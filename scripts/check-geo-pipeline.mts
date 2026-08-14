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
import {
  budgetExhausted, heaviestPerFeature, looksTruncatedByCap, nextPageSize, pageFingerprint, shrinkPageSize,
  WFS_MAX_PAGES, WFS_MAX_SHRINKS, WFS_MAX_TOTAL_BYTES, WFS_PROBE_SIZE,
} from '../src/lib/wfs-paging';

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

/* ── WFS: ¿se trae la capa entera, y en cuántas páginas? ──────────────
   Recorre exactamente el mismo bucle que el visor: página de sondeo, talla
   calculada con los bytes por entidad observados y reintento más corto cuando
   una página no cabe en una petición del proxy. Es la comprobación de que las
   capas de polígonos pesadas —las que devolvían «Expected ',' or ']' after
   array element in JSON at position 50323422»— ahora se dibujan. */
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

class OversizePage extends Error {}

/** Una página, con lo que ha pesado: es lo que dimensiona la siguiente. */
async function loadPage(typeName: string, extra: Record<string, string>) {
  let text: string;
  try {
    const res = await fetch(build(typeName, { outputFormat: 'application/json', ...extra }));
    if (res.status === 413) throw new OversizePage();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    if (err instanceof OversizePage) throw err;
    if (err instanceof TypeError) throw new OversizePage();
    throw err;
  }
  try {
    const data = JSON.parse(text) as { features?: unknown[] };
    return { features: data.features ?? [], bytes: text.length };
  } catch {
    if (looksTruncatedByCap(text.length)) throw new OversizePage();
    throw new Error(ogcException(text.slice(0, 8192))?.text ?? 'el servicio no devolvió GeoJSON');
  }
}

for (const ft of (caps.featureTypes ?? []).slice(0, 4)) {
  let matched: number | null = null;
  try {
    const hits = await (await fetch(build(ft.name, { resultType: 'hits' }))).text();
    const m = /numberMatched="(\d+)"|numberOfFeatures="(\d+)"/.exec(hits);
    if (m) matched = Number(m[1] ?? m[2]);
  } catch { /* el recuento es opcional */ }

  const t0 = Date.now();
  const seen = new Set<string>();
  let collected = 0, totalBytes = 0, pages = 0, shrinks = 0, perFeature = 0;
  let pageSize = WFS_PROBE_SIZE;
  let stop = 'paginas';
  let error = '';

  for (let page = 0; page < WFS_MAX_PAGES; page++) {
    const paging: Record<string, string> = { count: String(pageSize) };
    if (collected > 0) paging.startIndex = String(collected);
    try {
      const { features, bytes } = await loadPage(ft.name, paging);
      pages++;
      if (features.length === 0) { stop = 'completa'; break; }
      const fingerprint = pageFingerprint(features[0] as { geometry: unknown; properties: unknown });
      if (seen.has(fingerprint)) { stop = 'sin-paginacion'; break; }
      seen.add(fingerprint);
      collected += features.length;
      totalBytes += bytes;
      if (features.length < pageSize) { stop = 'completa'; break; }
      if (matched !== null && collected >= matched) { stop = 'completa'; break; }
      perFeature = heaviestPerFeature(perFeature, bytes, features.length);
      if (budgetExhausted(totalBytes, perFeature)) { stop = 'presupuesto'; break; }
      pageSize = nextPageSize(pageSize, perFeature, WFS_MAX_TOTAL_BYTES - totalBytes);
    } catch (err) {
      if (err instanceof OversizePage && shrinks < WFS_MAX_SHRINKS) {
        shrinks++;
        pageSize = shrinkPageSize(pageSize);
        page--;
        continue;
      }
      stop = 'servicio';
      error = err instanceof OversizePage ? `ni ${pageSize} entidades caben en una petición` : (err as Error).message;
      break;
    }
  }

  const mark = collected === 0 ? '✗ SIN NADA ' : stop === 'completa' ? '✓ COMPLETA ' : '≈ PARCIAL  ';
  console.log(`${mark} ${ft.name}`);
  console.log(
    `    ${collected.toLocaleString('es-ES')} de ${matched?.toLocaleString('es-ES') ?? '?'} entidades · ` +
    `${pages} página(s) de hasta ${pageSize} · ${(totalBytes / 1e6).toFixed(1)} MB · ` +
    `${shrinks} reintento(s) más corto(s) · ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  if (stop !== 'completa') console.log(`    paró por: ${stop}${error ? ` (${error})` : ''}`);
}
