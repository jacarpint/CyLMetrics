/**
 * Acceso server-side al informe de análisis de datos (frictionless) generado
 * por src/analysis (Python). Lee `reports/data-analysis.json` y lo expone
 * tipado, con una caché en memoria de 5 minutos.
 *
 * Este módulo SOLO debe importarse desde código de servidor (Server
 * Components o Route Handlers). No es apto para componentes cliente.
 */

import fs from 'node:fs';
import path from 'node:path';
import { datasetSlug } from './utils';

// Re-export para uso en servidor; los componentes cliente deben importar
// desde `./quality-labels` (este módulo usa node:fs y no puede empaquetarse
// en el bundle del cliente).
export {
  issueLabel, ISSUE_LABELS, categoryLabel, issueCategory, schemaTypeLabel,
  formatBytes, formatDuration, distributionVolume, analyzedCells,
} from './quality-labels';
export type { DistributionVolume, VolumeMetric } from './quality-labels';
import { distributionVolume } from './quality-labels';
import { datasetAvailabilityPct, formatStates, type FormatState } from './availability';
export type { IssueCategory } from './quality-labels';
import { issueCategory } from './quality-labels';

const REPORT_PATH = path.join(process.cwd(), 'reports', 'data-analysis.json');
const HISTORY_DIR = path.join(process.cwd(), 'reports', 'history');
const CACHE_MS = 5 * 60 * 1000;

export interface IssueSample {
  /** Row number (1-based, data row excluding header). */
  row?: number;
  /** Column/field name where the issue occurred. */
  field?: string;
  /** Column index (if field name not available). */
  field_index?: number;
  /** The specific cell value causing the issue. */
  cell?: string | null;
  /** Full row values (array of strings, may be truncated). */
  row_values?: (string | null)[];
  /** Header row (column names). */
  header?: (string | null)[];
}

export interface IssueInfo {
  code: string;
  label: string;
  severity: 'error' | 'warning';
  count: number;
  /** Sample instances of this issue with position and cell data for visual exploration. */
  samples?: IssueSample[];
}

export interface FetchInfo {
  status: string;
  size: number;
  http_status: number | null;
  duration_ms: number;
  truncated: boolean;
  note: string;
  final_url: string | null;
}

/** Campo del esquema inferido (sobre la muestra de datos analizada). */
export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'unknown';
  /** Celdas vacías en la muestra. */
  null_count: number;
  /** Proporción de celdas vacías (0..1). */
  null_pct: number;
  /** Valores distintos (capado a 1000). */
  distinct: number;
  /** Rango mínimo/máximo para columnas numéricas o de fecha. */
  min?: number | string;
  max?: number | string;
}

export interface AnalysisInfo {
  ok: boolean;
  score: number | null;
  summary: string;
  metrics: Record<string, unknown>;
  issues: IssueInfo[];
  truncated?: boolean;
  /** Esquema inferido para datos tabulares (CSV, XLSX, JSON). */
  schema?: SchemaField[];
  /** Primeras filas de la muestra de datos. */
  sample_rows?: (string | null)[][];
}

export type DistributionStatus = 'ok' | 'error' | 'skipped';

export interface DistributionResult {
  dataset_index: number;
  dataset_id: string;
  dataset_title: string;
  format: string;
  mime: string;
  url: string;
  status: DistributionStatus;
  fetch: FetchInfo | null;
  analysis: AnalysisInfo | null;
  duration_ms: number;
}

export interface QualityDatasetSummary {
  dataset_index: number;
  dataset_id: string;
  dataset_title: string;
  distributions: number;
  analyzed: number;
  failed: number;
  skipped: number;
  scores: number[];
  distribution_results: DistributionResult[];
  issues_by_code: Record<string, number>;
  score: number | null;
  coverage_pct: number;
}

export interface FormatSummary {
  total: number;
  ok: number;
  error: number;
  skipped: number;
  downloaded: number;
  avg_score: number | null;
  bytes: number;
  top_issues: Record<string, number>;
}

