import { XMLParser } from "fast-xml-parser";
import { isAllowedHost, isAllowedResponse } from "@/lib/proxy-allow";
import { OGC_MAX_BYTES, OGC_TIMEOUT_MS } from "@/lib/download-budget";

export const revalidate = 3600;
export const runtime = "nodejs";
/**
 * Mismo motivo que en `/api/proxy`: sin esto la plataforma corta a los 10 s, y
 * literal por la misma razón (Next lee estas constantes sin ejecutar el módulo).
 */
export const maxDuration = 60;

/**
 * Presupuesto total de la ruta, repartido entre sus dos intentos. Deja margen
 * para parsear el XML y responder dentro de `maxDuration`.
 */
const OGC_BUDGET_MS = OGC_TIMEOUT_MS * 2;

type Bbox = { west: number; south: number; east: number; north: number };
type Layer = {
  name: string;
  title: string;
  /** Extensión geográfica declarada, para encuadrar el mapa en esa capa. */
  bbox?: Bbox | null;
  /** Solo WMS: la capa tiene leyenda propia consultable con GetLegendGraphic. */
  queryable?: boolean;
  /** Solo WFS: CRS nativo del tipo de entidad. */
  crs?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: true,
  trimValues: true,
});

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function validBbox(b: Bbox | null): Bbox | null {
  if (!b) return null;
  const vals = [b.west, b.south, b.east, b.north];
  if (vals.some((v) => !Number.isFinite(v))) return null;
  if (b.west === b.east || b.south === b.north) return null;
  return b;
}

function withCapabilitiesQuery(rawUrl: string, service: "WMS" | "WFS"): string {
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has("request")) {
      u.searchParams.set("service", service);
      u.searchParams.set("request", "GetCapabilities");
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Devuelve el endpoint base al que un cliente puede añadir sus propios
 * parámetros OGC.
 *
 * GeoServer publica hrefs del tipo `…/ows?SERVICE=WMS&`. Si se pasan tal cual a
 * Leaflet, este concatena con `&` y sale `…/ows?SERVICE=WMS&&service=WMS&…`
 * (parámetro duplicado y separador vacío). Se quitan los parámetros que el
 * cliente va a fijar por su cuenta y se conserva el resto — algunos servidores
 * llevan en la query datos imprescindibles (p. ej. `map=` en MapServer), así
 * que recortar a la ruta pelada rompería esos.
 */
function normalizeEndpoint(rawUrl: string, fallback: string): string {
  const candidate = rawUrl || fallback;
  try {
    const u = new URL(candidate, fallback);
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (k === "service" || k === "request" || k === "version") u.searchParams.delete(key);
    }
    // `toString()` deja un `?` colgante si ya no quedan parámetros.
    const out = u.toString();
    return out.endsWith("?") ? out.slice(0, -1) : out;
  } catch {
    return candidate.split("?")[0];
  }
}

type Fetched = { text: string; finalUrl: string; ok: boolean };

/**
 * Descarga texto conservando SIEMPRE la URL final tras los redirects, incluso
 * cuando la respuesta no es OK.
 *
 * Esto importa: `datosabiertos.jcyl.es/…/x.wfs` redirige al GeoServer real y
 * este responde 400 si no le llega `request=`. Si se descartara la respuesta
 * por no ser OK, el reintento se lanzaría contra la URL del portal — cuyo
 * redirect además descarta el query string — y nunca se leerían las
 * capacidades.
 */
/**
 * Lee el cuerpo sin pasar de `OGC_MAX_BYTES`.
 *
 * `res.text()` no tenía ningún tope, a diferencia del proxy. Un
 * `GetCapabilities` de un servicio con miles de capas son decenas de MB de XML
 * que se acumulaban enteros y acto seguido pasaban a `fast-xml-parser`, que
 * construye un árbol de varias veces ese tamaño. Aquí se corta antes de llegar
 * a eso; el parser solo necesita las primeras capas para responder.
 */
