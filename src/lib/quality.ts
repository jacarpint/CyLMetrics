import type { DatasetStatus } from '@/lib/types';
import { datasetAvailabilityPct } from '@/lib/availability';
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
  return Math.round(
    SCORE_WEIGHTS.metadata * (metadata ?? 0) +
      SCORE_WEIGHTS.availability * availability +
      SCORE_WEIGHTS.content * (content ?? 0)
  );
}

/** Score compuesto de un dataset a partir de su ficha del informe de análisis. */
export function scoreForDataset(
  metadataScore: number | null,
  reportDataset: QualityDatasetSummary | null | undefined
): number | null {
  return compositeScore({
    metadata: metadataScore,
    availability: datasetAvailabilityPct(reportDataset),
    content: reportDataset?.score ?? null,
  });
}

/**
 * Nivel de calidad de una puntuación 0-100. Es el único sitio donde viven los
 * umbrales: el resto de helpers derivan de aquí.
 */
export type ScoreLevel = 'ok' | 'warn' | 'bad';

export function getScoreLevel(score: number): ScoreLevel {
  if (score >= 80) return 'ok';
  if (score >= 50) return 'warn';
  return 'bad';
}

/**
 * Etiqueta textual del nivel. El color nunca puede ser el único portador de la
 * información (WCAG 1.4.1), así que las vistas acompañan el score con esto.
 */
export function getScoreLabel(score: number): string {
  const level = getScoreLevel(score);
  if (level === 'ok') return 'Buena';
  if (level === 'warn') return 'Mejorable';
  return 'Deficiente';
}

/** Color de texto según la puntuación de calidad (token, voltea con el tema). */
export function getScoreColor(score: number): string {
  const level = getScoreLevel(score);
  if (level === 'ok') return 'text-ok';
  if (level === 'warn') return 'text-warn';
  return 'text-bad';
}

/** Color de borde según la puntuación de calidad. */
export function getScoreBorderColor(score: number): string {
  const level = getScoreLevel(score);
  if (level === 'ok') return 'border-ok-solid';
  if (level === 'warn') return 'border-warn-solid';
  return 'border-bad-solid';
}

/**
 * Color de trazo SVG según la puntuación. Devuelve la variable CSS, no un hex,
 * para que el anillo también cambie al alternar de tema sin volver a renderizar.
 */
export function getScoreStroke(score: number): string {
  const level = getScoreLevel(score);
  if (level === 'ok') return 'var(--ok-solid)';
  if (level === 'warn') return 'var(--warn-solid)';
  return 'var(--bad-solid)';
}

/** Clase bg para el fondo del score según puntuación. */
export function getScoreBg(score: number): string {
  const level = getScoreLevel(score);
  if (level === 'ok') return 'bg-ok-surface';
  if (level === 'warn') return 'bg-warn-surface';
  return 'bg-bad-surface';
}

/** Clase de relleno (barras, segmentos) según puntuación. */
export function getScoreFill(score: number): string {
  const level = getScoreLevel(score);
  if (level === 'ok') return 'bg-ok-solid';
  if (level === 'warn') return 'bg-warn-solid';
  return 'bg-bad-solid';
}

export function getStatusBadgeVariant(status: DatasetStatus): 'success' | 'warning' | 'destructive' {
  if (status === 'healthy') return 'success';
  if (status === 'warning') return 'warning';
  return 'destructive';
}

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
