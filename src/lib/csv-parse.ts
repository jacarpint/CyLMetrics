/**
 * Lector de CSV/TSV para el visor del navegador.
 *
 * Se hace a mano en vez de tirar de una librería porque solo hace falta esto:
 * separar filas y campos respetando comillas dobles al estilo RFC 4180. Pesa
 * unos cientos de bytes en el bundle frente a las decenas de KB de un parser
 * completo, y el fichero ya viene descargado entero del proxy.
 */

/** Delimitadores candidatos, en orden de probabilidad en datos abiertos. */
const CANDIDATES = [';', ',', '\t', '|'] as const;

/**
 * Adivina el delimitador contando apariciones fuera de comillas en las
 * primeras líneas. Gana el que produce el mismo número de campos en todas.
 */
export function guessDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024);
  let best = ';';
  let bestScore = -1;

  for (const candidate of CANDIDATES) {
    const rows = parseCsv(sample, candidate, 20);
    if (rows.length < 2) continue;
    const counts = rows.map((r) => r.length);
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    // Prima la consistencia y, a igualdad, el que parta en más columnas.
    const score = consistent * 100 + Math.min(first, 50);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Parsea texto CSV en filas de campos.
 *
 * @param maxRows corta la lectura (sin contar la cabecera). 0 = sin límite.
 */
export function parseCsv(text: string, delimiter: string, maxRows = 0): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  // El BOM se cuela en el primer encabezado y rompe la comparación de nombres.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === delimiter) { pushField(); continue; }
    if (char === '\r') continue;
    if (char === '\n') {
      pushField();
      pushRow();
      if (maxRows > 0 && rows.length > maxRows) return rows;
      continue;
    }
    field += char;
  }

  // Última fila sin salto final.
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  // Las filas totalmente vacías son ruido de exportación, no datos.
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '');
}

export interface ParsedTable {
  header: string[];
  rows: string[][];
  delimiter: string;
}

/** Parsea el texto completo tratando la primera fila como encabezado. */
export function parseTable(text: string, delimiter?: string): ParsedTable {
  const d = delimiter ?? guessDelimiter(text);
  const all = parseCsv(text, d);
  if (all.length === 0) return { header: [], rows: [], delimiter: d };
  const [header, ...rows] = all;
  return {
    header: header.map((h, i) => h.trim() || `Columna ${i + 1}`),
    rows,
    delimiter: d,
  };
}
