import { describe, it, expect } from 'vitest';
import {
  classifyDelivery,
  deliveryCause,
  distributionsAffectedByIssue,
  findSystemicCauses,
  formatContentScores,
  groupByField,
  reuseConsequences,
  summarizeDelivery,
  type FileIssueRow,
} from '../availability';
import type { DistributionResult, FetchStatus, QualityReport } from '../quality-report';
/**
 * `fetch` por defecto: descargado. En el informe real TODAS las distribuciones
 * traen su objeto `fetch`, así que omitirlo aquí probaba un estado imposible.
 */
function fetchInfo(status: FetchStatus = 'downloaded', httpStatus: number | null = 200) {
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
    // `error` NO está en esta lista, y antes sí. Los otros dos hablan del
    // origen —contestó mal o no contestó—, pero `error` habla de nosotros: es el
    // analizador el que se interrumpió, y eso no puede contarse como un archivo
    // que no abre. Ver el caso de los diez CSV de Educación más abajo.
    for (const status of ['http_error', 'unreachable'] as const) {
      expect(classifyDelivery(withIssues('error', ['descarga'], 'CSV', fetchInfo(status, 404))), status).toBe('roto');
    }
  });
  /**
   * Los 18 servicios del catálogo salían en rojo, todos, con el motivo «El
   * servicio de origen no atendió la petición»: `fetch.status: 'service'` lo
   * pone `engine.py` en cuanto ve un WMS o un WFS, antes de consultarlo, y aquí
   * se leía como una descarga fallida. El informe dice lo contrario —9 de 10 WMS
   * y 8 de 8 WFS declaran sus capas— y la vista previa las dibujaba.
   */
  it('un servicio OGC que responde no es un archivo roto', () => {
    expect(classifyDelivery(dist({ status: 'ok', format: 'WFS', fetch: fetchInfo('service', null) }))).toBe('ok');
    // `sin-capas` es un aviso del contenido del servicio, no un fallo de entrega.
    expect(classifyDelivery(withIssues('error', ['sin-capas'], 'WMS', fetchInfo('service', null)))).toBe('ok');
  });
  it('un servicio OGC caído sí es roto, por su código bloqueante', () => {
    for (const code of ['servicio-no-disponible', 'servicio-error']) {
      expect(
        classifyDelivery(withIssues('error', [code], 'WMS', fetchInfo('service', null))),
        code
      ).toBe('roto');
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
  /**
   * El caso de los 341 XLSX del informe: descarga correcta, HTTP 200, y el
   * análisis no llegó a mirar dentro porque no teníamos openpyxl instalado.
   * Antes caía en `omitida`, junto a los que ni se intentaron.
   */
  it('no-analizado cuando el archivo llega pero nos falta el lector', () => {
    expect(
      classifyDelivery(withIssues('skipped', ['dependencia-faltante'], 'XLSX'))
    ).toBe('no-analizado');
  });
  it('no-analizado también cuando el que falla es nuestro propio analizador', () => {
    expect(classifyDelivery(withIssues('error', ['fallo-analizador'], 'CSV'))).toBe('no-analizado');
    expect(classifyDelivery(withIssues('skipped', ['descarga-truncada'], 'SHP'))).toBe('no-analizado');
  });
  it('una causa bloqueante manda sobre la falta de lector', () => {
    // Si el ZIP está corrupto, eso lo sabemos y sí es del archivo.
    expect(
      classifyDelivery(withIssues('error', ['zip-invalido', 'dependencia-faltante'], 'SHP'))
    ).toBe('roto');
  });
  it('omitida cuando el catálogo no publica URL, no roto', () => {
    // `no_url` no estaba en ninguno de los dos conjuntos de `fetch.status`, así
    // que caía al respaldo «fallido» y se contaba como un archivo que no abre.
    expect(classifyDelivery(dist({ status: 'skipped', fetch: fetchInfo('no_url', null) }))).toBe('omitida');
  });
  it('omitida cuando el fallo es del analizador, no del origen', () => {
    // `fetch.status: 'error'` significa «el análisis de este portal se
    // interrumpió», y así está documentado en `/api`. Caía al respaldo «fallido»
    // y salía como archivo roto, o sea que un fallo de casa se publicaba como un
    // fallo del organismo. Pasó con diez CSV de Educación: redirigen a una URL
    // con la `ó` de «Educación» sin escapar, `requests` no supo leer la cabecera
    // y el portal dijo «No se pudo descargar» de diez archivos que se descargan
    // sin problema. Ver `_redirect_target` en `downloader.py`.
    expect(classifyDelivery(dist({ status: 'error', fetch: fetchInfo('error', null) }))).toBe(
      'omitida'
    );
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
  /**
   * El fallo que se veía en producción, fijado aquí.
   *
   * La tabla de archivos enseñaba «downloaded» de motivo, en inglés, con HTTP 200
   * al lado y «openpyxl no está instalado» como resumen: tres datos correctos que
   * juntos no explicaban nada. El motivo se buscaba en `fetch.status` sin
   * comprobar antes si los bytes habían llegado.
   */
  it('con la descarga correcta, el motivo es nuestro código y NO el fetch.status', () => {
    const d = withIssues('skipped', ['dependencia-faltante'], 'XLSX', fetchInfo('downloaded', 200));
    expect(deliveryCause(d)).toMatchObject({
      code: 'dependencia-faltante',
      label: 'Este portal no dispone de lector para este formato',
    });
  });
  /**
   * `service` no describe ningún fallo: dice que el recurso es un servicio. Si
   * un WMS está caído, el motivo tiene que ser el código del analizador OGC.
   */
  it('el motivo de un servicio caído es su código, no «service»', () => {
    const d = withIssues('error', ['servicio-no-disponible'], 'WMS', fetchInfo('service', null));
    expect(deliveryCause(d)).toMatchObject({
      code: 'servicio-no-disponible',
      label: 'El servicio de mapas no responde',
    });
  });
  it('nunca devuelve un estado de descarga cuando los bytes llegaron', () => {
    for (const status of ['downloaded', 'truncated'] as const) {
      const d = withIssues('skipped', ['dependencia-faltante'], 'XLSX', fetchInfo(status, 200));
      expect(deliveryCause(d)?.code, status).not.toBe(status);
    }
  });
  it('la etiqueta del motivo nunca es el código en crudo', () => {
    const casos = [
      withIssues('skipped', ['dependencia-faltante'], 'XLSX'),
      withIssues('error', ['descarga'], 'CSV', fetchInfo('http_error', 404)),
      dist({ status: 'skipped', fetch: fetchInfo('no_url', null) }),
      dist({ status: 'error', fetch: null }),
    ];
    for (const d of casos) {
      const cause = deliveryCause(d);
      expect(cause?.label, cause?.code).not.toBe(cause?.code);
    }
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
describe('formatContentScores', () => {
  /** Con nota: `withIssues` deja `score: null`, así que hay que ponerla. */
  function scored(score: number | null, codes: string[], format: string, fetch = fetchInfo()) {
    const d = withIssues(codes.length ? 'error' : 'ok', codes, format, fetch);
    return { ...d, analysis: { ...d.analysis!, score } } as DistributionResult;
  }
  const report = {
    generated_at: '2026-08-13T20:47:16Z',
    totals: { distributions: 0, ok: 0, error: 0, skipped: 0, downloaded: 0, avg_score: null, bytes: 0 },
    by_format: {},
    datasets: [
      {
        dataset_id: 'a', dataset_title: 'A', dataset_index: 0,
        distributions: 0, analyzed: 0, failed: 0, skipped: 0, scores: [],
        issues_by_code: {}, score: null, coverage_pct: 0,
        distribution_results: [
          // XLSX: las dos notas son ceros de «no teníamos openpyxl».
          scored(0, ['dependencia-faltante'], 'XLSX'),
          scored(0, ['dependencia-faltante'], 'XLSX'),
          // CSV: una nota real y otra contaminada por un fallo nuestro.
          scored(80, ['celda-faltante'], 'CSV'),
          scored(0, ['fallo-analizador'], 'CSV'),
          // Un cero legítimo: el archivo dice ser imagen y es una página web.
          scored(0, ['no-es-imagen'], 'JPEG'),
          // Un servicio OGC: no descarga archivo, pero se analizó de verdad.
          scored(90, [], 'WMS', fetchInfo('service', 200)),
        ],
      },
    ],
  } as unknown as QualityReport;
  it('un formato cuyas únicas notas son ceros nuestros no puntúa: «—», no cero', () => {
    expect(formatContentScores(report).XLSX).toEqual({ scored: 0, avgScore: null });
  });
  it('descarta la nota contaminada y conserva la real', () => {
    expect(formatContentScores(report).CSV).toEqual({ scored: 1, avgScore: 80 });
  });
  it('un cero que sí habla del archivo se queda', () => {
    expect(formatContentScores(report).JPEG).toEqual({ scored: 1, avgScore: 0 });
  });
  /**
   * Un WMS no descarga ningún archivo y su nota sale del análisis de las
   * capacidades, así que tiene que sobrevivir a cualquier filtro de entrega.
   */
  it('los servicios OGC conservan su nota aunque no entreguen archivo', () => {
    expect(formatContentScores(report).WMS).toEqual({ scored: 1, avgScore: 90 });
  });
  it('sobrevive a la ausencia de informe', () => {
    expect(formatContentScores(null)).toEqual({});
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
  /**
   * El recuento cuenta ARCHIVOS, que es lo que dice la tarjeta, y no la suma de
   * los recuentos de cada código. Con la suma, un archivo que trae las dos cosas
   * se contaba dos veces: sobre el informe real la tarjeta decía «164 archivos
   * afectados» cuando los archivos distintos eran 136, porque 28 tienen a la vez
   * el encabezado vacío y encabezados duplicados. Mientras la tarjeta no enlazaba
   * a ningún sitio el error era invisible; con el enlace puesto, la tabla la
   * desmiente.
   */
  it('un archivo con dos códigos del mismo grupo se cuenta una vez', () => {
    const report = {
      datasets: [
        {
          distribution_results: [
            withIssues('error', ['encabezado-vacio', 'encabezado-duplicado']),
          ],
        },
      ],
    } as unknown as QualityReport;
    const [consequence] = reuseConsequences(report);
    expect(consequence.count).toBe(1);
  });
  it('lleva los códigos del grupo, para poder enlazar a la tabla filtrada', () => {
    const [consequence] = reuseConsequences(reportWith(['encabezado-vacio']));
    expect(consequence.codes).toEqual(['encabezado-vacio', 'encabezado-duplicado']);
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
