import { describe, it, expect } from 'vitest';
import {
  classifyDelivery,
  deliveryCause,
  distributionsAffectedByIssue,
  findSystemicCauses,
  groupByField,
  reuseConsequences,
  summarizeDelivery,
  type FileIssueRow,
} from '../availability';
import type { DistributionResult, QualityReport } from '../quality-report';

/**
 * `fetch` por defecto: descargado. En el informe real TODAS las distribuciones
 * traen su objeto `fetch`, así que omitirlo aquí probaba un estado imposible.
 */
function fetchInfo(status = 'downloaded', httpStatus: number | null = 200) {
  return {
    status,
    size: 1024,
    http_status: httpStatus,
    duration_ms: 10,
    truncated: status === 'truncated',
    note: '',
    final_url: null,
  };
}

function dist(partial: Partial<DistributionResult> & { status: DistributionResult['status'] }): DistributionResult {
  return {
    dataset_index: 0,
    dataset_id: 'https://example.org/ds/1',
    dataset_title: 'Dataset',
    format: 'CSV',
    mime: '',
    url: 'https://example.org/a.csv',
    fetch: fetchInfo(),
    analysis: null,
    duration_ms: 0,
    ...partial,
  } as DistributionResult;
}

function withIssues(
  status: DistributionResult['status'],
  codes: string[],
  format = 'CSV',
  fetch = fetchInfo()
): DistributionResult {
  return dist({
    status,
    format,
    fetch,
    analysis: {
      ok: false,
      score: null,
      summary: '',
      metrics: {},
      issues: codes.map((code) => ({ code, label: code, severity: 'error' as const, count: 1, stored: 0 })),
    },
  });
}

describe('classifyDelivery', () => {
  it('ok cuando la distribución se analizó bien', () => {
    expect(classifyDelivery(dist({ status: 'ok' }))).toBe('ok');
  });

  it('roto cuando la descarga no trae el fichero', () => {
    for (const status of ['http_error', 'unreachable', 'service']) {
      expect(classifyDelivery(withIssues('error', ['descarga'], 'CSV', fetchInfo(status, 404))), status).toBe('roto');
    }
  });

  it('roto cuando llega pero no se puede interpretar', () => {
    expect(classifyDelivery(withIssues('error', ['json-invalido'], 'JSON'))).toBe('roto');
    expect(classifyDelivery(withIssues('error', ['zip-invalido'], 'SHP'))).toBe('roto');
    expect(classifyDelivery(withIssues('error', ['xlsx-invalido'], 'XLSX'))).toBe('roto');
  });

  /**
   * El fallo que sobredimensionaba el titular del portal. `engine.py` pone
   * `status: 'error'` en cuanto hay una incidencia de severidad error, y «tipos
   * mezclados» lo es: 328 de las 582 marcadas en error abren y traen filas.
   */
  it('NO es roto un fichero que abre y solo tiene problemas de contenido', () => {
    for (const code of [
      'error-tipo', 'encabezado-vacio', 'encabezado-duplicado',
      'fila-vacia', 'celda-extra', 'celda-faltante',
    ]) {
      expect(classifyDelivery(withIssues('error', [code])), code).toBe('ok');
    }
  });

  it('un fichero grande leído a medias sigue estando entregado', () => {
    expect(classifyDelivery(withIssues('error', ['error-tipo'], 'CSV', fetchInfo('truncated')))).toBe('ok');
  });

  it('la causa bloqueante manda sobre las de contenido', () => {
    expect(classifyDelivery(withIssues('error', ['error-tipo', 'json-invalido'], 'JSON'))).toBe('roto');
  });

  // El caso que engine.py marcaba "skipped" y alerts.ts trataba como bloqueante.
  it('no-entrega cuando la URL devuelve una página en vez del archivo', () => {
    expect(classifyDelivery(withIssues('skipped', ['no-es-archivo']))).toBe('no-entrega');
    expect(classifyDelivery(withIssues('skipped', ['no-es-imagen']))).toBe('no-entrega');
  });

  it('no-entrega manda sobre roto: el motivo es más específico que el estado', () => {
    expect(classifyDelivery(withIssues('error', ['no-es-archivo']))).toBe('no-entrega');
  });

  it('omitida cuando supera el tope de tamaño: no se llegó a comprobar', () => {
    expect(classifyDelivery(withIssues('skipped', [], 'CSV', fetchInfo('too_large', 200)))).toBe('omitida');
  });

  it('omitida para el resto de saltos del analizador', () => {
    expect(classifyDelivery(dist({ status: 'skipped' }))).toBe('omitida');
  });

  it('roto si no hay ni información de descarga', () => {
    expect(classifyDelivery(dist({ status: 'error', fetch: null }))).toBe('roto');
  });
});

