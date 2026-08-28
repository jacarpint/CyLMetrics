import { datasetAvailabilityPct, datasetContentScore } from '@/lib/availability';
import type { QualityDatasetSummary } from '@/lib/quality-report';

/**
 * Pesos del score compuesto.
 *
 * Antes eran metadatos y contenido al 50%, y la disponibilidad no entraba:
 * como el análisis no devuelve score de contenido cuando NINGÚN archivo se
 * puede abrir, `combineScore(100, null)` devolvía 100. Resultado: 388 de 824
 * datasets sin una sola distribución utilizable podían lucir nota alta.
 * Con la disponibilidad como eje propio, eso ya no puede pasar.
 */
export const SCORE_WEIGHTS = { metadata: 0.4, availability: 0.3, content: 0.3 } as const;

/**
 * Pesos de los cuatro factores del eje de metadatos, que `computeQuality` aplica.
 *
 * Viven aquí y no junto al cálculo porque la página de Metodología los publica:
 * estaban escritos a mano en su tabla y otra vez como números sueltos dentro de
 * la fórmula, así que cambiar un peso dejaba la metodología documentando algo
 * que el código ya no hacía. Ahora los dos leen de aquí.
 */
export const METADATA_WEIGHTS = {
  completeness: 0.4,
  formats: 0.25,
  freshness: 0.25,
  license: 0.1,
} as const;

/**
 * Nota mínima de cada nivel de calidad.
 *
 * Había cuatro copias de estos dos números —el cálculo del catálogo, el del
 * informe, este módulo y el texto de la metodología— y nada obligaba a que
 * coincidieran.
 */
export const SCORE_THRESHOLDS = { ok: 80, warn: 50 } as const;

export interface ScoreInputs {
  /** Score de metadatos del catálogo DCAT (0-100). */
  metadata: number | null;
  /** % de distribuciones que se descargan y abren (0-100), o null si no se analizó. */
  availability: number | null;
  /** Score de contenido del análisis (0-100), o null si no hubo nada analizable. */
  content: number | null;
}

/**
 * Score compuesto 0-100 a partir de los tres ejes.
 *
 * Si `availability` es null el dataset nunca se analizó, así que no se puede
 * afirmar nada sobre sus archivos y se devuelve el score de metadatos tal cual.
 * Si sí se analizó, `content` a null significa que no quedó nada legible que
 * medir, y eso cuenta como cero: no es ausencia de dato, es el peor caso.
 */
export function compositeScore({ metadata, availability, content }: ScoreInputs): number | null {
  if (availability == null) return metadata == null ? null : Math.round(metadata);

  const weighted = Math.round(
    SCORE_WEIGHTS.metadata * (metadata ?? 0) +
      SCORE_WEIGHTS.availability * availability +
      SCORE_WEIGHTS.content * (content ?? 0)
  );

  /*
   * Para poder ser «Buena», la disponibilidad también tiene que ser «Buena».
   *
   * Con la disponibilidad como sumando del 30% y nada más, el portal reproducía
   * en pequeño el defecto que le reprocha a los demás observatorios: una nota
   * alta tapando archivos caídos. La aritmética lo permitía sin ningún caso
   * raro —metadatos 100, disponibilidad 50, contenido 100 da 85, o sea «Buena»
   * con la mitad del conjunto inservible—, y en el informe del 27 de agosto ya
   * lo hacía de verdad con 11 conjuntos: 6 con 2 de 3 archivos y 5 con 3 de 4.
   *
   * Un eje del que la metodología dice que es BLOQUEANTE no puede quedarse en
   * sumando, porque un sumando siempre se puede compensar con los otros dos.
   * Así que actúa además como techo, y solo sobre el tramo alto: es el único
   * que hace una afirmación tranquilizadora. «Deficiente» y «Mejorable» no
   * prometen nada, así que ahí no hay nada que la disponibilidad deba impedir.
   *
   * El umbral es el mismo `SCORE_THRESHOLDS.ok` a los dos lados de la
   * comparación, a propósito: la regla se lee «tu disponibilidad tiene que
   * sacar la nota que tú quieres sacar» y no añade ninguna constante que haya
   * que justificar aparte.
   *
   * Es proporcionada por construcción: se cae quien pierde un tercio o un cuarto
   * de sus archivos, no quien pierde 1 de 8. Ese caso sigue pudiendo ser «Buena»
   * —y la ficha del catálogo marca su formato roto igualmente—, lo que queda
   * declarado en los límites conocidos de la metodología.
   */
  if (availability < SCORE_THRESHOLDS.ok) return Math.min(weighted, SCORE_THRESHOLDS.ok - 1);
  return weighted;
}

/**
 * Score compuesto de un dataset a partir de su ficha del informe de análisis.
 *
 * Los dos ejes que dependen de los archivos se derivan de
 * `distribution_results` con el criterio de `classifyDelivery`, no del `score`
 * que trae el informe: ese venía inflado por construcción (ver
 * `datasetContentScore`) y dejaba el 30% de contenido valiendo entre 95 y 100
 * para todos los conjuntos, así que no separaba a nadie de nadie.
 */