async function readCapped(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (seen >= limit) break;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

/**
 * `deadline` es un instante absoluto, no un plazo por intento.
 *
 * Antes cada intento arrancaba su propio cronómetro de 12 s y esta ruta hace
 * hasta dos: 24 s en el peor caso, por encima del techo de la plataforma. Con
 * un vencimiento compartido, los dos intentos caben dentro del mismo
 * presupuesto y la ruta responde algo antes de que la maten.
 */
async function fetchText(url: string, deadline: number): Promise<Fetched | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(remaining, OGC_TIMEOUT_MS));
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "JCyL-DataQuality-Portal/1.0", accept: "application/xml,text/xml,*/*" },
      redirect: "follow",
    });
    // La allowlist se comprobó sobre la URL pedida; el redirect puede llevar a
    // otro sitio, así que se vuelve a comprobar el destino final.
    if (!isAllowedResponse(res, url)) return null;
    return { text: await readCapped(res, OGC_MAX_BYTES), finalUrl: res.url || url, ok: res.ok };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeCapabilities(text: string): boolean {
  return /<(\w+:)?(WMS_Capabilities|WMT_MS_Capabilities|WFS_Capabilities)/i.test(text.slice(0, 4000));
}

/* ── WMS ── */

function wmsLayerBbox(n: Record<string, unknown>): Bbox | null {
  const ex = n.EX_GeographicBoundingBox as Record<string, unknown> | undefined;
  if (ex) {
    return validBbox({
      west: num(ex.westBoundLongitude), south: num(ex.southBoundLatitude),
      east: num(ex.eastBoundLongitude), north: num(ex.northBoundLatitude),
    });
  }
  const ll = n.LatLonBoundingBox as Record<string, unknown> | undefined;
  if (ll) {
    return validBbox({
      west: num(ll["@_minx"]), south: num(ll["@_miny"]),
      east: num(ll["@_maxx"]), north: num(ll["@_maxy"]),
    });
  }
  return null;
}

/**
 * Capas que se devuelven como mucho. Cada una es un `<option>` del selector, y
 * un servicio con miles convierte la lista en algo que no se puede usar además
 * de una respuesta enorme. Cuando se alcanza, la interfaz lo dice.
 */
const MAX_WMS_LAYERS = 500;
/** Profundidad máxima del árbol de capas, como corta a un XML malicioso o roto. */
const MAX_LAYER_DEPTH = 12;

/**
 * Recorre el árbol de capas. Solo las que tienen `<Name>` son pintables: las
 * que solo llevan `<Title>` son agrupadores. La extensión se hereda del padre
 * cuando la capa no declara la suya.
 *
 * La recursión iba sin tope de profundidad ni de número: un documento con un
 * ciclo o con miles de capas se llevaba por delante la función.
 */
function collectWmsLayers(node: unknown, acc: Layer[], inheritedBbox: Bbox | null, depth = 0): void {
  if (!node || typeof node !== "object") return;
  if (depth > MAX_LAYER_DEPTH || acc.length >= MAX_WMS_LAYERS) return;
  const n = node as Record<string, unknown>;
  const own = wmsLayerBbox(n) ?? inheritedBbox;

  const name = n.Name;
  if (typeof name === "string" || typeof name === "number") {
    const title = n.Title;
    acc.push({
      name: String(name),
      title: typeof title === "string" && title.trim() ? title : String(name),
      bbox: own,
      queryable: n["@_queryable"] === 1 || n["@_queryable"] === "1" || n["@_queryable"] === true,
    });
  }
  for (const child of toArray(n.Layer as unknown)) collectWmsLayers(child, acc, own, depth + 1);
}

function parseWms(xml: string, finalUrl: string) {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = (doc.WMS_Capabilities ?? doc.WMT_MS_Capabilities) as Record<string, unknown> | undefined;
  if (!root) return null;
  const version = typeof root["@_version"] === "string" ? (root["@_version"] as string) : "1.3.0";

  const capability = root.Capability as Record<string, unknown> | undefined;
  const request = capability?.Request as Record<string, unknown> | undefined;
  const getMap = request?.GetMap as Record<string, unknown> | undefined;
  const http = (getMap?.DCPType as Record<string, unknown>)?.HTTP as Record<string, unknown> | undefined;
  const get = (http?.Get as Record<string, unknown>)?.OnlineResource as Record<string, unknown> | undefined;
  const getMapUrl = normalizeEndpoint((get?.["@_href"] as string) ?? "", finalUrl);

  const topLayer = capability?.Layer as Record<string, unknown> | undefined;
  const bbox = topLayer ? wmsLayerBbox(topLayer) : null;

  const layers: Layer[] = [];
  collectWmsLayers(topLayer, layers, bbox);

  // Formatos de imagen soportados: preferimos PNG transparente, pero algunos
  // servicios antiguos solo ofrecen JPEG o GIF.
  const formats = toArray(getMap?.Format as unknown).map(String);
  const format =
    formats.find((f) => f === "image/png") ??
    formats.find((f) => f.startsWith("image/png")) ??
    formats.find((f) => f === "image/gif") ??
    formats.find((f) => f.startsWith("image/")) ??
    "image/png";

  return { service: "WMS" as const, version, getMapUrl, layers, bbox, format };
}

