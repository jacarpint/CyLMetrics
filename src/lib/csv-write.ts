/**
 * Escritura de los CSV descargables del portal.
 *
 * Estaba duplicado en cada vista que ofrece descarga, y las copias compartían
 * el mismo defecto: el escapado no contemplaba el retorno de carro, así que un
 * valor con `\r` partía la fila en dos y desplazaba todas las columnas
 * siguientes. Aquí vive una sola vez, con test.
 *
 * Dos decisiones que no son evidentes y que conviene no revertir:
 *
 * - Delimitador `;` y no coma. Excel en configuración regional española espera
 *   punto y coma; con coma vuelca toda la fila en la primera columna.
 * - BOM al principio. Sin él, Excel lee el archivo como ANSI y los acentos y
 *   las eñes llegan corrompidos.
 *
 * Client-safe.
 */

const DELIMITER = ';';
const BOM = '﻿';

/** Caracteres que obligan a entrecomillar: el delimitador, la comilla y los saltos. */
const NEEDS_QUOTING = /[";\r\n]/;

/** Un valor de celda ya listo para escribir. `null` y `undefined` quedan vacíos. */
export type CsvValue = string | number | null | undefined;

/**
 * Caracteres con los que Excel y LibreOffice interpretan la celda como fórmula.
 *
 * `=SUMA(...)` es lo esperable, pero también `+`, `@` y el tabulador, y con
 * `=cmd|'/c calc'!A1` se llega a ejecutar un programa. Entrecomillar NO lo evita:
 * la hoja de cálculo mira el primer carácter del valor, no del campo.
 */
const FORMULA_START = /^[=+@\t\r\n]/;

/** Un número negativo de verdad, que no hay que tocar. */
const PLAIN_NEGATIVE = /^-\d+(?:[.,]\d+)?$/;

/**
 * Desactiva la celda como fórmula anteponiendo un apóstrofo.
 *
 * Estos CSV los rellena el catálogo de la Junta —títulos de conjunto, temáticas,
 * URL—, o sea contenido de terceros que el portal no escribe ni valida, y se
 * ofrecen para abrirlos en Excel. Es el escenario exacto de la inyección de
 * fórmulas en CSV, y aquí el escapado RFC 4180 no protege de nada porque resuelve
 * otro problema.
 *
 * El guion se trata aparte: `-5` es un número legítimo y anteponerle el apóstrofo
 * lo convertiría en texto, así que solo se neutraliza cuando lo que sigue no es
 * un número.
 */
function neutralizeFormula(text: string): string {
  if (FORMULA_START.test(text)) return `'${text}`;
  if (text.startsWith('-') && !PLAIN_NEGATIVE.test(text)) return `'${text}`;
  return text;
}

/**
 * Escapa un valor según RFC 4180 —se entrecomilla si hace falta y las comillas
 * internas se duplican— y lo desactiva como fórmula si empieza por algo que la
 * hoja de cálculo interpretaría.
 *
 * El orden importa: primero el apóstrofo, después las comillas. Al revés, el
 * apóstrofo quedaría fuera del campo y rompería el CSV.
 */
export function escapeCsvValue(value: CsvValue): string {
  const text = neutralizeFormula(String(value ?? ''));
  return NEEDS_QUOTING.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Genera un CSV completo a partir de una cabecera y sus filas.
 *
 * Las filas se pasan como arrays de celdas en el mismo orden que la cabecera;
 * cuadrar ambas cosas es responsabilidad de quien llama, porque cada vista sabe
 * qué columnas publica.
 */
export function toCsv(header: readonly string[], rows: readonly CsvValue[][]): string {
  const lines = [
    header.join(DELIMITER),
    ...rows.map((row) => row.map(escapeCsvValue).join(DELIMITER)),
  ];
  return `${BOM}${lines.join('\r\n')}`;
}
