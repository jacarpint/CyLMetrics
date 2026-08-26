import { describe, it, expect } from 'vitest';
import { PROXY_MAX_BYTES } from '../download-budget';
import {
  bboxParam,
  budgetExhausted,
  heaviestPerFeature,
  looksTruncatedByCap,
  nextPageSize,
  padView,
  pageFingerprint,
  shouldRefetchView,
  shrinkPageSize,
  viewContains,
  WFS_MAX_PAGE_SIZE,
  WFS_MAX_TOTAL_BYTES,
  WFS_MIN_PAGE_SIZE,
  WFS_TARGET_PAGE_BYTES,
} from '../wfs-paging';

/** Peso por entidad medido en las capas de polígonos del IDECyL. */
const POLIGONO_PESADO = 298 * 1024;

describe('nextPageSize', () => {
  /**
   * El fallo que se veía: páginas fijas de 500 entidades contra una capa de
   * polígonos de ~300 KB cada uno son ~150 MB, muy por encima del tope del
   * proxy, que cortaba el cuerpo y dejaba un JSON partido.
   */
  it('la página que calcula no se pasa del tope del proxy', () => {
    const size = nextPageSize(500, POLIGONO_PESADO);
    expect(size * POLIGONO_PESADO).toBeLessThan(PROXY_MAX_BYTES);
    expect(size).toBeGreaterThan(WFS_MIN_PAGE_SIZE);
  });

  it('con entidades ligeras sube hasta el techo', () => {
    expect(nextPageSize(25, 1024)).toBe(WFS_MAX_PAGE_SIZE);
  });

  it('con entidades enormes baja hasta el suelo, no a cero', () => {
    expect(nextPageSize(500, WFS_TARGET_PAGE_BYTES * 10)).toBe(WFS_MIN_PAGE_SIZE);
  });

  it('sin medición conserva la talla', () => {
    expect(nextPageSize(120, 0)).toBe(120);
  });

  /**
   * El tope total solo se comprobaba después de recibir la página, así que la
   * última se traía entera por encima del presupuesto.
   */
  it('no pide más de lo que queda de presupuesto', () => {
    const restante = 2 * 1024 * 1024;
    expect(nextPageSize(100, POLIGONO_PESADO, restante) * POLIGONO_PESADO).toBeLessThanOrEqual(restante);
  });

  it('sin presupuesto restante sigue pidiendo el mínimo, no cero', () => {
    expect(nextPageSize(100, POLIGONO_PESADO, 0)).toBe(WFS_MIN_PAGE_SIZE);
  });
});

describe('heaviestPerFeature', () => {
  /**
   * Medido sobre la capa real: 298 KB por entidad en el sondeo, 678 en la página
   * siguiente y 366 en la de después. Dimensionar con la última medición
   * subestima la mitad de las veces, y una página que se pasa cuesta una
   * descarga entera tirada.
   */
  it('se queda con el peor caso visto, no con el último', () => {
    let peso = heaviestPerFeature(0, 298 * 1024 * 25, 25);
    peso = heaviestPerFeature(peso, 678 * 1024 * 40, 40);
    peso = heaviestPerFeature(peso, 366 * 1024 * 20, 20);
    expect(Math.round(peso / 1024)).toBe(678);
  });

  it('una página vacía no cuenta como medición', () => {
    expect(heaviestPerFeature(1000, 0, 0)).toBe(1000);
  });
});

describe('budgetExhausted', () => {
  it('con presupuesto de sobra, sigue', () => {
    expect(budgetExhausted(0, POLIGONO_PESADO)).toBe(false);
  });

  it('para al agotarlo', () => {
    expect(budgetExhausted(WFS_MAX_TOTAL_BYTES, POLIGONO_PESADO)).toBe(true);
  });

  /**
   * El caso que rebasaba el tope: con entidades de más de un mega, la página
   * más corta posible (`WFS_MIN_PAGE_SIZE`) ya no cabe en lo que queda, así que
   * pedirla se salta el presupuesto por una página entera.
   */
  it('para también cuando lo que queda no da ni para la página mínima', () => {
    const enorme = 4 * 1024 * 1024;
    const casiLleno = WFS_MAX_TOTAL_BYTES - enorme * (WFS_MIN_PAGE_SIZE - 1);
    expect(budgetExhausted(casiLleno, enorme)).toBe(true);
  });

  it('sin medición todavía, no se adelanta a parar', () => {
    expect(budgetExhausted(0, 0)).toBe(false);
  });
});

describe('shrinkPageSize', () => {
  it('acorta de verdad y nunca por debajo del suelo', () => {
    expect(shrinkPageSize(400)).toBe(100);
    expect(shrinkPageSize(WFS_MIN_PAGE_SIZE)).toBe(WFS_MIN_PAGE_SIZE);
  });
});

describe('looksTruncatedByCap', () => {
  it('distingue el cuerpo cortado por el proxy de un JSON simplemente inválido', () => {
    // El caso real: «Expected ',' or ']' … at position 50323422», con el tope en
    // 50.331.648. Un JSON corto que no parsea es otra cosa y se cuenta aparte.
    expect(looksTruncatedByCap(50_323_422)).toBe(true);
    expect(looksTruncatedByCap(4_096)).toBe(false);
  });
});

