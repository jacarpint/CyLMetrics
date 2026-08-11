/**
 * Convierte un JSON tabular en la misma estructura `header` + `rows` que
 * producen los lectores de CSV y XLSX, para que el explorador, el perfilado de
 * columnas y la detección de incidencias sirvan igual para los tres.
 *
 * Replica el criterio de `analyze_json` en `src/analysis/formats/tabular.py`:
 * solo se considera tabular una lista cuyo primer elemento sea un objeto (o un
 * array), y las columnas son las claves de ese primer elemento.
 */

export interface JsonTable {
  header: string[];
  rows: string[][];
  /** Registros que no traían alguna de las claves del primero. */
  irregular: number;
}

/** Valor JSON → texto de celda, sin perder la distinción entre vacío y "null". */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Objetos y arrays anidados se muestran serializados: la tabla es plana.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** ¿Es una lista de registros que se puede pintar como tabla? */
export function isTabularJson(data: unknown): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  const first = data[0];
  return typeof first === 'object' && first !== null;
}

/**
 * Tabla equivalente al JSON, o null si no es tabular.
 * Las claves salen del primer registro, igual que en el analizador.
 */
export function jsonToTable(data: unknown): JsonTable | null {
  if (!isTabularJson(data)) return null;
  const list = data as unknown[];
  const first = list[0];

  if (Array.isArray(first)) {
    const width = Math.max(...list.map((r) => (Array.isArray(r) ? r.length : 0)));
    return {
      header: Array.from({ length: width }, (_, i) => `Columna ${i + 1}`),
      rows: list.map((r) => (Array.isArray(r) ? r.map(cellText) : [])),
      irregular: 0,
    };
  }

  const header = Object.keys(first as Record<string, unknown>);
  if (header.length === 0) return null;

  let irregular = 0;
  const rows = list.map((item) => {
    if (typeof item !== 'object' || item === null) {
      irregular++;
      return [cellText(item)];
    }
    const record = item as Record<string, unknown>;
    if (header.some((k) => !(k in record))) irregular++;
    return header.map((k) => cellText(record[k]));
  });

  return { header, rows, irregular };
}

/* ------------------------------------------------------------------ */
/* Dónde están los registros                                           */
/* ------------------------------------------------------------------ */

/** Hasta dónde se baja buscando la lista de registros. */
const MAX_DEPTH = 4;

/** Lista de registros hallada en el documento, y la ruta donde estaba. */
export interface RecordSource {
  items: unknown[];
  /** Ruta desde la raíz; cadena vacía si los registros son el documento. */
  path: string;
}

/**
 * Muchos JSON del portal no son una lista pelada sino un envoltorio:
 * `{document: {date, list: [...]}}`. El analizador Python se queda en la raíz y
 * no los analiza, pero para explorarlos sí interesa encontrar la lista.
 * Se elige la más larga de las que hay a la vista.
 */
export function findRecords(data: unknown): RecordSource | null {
  let best: RecordSource | null = null;

  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      // No se entra en los elementos: sus hijos ya no son «la lista».
      if (isTabularJson(value) && (best === null || value.length > best.items.length)) {
        best = { items: value, path };
      }
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };

  visit(data, '', 0);
  return best === null ? null : unwrapSingleKey(best);
}

/**
 * Deshace el envoltorio de un solo campo (`[{element: {...}}, …]`), que en el
 * portal es habitual y dejaría una tabla de una única columna con el registro
 * entero serializado dentro.
 */
function unwrapSingleKey(source: RecordSource): RecordSource {
  let wrapper: string | null = null;

  for (const item of source.items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return source;
    const keys = Object.keys(item as Record<string, unknown>);
    if (keys.length !== 1) return source;
    if (wrapper !== null && keys[0] !== wrapper) return source;
    const inner = (item as Record<string, unknown>)[keys[0]];
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return source;
    wrapper = keys[0];
  }

  if (wrapper === null) return source;
  return {
    items: source.items.map((item) => (item as Record<string, unknown>)[wrapper]),
    path: `${source.path}[].${wrapper}`,
  };
}

/* ------------------------------------------------------------------ */
/* Registros codificados como pares nombre/valor                       */
/* ------------------------------------------------------------------ */

/**
 * Buena parte de los JSON del portal no guardan los campos como claves sino
 * como una lista de pares:
 *
 *   {"attribute": [{"name": "Titulo_es", "string": "…"},
 *                  {"name": "CodigoPostal", "valor": "05120"}]}
 *
 * Tal cual, la tabla saldría con una sola columna y el registro entero
 * serializado dentro. Aquí se convierte a columnas de verdad. El nombre de la
 * clave que lleva el valor cambia según el tipo (`valor`, `string`, `text`,
 * `date`, `link`…), así que se toma la primera que no sea `name`.
 */
function nameValueTable(items: unknown[]): { table: JsonTable; key: string } | null {
  if (items.length === 0) return null;

  let listKey: string | null = null;
  const perRecord: Map<string, string[]>[] = [];
  /** Nombres en el orden en que aparecen por primera vez. */
  const header: string[] = [];
  const known = new Set<string>();

  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const keys = Object.keys(item as Record<string, unknown>);
    if (keys.length !== 1) return null;
    if (listKey !== null && keys[0] !== listKey) return null;
    listKey = keys[0];

    const pairs = (item as Record<string, unknown>)[listKey];
    if (!Array.isArray(pairs)) return null;

    const fields = new Map<string, string[]>();
    for (const pair of pairs) {
      if (pair === null || typeof pair !== 'object' || Array.isArray(pair)) return null;
      const entry = pair as Record<string, unknown>;
      if (typeof entry.name !== 'string') return null;
      const valueKey = Object.keys(entry).find((k) => k !== 'name');
      const text = valueKey === undefined ? '' : cellText(entry[valueKey]);
      // Un nombre puede repetirse (varios teléfonos, varias provincias): se
      // acumulan en la misma columna en lugar de inventar columnas nuevas.
      const bucket = fields.get(entry.name);
      if (bucket) bucket.push(text);
      else fields.set(entry.name, [text]);
      if (!known.has(entry.name)) { known.add(entry.name); header.push(entry.name); }
    }
    perRecord.push(fields);
  }

  if (listKey === null || header.length === 0) return null;

  let irregular = 0;
  const rows = perRecord.map((fields) => {
    if (header.some((name) => !fields.has(name))) irregular++;
    return header.map((name) => (fields.get(name) ?? []).filter(Boolean).join(' · '));
  });

  return { table: { header, rows, irregular }, key: listKey };
}

/** Tabla de los registros del documento, estén donde estén y como estén. */
export function jsonRecordTable(data: unknown): (JsonTable & { path: string }) | null {
  const found = findRecords(data);
  if (!found) return null;

  const pairs = nameValueTable(found.items);
  if (pairs) return { ...pairs.table, path: `${found.path}[].${pairs.key}` };

  const table = jsonToTable(found.items);
  return table ? { ...table, path: found.path } : null;
}

/** Resumen legible de la forma del JSON, para la cabecera del explorador. */
export function describeJson(data: unknown): string {
  if (Array.isArray(data)) return `Array · ${data.length.toLocaleString('es-ES')} elementos`;
  if (data !== null && typeof data === 'object') {
    return `Objeto · ${Object.keys(data as object).length.toLocaleString('es-ES')} claves`;
  }
  return `Valor ${data === null ? 'null' : typeof data}`;
}
