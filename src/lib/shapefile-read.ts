/**
 * Lector de shapefiles empaquetados en ZIP, para el navegador.
 *
 * Un «SHP» del catálogo es en realidad un ZIP con varios ficheros: la geometría
 * (`.shp`), la tabla de atributos (`.dbf`), el sistema de referencia (`.prj`) y
 * accesorios que aquí no hacen falta. Se leen los tres primeros y se devuelve
 * GeoJSON en lon/lat, que es lo único que Leaflet entiende.
 *
 * Hasta ahora estos recursos solo mostraban un marcador orientativo en el
 * centro de la provincia. Con esto se pinta la geometría real y completa, y sus
 * atributos pueden recorrerse como una tabla más.
 *
 * Formato según la especificación de ESRI (ESRI Shapefile Technical
 * Description, julio de 1998): cabecera de 100 bytes, registros de longitud
 * variable, enteros de cabecera en big-endian y los datos en little-endian.
 * De las variantes Z y M solo se leen las coordenadas X/Y, que van primero.
 */

import { unzip, ZipError } from './zip-read';
import { parsePrj, prjName, toLonLat, isPlausibleLonLat, type Projection } from './projection';

export { ZipError };

export class ShapefileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapefileError';
  }
}

export interface ShapeFeature {
  type: 'Feature';
  geometry: GeoJSON.Geometry | null;
  properties: Record<string, string>;
}

export interface ShapeLayer {
  name: string;
  features: ShapeFeature[];
  /** Nombres de los campos del `.dbf`, en su orden original. */
  fields: string[];
  /** Sistema de referencia declarado en el `.prj`, si lo trae. */
  crs: string | null;
  /** false = el `.prj` usa una proyección que no sabemos convertir. */
  projected: boolean;
  /** Registros sin geometría: el shapefile los admite y conviene contarlos. */
  nullGeometries: number;
}

/* ------------------------------------------------------------------ */
/* Tabla de atributos (.dbf)                                           */
/* ------------------------------------------------------------------ */

interface DbfField {
  name: string;
  type: string;
  length: number;
}

/**
 * Elige cómo descodificar el texto del `.dbf`.
 *
 * El formato no lleva la codificación de forma fiable, así que se prueba UTF-8
 * en modo estricto: si el contenido no es UTF-8 válido, lanza y se cae a
 * windows-1252, que es lo que produce ArcGIS en España. Adivinar al revés
 * llenaría los topónimos de caracteres de reemplazo.
 */
function pickDecoder(sample: Uint8Array, cpg: string | null): TextDecoder {
  if (cpg) {
    const tag = cpg.trim().toLowerCase();
    if (tag.includes('utf-8') || tag.includes('utf8')) return new TextDecoder('utf-8');
    if (tag.includes('8859')) return new TextDecoder('iso-8859-1');
    if (tag.includes('1252')) return new TextDecoder('windows-1252');
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return new TextDecoder('utf-8');
  } catch {
    return new TextDecoder('windows-1252');
  }
}

/** Fecha dBase `AAAAMMDD` → ISO, que es como se comparan en el resto del portal. */
function dbaseDate(raw: string): string {
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
}

