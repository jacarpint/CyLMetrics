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

import type { DistributionResult, QualityDatasetSummary, QualityReport } from './quality-report';
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

/**
 * Resultado de la descarga, según `fetch.status` del analizador.
 *
 * - `downloaded` / `truncated`: los bytes llegaron. `truncated` es un fichero
 *   grande del que se leyó una parte, pero se leyó.
 * - `too_large`: no se intentó por superar el tope. No sabemos si abre.
 * - `http_error` / `unreachable` / `service`: la descarga falló.
 */
const FETCH_DELIVERED = new Set(['downloaded', 'truncated']);
const FETCH_NOT_EVALUATED = new Set(['too_large']);

type FetchOutcome = 'entregado' | 'fallido' | 'no-evaluado';

function fetchOutcome(dist: DistributionResult): FetchOutcome {
  const status = dist.fetch?.status;
  if (!status) return 'fallido';
  if (FETCH_DELIVERED.has(status)) return 'entregado';
  if (FETCH_NOT_EVALUATED.has(status)) return 'no-evaluado';
  return 'fallido';
}

/**
 * Etiquetas en masculino, concordando con «archivo».
 *
 * Estaban en femenino porque concordaban con «distribución», pero las tablas que
 * las pintan llaman «archivo» a la fila: se leía «archivo … Rota». Es el rastro
 * visible de haber tenido cuatro nombres —distribución, fichero, archivo,
 * recurso— para la misma cosa.
 */
export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  ok: 'Se descarga y se abre',
  roto: 'No se puede descargar ni abrir',
  'no-entrega': 'La URL no devuelve el archivo',
  omitida: 'Sin analizar',
};

export const DELIVERY_SHORT: Record<DeliveryState, string> = {
  ok: 'Correcto',
  roto: 'No abre',
  'no-entrega': 'No entrega el archivo',
  omitida: 'Sin analizar',
};

/** Explicación de cada estado que no es «se descarga y se abre». */
export const DELIVERY_EXPLANATIONS: Record<Exclude<DeliveryState, 'ok'>, string> = {
  roto: 'El servidor no devolvió el archivo, o el archivo llegó y no se pudo interpretar. El dato no es reutilizable tal cual.',
  'no-entrega':
    'La URL responde, pero devuelve una página web en lugar del archivo de datos. Bloquea la reutilización automatizada; suele ser un problema de la plataforma de publicación, no del dato en sí, y por eso no penaliza la puntuación.',
  omitida:
    'El análisis no llegó a comprobar este archivo (por ejemplo, porque supera el tamaño máximo descargable o no declara URL de acceso).',
};

function issueCodes(dist: DistributionResult): string[] {
  return (dist.analysis?.issues ?? []).map((i) => i.code);
}

/**
 * Clasifica una distribución del informe por su estado de entrega.
 *
 * El criterio es si el fichero LLEGA y ABRE, no el `status` que le pone el
 * analizador. Esa era la confusión que sobredimensionaba el titular del portal:
 * `engine.py` marca `status: 'error'` en cuanto hay una incidencia de severidad
 * `error`, y «tipos mezclados en una columna» es una de ellas. Resultado: un
 * XLSX que responde HTTP 200, se descarga, se abre y del que se leen 336 filas
 * en 2 hojas con puntuación 80 se contaba como «no se puede descargar o abrir».
 *
 * De las 582 distribuciones que el analizador marca en error, 328 son de este
 * tipo: abren y traen filas. Las otras 254 son las que de verdad no se pueden
 * usar. Mezclarlas convertía el 15% real en un 35%, y metía en «Qué arreglar»
 * —la lista de lo inutilizable— ficheros perfectamente legibles que solo
 * necesitan limpieza, que es lo que mide el otro eje.
 */
