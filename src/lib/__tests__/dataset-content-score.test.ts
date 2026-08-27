import { describe, it, expect } from 'vitest';
import { datasetContentScore, summarizeContent } from '@/lib/availability';
import { getQualityReport } from '@/lib/quality-report';
import { getScoreLevel } from '@/lib/quality';
import type { DistributionResult, FetchStatus, QualityDatasetSummary } from '@/lib/quality-report';

/**
 * La calidad de contenido de un conjunto de datos.
 *
 * El fallo que fijan estos tests: `report.py` promediaba solo las distribuciones
 * con `status == 'ok'`, y `engine.py` pone `status: 'error'` ante cualquier
 * incidencia de severidad error —«tipos mezclados en una columna» lo es—. O sea
 * que la media que mide cómo de limpio está el contenido dejaba fuera justo los
 * archivos con el contenido sucio. En el informe del 14 de agosto eso descartaba
 * 533 de las 1.478 notas y, entre ellas, TODAS las que bajan de 80: los 430
 * conjuntos puntuados salían entre 95 y 100.
 */

function fetchInfo(status: FetchStatus = 'downloaded') {
  return {
    status,
    size: 1024,
    http_status: status === 'service' ? null : 200,
    duration_ms: 10,
    truncated: status === 'truncated',
    note: '',
    final_url: null,
  };
}

/** Una distribución con su nota y, opcionalmente, códigos de incidencia. */
function dist(
  status: DistributionResult['status'],
  score: number | null,
  codes: string[] = [],
  fetchStatus: FetchStatus = 'downloaded'
): DistributionResult {
  return {
    dataset_index: 0,
    dataset_id: 'https://example.org/ds/1',
    dataset_title: 'Dataset',
    format: 'CSV',
    mime: '',
    url: `https://example.org/${codes.join('-') || 'a'}-${score}.csv`,
    // Sin esto `classifyDelivery` cae a `omitida` por su rama final y todo
    // devuelve null: es el propio criterio que estos tests fijan.
    status,
    fetch: fetchInfo(fetchStatus),
    analysis: {
      ok: status === 'ok',
      score,
      summary: '',
      metrics: {},
      issues: codes.map((code) => ({
        code,
        label: code,
        severity: 'error' as const,
        count: 1,
        stored: 0,
      })),
    },
    duration_ms: 0,
  } as DistributionResult;
}

function dataset(...results: DistributionResult[]): Pick<QualityDatasetSummary, 'distribution_results'> {
  return { distribution_results: results };
}

describe('datasetContentScore', () => {
  it('promedia los archivos que abren, aunque el analizador los marque en error', () => {
    // El caso exacto del fallo: un CSV limpio y otro con tipos mezclados. El
    // segundo llega con `status: 'error'` y antes desaparecía de la media, así
    // que el conjunto sacaba 100 en vez de 60.
    const ds = dataset(dist('ok', 100), dist('error', 20, ['error-tipo']));
    expect(datasetContentScore(ds)).toBe(60);
  });

  it('deja fuera los archivos que no se pueden abrir', () => {
    // Un JSON inválido no tiene contenido que medir: su cero es del eje de
    // disponibilidad, no de este. Contarlo aquí penalizaría dos veces lo mismo.
    const ds = dataset(dist('ok', 90), dist('error', 0, ['json-invalido']));
    expect(datasetContentScore(ds)).toBe(90);
  });

  it('deja fuera lo que no pudimos leer nosotros', () => {
    // 341 XLSX del informe del 13 de agosto entraron como cero por no tener
    // `openpyxl` instalado. Eso mide nuestro entorno, no el archivo.
    const ds = dataset(dist('ok', 80), dist('skipped', 0, ['dependencia-faltante']));
    expect(datasetContentScore(ds)).toBe(80);
  });

  it('deja fuera la URL que devuelve una página web en vez del archivo', () => {
    const ds = dataset(dist('ok', 70), dist('skipped', 0, ['no-es-archivo']));
    expect(datasetContentScore(ds)).toBe(70);
  });

  it('no cuenta lo que ni se llegó a descargar', () => {
    const ds = dataset(dist('ok', 60), dist('skipped', null, [], 'too_large'));
    expect(datasetContentScore(ds)).toBe(60);
  });

  it('cuenta los servicios OGC, que no descargan ningún archivo', () => {
    // Un WMS se juzga por sus capacidades: `fetch.status: 'service'` no es un
    // fallo de descarga y su nota es tan válida como la de un CSV.
    const ds = dataset(dist('ok', 50, [], 'service'));
    expect(datasetContentScore(ds)).toBe(50);
  });

  it('devuelve null cuando no queda nada legible que medir', () => {
    // Null y no cero: la ausencia la interpreta `compositeScore`, que solo la
    // cuenta como cero si el conjunto sí se llegó a comprobar.
    expect(datasetContentScore(dataset(dist('error', 0, ['descarga'])))).toBeNull();
    expect(datasetContentScore(dataset())).toBeNull();
    expect(datasetContentScore(null)).toBeNull();
    expect(datasetContentScore(undefined)).toBeNull();
  });

  it('redondea a entero, que es como se pinta', () => {
    expect(datasetContentScore(dataset(dist('ok', 90), dist('ok', 95)))).toBe(93);
  });
});

