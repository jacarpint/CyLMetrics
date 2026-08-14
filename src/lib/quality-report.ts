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
import crypto from 'node:crypto';

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
  type FormatState,
} from './availability';
export type { IssueCategory } from './quality-labels';
import type { DistributionDetail, IssueDetail } from './report-bundle';
export type {
  DistributionDetail,
  IssueDetail,
  IssueColumnGroup,
  IssuePosition,
} from './report-bundle';

/**
 * Directorio del informe vigente: `index.json` (ligero, lo lee todo el portal)
 * y `d/<id>.json` (un fragmento por distribución, solo su ficha).
 *
 * OJO al desplegar: estas rutas se construyen en tiempo de ejecución, así que
 * el rastreador de Next no las ve y hay que declararlas a mano en
 * `outputFileTracingIncludes` (`next.config.ts`). Sin eso el informe no viaja
 * al despliegue y el portal arranca sin datos.
 */
const BUNDLE_DIR = path.join(process.cwd(), 'reports', 'current');
const BUNDLE_INDEX = path.join(BUNDLE_DIR, 'index.json');
const SHARD_DIR = path.join(BUNDLE_DIR, 'd');

/**
 * Una incidencia tal y como viaja en el ÍNDICE: código, severidad y cuántas
 * hay. Las posiciones no vienen aquí; están en el fragmento de la distribución
 * (`DistributionDetail`), que se abre solo al entrar en su ficha.
 *
 * `samples` ya no existe. Guardaba cinco posiciones mientras `count` decía
 * 850.658, y la ficha enseñaba esas cinco: el resumen y el detalle hablaban del
 * mismo fichero con dos cifras distintas.
 */
/**
 * Gravedad de una incidencia.
 *
 * `info` no es «un aviso flojito»: es «esto no habla del archivo». Lo emiten los
 * analizadores cuando el que falla es el portal —falta la librería de lectura, se
 * rompió nuestro propio código— y existe porque no había forma de decirlo: esos
 * casos salían con `severity: 'error'` y se contaban como defectos del dato. En el
 * informe del 13 de agosto eran 364.
 *
 * Quien cuente errores debe comparar con `'error'` explícitamente, nunca con
 * `!== 'warning'`.
 */
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface IssueInfo {
  code: string;
  label: string;
  severity: IssueSeverity;
  /** Ocurrencias detectadas. */
  count: number;
  /**
   * Ocurrencias con posición guardada en el fragmento. 0 significa que la
   * incidencia es del fichero entero (no descarga, ZIP corrupto) y no hay nada
   * que localizar dentro. Menor que `count` significa recorte, y la interfaz
   * está obligada a decirlo.
   */
  stored: number;
  /** Tipo crudo de Frictionless, como trazabilidad. */
  source?: string;
}

/**
 * Los ocho resultados que `fetch.status` puede traer del analizador.
 *
 * Estaba tipado como `string`, y eso permitió que estos valores se colaran en la
 * interfaz como si fueran códigos de incidencia: `deliveryCause` caía a ellos y
 * la tabla de archivos acabó enseñando «downloaded» de etiqueta. Con la unión
 * cerrada, quien los trate tiene que cubrirlos todos.
 *
 * Se emiten en `downloader.py` (`downloaded`, `truncated`, `too_large`,
 * `http_error`, `unreachable`) y en `engine.py` (`service`, `no_url`, `error`).
 */
export type FetchStatus =
  | 'downloaded'
  | 'truncated'
  | 'too_large'
  | 'http_error'
  | 'unreachable'
  | 'service'
  | 'no_url'
  | 'error';

export interface FetchInfo {
  status: FetchStatus;
  size: number;
  http_status: number | null;
  duration_ms: number;
  truncated: boolean;
  note: string;
  final_url: string | null;
}

export type { SchemaField } from './report-bundle';

/**
 * El análisis tal y como viaja en el índice.
 *
 * `schema` y `sample_rows` viven en el fragmento, no aquí: son lo más pesado
 * del informe y solo los usa la ficha de la distribución. Mantenerlos en el
 * índice obligaba a parsearlos en cada arranque en frío de cualquier página.
 */