export function scoreForDataset(
  metadataScore: number | null,
  reportDataset: QualityDatasetSummary | null | undefined
): number | null {
  return compositeScore({
    metadata: metadataScore,
    availability: datasetAvailabilityPct(reportDataset),
    content: datasetContentScore(reportDataset),
  });
}

/**
 * Nivel de calidad de una puntuación 0-100. Es el único sitio donde viven los
 * umbrales: el resto de helpers derivan de aquí.
 */
export type ScoreLevel = 'ok' | 'warn' | 'bad';

export function getScoreLevel(score: number): ScoreLevel {
  if (score >= SCORE_THRESHOLDS.ok) return 'ok';
  if (score >= SCORE_THRESHOLDS.warn) return 'warn';
  return 'bad';
}

/**
 * Todo lo que depende del nivel, junto.
 *
 * Eran cuatro funciones con la misma cadena de `if` repetida, una por cada cosa
 * que se deriva del nivel. Cambiar la paleta obligaba a acertar en cuatro sitios
 * y nada avisaba si uno se quedaba atrás. Aquí una fila por nivel: si falta un
 * campo, no compila.
 *
 * `label` existe porque el color no puede ser el único portador de la
 * información (WCAG 1.4.1): las vistas acompañan siempre el número con el texto.
 * `stroke` devuelve la variable CSS y no un hexadecimal, para que el anillo del
 * medidor cambie al alternar de tema sin volver a renderizar.
 */
const SCORE_PRESENTATION: Record<
  ScoreLevel,
  { label: string; color: string; border: string; stroke: string; fill: string }
> = {
  ok: { label: 'Buena', color: 'text-ok', border: 'border-ok-solid', stroke: 'var(--ok-solid)', fill: 'bg-ok-solid' },
  warn: { label: 'Mejorable', color: 'text-warn', border: 'border-warn-solid', stroke: 'var(--warn-solid)', fill: 'bg-warn-solid' },
  bad: { label: 'Deficiente', color: 'text-bad', border: 'border-bad-solid', stroke: 'var(--bad-solid)', fill: 'bg-bad-solid' },
};

/** Etiqueta textual del nivel de calidad. */
export function getScoreLabel(score: number): string {
  return SCORE_PRESENTATION[getScoreLevel(score)].label;
}

/** Color de texto según la puntuación (token, voltea con el tema). */
export function getScoreColor(score: number): string {
  return SCORE_PRESENTATION[getScoreLevel(score)].color;
}

/** Color de borde según la puntuación. */
export function getScoreBorderColor(score: number): string {
  return SCORE_PRESENTATION[getScoreLevel(score)].border;
}

/** Color de trazo SVG según la puntuación. */
export function getScoreStroke(score: number): string {
  return SCORE_PRESENTATION[getScoreLevel(score)].stroke;
}

/**
 * Los tres niveles con su rango, de peor a mejor, para poder pintar la escala sin
 * repetir en la interfaz ni los números ni las etiquetas ni los colores.
 *
 * Hay dos formas de expresar el mismo tramo y las dos hacen falta:
 *
 * - `min`/`max` son notas enteras, para rotularlo («50–79»).
 * - `width` es la porción de la escala 0–100 que ocupa, para dibujarlo. Se mide
 *   con el límite superior excluido, así que los tres suman exactamente 100.
 *   Va proporcional al rango real y no a un tercio por tramo, porque «deficiente»
 *   abarca la mitad de la escala y «buena» solo una quinta parte.
 */
export const SCORE_LEVELS = [
  { level: 'bad' as const, min: 0, upperBound: SCORE_THRESHOLDS.warn },
  { level: 'warn' as const, min: SCORE_THRESHOLDS.warn, upperBound: SCORE_THRESHOLDS.ok },
  { level: 'ok' as const, min: SCORE_THRESHOLDS.ok, upperBound: 100 },
].map(({ level, min, upperBound }, i, bands) => ({
  level,
  min,
  /** Nota más alta del tramo. El último llega a 100; los demás, al umbral menos 1. */
  max: i === bands.length - 1 ? 100 : upperBound - 1,
  label: SCORE_PRESENTATION[level].label,
  color: SCORE_PRESENTATION[level].color,
  /**
   * Clase de relleno, tomada literal de la tabla y no compuesta como
   * `bg-${level}-solid`: Tailwind solo genera las clases que encuentra escritas
   * en el código, y una compuesta en tiempo de ejecución sale sin estilo.
   */
  fill: SCORE_PRESENTATION[level].fill,
  width: upperBound - min,
}));

/**
 * Humaniza una fecha ISO en castellano relativo al momento actual.
 * Ej.: "hace 3 horas", "hace 2 días", "hace 1 año".
 */
export function timeAgo(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'desconocido';

  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return 'futuro';
  if (seconds < 60) return 'hace menos de 1 minuto';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} día${days === 1 ? '' : 's'}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;

  const years = Math.floor(months / 12);
  return `hace ${years} año${years === 1 ? '' : 's'}`;
}
