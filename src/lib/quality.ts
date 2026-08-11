import type { DatasetStatus } from '@/lib/types';

/**
 * Combina la puntuación de metadatos del catálogo (que ya pondera
 * completitud, formato, frescura y licencia) con la puntuación del análisis
 * de contenido en un único score de 0-100.
 * Si solo una está disponible, se usa esa; si ambas, media ponderada 50/50.
 */
export function combineScore(
  metadataScore: number | null,
  contentScore: number | null
): number | null {
  if (metadataScore == null && contentScore == null) return null;
  if (metadataScore == null) return Math.round(contentScore as number);
  if (contentScore == null) return Math.round(metadataScore);
  return Math.round(0.5 * metadataScore + 0.5 * contentScore);
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
