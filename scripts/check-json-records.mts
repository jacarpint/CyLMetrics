/**
 * Comprueba, sobre los JSON reales del catálogo, si el explorador consigue
 * encontrar la lista de registros dentro del documento — y si sus incidencias
 * coinciden con las que registró el analizador Python.
 *
 *   npx vite-node scripts/check-json-records.mts        (solo los dict)
 *   npx vite-node scripts/check-json-records.mts todos
 *
 * Necesita el servidor de desarrollo levantado.
 */
import fs from 'node:fs';
import { jsonRecordTable, describeJson } from '../src/lib/json-to-table';
import { findTabularIssues } from '../src/lib/tabular-analysis';

const REPORT = 'reports/history/analysis-2026-08-10T13-18-40.json';
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const all = process.argv[2] === 'todos';

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const targets: { url: string; kind: string; metrics: Record<string, unknown> }[] = [];
for (const ds of report.datasets) {
  for (const d of ds.distribution_results) {
    if (d.format !== 'JSON' || d.status !== 'ok') continue;
    const m = d.analysis?.metrics ?? {};
    if (!all && m.kind !== 'dict') continue;
    targets.push({ url: d.url, kind: String(m.kind), metrics: m });
  }
}

console.log(`${targets.length} JSON a comprobar\n`);
let tabulados = 0;
let coincidencias = 0;
let comparables = 0;

for (const t of targets.slice(0, all ? 40 : 40)) {
  const name = t.url.split('/').slice(-2).join('/');
  try {
    const res = await fetch(`${base}/api/proxy?url=${encodeURIComponent(t.url)}`);
    if (!res.ok) { console.log(`✗ ${name}  proxy ${res.status}`); continue; }
    const data = JSON.parse(await res.text());
    const table = jsonRecordTable(data);

    if (!table) {
      console.log(`· ${name}  [${t.kind}] sin tabla — ${describeJson(data)}`);
      continue;
    }
    tabulados++;
    const issues = findTabularIssues(table.header, table.rows, 'record');
    const mine = issues.reduce((n, i) => n + i.occurrences.length, 0);
    const theirs = typeof t.metrics.error_cells === 'number' ? t.metrics.error_cells : null;

    let veredicto = '';
    if (theirs != null) {
      comparables++;
      if (theirs === mine) { coincidencias++; veredicto = '  ✓ coincide con el informe'; }
      else veredicto = `  ≠ informe=${theirs} navegador=${mine}`;
    }
    console.log(
      `✓ ${name}  [${t.kind}] ${table.rows.length} reg × ${table.header.length} campos` +
      `  ruta="${table.path || '(raíz)'}"${veredicto}`
    );
  } catch (err) {
    console.log(`✗ ${name}  ${(err as Error).message}`);
  }
}

console.log(`\ntabulados ${tabulados}/${Math.min(targets.length, 40)}`);
if (comparables) console.log(`incidencias coincidentes con el informe: ${coincidencias}/${comparables}`);