export function classifyDelivery(dist: DistributionResult): DeliveryState {
  const codes = issueCodes(dist);

  // Lo más específico primero: la URL respondió, pero con una página web.
  if (codes.some((c) => NOT_A_FILE_CODES.has(c))) return 'no-entrega';

  const outcome = fetchOutcome(dist);
  // No llegó el fichero: da igual lo que diga el resto.
  if (outcome === 'fallido') return 'roto';
  // No se intentó (supera el tope de tamaño): no se puede afirmar nada.
  if (outcome === 'no-evaluado') return 'omitida';

  // Llegó. Solo es «roto» si además no se puede interpretar: un JSON inválido,
  // un ZIP corrupto, un shapefile sin sus piezas.
  if (codes.some(isBlockingCode)) return 'roto';

  // Llegó y abrió. Si el analizador lo marcó en error, es por el CONTENIDO, y
  // eso lo mide el eje de calidad, no este.
  if (dist.status === 'ok' || dist.status === 'error') return 'ok';

  return 'omitida';
}

export interface DeliveryCause {
  code: string;
  label: string;
}

/**
 * Motivo concreto por el que una distribución no está disponible, o null si sí
 * lo está.
 *
 * Se pregunta por el estado de entrega, no por `dist.status`: un fichero que
 * abre pero trae tipos mezclados no tiene «motivo de indisponibilidad», y antes
 * devolvía «Valores con tipo distinto al de su columna» como si lo fuera.
 *
 * Prioriza el código bloqueante; si la descarga falló sin dejar código, cae al
 * estado de la descarga (`http_error`, `unreachable`…), que ya tiene etiqueta.
 */
