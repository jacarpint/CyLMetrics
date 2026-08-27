/**
 * Perfilado e incidencias de datos tabulares, en el navegador.
 *
 * Por qué existe: el informe solo guarda 5 muestras por incidencia, así que
 * una distribución con 9.072 celdas vacías no se podía explorar. El visor ya
 * descarga el fichero completo, de modo que aquí se rehace el cálculo sobre
 * TODAS las filas y se obtienen las posiciones de cada caso.
 *
 * Las reglas replican las de `src/analysis/formats/tabular.py`
 * (`_value_type`, `_check_column_quality`, `_build_schema_and_sample`). Es una
 * duplicación consciente: el informe sigue siendo la fuente de verdad para el
 * histórico y el score, y esto solo sirve para explorar el fichero de hoy. Si
 * tocas una regla en Python, tócala aquí — y al revés.
 */

import type { UnitVoice } from '@/lib/unit-words';

export type ValueType = 'empty' | 'number' | 'date' | 'bool' | 'str';

/** Orden de preferencia al desempatar, igual que `_TYPE_PRIORITY`. */
const TYPE_PRIORITY: Record<ValueType, number> = { number: 0, date: 1, bool: 2, str: 3, empty: 9 };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Número decimal corriente, y el MISMO patrón que `_NUMBER_LITERAL` en
 * `src/analysis/formats/tabular.py`.
 *
 * Antes esto era `Number.isFinite(Number(v))`, que acepta cosas que el
 * analizador no —`Number('0x1A')` vale 26, `Number('0b11')` vale 3— y rechaza
 * otras que sí acepta —`int('1_000')` en Python vale 1000—. Cada discrepancia
 * era un `error-tipo` que salía en una pantalla y no en la otra sobre el mismo
 * fichero, que es justo lo que hacía dudar de las dos cifras.
 */
export const NUMBER_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Decimal con coma, la forma española de escribir un número, y el MISMO patrón
 * que `_DECIMAL_COMMA` en `src/analysis/formats/tabular.py`.
 *
 * Sin esto, una columna de cifras como «3632981672,59» se tipaba entera como
 * texto: 32 columnas del informe repartidas en 11 distribuciones, casi todas
 * presupuestarias, publicadas como cadenas y sin mínimo ni máximo.
 *
 * Se exige que la COMA esté presente, y ahí está toda la lógica. En castellano
 * el punto separa los miles, así que `1.234` a secas puede ser mil doscientos
 * treinta y cuatro o uno coma doscientos treinta y cuatro y no hay manera de
 * decidirlo mirando la celda: esa forma se queda fuera. Pero `210.826.129,02` no
 * tiene ninguna ambigüedad —la coma dice dónde empiezan los decimales y obliga a
 * leer los puntos como miles—, así que sí entra, con grupos de tres dígitos.
 *
 * Sin la forma con separador de miles el cambio hacía daño: la columna
 * «Incorporaciones» del presupuesto mezcla `0` con `210.826.129,02`, y con el
 * patrón corto solo los ceros contaban como números, ganaban por 27 a 26 y las
 * 26 cifras de verdad quedaban marcadas como valores de tipo incorrecto.
 */
export const DECIMAL_COMMA = /^[+-]?(\d+|\d{1,3}(\.\d{3})+),\d+$/;

/** Tipo estricto de una celda. En CSV todo llega como texto. */
export function valueType(value: string | null | undefined): ValueType {
  if (value == null) return 'empty';
  const v = value.trim();
  if (!v) return 'empty';
  const lower = v.toLowerCase();
  if (lower === 'true' || lower === 'false') return 'bool';
  if (NUMBER_LITERAL.test(v) || DECIMAL_COMMA.test(v)) return 'number';
  if (ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))) return 'date';
  return 'str';
}

/**
 * La celda como número, entendiendo lo mismo que `valueType`.
 *
 * Va aparte de `Number()` porque `Number('1234,56')` es `NaN`: sin esto una
 * columna de decimales con coma se reconocería como numérica y luego se
 * quedaría sin rango, que es lo peor de las dos opciones. Es el equivalente de
 * `_to_number` en `tabular.py`.
 */
