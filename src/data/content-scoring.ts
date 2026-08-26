/**
 * Cómo baja la puntuación de contenido de un archivo, en datos.
 *
 * Estaba escrito a mano dentro de un bloque de código en la página de
 * Metodología. Son las mismas cifras que aplica `_score_from_issues`
 * (`src/analysis/formats/tabular.py`), y ya hemos visto una vez lo que pasa
 * cuando un número publicado vive solo en la prosa: el tope de descarga estuvo
 * meses diciendo 25 MB cuando el análisis usaba 512.
 *
 * Aquí viven una vez y `content-scoring.test.ts` las contrasta contra el fuente
 * de Python, igual que `pipeline-limits.test.ts` hace con los topes.
 *
 * La fórmula real, para leer esta tabla:
 *
 *   score = 100 − min(60, 15 × nº de TIPOS de incidencia grave)
 *   score = score − 5 × nº de TIPOS de incidencia leve
 *   si el total de CASOS graves > 1000: score = score − 10
 *   score acotado entre 0 y 100
 *
 * Penaliza tipos y no casos a propósito: un CSV con 9.000 celdas vacías del
 * mismo tipo tiene un problema, no nueve mil.
 */
export interface ContentPenalty {
  /** Qué provoca el descuento. */
  concept: string;
  /** Cuánto resta, en puntos. Positivo; el signo lo pone la interfaz. */
  points: number;
  /** El tope o la matización, si la tiene. */
  note: string;
}

/** Nota de partida de cualquier archivo legible. */
export const CONTENT_START = 100;

/** Tope acumulado de lo que pueden restar las incidencias graves. */
export const CONTENT_ERROR_CAP = 60;

/** A partir de cuántos casos graves se aplica el descuento extra por volumen. */
export const CONTENT_BULK_THRESHOLD = 1000;

export const CONTENT_PENALTIES: ContentPenalty[] = [
  {
    concept: 'Por cada tipo de incidencia grave',
    points: 15,
    note: `Hasta un máximo de −${CONTENT_ERROR_CAP} entre todas`,
  },
  {
    concept: 'Por cada tipo de incidencia leve',
    points: 5,
    note: 'Sin tope',
  },
  {
    concept: `Si el total de casos graves pasa de ${CONTENT_BULK_THRESHOLD.toLocaleString('es-ES')}`,
    points: 10,
    note: 'Una sola vez, sea cual sea el exceso',
  },
];
