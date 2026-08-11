/**
 * Triaje de datasets problemáticos del informe de análisis.
 *
 * Antes: cualquier dataset con ≥1 incidencia era una "alerta" (824/824), lo que
 * inundaba la página de Alertas y la hacía inutilizable como lista de corrección.
 *
 * Ahora: se priorizan las incidencias por impacto real en la reutilización:
 *   - CRÍTICO: el recurso es inutilizable (disponibilidad o conformidad de formato).
 *   - ADVERTENCIA: problemas de contenido con impacto (tipos, encabezados, filas,
 *     o un volumen alto de celdas vacías).
 * Las incidencias menores (celdas vacías esporádicas) no generan alerta.
 *
 * Módulo server-safe: depende de `quality-labels` (client-safe) y de tipos de
 * `quality-report`; puede importarse desde páginas servidor y route handlers.
 */

import type { QualityDatasetSummary, QualityReport } from './quality-report';
import { issueCategory, issueLabel, type IssueCategory } from './quality-labels';

export type AlertLevel = 'critical' | 'warning';

export interface AlertCause {
  code: string;
  label: string;
  count: number;
  category: IssueCategory;
}

export interface DatasetAlert {
  datasetId: string;
  title: string;
  score: number | null;
  level: AlertLevel;
  causes: AlertCause[];
  failedDistributions: number;
  totalDistributions: number;
}

/** Códigos que inutilizan el recurso (disponibilidad o conformidad de formato). */
const BLOCKING_ISSUE_CODES = new Set<string>([
  'descarga',
  'error-fuente',
  'no-es-archivo',
  'archivo-vacio',
  'servicio-no-disponible',
  'servicio-error',
  'no-es-imagen',
  'formato-no-esperado',
  'json-invalido',
  'xml-no-bien-formado',
  'xlsx-invalido',
  'zip-invalido',
  'tipo-no-identificado',
  'error-validacion',
  'error-esquema',
  'ical-invalido',
  'firma-invalida',
  'geojson-invalido',
  'raiz-invalida',
  'imagen-corrupta',
  'shp-faltante',
  'zip-extraccion',
  'shp-lectura',
]);

/** Códigos de impacto moderado: legibles pero con discrepancias o contenido erróneo. */
const HIGH_IMPACT_CONTENT_CODES = new Set<string>([
  'error-tipo',
  'celda-extra',
  'fila-vacia',
  'encabezado-vacio',
  'encabezado-duplicado',
  'fila-duplicada',
  'error-restriccion',
  'error-unico',
  'error-encoding',
  'xls-legado',
  'tipo-detectado',
  'sin-datos',
  'sin-contenido',
  'geometria-nula',
]);

/** Umbral de celdas vacías a partir del cual se considera incidencia accionable. */
const MISSING_CELL_THRESHOLD = 1000;

/** True si el código de incidencia inutiliza el recurso (disponibilidad/formato). */
export function isBlockingCode(code: string): boolean {
  return BLOCKING_ISSUE_CODES.has(code);
}

/**
 * Clasifica un dataset del informe en una alerta accionable, o null si solo
 * tiene incidencias menores (celdas vacías esporádicas) o ninguna.
 */
export function classifyDataset(ds: QualityDatasetSummary): DatasetAlert | null {
  const causes: AlertCause[] = [];
  let hasBlocking = false;
  let hasContent = false;

  for (const [code, count] of Object.entries(ds.issues_by_code)) {
    if (BLOCKING_ISSUE_CODES.has(code)) {
      hasBlocking = true;
      causes.push({ code, label: issueLabel(code), count, category: issueCategory(code) });
    } else if (
      HIGH_IMPACT_CONTENT_CODES.has(code) ||
      (code === 'celda-faltante' && count >= MISSING_CELL_THRESHOLD)
    ) {
      hasContent = true;
      causes.push({ code, label: issueLabel(code), count, category: issueCategory(code) });
    }
  }

  if (!hasBlocking && !hasContent) return null;

  const level: AlertLevel =
    hasBlocking || (ds.score != null && ds.score < 50) ? 'critical' : 'warning';

  causes.sort(
    (a, b) =>
      Number(isBlockingCode(b.code)) - Number(isBlockingCode(a.code)) || b.count - a.count
  );

  return {
    datasetId: ds.dataset_id,
    title: ds.dataset_title,
    score: ds.score,
    level,
    causes,
    failedDistributions: ds.failed,
    totalDistributions: ds.distributions,
  };
}

/** Construye la lista de alertas ordenadas por peor score primero. */
export function buildAlerts(report: QualityReport | null): DatasetAlert[] {
  if (!report) return [];
  const alerts = report.datasets
    .map(classifyDataset)
    .filter((a): a is DatasetAlert => a != null);
  alerts.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  return alerts;
}

/** Texto plano de las alertas para exportar (TXT). */
export function alertsToText(alerts: DatasetAlert[]): string {
  return alerts
    .map(
      (a) =>
        `[${a.level.toUpperCase()}] ${a.title} (${a.datasetId})\n` +
        `  Score: ${a.score ?? 'N/A'}%\n` +
        a.causes.map((c) => `  - ${c.label} (×${c.count})`).join('\n')
    )
    .join('\n\n');
}