export interface QualityReport {
  generated_at: string;
  totals: {
    distributions: number;
    ok: number;
    error: number;
    skipped: number;
    downloaded: number;
    avg_score: number | null;
    bytes: number;
  };
  by_format: Record<string, FormatSummary>;
  datasets: QualityDatasetSummary[];
}

/** Resumen ligero para la tabla del cliente (evita serializar los 3 MB). */
export type QualityDatasetLite = {
  dataset_index: number;
  dataset_title: string;
  distributions: number;
  analyzed: number;
  failed: number;
  skipped: number;
  score: number | null;
  coverage_pct: number;
  issues_by_code: Record<string, number>;
  status: 'ok' | 'error' | 'parcial' | 'sin-datos';
  max_rows: number | null;
  max_cols: number | null;
  /** Incidencias con severidad de error. Nunca se suma con las advertencias. */
  error_issues: number;
  /** Incidencias con severidad de advertencia (sobre todo celdas vacías). */
  warning_issues: number;
  /** % de distribuciones que se descargan y abren, o null si no se analizó. */
  availability_pct: number | null;
  /** Estado agregado de cada formato, para colorear su etiqueta en la tarjeta. */
  format_states: Record<string, FormatState>;
};

/* ------------------------------------------------------------------ */
/* Carga                                                               */
/* ------------------------------------------------------------------ */

let cached: { at: number; report: QualityReport } | null = null;

/** Devuelve el informe tipado, o null si aún no se ha generado. */
export function getQualityReport(): QualityReport | null {
  if (!fs.existsSync(REPORT_PATH)) return getLatestValidHistoryReport();
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  try {
    const raw = fs.readFileSync(REPORT_PATH, 'utf-8');
    const report = JSON.parse(raw) as QualityReport;
    cached = { at: Date.now(), report };
    return report;
  } catch {
    // Informe corrupto: intentar fallback al último válido del historial.
    return getLatestValidHistoryReport();
  }
}

/** Información de un informe en el historial. */
export interface HistoryEntry {
  filename: string;
  generatedAt: string;
  filePath: string;
}

/** Lista los informes del historial ordenados por fecha descendente. */
export function listHistory(): HistoryEntry[] {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).sort().reverse();
  return files.map((filename) => {
    const filePath = path.join(HISTORY_DIR, filename);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const report = JSON.parse(raw) as QualityReport;
      return { filename, generatedAt: report.generated_at, filePath };
    } catch {
      return { filename, generatedAt: '', filePath };
    }
  }).filter((e) => e.generatedAt);
}

