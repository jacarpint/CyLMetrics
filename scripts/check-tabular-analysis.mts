/**
 * Contrasta la detección de incidencias del navegador con la del analizador
 * Python, sobre el mismo fichero real.
 *
 *   npx vite-node scripts/check-tabular-analysis.mts -- <url> [ruta-informe]
 *
 * No tienen por qué salir cifras idénticas: el informe pudo analizar solo una
 * parte del fichero (`truncated`) o el recurso puede haber cambiado desde
 * entonces. Lo que sí debe cuadrar es el conjunto de códigos detectados.
 */
import fs from 'node:fs';
import { parseTable } from '../src/lib/csv-parse';
import { findTabularIssues, columnProfiles } from '../src/lib/tabular-analysis';

const url =
  process.argv[2] ??
  'https://datosabiertos.jcyl.es/web/jcyl/risp/es/economia/establecimientos-comerciales/1285142020827.csv';
const reportPath = process.argv[3] ?? 'reports/history/analysis-2026-08-10T13-18-40.json';
const base = process.env.BASE_URL ?? 'http://localhost:3000';

const res = await fetch(`${base}/api/proxy?url=${encodeURIComponent(url)}`);
if (!res.ok) {
  console.error('proxy devolvió', res.status);
  process.exit(1);
}
const table = parseTable(await res.text());
console.log(`fichero: ${table.rows.length.toLocaleString('es-ES')} filas × ${table.header.length} columnas`);

const issues = findTabularIssues(table.header, table.rows);
console.log('\nNAVEGADOR (fichero completo)');
for (const i of issues) {
  console.log(`  ${i.code.padEnd(22)} ${i.occurrences.length.toLocaleString('es-ES').padStart(9)}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
let match: { analysis?: { issues?: { code: string; count: number }[]; truncated?: boolean; metrics?: Record<string, unknown> } } | undefined;
for (const ds of report.datasets) {
  for (const d of ds.distribution_results) {
    if (d.url === url) match = d;
  }
}

if (!match?.analysis) {
  console.log('\n(esa URL no está en el informe)');
} else {
  console.log(`\nINFORME (truncado: ${match.analysis.truncated}, filas: ${match.analysis.metrics?.rows})`);
  for (const i of match.analysis.issues ?? []) {
    console.log(`  ${i.code.padEnd(22)} ${i.count.toLocaleString('es-ES').padStart(9)}`);
  }
  const local = new Set(issues.map((i) => i.code));
  const remote = new Set((match.analysis.issues ?? []).map((i) => i.code));
  const onlyLocal = [...local].filter((c) => !remote.has(c));
  const onlyRemote = [...remote].filter((c) => !local.has(c) && c !== 'fila-vacia');
  console.log('\ncódigos solo en el navegador:', onlyLocal.length ? onlyLocal.join(', ') : 'ninguno');
  console.log('códigos solo en el informe  :', onlyRemote.length ? onlyRemote.join(', ') : 'ninguno');
}

const profiles = columnProfiles(table.header, table.rows);
console.log('\nPERFIL DE COLUMNAS (primeras 5)');
for (const p of profiles.slice(0, 5)) {
  console.log(`  ${p.name.padEnd(22)} ${p.type.padEnd(8)} nulos=${p.null_count} distintos=${p.distinct}`);
}
