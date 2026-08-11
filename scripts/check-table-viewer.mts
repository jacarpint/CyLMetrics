/**
 * Comprobación de extremo a extremo de la ruta de datos del visor de tabla:
 * proxy → texto → parser → filas y columnas.
 *
 *   npx vite-node scripts/check-table-viewer.mts -- <url-del-csv>
 *
 * Necesita el servidor de desarrollo levantado, porque la descarga pasa por
 * /api/proxy (que es quien aplica la allowlist de dominios).
 */
import { parseTable } from '../src/lib/csv-parse';

const DEFAULT_URL =
  'https://datosabiertos.jcyl.es/web/jcyl/risp/es/economia/establecimientos-comerciales/1285142020827.csv';

const target = process.argv[2] ?? DEFAULT_URL;
const base = process.env.BASE_URL ?? 'http://localhost:3000';

const res = await fetch(`${base}/api/proxy?url=${encodeURIComponent(target)}`);
console.log('proxy      :', res.status, res.headers.get('content-type'));
if (!res.ok) process.exit(1);

const text = await res.text();
console.log('descargado :', (text.length / 1e6).toFixed(2), 'MB');

const started = Date.now();
const table = parseTable(text);
console.log('parseado en:', Date.now() - started, 'ms');
console.log('delimitador:', JSON.stringify(table.delimiter));
console.log('columnas   :', table.header.length);
console.log('filas      :', table.rows.length.toLocaleString('es-ES'));
console.log('cabecera   :', table.header.slice(0, 6).join(' | '));

const ragged = table.rows.filter((r) => r.length !== table.header.length).length;
console.log('filas con nº de campos distinto al encabezado:', ragged);
