import { describe, it, expect } from 'vitest';
import {
  countPositions,
  metresPerPixel,
  simplifyGeometry,
  toleranceForZoom,
} from '@/lib/geo-simplify';

/**
 * Lo que fija este fichero: que simplificar quite muchos puntos sin mover los
 * que se ven, y que no rompa las geometrías por el camino.
 */

/** Un anillo cuadrado con `extra` vértices intermedios en cada lado. */
function ringWithNoise(extra: number, wobble = 0): GeoJSON.Polygon {
  const ring: number[][] = [];
  for (let i = 0; i <= extra; i++) {
    const t = i / extra;
    ring.push([t, wobble ? (i % 2 ? wobble : 0) : 0]);
  }
  ring.push([1, 1], [0, 1], [0, 0]);
  return { type: 'Polygon', coordinates: [ring] };
}

describe('toleranceForZoom', () => {
  it('un píxel a escala de comunidad son más de cien metros', () => {
    // A zoom 8 se ve Castilla y León entera. Con ~450 m por píxel, los vértices
    // separados por menos de eso caen en el mismo píxel.
    expect(metresPerPixel(8, 41.7)).toBeGreaterThan(300);
    expect(metresPerPixel(8, 41.7)).toBeLessThan(600);
  });

  it('cada nivel de zoom parte el píxel por la mitad', () => {
    expect(metresPerPixel(9, 41.7)).toBeCloseTo(metresPerPixel(8, 41.7) / 2, 5);
  });

  it('acercándose, la tolerancia se vuelve despreciable', () => {
    // A zoom 16 el píxel son centímetros: ya no se descarta prácticamente nada.
    expect(metresPerPixel(16, 41.7)).toBeLessThan(3);
    expect(toleranceForZoom(16)).toBeLessThan(toleranceForZoom(8));
  });

  it('la tolerancia va en grados, que es lo que usan las coordenadas', () => {
    // ~450 m a zoom 8 son ~0,004 grados.
    expect(toleranceForZoom(8)).toBeGreaterThan(0.001);
    expect(toleranceForZoom(8)).toBeLessThan(0.01);
  });
});

