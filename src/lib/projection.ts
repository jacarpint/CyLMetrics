/**
 * Reproyección de coordenadas planas a longitud/latitud (WGS84).
 *
 * Los shapefiles del catálogo vienen en ETRS89 / UTM huso 30N (EPSG:25830) —
 * los 18 legibles, sin excepción— y Leaflet solo entiende lon/lat, así que hay
 * que convertir antes de pintar. Se implementa la Transversa de Mercator
 * inversa (serie de Snyder, USGS Professional Paper 1395), exacta al milímetro
 * dentro de un huso: más que suficiente y sin traerse proj4 entero.
 *
 * ETRS89 y WGS84 difieren en centímetros en la península, así que se tratan
 * como equivalentes: cualquier otra cosa sería precisión falsa a esta escala.
 */

export interface TransverseMercator {
  kind: 'tmerc';
  /** Semieje mayor del elipsoide, en metros. */
  a: number;
  /** Achatamiento inverso (1/f). */
  invFlattening: number;
  /** Meridiano central, en grados. */
  lon0: number;
  /** Factor de escala en el meridiano central. */
  k0: number;
  falseEasting: number;
  falseNorthing: number;
}

/** El archivo ya viene en grados: no hay nada que convertir. */
export interface Geographic {
  kind: 'geographic';
}

export type Projection = TransverseMercator | Geographic;

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Lectura del .prj                                                    */
/* ------------------------------------------------------------------ */

/** Valor de un parámetro WKT del tipo `PARAMETER["central_meridian",-3.0]`. */
function wktParameter(wkt: string, name: string): number | null {
  const re = new RegExp(`PARAMETER\\s*\\[\\s*"${name}"\\s*,\\s*(-?[\\d.eE+]+)`, 'i');
  const match = re.exec(wkt);
  return match ? Number(match[1]) : null;
}

/**
 * Interpreta un `.prj` (WKT 1) y devuelve cómo convertir sus coordenadas.
 *
 * Solo se resuelve la Transversa de Mercator, que es lo que usa toda la
 * cartografía autonómica (UTM 30N). Para cualquier otra proyección se devuelve
 * `null` y quien llama avisa en vez de pintar geometrías en un sitio erróneo.
 */
export function parsePrj(wkt: string): Projection | null {
  const text = wkt.trim();
  if (!text) return null;

  // Sin PROJCS es un sistema geográfico: las coordenadas ya son lon/lat.
  if (!/PROJCS/i.test(text)) {
    return /GEOGCS/i.test(text) ? { kind: 'geographic' } : null;
  }

  if (!/Transverse_Mercator/i.test(text)) return null;

  const spheroid = /SPHEROID\s*\[\s*"[^"]*"\s*,\s*([\d.eE+]+)\s*,\s*([\d.eE+]+)/i.exec(text);
  const a = spheroid ? Number(spheroid[1]) : 6378137;
  const invFlattening = spheroid && Number(spheroid[2]) > 0 ? Number(spheroid[2]) : 298.257222101;

  const lon0 = wktParameter(text, 'central_meridian') ?? wktParameter(text, 'longitude_of_center');
  if (lon0 === null) return null;

  return {
    kind: 'tmerc',
    a,
    invFlattening,
    lon0,
    k0: wktParameter(text, 'scale_factor') ?? 0.9996,
    falseEasting: wktParameter(text, 'false_easting') ?? 0,
    falseNorthing: wktParameter(text, 'false_northing') ?? 0,
  };
}

/** Nombre legible del sistema de referencia, para poder decirlo en la interfaz. */
export function prjName(wkt: string): string | null {
  const match = /^\s*(?:PROJCS|GEOGCS)\s*\[\s*"([^"]+)"/i.exec(wkt);
  return match ? match[1].replace(/_/g, ' ') : null;
}

/* ------------------------------------------------------------------ */
/* Conversión                                                          */
/* ------------------------------------------------------------------ */

/**
 * Transversa de Mercator inversa: metros → [lon, lat] en grados.
 *
 * Sigue la formulación de Snyder (págs. 63-64). Se calcula una latitud de pie
 * de perpendicular (`phi1`) a partir de la distancia meridional y desde ahí se
 * corrige con la serie en potencias de la distancia al meridiano central.
 */
function inverseTransverseMercator(p: TransverseMercator, x: number, y: number): [number, number] {
  const f = 1 / p.invFlattening;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);

  const dx = x - p.falseEasting;
  const dy = y - p.falseNorthing;

  const M = dy / p.k0;
  const mu = M / (p.a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const e1_2 = e1 * e1;
  const e1_3 = e1_2 * e1;
  const e1_4 = e1_3 * e1;

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1_3) / 32) * Math.sin(2 * mu) +
    ((21 * e1_2) / 16 - (55 * e1_4) / 32) * Math.sin(4 * mu) +
    ((151 * e1_3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1_4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const C1 = ep2 * cosPhi1 * cosPhi1;
  const T1 = tanPhi1 * tanPhi1;
  const oneMinus = 1 - e2 * sinPhi1 * sinPhi1;
  const N1 = p.a / Math.sqrt(oneMinus);
  const R1 = (p.a * (1 - e2)) / (oneMinus * Math.sqrt(oneMinus));
  const D = dx / (N1 * p.k0);

  const D2 = D * D;
  const D3 = D2 * D;
  const D4 = D2 * D2;
  const D5 = D4 * D;
  const D6 = D4 * D2;

  const lat =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      (D2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D6) / 720);

  const lon =
    p.lon0 * DEG +
    (D -
      ((1 + 2 * T1 + C1) * D3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5) / 120) /
      cosPhi1;

  return [lon / DEG, lat / DEG];
}

/** Convierte un punto del sistema del archivo a [lon, lat] en grados. */
export function toLonLat(projection: Projection, x: number, y: number): [number, number] {
  if (projection.kind === 'geographic') return [x, y];
  return inverseTransverseMercator(projection, x, y);
}

/** ¿El punto cae dentro de coordenadas geográficas plausibles? */
export function isPlausibleLonLat([lon, lat]: [number, number]): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}
