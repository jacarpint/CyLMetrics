/**
 * Lector de XLSX para el visor del navegador.
 *
 * Convierte cada hoja en la misma estructura `header` + `rows` de texto que
 * produce el lector de CSV, de modo que el explorador, el perfilado de
 * columnas y la detección de incidencias funcionan igual para los dos.
 *
 * Los ficheros pequeños del paquete (workbook, relaciones, estilos) se parsean
 * con `fast-xml-parser`, que ya es dependencia del proyecto. Los grandes y
 * repetitivos (cadenas compartidas y datos de la hoja) se recorren con un
 * escáner propio: son XML generado por máquina, con estructura fija, y montar
 * el árbol completo de una hoja de 26 MB es caro de más.
 *
 * Limitaciones conocidas: de las fórmulas se muestra el último valor calculado
 * que guardó Excel, y de los estilos solo se interpreta el formato de fecha
 * (lo demás no cambia el dato, solo su presentación).
 */

import { unzip, ZipError } from './zip-read';

export { ZipError };

export interface XlsxSheet {
  name: string;
  header: string[];
  rows: string[][];
}

/* ------------------------------------------------------------------ */
/* Utilidades XML                                                      */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

async function parseXml(data: Uint8Array | undefined): Promise<Record<string, unknown> | null> {
  if (!data) return null;
  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseAttributeValue: false,
    trimValues: true,
  });
  return parser.parse(new TextDecoder('utf-8').decode(data)) as Record<string, unknown>;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

/** Formatos de fecha/hora integrados en el estándar OOXML. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** ¿El código de formato dibuja una fecha? Se ignora lo entrecomillado. */
function isDateFormat(code: string): boolean {
  const withoutLiterals = code.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(withoutLiterals);
}

/**
 * Serie de Excel → fecha ISO.
 *
 * El origen es 1899-12-30 y no 1900-01-01 porque Excel arrastra el bug de
 * considerar 1900 bisiesto; ese desfase de dos días es el que compensa.
 */
function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(serial);
  const iso = date.toISOString();
  // Con parte horaria se conserva; si es medianoche exacta, solo la fecha.
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

/* ------------------------------------------------------------------ */
/* Partes del paquete                                                  */
/* ------------------------------------------------------------------ */

/** `<si>` del sharedStrings: se concatenan todos sus `<t>` (texto enriquecido). */
function parseSharedStrings(data: Uint8Array | undefined): string[] {
  if (!data) return [];
  const xml = new TextDecoder('utf-8').decode(data);
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let si: RegExpExecArray | null;
  while ((si = siRe.exec(xml))) {
    const body = si[1] ?? '';
    let text = '';
    let t: RegExpExecArray | null;
    tRe.lastIndex = 0;
    while ((t = tRe.exec(body))) text += decodeXml(t[1]);
    out.push(text);
  }
  return out;
}

/** Índice de cellXfs → true si ese estilo pinta una fecha. */
async function parseDateStyles(data: Uint8Array | undefined): Promise<boolean[]> {
  const doc = await parseXml(data);
  const styles = doc?.styleSheet as Record<string, unknown> | undefined;
  if (!styles) return [];

  const custom = new Map<number, string>();
  for (const fmt of toArray((styles.numFmts as Record<string, unknown>)?.numFmt as unknown)) {
    const f = fmt as Record<string, string>;
    const id = Number(f['@_numFmtId']);
    if (Number.isFinite(id)) custom.set(id, f['@_formatCode'] ?? '');
  }

  return toArray((styles.cellXfs as Record<string, unknown>)?.xf as unknown).map((xf) => {
    const id = Number((xf as Record<string, string>)['@_numFmtId']);
    if (!Number.isFinite(id)) return false;
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    return code ? isDateFormat(code) : false;
  });
}