const report = getQualityReport();

describe.skipIf(!report)('sobre el informe real que hay en el repositorio', () => {
  const scores = report!.datasets.map((ds) => datasetContentScore(ds));
  const puntuados = scores.filter((s): s is number => s != null);

  it('las notas se reparten por toda la escala, no solo por encima de 80', () => {
    // La firma del fallo: con la nota del informe, el mínimo era 95. Si este
    // test vuelve a ver un suelo alto, alguien ha vuelto a filtrar por `status`.
    expect(Math.min(...puntuados)).toBeLessThan(80);
    expect(Math.max(...puntuados)).toBeGreaterThan(80);
  });

  it('los cubos «mejorable» y «deficiente» dejan de estar vacíos', () => {
    // `/api/quality` publica este reparto con sus umbrales. Mientras la nota
    // salía del informe, `fair` y `poor` valían 0 SIEMPRE: se documentaban unos
    // tramos («50-79», «< 50») que era imposible llenar.
    const niveles = { ok: 0, warn: 0, bad: 0 };
    for (const score of puntuados) niveles[getScoreLevel(score)]++;
    expect(niveles.warn).toBeGreaterThan(0);
    expect(niveles.bad).toBeGreaterThan(0);
  });

  /**
   * Paridad con la nota que escribe `report.py`.
   *
   * Aquí se exigía que la nota derivada midiera MÁS conjuntos que la del
   * informe. Era cierto mientras `aggregate()` descartaba de la media toda
   * distribución que no tuviera `status == 'ok'`; corregido eso, las dos
   * coinciden y el test fallaba precisamente porque el fallo ya no estaba.
   *
   * Lo que se fija ahora es la coincidencia, que es un invariante mucho más
   * fuerte: dos implementaciones del mismo criterio, una en Python y otra en
   * TypeScript, contrastadas sobre el catálogo entero.
   *
   * Se admite un punto de diferencia porque los dos lenguajes redondean distinto:
   * `round()` de Python va al par (`round(92.5) == 92`) y `Math.round` sube
   * siempre (`93`). Son 22 conjuntos de 831 y no se ve en ninguna parte, porque
   * el portal deriva la nota en TypeScript; documentarlo vale más que forzar a
   * uno de los dos a imitar al otro.
   */
  it('coincide con la nota que escribe el analizador', () => {
    const discrepan: string[] = [];
    for (const ds of report!.datasets) {
      const derivada = datasetContentScore(ds);
      if (derivada == null && ds.score == null) continue;
      if (derivada == null || ds.score == null) {
        discrepan.push(`${ds.dataset_id}: python=${ds.score} ts=${derivada}`);
      } else if (Math.abs(derivada - ds.score) > 1) {
        discrepan.push(`${ds.dataset_id}: python=${ds.score} ts=${derivada}`);
      }
    }
    expect(discrepan, discrepan.slice(0, 5).join('\n')).toEqual([]);
  });

  /**
   * La media global y la de cada conjunto tienen que salir del mismo criterio.
   * `summarizeContent` es la que pinta la portada; si una de las dos se filtra
   * por otro sitio, el portal publica dos cifras distintas del mismo hecho, que
   * es exactamente lo que pasaba entre la portada (90,3) y `totals.avg_score`
   * del informe (79,9).
   */
  it('comparte criterio con la media global de la portada', () => {
    const global = summarizeContent(report);
    let scored = 0;
    let sum = 0;
    for (const ds of report!.datasets) {
      const score = datasetContentScore(ds);
      if (score == null) continue;
      // Reconstruye el denominador contando las distribuciones que aportaron.
      scored++;
      sum += score;
    }
    expect(scored).toBeGreaterThan(0);
    // No comparamos las medias (una promedia archivos y la otra conjuntos), sino
    // que ninguna quede por debajo de la otra por filtrar de más.
    expect(global.avgScore).not.toBeNull();
    expect(Math.abs(global.avgScore! - sum / scored)).toBeLessThan(15);
  });
});
