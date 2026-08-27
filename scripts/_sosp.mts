import fs from 'node:fs';
import type { QualityReport, DistributionResult } from '../src/lib/quality-report';

const nuevo: QualityReport = JSON.parse(fs.readFileSync('reports/current/index.json', 'utf-8'));
const caidos = new Set(
  fs.readFileSync('C:/Users/javier.carpintero/AppData/Local/Temp/cyl-analysis/caidos.txt', 'utf-8')
    .trim().split('\n').map((s) => s.trim()).filter(Boolean)
);

const sosp: DistributionResult[] = [];
for (const ds of nuevo.datasets) for (const d of ds.distribution_results) {
  const n = d.fetch?.note ?? '';
  if (/ConnectionError|ChunkedEncoding|IncompleteRead|ReadTimeout|Timeout/.test(n)) sosp.push(d);
}
console.log(`Sospechosos (timeout o conexión cortada): ${sosp.length}\n`);
console.log('¿ya reintentado');
console.log('con 2 hilos?   declara      formato  url');
for (const d of sosp) {
  const yaVisto = caidos.has(d.url);
  const mb = (d.fetch?.size ?? 0) / 1048576;
  console.log(
    (yaVisto ? '  SÍ         ' : '  no         '),
    (mb > 0 ? mb.toFixed(0) + ' MB' : '     ?').padStart(8),
    ' ',
    d.format.padEnd(6),
    d.url.slice(-64)
  );
}
console.log(`\nde los ${sosp.length}, ya pasaron por el reintento a 2 hilos: ${sosp.filter((d) => caidos.has(d.url)).length}`);
