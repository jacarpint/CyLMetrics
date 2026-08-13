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

// Re-export para uso en servidor; los componentes cliente deben importar
// desde `./quality-labels` (este módulo usa node:fs y no puede empaquetarse
// en el bundle del cliente).
export {
  issueLabel, ISSUE_LABELS, categoryLabel, issueCategory, schemaTypeLabel,
  formatBytes, formatDuration, formatLongDate, distributionVolume, analyzedCells,
} from './quality-labels';
export type { DistributionVolume, VolumeMetric } from './quality-labels';
import { distributionVolume } from './quality-labels';
import {
  datasetAvailabilityPct,
  formatStates,
  summarizeContent,
  summarizeDelivery,
  type FormatState,
} from './availability';
export type { IssueCategory } from './quality-labels';
import { issueCategory } from './quality-labels';
import { getScoreLevel } from './quality';

const REPORT_PATH = path.join(process.cwd(), 'reports', 'data-analysis.json');
const HISTORY_DIR = path.join(process.cwd(), 'reports', 'history');

/**
 * Informes con menos datasets que esto son ejecuciones parciales (`--limit N`)
 * y no representan al catálogo. `build-history-index.ts` ya las descarta; el
 * mismo criterio tiene que aplicarse aquí o el índice y la página cuentan un
 * número distinto de informes.
 */
const MIN_DATASETS_FOR_FULL_RUN = 50;

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

/**
 * Firma de un fichero: ruta, fecha de modificación y tamaño.
 *
 * La caché se invalida comparando firmas, no por tiempo transcurrido. Antes
 * caducaba a los 5 minutos, pero solo en la rama que leía
 * `reports/data-analysis.json` — y ese fichero está en `.gitignore`, así que en
 * un despliegue limpio nunca existe: cada render caía al historial, que se
 * releía y reparseaba entero (26 MB, 300 ms medidos) sin guardar nada.
 */
function fileSignature(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

/** Ficheros del historial, del más reciente al más antiguo (por nombre). */
function historyFiles(): string[] {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => path.join(HISTORY_DIR, f));
}

/** Candidatos a informe vigente: el recién generado y, tras él, el historial. */
function candidateReportPaths(): string[] {
  const paths: string[] = [];
  if (fs.existsSync(REPORT_PATH)) paths.push(REPORT_PATH);
  paths.push(...historyFiles());
  return paths;
}

function isValidReport(value: unknown): value is QualityReport {
  const report = value as QualityReport | null;
  return Boolean(
    report &&
      Array.isArray(report.datasets) &&
      report.totals != null &&
      typeof report.generated_at === 'string'
  );
}

/** True si el informe cubre el catálogo entero (no es una ejecución con `--limit`). */
function isFullRun(report: QualityReport): boolean {
  return report.datasets.length >= MIN_DATASETS_FOR_FULL_RUN;
}

function readReport(filePath: string): QualityReport | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return isValidReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let cached: { key: string; report: QualityReport | null } | null = null;

/** Devuelve el informe tipado, o null si aún no se ha generado. */
export function getQualityReport(): QualityReport | null {
  const candidates = candidateReportPaths();
  // La clave incluye la firma del candidato preferido y el número de ficheros
  // del historial: así se detecta tanto que el informe se ha regenerado como
  // que ha entrado uno nuevo en el historial.
  const key = candidates.length > 0
    ? `${fileSignature(candidates[0]) ?? candidates[0]}|${candidates.length}`
    : 'sin-informe';
  if (cached && cached.key === key) return cached.report;

  let report: QualityReport | null = null;
  for (const filePath of candidates) {
    const parsed = readReport(filePath);
    if (parsed) {
      report = parsed;
      break;
    }
  }

  cached = { key, report };
  return report;
}

/** Información de un informe en el historial. */
export interface HistoryEntry {
  filename: string;
  generatedAt: string;
  filePath: string;
}

/**
 * Lista los informes del historial ordenados por fecha descendente.
 *
 * La fecha sale del nombre del fichero (`analysis-2026-08-10T13-18-40.json`),
 * que lo escribe `manage-reports.ts` a partir de `generated_at`. Antes se
 * abría y parseaba cada informe solo para leer ese campo: 200 ms de JSON por
 * una cadena que ya estaba en el nombre.
 */
export function listHistory(): HistoryEntry[] {
  return historyFiles()
    .map((filePath) => ({
      filename: path.basename(filePath),
      generatedAt: generatedAtFromFilename(path.basename(filePath)),
      filePath,
    }))
    .filter((entry) => entry.generatedAt);
}

