/**
 * Contrasta el lector de XLSX del navegador con lo que registró el analizador
 * Python (openpyxl) sobre el mismo fichero.
 *
 *   npx vite-node scripts/check-xlsx-read.mts
 *
 * Necesita el servidor de desarrollo levantado: la descarga pasa por el proxy.
 */
import fs from 'node:fs';
import { readXlsx } from '../src/lib/xlsx-read';
import { columnProfiles, findTabularIssues } from '../src/lib/tabular-analysis';

const REPORT = 'reports/history/analysis-2026-08-10T13-18-40.json';
const base = process.env.BASE_URL ?? 'http://localhost:3000';

const urls = process.argv.length > 2 ? process.argv.slice(2) : [
  'https://datosabiertos.jcyl.es/web/jcyl/risp/es/salud/dosis-vacunas-gripe-campana-24-25/1285449743808.xls',
  'https://datosabiertos.jcyl.es/web/jcyl/risp/es/comercio/talleres-artesanos/1285154430304.xls',
  'https://datosabiertos.jcyl.es/web/jcyl/risp/es/sector-publico/viajes-2026-2/1285663193631.xls',
];

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
function reported(url: string) {
  for (const ds of report.datasets) {
    for (const d of ds.distribution_results) {
      if (d.url === url) return d.analysis?.metrics ?? {};
    }
  }
  return {};
}

for (const url of urls) {
  console.log(`\n=== ${url.split('/').pop()} ===`);
  const res = await fetch(`${base}/api/proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) { console.log('  proxy:', res.status); continue; }
  const buffer = await res.arrayBuffer();

  const started = Date.now();
  try {
    const sheets = await readXlsx(buffer);
    const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0);
    const m = reported(url);
    console.log(`  leído en ${Date.now() - started} ms · ${(buffer.byteLength / 1024).toFixed(0)} KB`);
    console.log(`  hojas   navegador=${sheets.length}   informe=${m.sheet_count ?? '—'}`);
    console.log(`  filas   navegador=${totalRows}       informe=${m.total_rows ?? '—'}`);
    for (const s of sheets) {
      console.log(`   · «${s.name}» ${s.rows.length} filas × ${s.header.length} col`);
      console.log(`     cabecera: ${s.header.slice(0, 5).join(' | ')}`);
      const types = columnProfiles(s.header, s.rows).map((c) => c.type);
      console.log(`     tipos   : ${types.slice(0, 8).join(', ')}`);
      const issues = findTabularIssues(s.header, s.rows);
      if (issues.length) console.log(`     incidencias: ${issues.map((i) => `${i.code}=${i.occurrences.length}`).join(', ')}`);
      const sample = s.rows[0]?.slice(0, 5).map((v) => (v.length > 18 ? `${v.slice(0, 18)}…` : v));
      if (sample) console.log(`     1ª fila : ${sample.join(' | ')}`);
    }
  } catch (err) {
    console.log('  ERROR:', (err as Error).name, (err as Error).message);
  }
}