function parseDbf(data: Uint8Array, cpg: string | null): { fields: DbfField[]; rows: Record<string, string>[] } {
  if (data.byteLength < 32) throw new ShapefileError('La tabla de atributos (.dbf) está vacía o incompleta.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);

  const decoder = pickDecoder(data.subarray(headerLength), cpg);
  const ascii = new TextDecoder('latin1');

  const fields: DbfField[] = [];
  for (let offset = 32; offset + 32 <= headerLength && data[offset] !== 0x0d; offset += 32) {
    const raw = data.subarray(offset, offset + 11);
    const end = raw.indexOf(0);
    const name = ascii.decode(end === -1 ? raw : raw.subarray(0, end)).trim();
    if (!name) continue;
    fields.push({ name, type: String.fromCharCode(data[offset + 11]), length: data[offset + 16] });
  }

  const rows: Record<string, string>[] = [];
  for (let i = 0; i < recordCount; i++) {
    const start = headerLength + i * recordLength;
    if (start + recordLength > data.byteLength) break;
    // El primer byte marca los registros borrados, que no deben mostrarse.
    if (data[start] === 0x2a) continue;

    const row: Record<string, string> = {};
    let cursor = start + 1;
    for (const field of fields) {
      const value = decoder.decode(data.subarray(cursor, cursor + field.length)).trim();
      cursor += field.length;
      row[field.name] =
        field.type === 'D' ? dbaseDate(value)
        : field.type === 'L' ? (/^[yYtT]$/.test(value) ? 'true' : /^[nNfF]$/.test(value) ? 'false' : '')
        : value;
    }
    rows.push(row);
  }

  return { fields, rows };
}

/* ------------------------------------------------------------------ */
/* Geometría (.shp)                                                    */
/* ------------------------------------------------------------------ */

type Ring = [number, number][];

/**
 * Área con signo de un anillo, en las coordenadas del propio archivo.
 *
 * Es lo que distingue un contorno de un hueco: la especificación exige que los
 * anillos exteriores vayan en sentido horario y los interiores al revés. Se
 * calcula antes de reproyectar, sobre el plano original, que es donde la
 * convención está definida.
 */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/** Agrupa los anillos en polígonos: cada contorno se queda con los huecos que le siguen. */
function ringsToPolygons(rings: Ring[], project: (r: Ring) => Ring): GeoJSON.Geometry | null {
  const polygons: Ring[][] = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    const isHole = signedArea(ring) < 0;
    if (isHole && polygons.length > 0) polygons[polygons.length - 1].push(project(ring));
    else polygons.push([project(ring)]);
  }
  if (polygons.length === 0) return null;
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

interface ShapeReader {
  project: (x: number, y: number) => [number, number];
}

function parseShp(data: Uint8Array, { project }: ShapeReader): (GeoJSON.Geometry | null)[] {
  if (data.byteLength < 100) throw new ShapefileError('El archivo de geometrías (.shp) está incompleto.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getInt32(0, false) !== 9994) {
    throw new ShapefileError('El archivo .shp no tiene la firma esperada de un shapefile.');
  }

  const projectRing = (ring: Ring): Ring => ring.map(([x, y]) => project(x, y));
  const out: (GeoJSON.Geometry | null)[] = [];

  let offset = 100;
  while (offset + 8 <= data.byteLength) {
    const contentWords = view.getInt32(offset + 4, false);
    const content = offset + 8;
    const next = content + contentWords * 2;
    if (contentWords <= 0 || next > data.byteLength) break;

    const type = view.getInt32(content, true);

    // Punto: los tipos 11 y 21 añaden Z/M después de X/Y, que aquí no se usan.
    if (type === 1 || type === 11 || type === 21) {
      out.push({ type: 'Point', coordinates: project(view.getFloat64(content + 4, true), view.getFloat64(content + 12, true)) });
    } else if (type === 8 || type === 18 || type === 28) {
      const n = view.getInt32(content + 36, true);
      const coords: Ring = [];
      for (let i = 0; i < n; i++) {
        const p = content + 40 + i * 16;
        coords.push(project(view.getFloat64(p, true), view.getFloat64(p + 8, true)));
      }
      out.push(coords.length ? { type: 'MultiPoint', coordinates: coords } : null);
    } else if (type === 3 || type === 5 || type === 13 || type === 15 || type === 23 || type === 25) {
      const partCount = view.getInt32(content + 36, true);
      const pointCount = view.getInt32(content + 40, true);
      const partsAt = content + 44;
      const pointsAt = partsAt + partCount * 4;

      const starts: number[] = [];
      for (let i = 0; i < partCount; i++) starts.push(view.getInt32(partsAt + i * 4, true));

      const rings: Ring[] = [];
      for (let i = 0; i < partCount; i++) {
        const from = starts[i];
        const to = i + 1 < partCount ? starts[i + 1] : pointCount;
        const ring: Ring = [];
        for (let j = from; j < to; j++) {
          const p = pointsAt + j * 16;
          ring.push([view.getFloat64(p, true), view.getFloat64(p + 8, true)]);
        }
        if (ring.length) rings.push(ring);
      }

      if (type === 3 || type === 13 || type === 23) {
        const lines = rings.filter((r) => r.length >= 2).map(projectRing);
        out.push(
          lines.length === 0 ? null
          : lines.length === 1 ? { type: 'LineString', coordinates: lines[0] }
          : { type: 'MultiLineString', coordinates: lines }
        );
      } else {
        out.push(ringsToPolygons(rings, projectRing));
      }
    } else {
      // Tipo nulo (0) o no contemplado: se cuenta como registro sin geometría.
      out.push(null);
    }

    offset = next;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Lectura del paquete                                                 */
/* ------------------------------------------------------------------ */

/** Nombre base de una ruta dentro del ZIP, en minúsculas y sin extensión. */
function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '');
}

/**
 * Abre un ZIP con uno o varios shapefiles y devuelve cada uno como una capa.
 *
 * Que sean varios no es raro en los paquetes cartográficos del portal, así que
 * se tratan como las hojas de un libro de cálculo: el visor deja elegir.
 */
export async function readShapefile(buffer: ArrayBuffer): Promise<ShapeLayer[]> {
  const files = await unzip(buffer);

  /** Rutas del ZIP agrupadas por nombre base, para casar .shp con .dbf y .prj. */
  const groups = new Map<string, Map<string, Uint8Array>>();
  for (const [path, data] of files) {
    const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();
    if (!ext) continue;
    const key = baseName(path).toLowerCase();
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key)!.set(ext, data);
  }

  const layers: ShapeLayer[] = [];
  for (const [key, parts] of groups) {
    const shp = parts.get('shp');
    if (!shp) continue;

    const prjText = parts.has('prj') ? new TextDecoder('latin1').decode(parts.get('prj')!) : '';
    const projection: Projection | null = prjText ? parsePrj(prjText) : null;
    const crs = prjText ? prjName(prjText) : null;

    // Sin `.prj` legible no se inventa nada: si las coordenadas ya parecen
    // grados se pasan tal cual, y si no, se avisa de que no se han convertido.
    const project = (x: number, y: number): [number, number] =>
      projection ? toLonLat(projection, x, y) : [x, y];

    const geometries = parseShp(shp, { project });

    let fields: string[] = [];
    let rows: Record<string, string>[] = [];
    if (parts.has('dbf')) {
      const cpg = parts.has('cpg') ? new TextDecoder('latin1').decode(parts.get('cpg')!) : null;
      const table = parseDbf(parts.get('dbf')!, cpg);
      fields = table.fields.map((f) => f.name);
      rows = table.rows;
    }

    let nullGeometries = 0;
    const features: ShapeFeature[] = geometries.map((geometry, i) => {
      if (!geometry) nullGeometries++;
      return { type: 'Feature', geometry, properties: rows[i] ?? {} };
    });

    // Si tras convertir las coordenadas siguen sin parecer grados, la geometría
    // se descarta: pintarla llevaría el mapa a mitad del Atlántico.
    const sample = features.find((f) => f.geometry?.type === 'Point')?.geometry as GeoJSON.Point | undefined;
    const projected =
      projection !== null &&
      (sample === undefined || isPlausibleLonLat(sample.coordinates as [number, number]));

    layers.push({
      name: key,
      features,
      fields,
      crs,
      projected,
      nullGeometries,
    });
  }

  if (layers.length === 0) {
    throw new ShapefileError('El ZIP no contiene ningún shapefile (.shp).');
  }
  return layers;
}

/** ¿Qué hay dentro de este ZIP? Sirve para explicar los recursos «OTRO». */
export async function describeZip(buffer: ArrayBuffer): Promise<{ entries: string[]; extensions: string[] }> {
  const files = await unzip(buffer);
  const entries = [...files.keys()];
  const extensions = [...new Set(entries.map((e) => /\.([^./\\]+)$/.exec(e)?.[1]?.toLowerCase()).filter(Boolean))] as string[];
  return { entries, extensions };
}
