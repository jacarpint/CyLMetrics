import { describe, it, expect } from 'vitest';
import { parsePrj, prjName, toLonLat, isPlausibleLonLat, type TransverseMercator } from '../projection';

/** El `.prj` que traen, literalmente, los shapefiles del IDECyL. */
const PRJ_25830 =
  'PROJCS["ETRS_1989_UTM_Zone_30N",GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",' +
  'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],' +
  'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],' +
  'PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],' +
  'PARAMETER["Central_Meridian",-3.0],PARAMETER["Scale_Factor",0.9996],' +
  'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

describe('parsePrj', () => {
  it('reconoce el UTM 30N del IDECyL con todos sus parámetros', () => {
    const p = parsePrj(PRJ_25830) as TransverseMercator;
    expect(p.kind).toBe('tmerc');
    expect(p.lon0).toBe(-3);
    expect(p.k0).toBe(0.9996);
    expect(p.falseEasting).toBe(500000);
    expect(p.falseNorthing).toBe(0);
    expect(p.a).toBe(6378137);
    expect(p.invFlattening).toBeCloseTo(298.257222101, 6);
  });

  it('trata un sistema geográfico como coordenadas ya listas', () => {
    expect(parsePrj('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]')).toEqual({ kind: 'geographic' });
  });

  it('no adivina proyecciones que no sabe convertir', () => {
    expect(parsePrj('PROJCS["X",PROJECTION["Lambert_Conformal_Conic"]]')).toBeNull();
    expect(parsePrj('')).toBeNull();
  });

  it('extrae el nombre legible del sistema', () => {
    expect(prjName(PRJ_25830)).toBe('ETRS 1989 UTM Zone 30N');
  });
});

describe('toLonLat', () => {
  // Ejemplo resuelto de Snyder (USGS PP 1395, pág. 269): es la referencia
  // publicada de la Transversa de Mercator inversa, sobre Clarke 1866.
  it('reproduce el ejemplo publicado de Snyder', () => {
    const snyder: TransverseMercator = {
      kind: 'tmerc',
      a: 6378206.4,
      invFlattening: 294.9786982,
      lon0: -75,
      k0: 0.9996,
      falseEasting: 0,
      falseNorthing: 0,
    };
    const [lon, lat] = toLonLat(snyder, 127106.5, 4484124.4);
    expect(lat).toBeCloseTo(40.5, 4);
    expect(lon).toBeCloseTo(-73.5, 4);
  });

  it('devuelve el meridiano central exacto en el falso este', () => {
    const p = parsePrj(PRJ_25830)!;
    const [lon] = toLonLat(p, 500000, 4500000);
    expect(lon).toBeCloseTo(-3, 9);
  });

  it('sitúa la esquina de un shapefile real dentro de Castilla y León', () => {
    const p = parsePrj(PRJ_25830)!;
    // Bbox de tn.ffcc_cyl_estacion.shp, tal cual lo declara su cabecera.
    const [lonMin, latMin] = toLonLat(p, 176550, 4494077);
    const [lonMax, latMax] = toLonLat(p, 588631, 4770747);
    expect(lonMin).toBeGreaterThan(-7.2);
    expect(lonMin).toBeLessThan(-6.6);
    expect(latMin).toBeGreaterThan(40.4);
    expect(lonMax).toBeGreaterThan(-2.3);
    expect(lonMax).toBeLessThan(-1.7);
    expect(latMax).toBeLessThan(43.2);
    // Y el orden se conserva: no se cruzan los ejes.
    expect(lonMax).toBeGreaterThan(lonMin);
    expect(latMax).toBeGreaterThan(latMin);
  });

  it('deja intactas las coordenadas ya geográficas', () => {
    expect(toLonLat({ kind: 'geographic' }, -4.72, 41.65)).toEqual([-4.72, 41.65]);
  });
});

describe('isPlausibleLonLat', () => {
  it('descarta lo que no son grados', () => {
    expect(isPlausibleLonLat([-4.7, 41.6])).toBe(true);
    expect(isPlausibleLonLat([500000, 4500000])).toBe(false);
    expect(isPlausibleLonLat([NaN, 0])).toBe(false);
  });
});
