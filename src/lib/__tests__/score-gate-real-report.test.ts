import { describe, it, expect } from 'vitest';
import { getQualityReport } from '@/lib/quality-report';
import { datasetAvailabilityPct, datasetContentScore } from '@/lib/availability';
import { SCORE_THRESHOLDS, SCORE_WEIGHTS, getScoreLevel, scoreForDataset } from '@/lib/quality';

/**
 * La puerta de disponibilidad, comprobada sobre el informe real.
 *
 * `quality.test.ts` fija la regla con casos sintéticos. Esto comprueba que sobre
 * los datos publicados no queda ningún conjunto rotulado en el nivel bueno con
 * archivos que no abren, que es el defecto concreto que la puerta cierra: la
 * ponderación 40/30/30 dejaba que los otros dos ejes compensaran un eje declarado
 * bloqueante.
 *
 * Los dos tests se plantean como invariantes y no como recuentos, deliberadamente.
 * `delivery-real-report.test.ts` ya documenta lo que pasa si no: allí un test
 * exigía «hay más de cero archivos sin analizar» y acabó fallando justo cuando el
 * problema se resolvió. Un recuento de conjuntos afectados envejecería con el
 * siguiente análisis; estas propiedades valen para cualquier informe.
 */
const report = getQualityReport();

/** La ponderación pura, sin la puerta, para poder comprobar que no interfiere. */
function weightedOnly(metadata: number, availability: number, content: number | null): number {
  return Math.round(
    SCORE_WEIGHTS.metadata * metadata +
      SCORE_WEIGHTS.availability * availability +
      SCORE_WEIGHTS.content * (content ?? 0)
  );
}

describe.skipIf(!report)('la puerta de disponibilidad sobre el informe real', () => {
  /**
   * Se evalúa con metadatos perfectos a propósito.
   *
   * Es el caso más favorable posible, así que si con 100 de metadatos la nota
   * sigue sin alcanzar el nivel bueno, no lo alcanza con ninguna ficha. Así el
   * test no depende de lo que devuelva el parser del catálogo y comprueba solo lo
   * que le toca: que la disponibilidad manda en el tramo alto.
   */
  it('ningún conjunto con disponibilidad insuficiente puede quedar en el nivel bueno', () => {
    const colados: string[] = [];

    for (const ds of report!.datasets) {
      const availability = datasetAvailabilityPct(ds);
      if (availability == null || availability >= SCORE_THRESHOLDS.ok) continue;

      const score = scoreForDataset(100, ds);
      if (score != null && getScoreLevel(score) === 'ok') {
        colados.push(`${ds.dataset_id}: disponibilidad ${availability}% -> nota ${score}`);
      }
    }

    expect(
      colados,
      `Conjuntos en el nivel bueno con archivos que no abren:\n${colados.slice(0, 5).join('\n')}`
    ).toEqual([]);
  });

  /**
   * Un techo, no un descuento.
   *
   * Si la puerta restara puntos en lugar de topar, penalizaría dos veces: la
   * disponibilidad ya pesa su parte dentro de la ponderación. Sobre los conjuntos
   * que la superan, la nota tiene que salir idéntica a la de antes de existir la
   * puerta.
   */
  it('a los conjuntos con disponibilidad suficiente no les cambia la nota', () => {
    const alterados: string[] = [];

    for (const ds of report!.datasets) {
      const availability = datasetAvailabilityPct(ds);
      if (availability == null || availability < SCORE_THRESHOLDS.ok) continue;

      const content = datasetContentScore(ds);
      const conPuerta = scoreForDataset(100, ds);
      const sinPuerta = weightedOnly(100, availability, content);
      if (conPuerta !== sinPuerta) {
        alterados.push(`${ds.dataset_id}: ${sinPuerta} -> ${conPuerta}`);
      }
    }

    expect(alterados, alterados.slice(0, 5).join('\n')).toEqual([]);
  });
});
