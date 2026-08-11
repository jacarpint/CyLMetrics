/**
 * Disponibilidad de los recursos: ¿se puede abrir el fichero, sí o no?
 *
 * El portal mezclaba dos preguntas muy distintas en un solo número:
 *   - ¿el recurso se puede usar?      → disponibilidad (bloqueante)
 *   - ¿el contenido está limpio?      → calidad de contenido (gradual)
 *
 * Mezclarlas engañaba en las dos direcciones. Por volumen, el 98,8% de las
 * "incidencias" del informe son celdas vacías y tipos incoherentes: un CSV
 * correcto con 9.072 celdas opcionales vacías salía mil veces peor que un
 * fichero que no existe. Y al revés, la media de calidad (78,7%) tapaba que
 * un tercio de los ficheros no abre.
 *
 * Este módulo es la fuente única de la primera pregunta. Client-safe: solo
 * importa tipos de `quality-report` y funciones de `quality-labels`.
 */

import type { DistributionResult, QualityReport } from './quality-report';
import { issueLabel } from './quality-labels';
import { isBlockingCode } from './alerts';

/**
 * Estado de entrega de una distribución.
 *
 * `no-entrega` existe porque el analizador y la interfaz no se ponían de
 * acuerdo: `engine.py` marca como "omitida" la URL que devuelve una página
 * HTML en vez del fichero (para no penalizar al organismo, ya que suele ser
 * un problema de la plataforma), pero `alerts.ts` la trataba como bloqueante.
 * Ambas cosas son ciertas, así que tiene categoría propia: se ve y se cuenta
 * aparte, pero no entra en el score.
 */
export type DeliveryState = 'ok' | 'roto' | 'no-entrega' | 'omitida';

/** Códigos que significan "la URL no devuelve el archivo prometido". */
const NOT_A_FILE_CODES = new Set(['no-es-archivo', 'no-es-imagen']);

export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  ok: 'Se descarga y se abre',
  roto: 'No se puede descargar o abrir',
  'no-entrega': 'La URL no devuelve el archivo',
  omitida: 'No analizada',
};

export const DELIVERY_SHORT: Record<DeliveryState, string> = {
  ok: 'Correcta',
  roto: 'Rota',
  'no-entrega': 'No entrega archivo',
  omitida: 'No analizada',
};

/** Explicación de por qué una distribución quedó sin analizar. */
export const DELIVERY_EXPLANATIONS: Record<Exclude<DeliveryState, 'ok'>, string> = {
  roto: 'El servidor no devolvió el recurso o el archivo no se pudo interpretar. El dato no es reutilizable tal cual.',
  'no-entrega':
    'La URL responde, pero devuelve una página web en lugar del archivo de datos. Bloquea la reutilización automatizada; suele ser un problema de la plataforma de publicación, no del dato en sí, y por eso no penaliza la puntuación.',
  omitida:
    'El analizador no llegó a evaluar el recurso (por ejemplo, porque supera el tamaño máximo descargable o no declara URL de acceso).',
};

function issueCodes(dist: DistributionResult): string[] {
  return (dist.analysis?.issues ?? []).map((i) => i.code);
}

/** Clasifica una distribución del informe por su estado de entrega. */
export function classifyDelivery(dist: DistributionResult): DeliveryState {
  if (dist.status === 'ok') return 'ok';
  const codes = issueCodes(dist);
  if (codes.some((c) => NOT_A_FILE_CODES.has(c))) return 'no-entrega';
  if (dist.status === 'error') return 'roto';
  return 'omitida';
}

export interface DeliveryCause {
  code: string;
  label: string;
}

/**
 * Motivo concreto por el que una distribución no está disponible. Prioriza el
 * primer código bloqueante; si no hay ninguno, cae al primero declarado y, en
 * último término, al estado de la descarga.
 */
export function deliveryCause(dist: DistributionResult): DeliveryCause | null {
  if (dist.status === 'ok') return null;
  const codes = issueCodes(dist);
  const code = codes.find((c) => isBlockingCode(c)) ?? codes[0] ?? dist.fetch?.status ?? 'desconocido';
  return { code, label: issueLabel(code) };
}

/* ------------------------------------------------------------------ */
/* Agregados                                                           */
/* ------------------------------------------------------------------ */

export interface DeliverySummary {
  total: number;
  ok: number;
  roto: number;
  noEntrega: number;
  omitida: number;
  /** Porcentaje de distribuciones rotas sobre el total (0-100, redondeado). */
  brokenPct: number;
  /** Porcentaje que no entrega archivo, aparte de las rotas. */
  notAFilePct: number;
  /** Datasets con al menos una distribución rota o que no entrega. */
  affectedDatasets: number;
  totalDatasets: number;
}