describe('simplifyGeometry', () => {
  it('quita los vértices que caen sobre la recta', () => {
    const poly = ringWithNoise(100);
    expect(countPositions(poly)).toBe(104);
    const simple = simplifyGeometry(poly, 0.01)!;
    // Los 100 puntos del lado inferior son colineales: sobran todos menos los
    // extremos.
    expect(countPositions(simple)).toBeLessThan(10);
  });

  it('conserva los vértices que sí se notarían', () => {
    // Dientes de sierra de 0,05 grados con una tolerancia de 0,01: se ven, así
    // que se quedan.
    const poly = ringWithNoise(20, 0.05);
    const simple = simplifyGeometry(poly, 0.01)!;
    expect(countPositions(simple)).toBeGreaterThan(10);
  });

  it('el anillo sigue cerrando', () => {
    // Si el primer punto deja de coincidir con el último, Leaflet dibuja un
    // polígono abierto o directamente nada.
    const simple = simplifyGeometry(ringWithNoise(200), 0.05) as GeoJSON.Polygon;
    for (const ring of simple.coordinates) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  it('un anillo que ya es mínimo se devuelve intacto', () => {
    // Simplificar un triángulo hasta dejarlo en dos puntos lo haría desaparecer.
    const triangulo: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [0.5, 1], [0, 0]]],
    };
    const simple = simplifyGeometry(triangulo, 10) as GeoJSON.Polygon;
    expect(simple.coordinates[0]).toHaveLength(4);
  });

  it('respeta los agujeros de un polígono', () => {
    const conAgujero: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]],
      ],
    };
    const simple = simplifyGeometry(conAgujero, 0.001) as GeoJSON.Polygon;
    expect(simple.coordinates).toHaveLength(2);
  });

  it('los puntos se devuelven tal cual', () => {
    const punto: GeoJSON.Point = { type: 'Point', coordinates: [-4.6, 40.9] };
    expect(simplifyGeometry(punto, 1)).toEqual(punto);
  });

  it('recorre multigeometrías y colecciones', () => {
    const multi: GeoJSON.MultiLineString = {
      type: 'MultiLineString',
      coordinates: [
        Array.from({ length: 50 }, (_, i) => [i / 49, 0]),
        Array.from({ length: 50 }, (_, i) => [i / 49, 1]),
      ],
    };
    expect(countPositions(simplifyGeometry(multi, 0.1))).toBe(4);

    const coleccion: GeoJSON.GeometryCollection = { type: 'GeometryCollection', geometries: [multi] };
    expect(countPositions(simplifyGeometry(coleccion, 0.1))).toBe(4);
  });

  it('sin tolerancia no toca nada', () => {
    const poly = ringWithNoise(100);
    expect(countPositions(simplifyGeometry(poly, 0))).toBe(104);
    expect(simplifyGeometry(null, 1)).toBeNull();
  });

  /**
   * Los anillos del catálogo llegan a 14.783 puntos. Una implementación
   * recursiva de Douglas-Peucker desborda la pila con esos tamaños, y sería un
   * fallo que solo aparecería en las capas más pesadas: justo donde hace falta.
   */
  it('aguanta un anillo enorme sin desbordar la pila', () => {
    // Un cuadrado recorrido con 60.000 vértices y un temblor muy por debajo de
    // la tolerancia: tiene que quedarse en las cuatro esquinas.
    const lado = 15_000;
    const grande: number[][] = [];
    const temblor = (i: number) => Math.sin(i / 50) * 1e-7;
    for (let i = 0; i < lado; i++) grande.push([i / lado, temblor(i)]);
    for (let i = 0; i < lado; i++) grande.push([1 + temblor(i), i / lado]);
    for (let i = 0; i < lado; i++) grande.push([1 - i / lado, 1 + temblor(i)]);
    for (let i = 0; i < lado; i++) grande.push([temblor(i), 1 - i / lado]);
    grande.push([0, 0]);

    const poly: GeoJSON.Polygon = { type: 'Polygon', coordinates: [grande] };
    let simple: GeoJSON.Geometry | null = null;
    expect(() => { simple = simplifyGeometry(poly, 1e-4); }).not.toThrow();
    // Cuatro esquinas más el cierre. Con la versión recursiva esto reventaba la
    // pila antes de llegar a contar nada.
    expect(countPositions(simple)).toBeLessThan(10);
    expect(countPositions(simple)).toBeGreaterThanOrEqual(4);
  });

  it('un anillo que colapsa se sustituye por su rectángulo, no se conserva entero', () => {
    /*
     * La primera versión devolvía el anillo ORIGINAL cuando la simplificación lo
     * dejaba por debajo de cuatro posiciones, para no romperlo. Medido contra la
     * capa real, eso invertía el efecto: a zoom 7 —tolerancia de 913 m, donde más
     * falta hace ahorrar— la reducción caía al 43%, y a zoom 12 subía al 86%.
     * Cuanto más agresiva la tolerancia, más anillos se salvaban enteros.
     */
    const casiRecto: number[][] = [];
    for (let i = 0; i <= 500; i++) casiRecto.push([i / 500, Math.sin(i / 30) * 1e-9]);
    casiRecto.push([0, 0]);
    const poly: GeoJSON.Polygon = { type: 'Polygon', coordinates: [casiRecto] };

    const simple = simplifyGeometry(poly, 1e-3) as GeoJSON.Polygon;
    expect(countPositions(simple)).toBe(5);
    const anillo = simple.coordinates[0];
    expect(anillo[0]).toEqual(anillo[anillo.length - 1]);
    // Y el rectángulo cubre de verdad la entidad que sustituye.
    const xs = casiRecto.map((p) => p[0]);
    expect(Math.min(...anillo.map((p) => p[0]))).toBeCloseTo(Math.min(...xs), 10);
    expect(Math.max(...anillo.map((p) => p[0]))).toBeCloseTo(Math.max(...xs), 10);
  });

  it('cuanta más tolerancia, menos puntos quedan', () => {
    // La propiedad que la primera versión rompía. Sin esto, el fallo solo se veía
    // midiendo contra el servicio.
    const poly = ringWithNoise(400, 0.002);
    const cuentas = [1e-5, 1e-4, 1e-3, 1e-2, 1e-1].map((t) => countPositions(simplifyGeometry(poly, t)));
    for (let i = 1; i < cuentas.length; i++) {
      expect(cuentas[i], `tolerancia ${i}`).toBeLessThanOrEqual(cuentas[i - 1]);
    }
  });

  it('el error introducido no supera la tolerancia', () => {
    // La garantía de Douglas-Peucker, y la razón de apuntar a un píxel: si el
    // error máximo es de un píxel, la simplificación no se puede ver.
    const tol = 0.01;
    const linea: GeoJSON.LineString = {
      type: 'LineString',
      coordinates: Array.from({ length: 200 }, (_, i) => [i / 199, Math.sin(i / 7) * 0.004]),
    };
    const simple = simplifyGeometry(linea, tol) as GeoJSON.LineString;
    // Todo el zigzag cabe dentro de la tolerancia: se reduce a los extremos.
    expect(simple.coordinates).toHaveLength(2);
  });
});
