/**
 * Contrasta el lector de shapefiles del navegador con lo que registró el
 * analizador Python (pyshp) sobre el mismo paquete.
 *
 *   npm run check:shp
 *
 * Necesita el servidor de desarrollo levantado: la descarga pasa por el proxy.
 */
import fs from 'node:fs';
import { readShapefile } from '../src/lib/shapefile-read';

const REPORT = 'reports/history/analysis-2026-08-10T13-18-40.json';
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const limit = Number(process.argv[2] ?? 8);

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const targets: { url: string; features: number; fields: number }[] = [];
for (const ds of report.datasets) {
  for (const d of ds.distribution_results) {
    if (d.format !== 'SHP' || d.status !== 'ok') continue;
    const m = d.analysis?.metrics ?? {};
    targets.push({ url: d.url, features: m.features ?? -1, fields: m.fields ?? -1 });
  }
}

console.log(`${targets.length} shapefiles legibles; comprobando ${Math.min(limit, targets.length)}\n`);

/** Extremos de todas las coordenadas: sirve para ver si caen donde deben. */
function bounds(features: { geometry: GeoJSON.Geometry | null }[]) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      minLon = Math.min(minLon, c[0]); maxLon = Math.max(maxLon, c[0]);
      minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
      return;
    }
    for (const child of c) walk(child);
  };
  for (const f of features) if (f.geometry && 'coordinates' in f.geometry) walk(f.geometry.coordinates);
  return { minLon, minLat, maxLon, maxLat };
}

/** Castilla y León, con margen: si algo se sale, la reproyección está mal. */
const CYL = { west: -7.5, east: -1.5, south: 39.8, north: 43.5 };

let okCount = 0;
let mismatched = 0;

for (const t of targets.slice(0, limit)) {
  const name = t.url.split('/').slice(-2).join('/');
  try {
    const res = await fetch(`${base}/api/proxy?url=${encodeURIComponent(t.url)}`);
    if (!res.ok) { console.log(`✗ ${name}  proxy ${res.status}`); continue; }
    const buffer = await res.arrayBuffer();

    const started = Date.now();
    const layers = await readShapefile(buffer);
    const ms = Date.now() - started;

    const total = layers.reduce((n, l) => n + l.features.length, 0);
    const cuadra = total === t.features;
    if (cuadra) okCount++; else mismatched++;

    console.log(
      `${cuadra ? '✓' : '≠'} ${name}  ${(buffer.byteLength / 1048576).toFixed(1)}MB en ${ms}ms` +
      `  entidades navegador=${total} informe=${t.features}`
    );
    for (const l of layers) {
      const b = bounds(l.features);
      const dentro = b.minLon >= CYL.west && b.maxLon <= CYL.east && b.minLat >= CYL.south && b.maxLat <= CYL.north;
      const geoms = new Set(l.features.map((f) => f.geometry?.type ?? 'null'));
      console.log(
        `    «${l.name}» ${l.features.length} ent · ${l.fields.length} campos (informe ${t.fields})` +
        ` · ${[...geoms].join('/')} · crs=${l.crs ?? '—'}${l.projected ? '' : ' SIN PROYECTAR'}` +
        `${l.nullGeometries ? ` · ${l.nullGeometries} sin geometría` : ''}`
      );
      console.log(
        `      extensión lon ${b.minLon.toFixed(3)}…${b.maxLon.toFixed(3)}  lat ${b.minLat.toFixed(3)}…${b.maxLat.toFixed(3)}` +
        `  ${dentro ? '✓ dentro de Castilla y León' : '✗ FUERA DE CASTILLA Y LEÓN'}`
      );
      const first = l.features.find((f) => Object.keys(f.properties).length);
      if (first) {
        const shown = Object.entries(first.properties).slice(0, 4).map(([k, v]) => `${k}=${String(v).slice(0, 22)}`);
        console.log(`      atributos: ${shown.join(' · ')}`);
      }
    }
  } catch (err) {
    console.log(`✗ ${name}  ${(err as Error).name}: ${(err as Error).message}`);
  }
}

console.log(`\ncoinciden con el informe: ${okCount}  ·  difieren: ${mismatched}`);