/* ── WFS ── */

/** `<ows:WGS84BoundingBox>` de WFS 2.0 / `<LatLongBoundingBox>` de WFS 1.x. */
function wfsTypeBbox(f: Record<string, unknown>): Bbox | null {
  const wgs = f.WGS84BoundingBox as Record<string, unknown> | undefined;
  if (wgs) {
    const lower = String(wgs.LowerCorner ?? "").trim().split(/\s+/).map(Number);
    const upper = String(wgs.UpperCorner ?? "").trim().split(/\s+/).map(Number);
    if (lower.length === 2 && upper.length === 2) {
      return validBbox({ west: lower[0], south: lower[1], east: upper[0], north: upper[1] });
    }
  }
  const ll = f.LatLongBoundingBox as Record<string, unknown> | undefined;
  if (ll) {
    return validBbox({
      west: num(ll["@_minx"]), south: num(ll["@_miny"]),
      east: num(ll["@_maxx"]), north: num(ll["@_maxy"]),
    });
  }
  return null;
}

function parseWfs(xml: string, finalUrl: string) {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = doc.WFS_Capabilities as Record<string, unknown> | undefined;
  if (!root) return null;
  const version = typeof root["@_version"] === "string" ? (root["@_version"] as string) : "2.0.0";
  const list = root.FeatureTypeList as Record<string, unknown> | undefined;

  const featureTypes: Layer[] = toArray(list?.FeatureType as unknown)
    .map((ft) => {
      const f = ft as Record<string, unknown>;
      const name = String(f.Name ?? "");
      const title = typeof f.Title === "string" && f.Title.trim() ? f.Title : name;
      const crsRaw = f.DefaultCRS ?? f.DefaultSRS ?? f.SRS;
      return {
        name,
        title,
        bbox: wfsTypeBbox(f),
        crs: crsRaw != null ? String(crsRaw) : undefined,
      };
    })
    .filter((t) => t.name);

  return {
    service: "WFS" as const,
    version,
    getFeatureUrl: normalizeEndpoint(finalUrl, finalUrl),
    featureTypes,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const service = (params.get("service") === "WFS" ? "WFS" : "WMS") as "WMS" | "WFS";

  if (!url || !isAllowedHost(url)) {
    return Response.json({ error: "URL no permitida" }, { status: 400 });
  }

  // Un solo vencimiento para los dos intentos: antes cada uno tenía el suyo y
  // el peor caso doblaba el presupuesto de la función.
  const deadline = Date.now() + OGC_BUDGET_MS;

  // 1º intento: la URL tal cual (suele redirigir al endpoint OGC real).
  let fetched = await fetchText(url, deadline);

  // 2º intento: forzar GetCapabilities sobre el destino del redirect. Esta es
  // la vía que funciona cuando el primer intento devuelve 400/ServiceException.
  if (!fetched || !fetched.ok || !looksLikeCapabilities(fetched.text)) {
    const target = fetched?.finalUrl ?? url;
    const retry = await fetchText(withCapabilitiesQuery(target, service), deadline);
    if (retry?.ok && looksLikeCapabilities(retry.text)) fetched = retry;
  }

  if (!fetched || !looksLikeCapabilities(fetched.text)) {
    return Response.json({ error: "Servicio no accesible" }, { status: 502 });
  }

  try {
    const parsed = service === "WFS" ? parseWfs(fetched.text, fetched.finalUrl) : parseWms(fetched.text, fetched.finalUrl);
    if (!parsed) return Response.json({ error: "Capacidades no reconocidas" }, { status: 502 });
    return Response.json(parsed, { headers: { "cache-control": "public, max-age=3600" } });
  } catch {
    return Response.json({ error: "Error al analizar las capacidades" }, { status: 502 });
  }
}
