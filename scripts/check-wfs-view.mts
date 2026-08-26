/**
 * La cadena completa del visor WFS contra el servicio real.
 *
 *   npm run check:wfs-view
 *
 * Comprueba lo que los tests unitarios no pueden: que pedir por `bbox` con la
 * sintaxis que genera `bboxParam` devuelve de verdad las entidades de esa zona.
 * Usa las mismas funciones que el componente, no una copia.
 */
import { bboxParam, padView, type ViewBox } from '../src/lib/wfs-paging';

const BASE = 'https://idecyl.jcyl.es/geoserver/incendios/ows';
const TYPE = 'incendios:plainc25_cyl_areas_peligro_if';

/** Encuadres reales: de la comunidad entera a un municipio. */
const VISTAS: { nombre: string; zoom: number; box: ViewBox }[] = [
  { nombre: 'Castilla y León', zoom: 7, box: { west: -7.1, south: 40.1, east: -1.8, north: 43.2 } },
  { nombre: 'provincia de Ávila', zoom: 10, box: { west: -5.7, south: 40.2, east: -4.5, north: 40.9 } },
  { nombre: 'entorno de Ávila', zoom: 12, box: { west: -4.75, south: 40.6, east: -4.6, north: 40.7 } },
];

const pedir = async (extra: Record<string, string>) => {
  const u = new URL(BASE);
  u.searchParams.set('service', 'WFS');
  u.searchParams.set('version', '2.0.0');
  u.searchParams.set('request', 'GetFeature');
  u.searchParams.set('typeNames', TYPE);
  u.searchParams.set('srsName', 'EPSG:4326');
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return (await fetch(u, { headers: { 'user-agent': 'CyLMetrics-verificacion/1.0' } })).text();
};

const total = /numberMatched="(\d+)"/.exec(await pedir({ resultType: 'hits' }))?.[1] ?? '?';
console.log(`Capa: ${TYPE}\nEntidades en total: ${total}\n`);
console.log('vista                 zoom   en la vista   traídas   puntos');

for (const { nombre, zoom, box } of VISTAS) {
  const bbox = bboxParam(padView(box));
  const hits = /numberMatched="(\d+)"/.exec(await pedir({ resultType: 'hits', bbox }))?.[1] ?? '?';

  // Una página corta, como la de sondeo del visor.
  const body = await pedir({ bbox, outputFormat: 'application/json', count: '10' });
  const parsed = JSON.parse(body) as { features: { geometry: GeoJSON.Geometry }[] };
  const geoms = parsed.features.map((f) => f.geometry).filter(Boolean);
  const puntos = geoms.reduce((sum, g) => {
    let n = 0;
    const walk = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === 'number') { n += 1; return; }
      for (const child of node) walk(child);
    };
    walk((g as { coordinates?: unknown }).coordinates);
    return sum + n;
  }, 0);

  console.log(
    nombre.padEnd(21),
    String(zoom).padStart(4),
    String(hits).padStart(13),
    String(geoms.length).padStart(9),
    String(puntos).padStart(8)
  );
}
