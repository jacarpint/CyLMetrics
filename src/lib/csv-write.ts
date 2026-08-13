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
 * Escapa un valor según RFC 4180: se entrecomilla si hace falta y las comillas
 * internas se duplican.
 */
export function escapeCsvValue(value: CsvValue): string {
  const text = String(value ?? '');
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