describe('deliveryCause', () => {
  it('no hay causa si la distribución está bien', () => {
    expect(deliveryCause(dist({ status: 'ok' }))).toBeNull();
  });

  // Un problema de contenido no es un motivo de indisponibilidad: antes esta
  // función devolvía «Valores con tipo distinto» como si el fichero no abriera.
  it('no hay causa si el fichero abre, aunque el contenido traiga errores', () => {
    expect(deliveryCause(withIssues('error', ['error-tipo']))).toBeNull();
  });

  it('prioriza el código bloqueante sobre el resto', () => {
    const d = withIssues('error', ['celda-faltante', 'descarga'], 'CSV', fetchInfo('http_error', 404));
    expect(deliveryCause(d)?.code).toBe('descarga');
  });

  it('cae al estado de la descarga cuando no hay código bloqueante', () => {
    const d = withIssues('error', ['error-tipo'], 'CSV', fetchInfo('unreachable', null));
    expect(deliveryCause(d)).toMatchObject({
      code: 'unreachable',
      label: 'No se pudo contactar con el servidor',
    });
  });
});

describe('summarizeDelivery', () => {
  const report = {
    generated_at: '2026-08-10T13:18:40',
    totals: { distributions: 5, ok: 2, error: 2, skipped: 1, downloaded: 0, avg_score: null, bytes: 0 },
    by_format: {},
    datasets: [
      {
        dataset_id: 'a', dataset_title: 'A', dataset_index: 0,
        distributions: 3, analyzed: 1, failed: 1, skipped: 1, scores: [],
        issues_by_code: {}, score: null, coverage_pct: 0,
        distribution_results: [
          dist({ status: 'ok' }),
          withIssues('error', ['descarga']),
          withIssues('skipped', ['no-es-archivo']),
        ],
      },
      {
        dataset_id: 'b', dataset_title: 'B', dataset_index: 1,
        distributions: 2, analyzed: 1, failed: 1, skipped: 0, scores: [],
        issues_by_code: {}, score: null, coverage_pct: 0,
        distribution_results: [dist({ status: 'ok' }), dist({ status: 'ok' })],
      },
    ],
  } as unknown as QualityReport;

  it('cuenta cada estado por separado', () => {
    const s = summarizeDelivery(report);
    expect(s).toMatchObject({ total: 5, ok: 3, roto: 1, noEntrega: 1, omitida: 0 });
  });

  it('cuenta datasets afectados, no distribuciones', () => {
    const s = summarizeDelivery(report);
    expect(s.affectedDatasets).toBe(1);
    expect(s.totalDatasets).toBe(2);
  });

  it('sobrevive a la ausencia de informe', () => {
    expect(summarizeDelivery(null).total).toBe(0);
  });
});

describe('distributionsAffectedByIssue', () => {
  it('cuenta recursos afectados, no ocurrencias', () => {
    const report = {
      datasets: [
        {
          distribution_results: [
            // La misma distribución con la incidencia repetida cuenta una vez.
            dist({
              status: 'error',
              analysis: {
                ok: false, score: null, summary: '', metrics: {},
                issues: [
                  { code: 'celda-faltante', label: '', severity: 'warning' as const, count: 9072, stored: 9072 },
                  { code: 'celda-faltante', label: '', severity: 'warning' as const, count: 5, stored: 5 },
                ],
              },
            }),
            withIssues('error', ['descarga']),
          ],
        },
      ],
    } as unknown as QualityReport;

    const counts = distributionsAffectedByIssue(report);
    expect(counts['celda-faltante']).toBe(1);
    expect(counts['descarga']).toBe(1);
  });

  it('devuelve un objeto vacío sin informe', () => {
    expect(distributionsAffectedByIssue(null)).toEqual({});
  });
});