export interface AnalysisInfo {
  ok: boolean;
  score: number | null;
  summary: string;
  metrics: Record<string, unknown>;
  issues: IssueInfo[];
  truncated?: boolean;
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
  /** Identificador del fragmento con el detalle (sha1 de la URL). */
  id?: string;
  /** true si existe fragmento: hay posiciones, esquema o filas de muestra. */
  has_detail?: boolean;
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
  /**
   * Las dos cifras de arriba NO suman el total de incidencias: las de severidad
   * `info` quedan fuera de las dos a propósito, porque no son defectos del dato
   * (ver `IssueSeverity`). Se listan en la ficha del archivo, no aquí.
   */
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

/**
 * El informe vigente: el bundle de `reports/current/`.
 *
 * Había además un respaldo sobre los informes del formato antiguo de
 * `reports/history/`, retirado junto con la serie histórica. No hacía falta:
 * `reports/current/` está versionado, así que cualquier checkout lo trae.
 */
function candidateReportPaths(): string[] {
  return fs.existsSync(BUNDLE_INDEX) ? [BUNDLE_INDEX] : [];
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

/**
 * Deja cualquiera de los dos formatos con la forma que espera el portal.
 *
 * Un informe antiguo trae `issues[].samples` y no trae `stored`. Si se dejara
 * pasar tal cual, `stored` sería `undefined` y toda la interfaz que decide si
 * una incidencia se puede localizar leería «no» donde el informe antiguo sí
 * traía cinco muestras. Aquí se traduce: `stored` = las muestras que hubiera.
 */
function normalizeReport(report: QualityReport): QualityReport {
  for (const ds of report.datasets) {
    for (const dist of ds.distribution_results ?? []) {
      // El informe antiguo no trae `id`: se calcula igual que lo hace el
      // generador, para que la ficha pueda pedir su detalle en los dos casos.
      if (!dist.id) dist.id = distributionShardId(dist.url);
      const issues = dist.analysis?.issues;
      if (!issues) continue;
      for (const issue of issues) {
        if (typeof issue.stored === 'number') continue;
        const legacy = issue as IssueInfo & { samples?: unknown[] };
        issue.stored = legacy.samples?.length ?? 0;
      }
    }
  }
  return report;
}

function readReport(filePath: string): QualityReport | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return isValidReport(parsed) ? normalizeReport(parsed) : null;
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

/* ------------------------------------------------------------------ */
/* Detalle de una distribución                                         */
/* ------------------------------------------------------------------ */

/**
 * Puente con el formato antiguo.
 *
 * Un informe anterior trae el esquema y las filas de muestra dentro de
 * `analysis`, y las posiciones como `samples` (cinco por incidencia). Se
 * traducen a la forma nueva para que la ficha siga enseñando lo que ya tenía
 * mientras no se regenere el análisis. `stored` sale de las muestras que
 * realmente había, así que la interfaz dirá «5 de 2.136» —que es la verdad de
 * ese informe— en vez de insinuar que están todas.
 */
type LegacySample = { row?: number; field?: string; field_index?: number; cell?: string | null };
type LegacyAnalysis = AnalysisInfo & {
  schema?: DistributionDetail['schema'];
  sample_rows?: DistributionDetail['sample_rows'];
  issues: (IssueInfo & { samples?: LegacySample[] })[];
};

function legacyIssueDetail(
  issue: IssueInfo & { samples?: LegacySample[] },
  header: string[]
): IssueDetail {
  const byColumn = new Map<number, { field?: string; rows: number[]; cells: (string | null)[] }>();
  const rowOnly: number[] = [];

  for (const sample of issue.samples ?? []) {
    const row = sample.row ?? 0;
    const col =
      sample.field != null && header.length > 0 ? header.indexOf(sample.field)
      : sample.field_index != null ? sample.field_index - 1
      : -1;
    if (col < 0) { rowOnly.push(row); continue; }
    let group = byColumn.get(col);
    if (!group) { group = { field: sample.field, rows: [], cells: [] }; byColumn.set(col, group); }
    group.rows.push(row);
    group.cells.push(sample.cell ?? null);
  }

  const toDeltas = (rows: number[]): number[] => {
    const ordered = [...rows].sort((a, b) => a - b);
    let previous = 0;
    return ordered.map((row) => { const delta = row - previous; previous = row; return delta; });
  };

  return {
    code: issue.code,
    label: issue.label,
    severity: issue.severity,
    count: issue.count,
    stored: issue.stored,
    columns: [...byColumn.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([col, group]) => ({
        col,
        field: group.field,
        rows: toDeltas(group.rows),
        cells: group.cells.some((c) => c != null) ? group.cells : undefined,
      })),
    rows: rowOnly.length > 0 ? toDeltas(rowOnly) : undefined,
  };
}

function legacyDetail(id: string): DistributionDetail | null {
  const report = getQualityReport();
  if (!report) return null;

  for (const ds of report.datasets) {
    for (const dist of ds.distribution_results ?? []) {
      if (distributionShardId(dist.url) !== id) continue;
      const analysis = dist.analysis as LegacyAnalysis | null;
      if (!analysis) return null;
      const metricHeader = (analysis.metrics as { header?: unknown })?.header;
      const header = Array.isArray(metricHeader) ? metricHeader.map((h) => String(h ?? '')) : [];
      return {
        id,
        url: dist.url,
        format: dist.format,
        dataset_id: dist.dataset_id,
        header,
        issues: analysis.issues.map((issue) => legacyIssueDetail(issue, header)),
        schema: analysis.schema,
        sample_rows: analysis.sample_rows,
      };
    }
  }
  return null;
}

/**
 * Caché de fragmentos abiertos. Pequeña a propósito: un fragmento con un millón
 * de posiciones ocupa memoria, y el patrón de uso real es «una ficha, unas
 * cuantas recargas» — no barrer el catálogo entero.
 */
const SHARD_CACHE_SIZE = 24;
const shardCache = new Map<string, DistributionDetail | null>();

/**
 * Identificador del fragmento de una distribución, a partir de su URL.
 *
 * Tiene que dar exactamente lo mismo que `shard_id()` de
 * `src/analysis/bundle.py`, que es quien nombra los ficheros: sha1 de la URL en
 * UTF-8, los 16 primeros caracteres hexadecimales.
 *
 * Se usa la URL y no la posición porque el informe es una foto y el catálogo
 * está vivo: un id posicional apuntaría al fragmento de otro archivo en cuanto
 * la Junta reordene o retire una distribución, sin dar ninguna señal. Es el
 * mismo criterio de `matchDistributions`.
 */
export function distributionShardId(url: string): string {
  return crypto.createHash('sha1').update(url ?? '', 'utf8').digest('hex').slice(0, 16);
}

/**
 * Fragmento con TODAS las posiciones de las incidencias de una distribución.
 *
 * Devuelve null si no hay fragmento, que es lo normal cuando la distribución no
 * tiene nada localizable dentro del fichero (no se descargó, o descargó limpia).
 */
export function getDistributionDetail(id: string | undefined): DistributionDetail | null {
  // El id es el nombre del fichero: sin esta comprobación, un id manipulado
  // (`../../algo`) sacaría la lectura del directorio de fragmentos.
  if (!id || !/^[0-9a-f]{6,64}$/.test(id)) return null;

  const cached = shardCache.get(id);
  if (cached !== undefined) return cached;

  let detail: DistributionDetail | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(SHARD_DIR, `${id}.json`), 'utf-8')) as DistributionDetail;
    detail = Array.isArray(parsed?.issues) ? parsed : null;
  } catch {
    detail = null;
  }
  // Sin fragmento, se construye uno a partir del informe antiguo. Es lo que
  // evita que el portal pierda el esquema y las posiciones mientras no se haya
  // regenerado el análisis con el formato nuevo.
  if (!detail) detail = legacyDetail(id);

  if (shardCache.size >= SHARD_CACHE_SIZE) {
    const oldest = shardCache.keys().next().value;
    if (oldest !== undefined) shardCache.delete(oldest);
  }
  shardCache.set(id, detail);
  return detail;
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
      // Tres ramas explícitas, no `error` contra «todo lo demás».
      //
      // Con `else` a secas, las incidencias `info` —las que hablan del portal y no
      // del archivo— se sumaban a las advertencias, y estos dos recuentos son lo
      // que la tarjeta del catálogo presenta como defectos del conjunto de datos.
      // Un XLSX que no pudimos leer habría aparecido como «1 advertencia» sobre un
      // archivo que puede estar perfectamente.
      if (issue.severity === 'error') error_issues += issue.count;
      else if (issue.severity === 'warning') warning_issues += issue.count;
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

/*
 * Aquí vivían `ErrorBreakdown` y `computeErrorBreakdown`, que agregaban las
 * ocurrencias por categoría. Se han quitado: no las llamaba nadie —ni la interfaz
 * ni los tests— y sumaban `dependencia-faltante` a la conformidad de formato, o sea
 * atribuían al publicador una librería que no habíamos instalado. Mantener código
 * muerto y además corregirlo no compensa; `issueCategory` sigue disponible para
 * quien necesite el desglose.
 */
