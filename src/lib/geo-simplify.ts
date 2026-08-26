/**
 * Simplificación de geometrías para el visor.
 *
 * Las capas de polígonos del IDECyL son enormes: «Plan 2025 CyL. Áreas peligro
 * inc.forestales» tiene 4.513 entidades con 20,3 millones de puntos entre todas,
 * y una mediana de 2.571 puntos por entidad. Medido contra el servicio.
 *
 * La mayor parte de esos puntos no se puede ver. A escala de comunidad un píxel
 * son ~150 m, así que dos vértices separados por menos de eso caen en el mismo
 * píxel. Descartarlos no cambia nada de lo que se dibuja y divide por doce la
 * memoria y el coste de pintado: Douglas-Peucker con 50 m de tolerancia quita el
 * 92% de los puntos de estas capas, y con 100 m el 95%.
 *
 * Ojo con lo que esto NO arregla: los bytes ya se han descargado cuando llegamos
 * aquí. Simplificar abarata la memoria y el dibujado, no la transferencia; de la
 * transferencia se ocupa pedir por `bbox` solo lo que se está mirando.
 *
 * Tampoco sirve recortar decimales, que es lo primero que uno piensa al ver
 * coordenadas con 14 cifras: una vez parseado el JSON, cada coordenada es un
 * `float64` y ocupa 8 bytes tanto si venía con 6 decimales como con 16. Lo que
 * pesa es CUÁNTOS puntos hay, no cómo de largos son.
 *
 * Client-safe: solo funciones puras.
 */

/** Metros por grado de latitud. Constante a efectos prácticos. */
const METRES_PER_DEGREE = 111_320;

/**
 * Metros que mide un píxel de pantalla a un zoom dado.
 *
 * Es la fórmula del mercator esférico que usan las teselas: la circunferencia
 * terrestre repartida entre 256 píxeles por tesela y 2^zoom teselas, corregida
 * por la latitud porque los meridianos se juntan hacia los polos.
 */
export function metresPerPixel(zoom: number, latitude: number): number {
  const cos = Math.cos((latitude * Math.PI) / 180);
  return (156_543.03392 * Math.abs(cos)) / Math.pow(2, zoom);
}

/**
 * Tolerancia de simplificación, en grados, para un zoom.
 *
 * Se apunta a un píxel: por debajo de eso el error no se puede representar en
 * pantalla, así que la simplificación es literalmente invisible. No a dos o a
 * tres píxeles, que ahorrarían más pero ya se notarían en los bordes.
 *
 * La tolerancia se aplica igual a longitud y latitud, aunque un grado de
 * longitud mida menos según se sube en latitud. La diferencia juega a favor —en
 * Castilla y León un grado de longitud son ~0,74 de latitud, así que en ese eje
 * se simplifica algo MENOS de un píxel— y no compensa la complicación de tratar
 * los dos ejes por separado.
 */
export function toleranceForZoom(zoom: number, latitude = 41.7): number {
  return metresPerPixel(zoom, latitude) / METRES_PER_DEGREE;
}

type Position = number[];

/**
 * Douglas-Peucker iterativo.
 *
 * Iterativo y no recursivo a propósito: con anillos de 14.783 puntos —los hay en
 * el catálogo— la versión recursiva puede agotar la pila del navegador, y sería
 * un fallo que solo aparecería en las capas más pesadas, que es justo donde esto
 * tiene que funcionar.
 */
function douglasPeucker(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;

    let maxDistance = -1;
    let index = first;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      // Distancia al SEGMENTO, no a la recta infinita: con la recta, un punto
      // muy alejado por detrás del extremo se conservaría sin motivo.
      let t = 0;
      if (lengthSquared > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
      }
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out: Position[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * El rectángulo envolvente de un anillo, como anillo cerrado de cinco posiciones.
 *
 * Es el sustituto de un anillo que la tolerancia deja en nada. A esa escala la
 * entidad entera cabe en un píxel o en una línea de un píxel de grosor, así que
 * su rectángulo se dibuja igual que ella: la diferencia no se puede representar.
 */
function boundingRing(ring: Position[]): Position[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
}

/**
 * Un anillo simplificado, sin dejar de ser un anillo.
 *
 * Un polígono necesita cuatro posiciones como mínimo y que la última repita la
 * primera. Simplificar a saco puede dejar dos o tres, y entonces el anillo no
 * cierra y Leaflet no lo dibuja.
 *
 * La primera versión resolvía eso devolviendo el anillo ORIGINAL, y salió el
 * tiro por la culata: medido contra la capa real, a zoom 7 —tolerancia de 913 m,
 * donde más falta hace ahorrar— la reducción caía al 43%, mientras que a zoom 12
 * llegaba al 86%. Cuanto más agresiva la tolerancia, más anillos colapsaban y
 * más se conservaban enteros, con sus 2.500 vértices cada uno.
 *
 * Ahora se sustituye por su rectángulo envolvente: cinco posiciones, válido, y a
 * esa escala indistinguible del original.
 */
function simplifyRing(ring: Position[], tolerance: number): Position[] {
  if (ring.length <= 5) return ring;
  const simplified = douglasPeucker(ring, tolerance);
  if (simplified.length < 4) return boundingRing(ring);
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push([...first]);
  return simplified;
}

function simplifyLine(line: Position[], tolerance: number): Position[] {
  return line.length <= 2 ? line : douglasPeucker(line, tolerance);
}

/**
 * Simplifica una geometría GeoJSON. Devuelve la misma si no hay nada que quitar.
 *
 * Los puntos se devuelven tal cual: no tienen vértices intermedios que descartar,
 * y una capa de puntos nunca ha sido el problema —2.887 puntos de incendios son
 * 1,6 MB enteros—.
 */
export function simplifyGeometry(
  geometry: GeoJSON.Geometry | null,
  tolerance: number
): GeoJSON.Geometry | null {
  if (!geometry || !(tolerance > 0)) return geometry;

  switch (geometry.type) {
    case 'Point':
    case 'MultiPoint':
      return geometry;

    case 'LineString':
      return { ...geometry, coordinates: simplifyLine(geometry.coordinates, tolerance) };

    case 'MultiLineString':
      return { ...geometry, coordinates: geometry.coordinates.map((l) => simplifyLine(l, tolerance)) };

    case 'Polygon':
      return { ...geometry, coordinates: geometry.coordinates.map((r) => simplifyRing(r, tolerance)) };

    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((p) => p.map((r) => simplifyRing(r, tolerance))),
      };

    case 'GeometryCollection':
      return {
        ...geometry,
        geometries: geometry.geometries.map((g) => simplifyGeometry(g, tolerance) as GeoJSON.Geometry),
      };

    default:
      return geometry;
  }
}

/** Cuenta las posiciones de una geometría. Para medir lo que se ha ahorrado. */
export function countPositions(geometry: GeoJSON.Geometry | null): number {
  if (!geometry) return 0;
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.reduce((sum, g) => sum + countPositions(g), 0);
  }
  let total = 0;
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number') {
      total += 1;
      return;
    }
    for (const child of node) walk(child);
  };
  walk((geometry as { coordinates?: unknown }).coordinates);
  return total;
}