describe('reuseConsequences', () => {
  /** Informe con una distribución por cada código pedido. */
  function reportWith(codes: string[]): QualityReport {
    return {
      datasets: [{ distribution_results: codes.map((code) => withIssues('error', [code])) }],
    } as unknown as QualityReport;
  }

  it('agrupa los códigos que rompen la reutilización por el mismo motivo', () => {
    // Un encabezado vacío y uno duplicado son una sola consecuencia.
    const [consequence] = reuseConsequences(reportWith(['encabezado-vacio', 'encabezado-duplicado']));
    expect(consequence.icon).toBe('encabezado');
    expect(consequence.count).toBe(2);
  });

  it('omite las consecuencias que no ocurren en este catálogo', () => {
    const result = reuseConsequences(reportWith(['descarga']));
    expect(result.map((c) => c.icon)).toEqual(['enlace']);
  });

  it('lo que no abre va antes que lo que solo hay que limpiar, aunque afecte a menos', () => {
    // Tres archivos con tipos mezclados (aviso) contra uno sin descarga (crítico).
    const report = reportWith(['error-tipo', 'error-tipo', 'error-tipo', 'descarga']);
    const result = reuseConsequences(report);
    expect(result[0].icon).toBe('enlace');
    expect(result[0].severity).toBe('bad');
    expect(result[0].count).toBeLessThan(result[1].count);
  });

  it('entre consecuencias de la misma gravedad manda el volumen', () => {
    const report = reportWith(['error-tipo', 'error-tipo', 'encabezado-vacio']);
    expect(reuseConsequences(report).map((c) => c.icon)).toEqual(['tipo', 'encabezado']);
  });

  it('sin informe no hay consecuencias que contar', () => {
    expect(reuseConsequences(null)).toEqual([]);
  });
});

describe('findSystemicCauses', () => {
  const rows = (n: number, format: string, causeCode: string, ds = (i: number) => `d${i}`): FileIssueRow[] =>
    Array.from({ length: n }, (_, i) => ({
      datasetSlug: ds(i), datasetTitle: 'x', category: 'c', family: 'entrega' as const,
      format, url: 'u', distSlug: format.toLowerCase(), state: 'roto' as const, causeCode,
    }));

  it('marca wholeFormat cuando el fallo alcanza a todos los recursos del formato', () => {
    const causes = findSystemicCauses(rows(32, 'GML', 'descarga'), { GML: 32, CSV: 700 });
    expect(causes[0]).toMatchObject({ format: 'GML', affected: 32, formatTotal: 32, wholeFormat: true });
  });

  it('no marca wholeFormat si solo falla una parte', () => {
    const causes = findSystemicCauses(rows(86, 'SHP', 'zip-invalido'), { SHP: 183 });
    expect(causes[0].wholeFormat).toBe(false);
  });

  it('el fallo de proceso va primero aunque afecte a menos recursos', () => {
    const causes = findSystemicCauses(
      [...rows(16, 'KML', 'descarga'), ...rows(86, 'SHP', 'zip-invalido', (i) => `s${i}`)],
      { KML: 16, SHP: 183 }
    );
    expect(causes[0].format).toBe('KML');
    expect(causes[1].format).toBe('SHP');
  });

  it('cuenta datasets distintos, no filas', () => {
    const causes = findSystemicCauses(rows(4, 'CSV', 'descarga', () => 'mismo'), { CSV: 10 });
    expect(causes[0]).toMatchObject({ affected: 4, datasets: 1 });
  });
});

describe('groupByField', () => {
  const mk = (category: string, slug: string): FileIssueRow => ({
    datasetSlug: slug, datasetTitle: 't', category, format: 'CSV', family: 'entrega',
    url: 'u', distSlug: 'csv', state: 'roto', causeCode: 'descarga',
  });

  it('ordena los grupos por recursos afectados', () => {
    const out = groupByField([mk('Medio ambiente', '1'), mk('Medio ambiente', '2'), mk('Salud', '3')], 'category');
    expect(out[0]).toEqual({ value: 'Medio ambiente', affected: 2, datasets: 2 });
    expect(out[1]).toEqual({ value: 'Salud', affected: 1, datasets: 1 });
  });

  it('cuenta datasets distintos, no filas', () => {
    const out = groupByField([mk('Salud', 'x'), mk('Salud', 'x')], 'category');
    expect(out[0]).toMatchObject({ affected: 2, datasets: 1 });
  });

  it('recoge los que no traen valor bajo una etiqueta común', () => {
    const out = groupByField([mk('', '1')], 'category');
    expect(out[0].value).toBe('Sin clasificar');
  });
});