export function toNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const v = value.trim();
  // Se exige uno de los dos patrones en vez de fiarlo a `Number()`, que es
  // generoso de un modo que aquí importa: `Number('')` vale 0 —una celda vacía
  // entrando en el mínimo como un cero que nadie escribió— y `Number('0x1A')`
  // vale 26, mientras que el `float('0x1A')` del analizador falla. Atarlo a los
  // mismos patrones que `valueType` es lo que garantiza que los dos lados midan
  // el mismo rango sobre el mismo fichero.
  // Puntos fuera (son los miles) y luego la coma pasa a punto. En ese orden, o
  // `210.826.129,02` acabaría en algo que `Number` no sabe leer.
  if (DECIMAL_COMMA.test(v)) return Number(v.replace(/\./g, '').replace(',', '.'));
  if (!NUMBER_LITERAL.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface ColumnProfile {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'unknown';
  /** Celdas vacías de la columna. */
  null_count: number;
  null_pct: number;
  distinct: number;
  min?: number | string;
  max?: number | string;
}

const TYPE_DISPLAY: Record<ValueType, ColumnProfile['type']> = {
  number: 'number',
  date: 'date',
  bool: 'boolean',
  str: 'string',
  empty: 'string',
};

/** Valores no vacíos de cada columna, indexados por posición. */
function columnValues(header: string[], rows: string[][]): string[][] {
  const ncols = header.length;
  const cols: string[][] = Array.from({ length: ncols }, () => []);
  for (const row of rows) {
    for (let i = 0; i < ncols; i++) {
      if (i >= row.length) continue;
      const v = row[i];
      if (valueType(v) === 'empty') continue;
      cols[i].push(v);
    }
  }
  return cols;
}

/** Tipo mayoritario de una columna y su recuento, con el desempate de Python. */
function majorityType(values: string[]): { winner: ValueType; count: number; second: number } {
  const counts = new Map<ValueType, number>();
  for (const v of values) {
    const t = valueType(v);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || TYPE_PRIORITY[a[0]] - TYPE_PRIORITY[b[0]]
  );
  if (ranked.length === 0) return { winner: 'empty', count: 0, second: 0 };
  return { winner: ranked[0][0], count: ranked[0][1], second: ranked[1]?.[1] ?? 0 };
}

/**
 * Perfil de cada columna sobre el fichero completo: tipo, nulos, distintos y
 * rango. Sin topes — el analizador cortaba los distintos en 1.000.
 */
export function columnProfiles(header: string[], rows: string[][]): ColumnProfile[] {
  const nrows = rows.length;
  const cols = columnValues(header, rows);

  return header.map((name, i) => {
    const values = cols[i];
    const { winner } = majorityType(values);
    const distinct = new Set(values).size;
    const nullCount = nrows - values.length;

    const profile: ColumnProfile = {
      name,
      type: TYPE_DISPLAY[winner] ?? 'string',
      null_count: nullCount,
      null_pct: nrows > 0 ? nullCount / nrows : 0,
      distinct,
    };

    if (winner === 'number') {
      // Con bucle y no `Math.min(...nums)`: el spread pasa un argumento por
      // valor, y una columna numérica de un CSV grande desborda la pila de
      // llamadas (~65.000 argumentos) mucho antes de agotar la memoria. Era un
      // fallo duro del visor, no una lentitud.
      let min = Infinity;
      let max = -Infinity;
      let seen = 0;
      for (const value of values) {
        // `toNumber` y no `Number`: este último devuelve `NaN` con la coma
        // decimal, así que una columna reconocida como numérica se quedaba sin
        // rango justo en las columnas por las que se añadió el patrón.
        const n = toNumber(value);
        if (n == null) continue;
        if (n < min) min = n;
        if (n > max) max = n;
        seen++;
      }
      if (seen > 0) {
        profile.min = min;
        profile.max = max;
      }
    } else if (winner === 'date') {
      const dates = values.map((v) => v.trim()).filter((v) => ISO_DATE.test(v)).sort();
      if (dates.length) {
        profile.min = dates[0];
        profile.max = dates[dates.length - 1];
      }
    }
    return profile;
  });
}

/* ------------------------------------------------------------------ */
/* Incidencias con posición                                            */
/* ------------------------------------------------------------------ */

/** Posición de un caso concreto. `row` es índice 0 dentro de las filas de datos. */
export interface Occurrence {
  row: number;
  col: number;
}

export interface TabularIssue {
  code: string;
  label: string;
  /**
   * Sin `info`, a diferencia de `IssueSeverity` en `quality-report.ts`, y a
   * propósito: este análisis lo hace el navegador sobre el archivo ya descargado,
   * así que nunca le falta un lector ni tiene nada que declarar como «no
   * comprobado». Esa estrechez es lo que permite a `table-explorer.tsx` tratar
   * cualquier severidad que no sea `error` como advertencia; si algún día se
   * amplía, hay que revisar allí los cinco sitios que lo dan por hecho.
   */
  severity: 'error' | 'warning';
  /** Explicación de la regla, para que el usuario sepa qué está viendo. */
  rule: string;
  occurrences: Occurrence[];
}

/** Proporción mínima de celdas rellenas para exigirle completitud a la columna. */
const MIN_FILL = 0.5;
/** Valores mínimos para atreverse a inferir el tipo de una columna. */
const MIN_VALUES_FOR_TYPE = 3;

/**
 * Un JSON de registros se analiza con las mismas reglas que una tabla, pero
 * llamarle «celda» a un campo de un objeto no ayuda a nadie: el vocabulario
 * cambia, la detección no. El eje está en `unit-words.ts`; aquí solo se usa.
 *
 * Lo de abajo no es vocabulario general sino el enunciado de cada regla, que es
 * propio de este analizador: por eso se queda aquí y no se mudó con las palabras.
 */
const WORDING: Record<string, Record<UnitVoice, { label: string; rule: string }>> = {
  'error-tipo': {
    table: {
      label: 'Valores con un tipo distinto al mayoritario de su columna',
      rule: 'Se compara cada valor con el tipo dominante de su columna (número, fecha o booleano). Las columnas de texto y las que empatan no se señalan.',
    },
    record: {
      label: 'Valores con un tipo distinto al mayoritario de su campo',
      rule: 'Se compara el valor de cada registro con el tipo dominante de ese campo (número, fecha o booleano). Los campos de texto y los que empatan no se señalan.',
    },
  },
  'celda-faltante': {
    table: {
      label: 'Celdas vacías en filas con datos',
      rule: `Solo se cuentan las columnas rellenas en al menos el ${MIN_FILL * 100}% de las filas: en las opcionales, estar vacía no es un fallo.`,
    },
    record: {
      label: 'Campos sin valor en registros con datos',
      rule: `Solo se cuentan los campos presentes en al menos el ${MIN_FILL * 100}% de los registros: en los opcionales, venir vacío o ausente no es un fallo.`,
    },
  },
  'encabezado-vacio': {
    table: {
      label: 'Columnas sin nombre',
      rule: 'La primera fila deja el nombre de la columna en blanco, lo que dificulta el procesamiento automático.',
    },
    record: {
      label: 'Campos sin nombre',
      rule: 'El registro trae una clave vacía o sin nombre, lo que dificulta el procesamiento automático.',
    },
  },
  'encabezado-duplicado': {
    table: {
      label: 'Columnas con el nombre repetido',
      rule: 'Dos o más columnas comparten nombre, lo que provoca conflictos al indexar o cruzar los datos.',
    },
    record: {
      label: 'Campos con el nombre repetido',
      rule: 'Dos o más campos comparten nombre, lo que provoca conflictos al indexar o cruzar los datos.',
    },
  },
  'celda-extra': {
    table: {
      label: 'Filas con más valores que columnas',
      rule: 'La fila trae más campos que nombres tiene el encabezado; suele romper los lectores automáticos.',
    },
    record: {
      label: 'Registros con más valores que campos',
      rule: 'El registro trae más valores de los que declara el primero, que es el que fija la estructura.',
    },
  },
};

function wording(code: string, voice: UnitVoice): { label: string; rule: string } {
  return WORDING[code][voice];
}

/**
 * Recorre el fichero y localiza cada caso de las incidencias que tienen
 * posición de celda. Las de fichero completo (descarga, ZIP corrupto…) no se
 * tratan aquí: no hay nada que recorrer.
 *
 * `voice` solo cambia cómo se nombran las cosas; las reglas son las mismas para
 * una tabla y para una lista de registros JSON.
 */
export function findTabularIssues(
  header: string[],
  rows: string[][],
  voice: UnitVoice = 'table'
): TabularIssue[] {
  const issues: TabularIssue[] = [];
  const ncols = header.length;
  const nrows = rows.length;
  if (ncols === 0) return issues;

  const cols = columnValues(header, rows);

  /* Tipos incoherentes dentro de una columna. */
  const typeErrors: Occurrence[] = [];
  for (let c = 0; c < ncols; c++) {
    const values = cols[c];
    if (values.length < MIN_VALUES_FOR_TYPE) continue;
    const { winner, count, second } = majorityType(values);
    if (winner === 'str' || winner === 'empty') continue;
    if (count <= second) continue; // empate: no se señala nada
    for (let r = 0; r < nrows; r++) {
      if (c >= rows[r].length) continue;
      const t = valueType(rows[r][c]);
      if (t === 'empty') continue; // dato ausente, no error de tipo
      if (t !== winner) typeErrors.push({ row: r, col: c });
    }
  }
  if (typeErrors.length) {
    issues.push({
      code: 'error-tipo',
      ...wording('error-tipo', voice),
      severity: 'error',
      occurrences: typeErrors,
    });
  }

  /* Celdas vacías en columnas mayoritariamente pobladas. */
  const missing: Occurrence[] = [];
  for (let c = 0; c < ncols; c++) {
    const fill = nrows > 0 ? cols[c].length / nrows : 0;
    if (fill < MIN_FILL) continue; // columna opcional: vacía no es un fallo
    for (let r = 0; r < nrows; r++) {
      if (c >= rows[r].length) continue;
      if (valueType(rows[r][c]) === 'empty') missing.push({ row: r, col: c });
    }
  }
  if (missing.length) {
    issues.push({
      code: 'celda-faltante',
      ...wording('celda-faltante', voice),
      severity: 'warning',
      occurrences: missing,
    });
  }

  /* Encabezados vacíos. */
  const blankHeaders: Occurrence[] = [];
  header.forEach((name, c) => {
    if (!name.trim() || /^Columna \d+$/.test(name)) blankHeaders.push({ row: -1, col: c });
  });
  if (blankHeaders.length) {
    issues.push({
      code: 'encabezado-vacio',
      ...wording('encabezado-vacio', voice),
      severity: 'error',
      occurrences: blankHeaders,
    });
  }

  /* Encabezados duplicados. */
  const seen = new Map<string, number>();
  const dupHeaders: Occurrence[] = [];
  header.forEach((name, c) => {
    const key = name.trim().toLowerCase();
    if (!key) return;
    if (seen.has(key)) dupHeaders.push({ row: -1, col: c });
    else seen.set(key, c);
  });
  if (dupHeaders.length) {
    issues.push({
      code: 'encabezado-duplicado',
      ...wording('encabezado-duplicado', voice),
      severity: 'error',
      occurrences: dupHeaders,
    });
  }

  /* Filas con más campos que el encabezado. */
  const extra: Occurrence[] = [];
  for (let r = 0; r < nrows; r++) {
    if (rows[r].length > ncols) extra.push({ row: r, col: ncols - 1 });
  }
  if (extra.length) {
    issues.push({
      code: 'celda-extra',
      ...wording('celda-extra', voice),
      severity: 'error',
      occurrences: extra,
    });
  }

  // Primero lo bloqueante y, dentro de cada nivel, lo más numeroso.
  return issues.sort(
    (a, b) =>
      Number(b.severity === 'error') - Number(a.severity === 'error') ||
      b.occurrences.length - a.occurrences.length
  );
}