describe('pageFingerprint', () => {
  const feature = (id: string, lon: number) => ({
    geometry: { type: 'Polygon', coordinates: [[[lon, 41], [lon + 1, 41], [lon, 42]]] },
    properties: { id },
  });

  /**
   * La huella anterior incluía el número de entidades de la página. Con páginas
   * de talla variable eso deja de ser comparable: la misma página devuelta a dos
   * peticiones distintas no coincidía consigo misma y el bucle la acumulaba una
   * y otra vez creyendo que eran páginas nuevas.
   */
  it('la misma primera entidad da la misma huella, pida lo que pida la página', () => {
    expect(pageFingerprint(feature('a', -4))).toBe(pageFingerprint(feature('a', -4)));
  });

  it('entidades distintas dan huellas distintas', () => {
    expect(pageFingerprint(feature('a', -4))).not.toBe(pageFingerprint(feature('b', -4)));
    // Mismos atributos, otra geometría: también son páginas distintas.
    expect(pageFingerprint(feature('a', -4))).not.toBe(pageFingerprint(feature('a', -5)));
  });

  it('una entidad sin geometría no revienta la huella', () => {
    expect(pageFingerprint({ geometry: null, properties: { id: 'a' } })).toContain('sin-geometria');
    expect(pageFingerprint(undefined)).toBe('');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   Pedir solo lo que se está mirando
   ──────────────────────────────────────────────────────────────────────────── */

describe('bbox por vista', () => {
  const AVILA = { west: -4.75, south: 40.6, east: -4.6, north: 40.7 };

  it('el parámetro declara CRS84, que fija el orden longitud-latitud', () => {
    // No es cosmético: comprobado contra el GeoServer del IDECyL, la misma caja
    // sin declarar CRS devuelve CERO entidades porque la lee como latitud-
    // longitud. Con CRS84 devuelve las 15 que hay.
    const p = bboxParam(AVILA);
    expect(p).toBe('-4.75,40.6,-4.6,40.7,urn:ogc:def:crs:OGC:1.3:CRS84');
    expect(p.split(',').slice(0, 4).map(Number)).toEqual([-4.75, 40.6, -4.6, 40.7]);
  });

  it('recorta los decimales que no significan nada', () => {
    const p = bboxParam({ west: -4.123456789012, south: 40.1, east: -4.1, north: 40.2 });
    expect(p.startsWith('-4.123457,')).toBe(true);
  });

  it('el margen ensancha la caja por los cuatro lados', () => {
    const p = padView(AVILA, 0.5);
    expect(p.west).toBeLessThan(AVILA.west);
    expect(p.east).toBeGreaterThan(AVILA.east);
    expect(p.south).toBeLessThan(AVILA.south);
    expect(p.north).toBeGreaterThan(AVILA.north);
    expect(viewContains(p, AVILA)).toBe(true);
  });

  it('el margen no se sale del mundo', () => {
    const polar = padView({ west: -10, south: -89.9, east: 10, north: 89.9 }, 1);
    expect(polar.south).toBeGreaterThanOrEqual(-90);
    expect(polar.north).toBeLessThanOrEqual(90);
  });

  it('sin nada cargado, se pide', () => {
    expect(shouldRefetchView(null, { box: AVILA, zoom: 10 })).toBe(true);
  });

  it('moverse dentro de lo ya traído no vuelve a pedir', () => {
    // Es para lo que existe el margen: arrastrar un poco no dispara una recarga.
    const cargado = { box: padView(AVILA), zoom: 10 };
    const unPoco = { west: -4.74, south: 40.61, east: -4.59, north: 40.71 };
    expect(viewContains(cargado.box, unPoco)).toBe(true);
    expect(shouldRefetchView(cargado, { box: unPoco, zoom: 10 })).toBe(false);
  });

  it('salirse de lo traído vuelve a pedir', () => {
    const cargado = { box: padView(AVILA), zoom: 10 };
    const lejos = { west: -3.0, south: 41.6, east: -2.8, north: 41.8 };
    expect(shouldRefetchView(cargado, { box: lejos, zoom: 10 })).toBe(true);
  });

  it('alejarse dentro de lo traído no pide nada', () => {
    // Al alejarse sobra detalle, no falta: lo que hay ya sirve.
    const cargado = { box: padView(AVILA), zoom: 12 };
    expect(shouldRefetchView(cargado, { box: AVILA, zoom: 9 })).toBe(false);
  });

  it('acercarse dos niveles pide más detalle', () => {
    // Las entidades se simplificaron con la tolerancia del zoom de entonces, así
    // que al acercarse hay que volver a traerlas para no enseñar contornos más
    // bastos de lo que ese zoom permite ver.
    const cargado = { box: padView(AVILA), zoom: 10 };
    expect(shouldRefetchView(cargado, { box: AVILA, zoom: 11 })).toBe(false);
    expect(shouldRefetchView(cargado, { box: AVILA, zoom: 12 })).toBe(true);
  });
});
