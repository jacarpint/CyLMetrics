/**
 * Contrasta la simplificación contra las geometrías reales del catálogo.
 *
 *   npm run check:simplify [-- <url-wfs> <typeName>]
 *
 * Los tests de `geo-simplify` fijan la regla con figuras sintéticas. Este script
 * responde a la pregunta que de verdad importa: cuántos puntos se ahorran en las
 * capas que están costando la memoria, y si alguna geometría se rompe por el
 * camino. Un anillo que quede abierto o con menos de cuatro posiciones no lo
 * dibuja Leaflet, y eso no se ve en un test con cuadrados.
 */
import { simplifyGeometry, countPositions, toleranceForZoom } from '../src/lib/geo-simplify';

const base = process.argv[2] ?? 'https://idecyl.jcyl.es/geoserver/incendios/ows';
const typeName = process.argv[3] ?? 'incendios:plainc25_cyl_areas_peligro_if';
const count = process.argv[4] ?? '12';

const url = new URL(base);
url.searchParams.set('service', 'WFS');
url.searchParams.set('version', '2.0.0');
url.searchParams.set('request', 'GetFeature');
url.searchParams.set('typeNames', typeName);
url.searchParams.set('srsName', 'EPSG:4326');
url.searchParams.set('outputFormat', 'application/json');
url.searchParams.set('count', count);

console.log(`Capa: ${typeName}\n`);

const response = await fetch(url, { headers: { 'user-agent': 'CyLMetrics-verificacion/1.0' } });
const body = await response.text();
if (!response.ok) {
  console.error(`El servicio respondió ${response.status}: ${body.slice(0, 200)}`);
  process.exit(1);
}

const parsed = JSON.parse(body) as { features: { geometry: GeoJSON.Geometry }[] };
const geometries = parsed.features.map((f) => f.geometry).filter(Boolean);
const original = geometries.reduce((sum, g) => sum + countPositions(g), 0);

console.log(
  `${geometries.length} entidades · ${original.toLocaleString('es-ES')} puntos · ` +
    `${(body.length / 1048576).toFixed(2)} MB\n`
);

/** Un anillo abierto o con menos de cuatro posiciones no se dibuja. */
function brokenRings(geometry: GeoJSON.Geometry): number {
  const rings: number[][][] =
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.type === 'MultiPolygon'
      ? geometry.coordinates.flat()
      : [];
  let broken = 0;
  for (const ring of rings) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length < 4 || first[0] !== last[0] || first[1] !== last[1]) broken++;
  }
  return broken;
}

console.log('zoom   se ve          m/píxel    puntos   ahorro   anillos rotos');
const ESCALAS: Record<number, string> = {
  7: 'la comunidad',
  8: 'la comunidad',
  10: 'una provincia',
  12: 'una comarca',
  14: 'un municipio',
  16: 'una parcela',
};
let roto = false;
for (const zoom of [7, 8, 10, 12, 14, 16]) {
  const tolerance = toleranceForZoom(zoom);
  const simplified = geometries.map((g) => simplifyGeometry(g, tolerance)!);
  const points = simplified.reduce((sum, g) => sum + countPositions(g), 0);
  const broken = simplified.reduce((sum, g) => sum + brokenRings(g), 0);
  if (broken > 0) roto = true;
  console.log(
    String(zoom).padEnd(6),
    (ESCALAS[zoom] ?? '').padEnd(14),
    (Math.round(tolerance * 111320) + ' m').padStart(8),
    String(points).padStart(9),
    ('-' + Math.round((1 - points / original) * 100) + '%').padStart(8),
    String(broken).padStart(14)
  );
}

if (roto) {
  console.error('\n✗ Alguna geometría se rompe al simplificar.');
  process.exit(1);
}
console.log('\n✓ Ninguna geometría se rompe: todos los anillos cierran y conservan 4+ posiciones.');
