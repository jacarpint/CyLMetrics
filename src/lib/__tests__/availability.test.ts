import { describe, it, expect } from 'vitest';
import {
  classifyDelivery,
  deliveryCause,
  distributionsAffectedByIssue,
  findSystemicCauses,
  groupByField,
  summarizeDelivery,
  type BrokenFileRow,
} from '../availability';
import type { DistributionResult, QualityReport } from '../quality-report';

function dist(partial: Partial<DistributionResult> & { status: DistributionResult['status'] }): DistributionResult {
  return {
    dataset_index: 0,
    dataset_id: 'https://example.org/ds/1',
    dataset_title: 'Dataset',
    format: 'CSV',
    mime: '',
    url: 'https://example.org/a.csv',
    fetch: null,
    analysis: null,
    duration_ms: 0,
    ...partial,
  } as DistributionResult;
}

function withIssues(status: DistributionResult['status'], codes: string[], format = 'CSV'): DistributionResult {
  return dist({
    status,
    format,
    analysis: {
      ok: false,
      score: null,
      summary: '',
      metrics: {},
      issues: codes.map((code) => ({ code, label: code, severity: 'error' as const, count: 1 })),
    },
  });
}

describe('classifyDelivery', () => {
  it('ok cuando la distribución se analizó bien', () => {
    expect(classifyDelivery(dist({ status: 'ok' }))).toBe('ok');
  });

  it('roto cuando falla la descarga o el análisis', () => {
    expect(classifyDelivery(withIssues('error', ['descarga']))).toBe('roto');
    expect(classifyDelivery(withIssues('error', ['zip-invalido']))).toBe('roto');
  });

  // El caso que engine.py marcaba "skipped" y alerts.ts trataba como bloqueante.
  it('no-entrega cuando la URL devuelve una página en vez del archivo', () => {
    expect(classifyDelivery(withIssues('skipped', ['no-es-archivo']))).toBe('no-entrega');
    expect(classifyDelivery(withIssues('skipped', ['no-es-imagen']))).toBe('no-entrega');
  });

  it('no-entrega manda sobre roto: el motivo es más específico que el estado', () => {
    expect(classifyDelivery(withIssues('error', ['no-es-archivo']))).toBe('no-entrega');
  });

  it('omitida para el resto de saltos del analizador', () => {
    expect(classifyDelivery(dist({ status: 'skipped' }))).toBe('omitida');
  });
});

describe('deliveryCause', () => {
  it('no hay causa si la distribución está bien', () => {
    expect(deliveryCause(dist({ status: 'ok' }))).toBeNull();
  });

  it('prioriza el código bloqueante sobre el resto', () => {
    const d = withIssues('error', ['celda-faltante', 'descarga']);
    expect(deliveryCause(d)?.code).toBe('descarga');
  });

  it('cae al primer código cuando ninguno es bloqueante', () => {
    expect(deliveryCause(withIssues('error', ['error-tipo']))?.code).toBe('error-tipo');
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
                  { code: 'celda-faltante', label: '', severity: 'warning' as const, count: 9072 },
                  { code: 'celda-faltante', label: '', severity: 'warning' as const, count: 5 },
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

describe('findSystemicCauses', () => {
  const rows = (n: number, format: string, causeCode: string, ds = (i: number) => `d${i}`): BrokenFileRow[] =>
    Array.from({ length: n }, (_, i) => ({
      datasetSlug: ds(i), datasetTitle: 'x', publisher: 'Org', category: 'c',
      format, url: 'u', distIdx: 0, state: 'roto' as const, causeCode, causeLabel: causeCode,
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
  const mk = (category: string, slug: string): BrokenFileRow => ({
    datasetSlug: slug, datasetTitle: 't', publisher: 'org', category, format: 'CSV',
    url: 'u', distIdx: 0, state: 'roto', causeCode: 'descarga', causeLabel: 'Descarga',
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