export function summarizeDelivery(report: QualityReport | null): DeliverySummary {
  const empty: DeliverySummary = {
    total: 0, ok: 0, roto: 0, noEntrega: 0, omitida: 0,
    brokenPct: 0, notAFilePct: 0, affectedDatasets: 0, totalDatasets: 0,
  };
  if (!report) return empty;

  let ok = 0, roto = 0, noEntrega = 0, omitida = 0, affected = 0;

  for (const ds of report.datasets) {
    let dsAffected = false;
    for (const dist of ds.distribution_results) {
      const state = classifyDelivery(dist);
      if (state === 'ok') ok++;
      else if (state === 'roto') { roto++; dsAffected = true; }
      else if (state === 'no-entrega') { noEntrega++; dsAffected = true; }
      else omitida++;
    }
    if (dsAffected) affected++;
  }

  const total = ok + roto + noEntrega + omitida;
  return {
    total, ok, roto, noEntrega, omitida,
    brokenPct: total > 0 ? Math.round((roto / total) * 100) : 0,
    notAFilePct: total > 0 ? Math.round((noEntrega / total) * 100) : 0,
    affectedDatasets: affected,
    totalDatasets: report.datasets.length,
  };
}

/**
 * Cuántas DISTRIBUCIONES sufre cada incidencia (no cuántas celdas).
 *
 * `issues_by_code` del informe suma ocurrencias, y eso hace que "celdas
 * vacías" salga con más de un millón mientras "el archivo no descarga" sale
 * con 182. Para hablar de impacto, lo comparable es a cuántos recursos afecta
 * cada problema, contando cada uno una sola vez.
 */
export function distributionsAffectedByIssue(report: QualityReport | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!report) return counts;
  for (const ds of report.datasets) {
    for (const dist of ds.distribution_results) {
      for (const code of new Set(issueCodes(dist))) {
        counts[code] = (counts[code] ?? 0) + 1;
      }
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Fila de fichero con problema                                        */
/* ------------------------------------------------------------------ */

/** Una distribución que no se puede usar, lista para pintar en tabla. */
export interface BrokenFileRow {
  datasetSlug: string;
  datasetTitle: string;
  publisher: string;
  category: string;
  format: string;
  url: string;
  distIdx: number;
  state: Exclude<DeliveryState, 'ok'>;
  causeCode: string;
  causeLabel: string;
  /** Nota del analizador o resumen, para dar contexto en la fila expandida. */
  note?: string;
  httpStatus?: number | null;
}

/* ------------------------------------------------------------------ */
/* Causas sistémicas                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un mismo fallo repetido en muchos recursos no son N incidencias: es una.
 * GML falla en 32 de 32 y KML en 16 de 16 — eso no son 48 problemas de datos,
 * es un proceso de publicación roto. Agrupar por (formato × causa) convierte
 * una lista inabarcable en una lista de arreglos priorizables.
 */
export interface SystemicCause {
  key: string;
  format: string;
  causeCode: string;
  causeLabel: string;
  /** Recursos afectados por esta combinación. */
  affected: number;
  /** Total de recursos de ese formato, para dar la proporción. */
  formatTotal: number;
  /** Datasets distintos que se recuperarían al arreglarlo. */
  datasets: number;
  /** true si afecta a TODOS los recursos del formato: apunta a un fallo de proceso. */
  wholeFormat: boolean;
}

export function findSystemicCauses(rows: BrokenFileRow[], formatTotals: Record<string, number>): SystemicCause[] {
  const groups = new Map<string, { format: string; causeCode: string; causeLabel: string; affected: number; datasets: Set<string> }>();

  for (const row of rows) {
    const key = `${row.format}|${row.causeCode}`;
    let g = groups.get(key);
    if (!g) {
      g = { format: row.format, causeCode: row.causeCode, causeLabel: row.causeLabel, affected: 0, datasets: new Set() };
      groups.set(key, g);
    }
    g.affected++;
    g.datasets.add(row.datasetSlug);
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      const formatTotal = formatTotals[g.format] ?? g.affected;
      return {
        key,
        format: g.format,
        causeCode: g.causeCode,
        causeLabel: g.causeLabel,
        affected: g.affected,
        formatTotal,
        datasets: g.datasets.size,
        wholeFormat: formatTotal > 1 && g.affected === formatTotal,
      };
    })
    // Primero lo que delata un proceso roto, luego por volumen recuperable.
    .sort((a, b) => Number(b.wholeFormat) - Number(a.wholeFormat) || b.affected - a.affected);
}

/**
 * Agrupa los ficheros con problema por un campo de texto.
 *
 * Nota sobre `publisher`: en este catálogo casi todos los datasets declaran el
 * mismo organismo (`…/Organismo/A07002862`, la Junta como entidad única), así
 * que agrupar por ahí devuelve un solo grupo y no ayuda a repartir el trabajo.
 * La categoría temática sí discrimina.
 */
export interface FieldFailures {
  value: string;
  affected: number;
  datasets: number;
}

export function groupByField(
  rows: BrokenFileRow[],
  field: 'publisher' | 'category' | 'format',
  fallback = 'Sin clasificar'
): FieldFailures[] {
  const map = new Map<string, { affected: number; datasets: Set<string> }>();
  for (const row of rows) {
    const key = row[field] || fallback;
    let g = map.get(key);
    if (!g) { g = { affected: 0, datasets: new Set() }; map.set(key, g); }
    g.affected++;
    g.datasets.add(row.datasetSlug);
  }
  return [...map.entries()]
    .map(([value, g]) => ({ value, affected: g.affected, datasets: g.datasets.size }))
    .sort((a, b) => b.affected - a.affected);
}