export function deliveryCause(dist: DistributionResult): DeliveryCause | null {
  if (classifyDelivery(dist) === 'ok') return null;
  const codes = issueCodes(dist);
  const code =
    codes.find((c) => isBlockingCode(c)) ??
    dist.fetch?.status ??
    codes[0] ??
    'desconocido';
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

export interface ContentSummary {
  /** Distribuciones entregadas con puntuación de contenido. */
  scored: number;
  /** Media de la calidad de contenido de esas, o null si no hay ninguna. */
  avgScore: number | null;
}

/**
 * Calidad de contenido de lo que SÍ se puede abrir.
 *
 * `report.totals.avg_score` promedia todas las distribuciones a las que el
 * analizador pudo poner nota: 1.470 de 1.655, e incluye 215 que no se entregan
 * (un fichero que descarga a medias o que no parsea también deja métricas
 * parciales). El portal, en cambio, afirma que esa media «no incluye los
 * archivos rotos». Aquí se calcula sobre el conjunto que el portal dice medir,
 * para que la afirmación sea verdad.
 */
export function summarizeContent(report: QualityReport | null): ContentSummary {
  if (!report) return { scored: 0, avgScore: null };
  let scored = 0;
  let sum = 0;
  for (const ds of report.datasets) {
    for (const dist of ds.distribution_results) {
      if (classifyDelivery(dist) !== 'ok') continue;
      const score = dist.analysis?.score;
      if (typeof score !== 'number') continue;
      scored++;
      sum += score;
    }
  }
  return {
    scored,
    avgScore: scored > 0 ? Math.round((sum / scored) * 10) / 10 : null,
  };
}

/**
 * Porcentaje de distribuciones de un dataset que se descargan y abren (0-100).
 *
 * Las que el analizador no llegó a evaluar quedan fuera del denominador: no
 * son un fallo del dataset, simplemente no se comprobaron. Devuelve null si no
 * se evaluó ninguna, para poder distinguir "no lo sabemos" de "no funciona".
 */
export function datasetAvailabilityPct(
  ds: Pick<QualityDatasetSummary, 'distribution_results'> | null | undefined
): number | null {
  if (!ds) return null;
  let evaluated = 0;
  let ok = 0;
  for (const dist of ds.distribution_results) {
    const state = classifyDelivery(dist);
    if (state === 'omitida') continue;
    evaluated++;
    if (state === 'ok') ok++;
  }
  return evaluated === 0 ? null : Math.round((ok / evaluated) * 100);
}

/**
 * Estado agregado por formato dentro de un dataset: para poder colorear la
 * etiqueta de cada formato en la tarjeta del catálogo sin volcar recuentos.
 */
export type FormatState = 'ok' | 'parcial' | 'roto' | 'sin-datos';

export function formatStates(
  ds: Pick<QualityDatasetSummary, 'distribution_results'> | null | undefined
): Record<string, FormatState> {
  const out: Record<string, FormatState> = {};
  if (!ds) return out;
  const acc = new Map<string, { evaluated: number; ok: number }>();

  for (const dist of ds.distribution_results) {
    let entry = acc.get(dist.format);
    if (!entry) { entry = { evaluated: 0, ok: 0 }; acc.set(dist.format, entry); }
    const state = classifyDelivery(dist);
    if (state === 'omitida') continue;
    entry.evaluated++;
    if (state === 'ok') entry.ok++;
  }

  for (const [format, { evaluated, ok }] of acc) {
    out[format] = evaluated === 0 ? 'sin-datos' : ok === evaluated ? 'ok' : ok === 0 ? 'roto' : 'parcial';
  }
  return out;
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
/* Consecuencias para quien reutiliza                                  */
/* ------------------------------------------------------------------ */

/**
 * Un problema técnico contado por lo que impide hacer, con su cifra real.
 *
 * Varios códigos distintos rompen la reutilización por el mismo motivo —un
 * encabezado vacío y uno duplicado estropean igual la carga automática—, así
 * que se agrupan: quien lee la portada necesita el efecto, no el código.
 */
export interface ReuseConsequence {
  /** Clave del icono; cada página la resuelve con su propio import. */
  icon: 'enlace' | 'no-archivo' | 'encabezado' | 'tipo';
  /** `bad` impide abrir el archivo; `warn` obliga a limpiarlo antes de usarlo. */
  severity: 'bad' | 'warn';
  /** Distribuciones afectadas, sumadas sobre los códigos del grupo. */
  count: number;
  title: string;
  text: string;
}

/** Códigos que comparten consecuencia, y cómo se cuenta cada grupo. */
const CONSEQUENCE_GROUPS: ReadonlyArray<Omit<ReuseConsequence, 'count'> & { codes: string[] }> = [
  {
    codes: ['descarga'],
    icon: 'enlace',
    severity: 'bad',
    title: 'Un enlace roto es un dato que no existe',
    text: 'Da igual lo bien documentado que esté: si el servidor no responde, quien lo necesita se encuentra un error. Es la diferencia entre publicar y estar disponible.',
  },
  {
    codes: ['no-es-archivo', 'no-es-imagen'],
    icon: 'no-archivo',
    severity: 'warn',
    title: 'Un archivo que no es un archivo',
    text: 'La URL responde, pero devuelve una página web en lugar del CSV o el mapa. Una persona lo sortea a mano; un programa que actualiza datos cada noche, no.',
  },
  {
    codes: ['encabezado-vacio', 'encabezado-duplicado'],
    icon: 'encabezado',
    severity: 'warn',
    title: 'Encabezados vacíos o repetidos',
    text: 'Las columnas sin nombre o con el nombre duplicado rompen la carga automática en hojas de cálculo y en cualquier programa. Obligan a limpiar a mano antes de poder empezar.',
  },
  {
    codes: ['error-tipo'],
    icon: 'tipo',
    severity: 'warn',
    title: 'Tipos mezclados en una misma columna',
    text: 'Un texto colado en una columna de números o fechas no da error: da un resultado equivocado. Son los fallos más caros porque nadie los ve venir.',
  },
];

/**
 * Consecuencias presentes en este catálogo, de mayor a menor impacto.
 *
 * Se descartan las que no ocurren —una consecuencia con cero afectados es
 * ruido—. El orden es gravedad primero y volumen después, no volumen a secas:
 * lo que impide abrir el archivo va antes que lo que solo obliga a limpiarlo,
 * aunque afecte a menos archivos. Es el mismo criterio que separa las dos
 * preguntas del portal, y ordenar solo por cantidad lo contradecía.
 */
const SEVERITY_ORDER: Record<ReuseConsequence['severity'], number> = { bad: 0, warn: 1 };

export function reuseConsequences(report: QualityReport | null): ReuseConsequence[] {
  const affected = distributionsAffectedByIssue(report);
  return CONSEQUENCE_GROUPS.map(({ codes, ...rest }) => ({
    ...rest,
    count: codes.reduce((sum, code) => sum + (affected[code] ?? 0), 0),
  }))
    .filter((consequence) => consequence.count > 0)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count
    );
}

/* ------------------------------------------------------------------ */
/* Fila de fichero con problema                                        */
/* ------------------------------------------------------------------ */

/**
 * Familia del defecto de un fichero, que es también la corrección que toca.
 *
 * `entrega` el fichero no llega o no se puede interpretar.
 * `contenido` el fichero abre, pero los datos vienen con errores.
 */
export type IssueFamily = 'entrega' | 'contenido';

/**
 * Un fichero con algún defecto, listo para pintar en tabla.
 *
 * Cubre las dos familias: antes solo existían las filas de entrega, así que los
 * ~328 ficheros que se abren con errores de contenido no aparecían en ninguna
 * tabla explorable —estaban únicamente en una lista de alertas por dataset— y no
 * se podían filtrar, buscar ni exportar.
 *
 * Estas filas viajan enteras al navegador (la tabla filtra en cliente), así que
 * no llevan nada derivable: la etiqueta de la causa se saca de `causeCode` con
 * `issueLabel`, que es client-safe. Enviarla ya resuelta costaba ~40 KB de
 * cadenas repetidas. `publisher` tampoco viaja: la vista no lo usa —el catálogo
 * declara el mismo organismo en todos— y el agrupado se hace por temática.
 */
export interface FileIssueRow {
  datasetSlug: string;
  datasetTitle: string;
  category: string;
  format: string;
  url: string;
  /** Slug de la distribución para la URL (/csv, /csv-2). */
  distSlug: string;
  family: IssueFamily;
  /** Estado de entrega. En las filas de contenido es siempre `ok`. */
  state: DeliveryState;
  /** Causa de entrega, o incidencia principal de contenido. */
  causeCode: string;
  /** Solo en contenido: incidencias de severidad error del fichero. */
  errorIssues?: number;
  /**
   * Índice de la nota del analizador dentro de `FileIssueRows.notes`, para dar
   * contexto en la fila expandida. Va por índice porque el analizador genera
   * las notas desde plantillas y solo 326 de las 711 son distintas: repetirlas
   * literalmente en cada fila costaba el doble de bytes.
   */
  noteIdx?: number;
  httpStatus?: number | null;
}

/** Filas de la pestaña de ficheros más las tablas que comparten. */
export interface FileIssueRows {
  rows: FileIssueRow[];
  /** Notas del analizador sin repetir; las filas apuntan aquí por índice. */
  notes: string[];
  /** Distribuciones analizadas por formato, para calcular proporciones. */
  formatTotals: Record<string, number>;
  totalDistributions: number;
}

/** Acumulador de notas sin duplicados, para construir `FileIssueRows.notes`. */
export function createNoteTable() {
  const notes: string[] = [];
  const index = new Map<string, number>();
  return {
    notes,
    /** Devuelve el índice de la nota, o undefined si está vacía. */
    add(note: string | undefined): number | undefined {
      if (!note) return undefined;
      const existing = index.get(note);
      if (existing != null) return existing;
      const next = notes.length;
      notes.push(note);
      index.set(note, next);
      return next;
    },
  };
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

export function findSystemicCauses(rows: FileIssueRow[], formatTotals: Record<string, number>): SystemicCause[] {
  const groups = new Map<string, { format: string; causeCode: string; affected: number; datasets: Set<string> }>();

  for (const row of rows) {
    const key = `${row.format}|${row.causeCode}`;
    let g = groups.get(key);
    if (!g) {
      g = { format: row.format, causeCode: row.causeCode, affected: 0, datasets: new Set() };
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
        causeLabel: issueLabel(g.causeCode),
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
 * Solo por categoría o formato: en este catálogo todos los datasets declaran el
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
  rows: FileIssueRow[],
  field: 'category' | 'format',
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
