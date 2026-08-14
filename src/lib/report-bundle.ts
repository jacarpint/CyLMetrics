/**
 * Formato del informe: índice ligero + un fragmento por distribución.
 *
 * Lo escribe `src/analysis/bundle.py`; aquí se declara la forma y se deshace la
 * codificación de las posiciones. Client-safe a propósito: el explorador de
 * incidencias necesita expandir las posiciones en el navegador, así que este
 * módulo no puede tocar `node:fs`.
 *
 * ## Por qué las posiciones vienen codificadas
 *
 * El informe anterior guardaba `samples: [...]` con **cinco** posiciones por
 * incidencia mientras `count` decía 850.658. Guardarlas todas con la forma
 * antigua era imposible: cada muestra repetía la fila entera y la cabecera
 * entera. Ahora la cabecera se guarda una vez por distribución y las posiciones
 * van agrupadas por columna y delta-codificadas — `[1200, 1201, 1202]` se
 * escribe `[1200, 1, 1]`—, que es lo que hace que un fichero de un millón de
 * posiciones comprima a unos pocos cientos de kilobytes.
 *
 * Las funciones de aquí son las únicas que saben de esa codificación. Nada
 * fuera de este módulo debe leer `rows` en crudo.
 */

/** Versión de formato que este código sabe leer. */
export const BUNDLE_VERSION = 1;

/**
 * Campo del esquema inferido, sobre TODAS las filas descargadas.
 *
 * Vive aquí y no en `quality-report` porque el fragmento lo transporta y los
 * componentes cliente lo pintan: `quality-report` usa `node:fs` y no se puede
 * empaquetar en el bundle del navegador.
 */
export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'unknown';
  /** Celdas vacías de la columna. */
  null_count: number;
  /** Proporción de celdas vacías (0..1). */
  null_pct: number;
  /** Valores distintos. Sin tope: el analizador ya no corta en 1.000. */
  distinct: number;
  /** Rango mínimo/máximo para columnas numéricas o de fecha. */
  min?: number | string;
  max?: number | string;
}

/** Posiciones de una incidencia dentro de una columna. */
export interface IssueColumnGroup {
  /** Índice de columna, 0-based. */
  col: number;
  /** Hoja del libro, solo en XLSX/XLS con varias. */
  sheet?: string;
  /** Nombre de la columna en el momento del análisis. */
  field?: string;
  /** Filas delta-codificadas y ascendentes. Usa `expandRows`, nunca esto. */
  rows: number[];
  /** Valor de la celda, alineado con `rows`. Solo en códigos donde importa. */
  cells?: (string | null)[];
}

/** Una incidencia con todas sus posiciones. */
export interface IssueDetail {
  code: string;
  label: string;
  /** Ver `IssueSeverity` en `quality-report.ts`: `info` = no es del archivo. */
  severity: 'error' | 'warning' | 'info';
  /** Ocurrencias detectadas. */
  count: number;
  /** Ocurrencias realmente guardadas. Si es menor que `count`, hay que decirlo. */
  stored: number;
  /** Tipo crudo de Frictionless, como trazabilidad. */
  source?: string;
  columns?: IssueColumnGroup[];
  /** Incidencias de fila entera (fila vacía, geometría nula). */
  rows?: number[];
}

/** Fragmento de una distribución: todo lo caro que no cabe en el índice. */
export interface DistributionDetail {
  id: string;
  url: string;
  format: string;
  dataset_id: string;
  /** Cabecera del fichero, guardada una sola vez. */
  header: string[];
  issues: IssueDetail[];
  schema?: SchemaField[];
  sample_rows?: (string | null)[][];
}

/** Una ocurrencia ya expandida, lista para pintar. */
export interface IssuePosition {
  /** Fila 1-based contando el encabezado como línea 1. `null` si es del fichero. */
  row: number | null;
  /** Columna 0-based, o `null` si la incidencia es de fila entera. */
  col: number | null;
  sheet?: string;
  field?: string;
  cell?: string | null;
}

/* ------------------------------------------------------------------ */
/* Decodificación                                                      */
/* ------------------------------------------------------------------ */

/** Deltas -> números de fila absolutos. */
export function expandRows(deltas: readonly number[]): number[] {
  const out: number[] = new Array(deltas.length);
  let current = 0;
  for (let i = 0; i < deltas.length; i++) {
    current += deltas[i];
    out[i] = current;
  }
  return out;
}

/** Cuántas posiciones lleva guardadas esta incidencia. */
export function positionCount(issue: IssueDetail): number {
  let total = issue.rows?.length ?? 0;
  for (const group of issue.columns ?? []) total += group.rows.length;
  return total;
}

/**
 * Ventana de posiciones, expandida solo en el tramo pedido.
 *
 * Es deliberadamente perezoso: una incidencia puede llevar cientos de miles de
 * posiciones y el explorador pinta cincuenta. Expandir la lista entera para
 * quedarse con una página es lo que congelaba el navegador en los ficheros
 * grandes.
 */
export function issuePositions(issue: IssueDetail, offset = 0, limit = 50): IssuePosition[] {
  const out: IssuePosition[] = [];
  if (limit <= 0) return out;
  let skipped = 0;

  for (const group of issue.columns ?? []) {
    const size = group.rows.length;
    if (skipped + size <= offset) {
      skipped += size;
      continue;
    }
    // Los deltas obligan a recorrer desde el principio del grupo, pero solo de
    // este grupo: los anteriores se saltan enteros por su longitud.
    const start = Math.max(0, offset - skipped);
    let row = 0;
    for (let i = 0; i < size; i++) {
      row += group.rows[i];
      if (i < start) continue;
      out.push({
        row,
        col: group.col,
        sheet: group.sheet,
        field: group.field,
        cell: group.cells ? group.cells[i] : undefined,
      });
      if (out.length >= limit) return out;
    }
    skipped += size;
  }

  const rowOnly = issue.rows;
  if (rowOnly && rowOnly.length > 0) {
    const start = Math.max(0, offset - skipped);
    let row = 0;
    for (let i = 0; i < rowOnly.length; i++) {
      row += rowOnly[i];
      if (i < start) continue;
      out.push({ row, col: null });
      if (out.length >= limit) return out;
    }
  }

  return out;
}

/**
 * Columnas afectadas por una incidencia, de más a menos casos.
 *
 * Es la vista que de verdad sirve para arreglar: «FECHA_ALTA: 12.400 valores
 * con otro tipo» le dice al publicador dónde mirar, y una lista de 12.400
 * posiciones no.
 */
export interface AffectedColumn {
  col: number;
  field?: string;
  sheet?: string;
  count: number;
}

export function affectedColumns(issue: IssueDetail): AffectedColumn[] {
  return (issue.columns ?? [])
    .map((group) => ({
      col: group.col,
      field: group.field,
      sheet: group.sheet,
      count: group.rows.length,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * ¿Se guardaron todas las posiciones de esta incidencia?
 *
 * Los códigos de fichero entero (la descarga falló, el ZIP no abre) no tienen
 * posiciones que guardar y no cuentan como recorte: `stored` es 0 porque no hay
 * nada dentro del fichero que señalar, no porque falte información.
 */
export function isTruncated(issue: IssueDetail): boolean {
  return issue.stored > 0 && issue.stored < issue.count;
}

/** ¿Esta incidencia se puede localizar dentro del fichero? */
export function isLocatable(issue: IssueDetail): boolean {
  return issue.stored > 0;
}