/** Devuelve el último informe válido del historial (fallback). */
function getLatestValidHistoryReport(): QualityReport | null {
  const entries = listHistory();
  for (const entry of entries) {
    try {
      const raw = fs.readFileSync(entry.filePath, 'utf-8');
      const report = JSON.parse(raw) as QualityReport;
      if (report.datasets && report.totals) return report;
    } catch {
      continue;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Observatorio histórico                                              */
/* ------------------------------------------------------------------ */

export interface HistorySnapshot {
  date: string;
  totalDistributions: number;
  ok: number;
  error: number;
  skipped: number;
  avgScore: number | null;
  healthyDatasets: number;
  warningDatasets: number;
  criticalDatasets: number;
}

/** Carga los N últimos informes válidos del historial como snapshots. */
export function loadHistorySnapshots(maxEntries = 20): HistorySnapshot[] {
  const entries = listHistory().slice(0, maxEntries).reverse();
  const snapshots: HistorySnapshot[] = [];
  for (const entry of entries) {
    try {
      const raw = fs.readFileSync(entry.filePath, 'utf-8');
      const report = JSON.parse(raw) as QualityReport;
      // Validación estructural: ignora informes de un esquema antiguo/incompleto.
      if (!report || !Array.isArray(report.datasets) || !report.totals || typeof report.generated_at !== 'string') {
        continue;
      }
      const healthy = report.datasets.filter((d) => d.score != null && d.score >= 80).length;
      const warning = report.datasets.filter((d) => d.score != null && d.score >= 50 && d.score < 80).length;
      const critical = report.datasets.filter((d) => d.score != null && d.score < 50).length;
      snapshots.push({
        date: report.generated_at.slice(0, 10),
        totalDistributions: report.totals.distributions,
        ok: report.totals.ok,
        error: report.totals.error,
        skipped: report.totals.skipped,
        avgScore: report.totals.avg_score,
        healthyDatasets: healthy,
        warningDatasets: warning,
        criticalDatasets: critical,
      });
    } catch {
      // Archivo corrupto o ilegible: se omite del historial.
      continue;
    }
  }
  return snapshots;
}

/** Localiza un dataset del informe por el slug numérico de su dataset_id. */
export function findReportDatasetBySlug(report: QualityReport | null, slug: string): QualityDatasetSummary | null {
  if (!report) return null;
  return report.datasets.find((d) => datasetSlug(d.dataset_id) === slug) ?? null;
}

/**
 * Localiza una distribución dentro de un dataset del informe por su índice
 * dentro de `distribution_results` (usado como `[distIdx]` en la URL).
 */
export function findDistribution(
  dataset: QualityDatasetSummary,
  distIdx: number
): DistributionResult | null {
  return dataset.distribution_results[distIdx] ?? null;
}

/** Versión ligera de cada dataset, apta para pasar a componentes cliente. */
export function toDatasetLite(ds: QualityDatasetSummary): QualityDatasetLite {
  let status: QualityDatasetLite['status'] = 'sin-datos';
  if (ds.distributions > 0) {
    if (ds.analyzed === ds.distributions) status = 'ok';
    else if (ds.failed === ds.distributions) status = 'error';
    else status = 'parcial';
  }
  let max_rows: number | null = null;
  let max_cols: number | null = null;
  let error_issues = 0;
  let warning_issues = 0;
  for (const d of ds.distribution_results) {
    // `distributionVolume` traduce los nombres reales que emite el analizador
    // según el formato; antes se leían `row_count`/`col_count`, que no existen.
    const { primary, secondary } = distributionVolume(d.format, d.analysis?.metrics);
    if (primary && (max_rows == null || primary.value > max_rows)) max_rows = primary.value;
    if (secondary && (max_cols == null || secondary.value > max_cols)) max_cols = secondary.value;
    // La severidad solo está en las incidencias de cada distribución;
    // `issues_by_code` la pierde y por eso no sirve para este recuento.
    for (const issue of d.analysis?.issues ?? []) {
      if (issue.severity === 'error') error_issues += issue.count;
      else warning_issues += issue.count;
    }
  }
  return {
    dataset_index: ds.dataset_index,
    dataset_title: ds.dataset_title,
    distributions: ds.distributions,
    analyzed: ds.analyzed,
    failed: ds.failed,
    skipped: ds.skipped,
    score: ds.score,
    coverage_pct: ds.coverage_pct,
    issues_by_code: ds.issues_by_code,
    status,
    max_rows,
    max_cols,
    error_issues,
    warning_issues,
    availability_pct: datasetAvailabilityPct(ds),
    format_states: formatStates(ds),
  };
}

/** Desglose de errores por categoría (disponibilidad, formato, contenido). */
export interface ErrorBreakdown {
  availability: number;
  format: number;
  content: number;
}

/** Computa el desglose de incidencias por categoría a partir del informe. */
export function computeErrorBreakdown(report: QualityReport): ErrorBreakdown {
  const breakdown: ErrorBreakdown = { availability: 0, format: 0, content: 0 };
  for (const ds of report.datasets) {
    for (const [code, count] of Object.entries(ds.issues_by_code)) {
      const cat = issueCategory(code);
      breakdown[cat] += count;
    }
  }
  return breakdown;
}