/** `B12` → 1 (índice de columna, base 0). */
function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Filas de una hoja como matriz de texto, respetando huecos. */
function parseSheet(data: Uint8Array, shared: string[], dateStyles: boolean[]): string[][] {
  const xml = new TextDecoder('utf-8').decode(data);
  const rows: string[][] = [];

  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const vRe = /<v\b[^>]*>([\s\S]*?)<\/v>/;
  const isRe = /<is\b[^>]*>([\s\S]*?)<\/is>/;
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;

  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(xml))) {
    const body = row[2] ?? '';
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    cellRe.lastIndex = 0;

    while ((cell = cellRe.exec(body))) {
      const attrs = cell[1] ?? '';
      const content = cell[2] ?? '';

      const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs);
      const index = refMatch ? columnIndex(refMatch[1]) : cells.length;
      // Rellenar los huecos de las celdas vacías que el XLSX omite.
      while (cells.length < index) cells.push('');

      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const styleIdx = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? NaN);

      let value = '';
      if (type === 'inlineStr') {
        const is = isRe.exec(content)?.[1] ?? '';
        let t: RegExpExecArray | null;
        tRe.lastIndex = 0;
        while ((t = tRe.exec(is))) value += decodeXml(t[1]);
      } else {
        const raw = vRe.exec(content)?.[1] ?? '';
        if (type === 's') {
          value = shared[Number(raw)] ?? '';
        } else if (type === 'b') {
          value = raw === '1' ? 'true' : 'false';
        } else if (type === 'e') {
          value = decodeXml(raw); // #N/A, #REF!…
        } else if (type === 'str') {
          value = decodeXml(raw); // resultado en texto de una fórmula
        } else {
          const num = Number(raw);
          value = raw !== '' && Number.isFinite(num) && dateStyles[styleIdx]
            ? serialToDate(num)
            : decodeXml(raw);
        }
      }
      cells.push(value);
    }
    rows.push(cells);
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* Lectura del libro                                                   */
/* ------------------------------------------------------------------ */

/** Nombre y ruta de cada hoja, en el orden del libro. */
async function sheetTargets(files: Map<string, Uint8Array>): Promise<{ name: string; path: string }[]> {
  const workbook = await parseXml(files.get('xl/workbook.xml'));
  const rels = await parseXml(files.get('xl/_rels/workbook.xml.rels'));

  const byId = new Map<string, string>();
  for (const rel of toArray((rels?.Relationships as Record<string, unknown>)?.Relationship as unknown)) {
    const r = rel as Record<string, string>;
    byId.set(r['@_Id'], r['@_Target']);
  }

  const sheets = toArray((workbook?.workbook as Record<string, unknown>)?.sheets as unknown)
    .flatMap((s) => toArray((s as Record<string, unknown>).sheet as unknown));

  return sheets.map((sheet, i) => {
    const s = sheet as Record<string, string>;
    const target = byId.get(s['@_id'] ?? '') ?? `worksheets/sheet${i + 1}.xml`;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    return { name: s['@_name'] || `Hoja ${i + 1}`, path };
  });
}

/**
 * Abre un XLSX y devuelve sus hojas con la primera fila como encabezado.
 * Las filas totalmente vacías se descartan, igual que en el lector de CSV.
 */
export async function readXlsx(buffer: ArrayBuffer): Promise<XlsxSheet[]> {
  const files = await unzip(buffer);
  const shared = parseSharedStrings(files.get('xl/sharedStrings.xml'));
  const dateStyles = await parseDateStyles(files.get('xl/styles.xml'));

  let targets = await sheetTargets(files);
  if (targets.length === 0) {
    // Libro sin workbook.xml legible: se cae a las hojas que haya en el ZIP.
    targets = [...files.keys()]
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort()
      .map((path, i) => ({ name: `Hoja ${i + 1}`, path }));
  }

  const sheets: XlsxSheet[] = [];
  for (const { name, path } of targets) {
    const data = files.get(path);
    if (!data) continue;
    const all = parseSheet(data, shared, dateStyles)
      .filter((r) => r.some((cell) => cell.trim() !== ''));
    if (all.length === 0) {
      sheets.push({ name, header: [], rows: [] });
      continue;
    }
    const [head, ...rest] = all;
    const width = Math.max(head.length, ...rest.map((r) => r.length), 0);
    const header = Array.from({ length: width }, (_, i) => head[i]?.trim() || `Columna ${i + 1}`);
    sheets.push({ name, header, rows: rest });
  }

  if (sheets.length === 0) throw new ZipError('El archivo no contiene hojas legibles.');
  return sheets;
}
