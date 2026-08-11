/**
 * Recorre el mismo camino que el visor geográfico para cada tipo de recurso y
 * comprueba que cada uno acaba donde debe: dibujado, o explicado.
 *
 *   npm run check:geo
 *
 * Necesita el servidor de desarrollo levantado.
 */
import { readShapefile, describeZip, ShapefileError } from '../src/lib/shapefile-read';
import { ZipError } from '../src/lib/zip-read';
import { diagnose, sniff, ogcException } from '../src/lib/geo-diagnose';

const base = process.env.BASE_URL ?? 'http://localhost:3000';

const CASES: { label: string; format: string; url: string; expect: string }[] = [
  { label: 'SHP legible', format: 'SHP', expect: 'dibujado',
    url: 'https://datosabiertos.jcyl.es/web/jcyl/risp/es/medio-ambiente/zonas-humedad-catalogadas-cyl/1284688146063.shp' },
  { label: 'SHP con capa muerta en GeoServer', format: 'SHP', expect: 'explicado (publicador)',
    url: 'https://datosabiertos.jcyl.es/web/jcyl/risp/es/medio-ambiente/delimitacion-cartografica-blackbass/1285154880418.shp' },
  { label: 'SHP que apunta a un directorio', format: 'SHP', expect: 'explicado (publicador)',
    url: 'https://ftp.itacyl.es/cartografia/04_SIOSE/' },
  { label: 'OTRO = GeoPackage en ZIP', format: 'OTRO', expect: 'explicado (contenido del ZIP)',
    url: 'https://datosabiertos.jcyl.es/web/jcyl/risp/es/medio-ambiente/incendios_forestales/1285648399689.gpkg' },
  { label: 'KML del workspace retirado', format: 'KML', expect: 'explicado (publicador)',
    url: 'https://datosabiertos.jcyl.es/web/jcyl/risp/es/medio-ambiente/aparcamientos/1284378117797.kml' },
  { label: 'GML del workspace retirado', format: 'GML', expect: 'explicado (publicador)',
    url: 'https://datosabiertos.jcyl.es/web/jcyl/risp/es/medio-ambiente/arboles_singulares/1284378127197.gml31' },
];

console.log('── Archivos ──────────────────────────────────────────────\n');

for (const c of CASES) {
  console.log(`${c.label}`);
  try {
    const res = await fetch(`${base}/api/proxy?raw=1&url=${encodeURIComponent(c.url)}`);
    if (!res.ok) { console.log(`   proxy ${res.status} — no se pudo probar\n`); continue; }
    const buffer = await res.arrayBuffer();
    const status = res.headers.get('x-origin-status');
    const kind = sniff(buffer);
    console.log(`   origen HTTP ${status} · ${(buffer.byteLength / 1024).toFixed(0)} KB · contenido: ${kind}`);

    if (kind === 'zip') {
      try {
        const layers = await readShapefile(buffer);
        const total = layers.reduce((n, l) => n + l.features.length, 0);
        console.log(`   → DIBUJADO: ${layers.length} capa(s), ${total.toLocaleString('es-ES')} entidades, ` +
          `${layers[0].fields.length} campos, crs ${layers[0].crs}`);
      } catch (err) {
        if (err instanceof ShapefileError) {
          const { extensions } = await describeZip(buffer);
          console.log(`   → EXPLICADO: el ZIP no trae shapefile; dentro hay ${extensions.join(', ')}`);
        } else if (err instanceof ZipError) {
          console.log(`   → EXPLICADO: ${diagnose(buffer, 'un shapefile').reason}`);
        } else throw err;
      }
    } else {
      const text = new TextDecoder().decode(buffer.slice(0, 4096));
      const exception = ogcException(text);
      const d = diagnose(buffer, `un archivo ${c.format}`, Number(status ?? 200));
      console.log(`   → EXPLICADO [${d.origin}]: ${d.reason}`);
      if (d.detail) console.log(`      detalle: ${d.detail}`);
      else if (exception) console.log(`      excepción: ${exception.text}`);
    }
  } catch (err) {
    console.log(`   FALLO: ${(err as Error).message}`);
  }
  console.log(`   esperado: ${c.expect}\n`);
}

/* ── WFS: ¿se trae la capa entera? ── */
console.log('── WFS: capa completa ────────────────────────────────────\n');

const caps = await (await fetch(
  `${base}/api/ogc?service=WFS&url=${encodeURIComponent(
    'https://datosabiertos.jcyl.es/web/jcyl/risp/es/medio-ambiente/incendios_forestales/1285647590501.wfs'
  )}`
)).json();

const build = (typeName: string, extra: Record<string, string>) => {
  const u = new URL(caps.getFeatureUrl);
  u.searchParams.set('service', 'WFS');
  u.searchParams.set('version', caps.version);
  u.searchParams.set('request', 'GetFeature');
  u.searchParams.set('typeNames', typeName);
  u.searchParams.set('srsName', 'EPSG:4326');
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return `${base}/api/proxy?url=${encodeURIComponent(u.toString())}`;
};

for (const ft of (caps.featureTypes ?? []).slice(0, 4)) {
  let matched: number | null = null;
  try {
    const hits = await (await fetch(build(ft.name, { resultType: 'hits' }))).text();
    const m = /numberMatched="(\d+)"|numberOfFeatures="(\d+)"/.exec(hits);
    if (m) matched = Number(m[1] ?? m[2]);
  } catch { /* el recuento es opcional */ }

  const t0 = Date.now();
  try {
    const res = await fetch(build(ft.name, { outputFormat: 'application/json' }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const n = data.features?.length ?? 0;
    const complete = matched === null || n >= matched;
    console.log(`${complete ? '✓ COMPLETA ' : '≈ PARCIAL  '} ${ft.name}`);
    console.log(`    ${n.toLocaleString('es-ES')} de ${matched?.toLocaleString('es-ES') ?? '?'} entidades en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.log(`✗ RESERVA   ${ft.name}`);
    console.log(`    la capa entera no llegó (${(err as Error).message}) tras ${((Date.now() - t0) / 1000).toFixed(1)}s → se pediría una muestra de 200`);
  }
}