/** `analysis-2026-08-10T13-18-40.json` → `2026-08-10T13:18:40`. */
function generatedAtFromFilename(filename: string): string {
  const match = filename.match(/^analysis-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.json$/);
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}` : '';
}

/* ------------------------------------------------------------------ */
/* Observatorio histórico                                              */
/* ------------------------------------------------------------------ */

/**
 * Estado del catálogo en un informe, medido con el MISMO criterio que el resto
 * del portal.
 *
 * Antes estos contadores salían de `report.totals.ok/error/skipped`, que son los
 * del motor de análisis: `engine.py` marca `error` en cuanto aparece una
 * incidencia de severidad error, y «tipos mezclados en una columna» es una de
 * ellas. Por eso la pestaña Evolución decía «582 con fallos» mientras Inicio
 * decía «254 no se pueden usar»: dos cifras contradictorias, del mismo informe,
 * a dos clics de distancia. Aquí se clasifica con `classifyDelivery`, que es la
 * fuente única de «¿se puede abrir este archivo?».
 */
export interface HistorySnapshot {
  date: string;
  totalDistributions: number;
  /** Archivos que se descargan y abren. */
  usable: number;
  /** Archivos que no llegan, o llegan y no se pueden interpretar. */
  broken: number;
  /** URLs que responden con una página web en lugar del archivo. */
  notDelivered: number;
  /** Archivos que no se llegaron a comprobar. */
  unanalyzed: number;
  /**
   * Calidad media del contenido de lo que SÍ abre. `report.totals.avg_score`
   * no vale aquí: promedia también los archivos que no se entregan, que dejan
   * métricas parciales, y el portal afirma en Inicio que esta media no los
   * incluye.
   */
  avgScore: number | null;
  healthyDatasets: number;
  warningDatasets: number;
  criticalDatasets: number;
  /**
   * Conjuntos de datos sin puntuación de contenido: ni un solo archivo legible
   * que medir. Se cuentan aparte en vez de omitirse, que era lo que hacía que la
   * interfaz enseñara «436 / 0 / 0» de 824 y afirmara «0 críticos» justo al lado
   * de «el 35% de los archivos no abre».
   */
  unscoredDatasets: number;
  totalDatasets: number;
}

let snapshotCache: { key: string; snapshots: HistorySnapshot[] } | null = null;

/**
 * Carga los N últimos informes completos del historial como snapshots.
 *
 * Las ejecuciones parciales quedan fuera, con el mismo umbral que usa
 * `build-history-index.ts`: si no, el índice contaba 2 informes y esta función
 * 3, y la página mezclaba las dos cifras.
 */
export function loadHistorySnapshots(maxEntries = 20): HistorySnapshot[] {
  const entries = listHistory().slice(0, maxEntries).reverse();
  const key = `${maxEntries}|${entries.map((e) => fileSignature(e.filePath) ?? e.filename).join(',')}`;
  if (snapshotCache && snapshotCache.key === key) return snapshotCache.snapshots;

  const snapshots: HistorySnapshot[] = [];
  for (const entry of entries) {
    const report = readReport(entry.filePath);
    if (!report || !isFullRun(report)) continue;
    let healthy = 0;
    let warning = 0;
    let critical = 0;
    let unscored = 0;
    // Los umbrales se leen de `getScoreLevel`, única fuente: aquí estaban
    // repetidos y podían quedarse atrás si se revisaba la escala.
    for (const ds of report.datasets) {
      if (ds.score == null) unscored++;
      else if (getScoreLevel(ds.score) === 'ok') healthy++;
      else if (getScoreLevel(ds.score) === 'warn') warning++;
      else critical++;
    }
    const delivery = summarizeDelivery(report);
    snapshots.push({
      date: report.generated_at.slice(0, 10),
      totalDistributions: delivery.total,
      usable: delivery.ok,
      broken: delivery.roto,
      notDelivered: delivery.noEntrega,
      unanalyzed: delivery.omitida,
      avgScore: summarizeContent(report).avgScore,
      healthyDatasets: healthy,
      warningDatasets: warning,
      criticalDatasets: critical,
      unscoredDatasets: unscored,
      totalDatasets: report.datasets.length,
    });
  }

  snapshotCache = { key, snapshots };
  return snapshots;
}

/**
 * Empareja las distribuciones del catálogo con sus resultados del informe.
 *
 * El emparejamiento es por URL, no por posición. Antes se leía
 * `distribution_results[idx]` directamente: hoy los índices coinciden, pero el
 * catálogo es una fuente en vivo y el informe una foto, así que el día que la
 * Junta reordene o retire una distribución la ficha enseñaría el análisis de
 * otro archivo sin dar ninguna señal. Con la URL como clave eso no puede pasar.
 *
 * El índice se mantiene como respaldo para las URLs que hayan cambiado de forma
 * (redirecciones, un `?v=` añadido) sin que el recurso sea otro: solo se usa si
 * esa posición no se ha emparejado ya por URL.
 */
export function matchDistributions(
  catalogDistributions: readonly { url: string }[],
  reportResults: readonly DistributionResult[] | undefined
): (DistributionResult | undefined)[] {
  if (!reportResults || reportResults.length === 0) {
    return catalogDistributions.map(() => undefined);
  }

  const byUrl = new Map<string, DistributionResult[]>();
  for (const result of reportResults) {
    const bucket = byUrl.get(result.url);
    if (bucket) bucket.push(result);
    else byUrl.set(result.url, [result]);
  }

  const used = new Set<DistributionResult>();
  const matched: (DistributionResult | undefined)[] = catalogDistributions.map((dist) => {
    const candidates = byUrl.get(dist.url);
    const hit = candidates?.find((c) => !used.has(c));
    if (hit) used.add(hit);
    return hit;
  });

  // Segunda pasada: posiciones sin emparejar caen a su índice, siempre que ese
  // resultado no se haya asignado ya a otra distribución por URL.
  matched.forEach((hit, idx) => {
    if (hit) return;
    const fallback = reportResults[idx];
    if (fallback && !used.has(fallback)) {
      used.add(fallback);
      matched[idx] = fallback;
    }
  });

  return matched;
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
