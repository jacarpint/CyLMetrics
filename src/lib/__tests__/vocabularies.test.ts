import { describe, it, expect } from 'vitest';
import { themeLabel, spatialLabel, looksLikeUri } from '../vocabularies';
import { getSpatialCoords, SPATIAL_COORDS } from '../geo';

describe('themeLabel', () => {
  it('traduce las URIs del vocabulario NTI-RISP', () => {
    expect(themeLabel('http://datos.gob.es/kos/sector-publico/sector/medio-ambiente')).toBe('Medio ambiente');
    expect(themeLabel('http://datos.gob.es/kos/sector-publico/sector/economia')).toBe('Economía');
    expect(themeLabel('http://datos.gob.es/kos/sector-publico/sector/urbanismo-infraestructuras'))
      .toBe('Urbanismo e infraestructuras');
  });

  it('deja pasar el texto que ya es legible', () => {
    expect(themeLabel('Medio ambiente')).toBe('Medio ambiente');
  });

  it('humaniza los códigos que no estén en la tabla, sin enseñar la URI', () => {
    const out = themeLabel('http://datos.gob.es/kos/sector-publico/sector/algo-nuevo');
    expect(out).toBe('Algo nuevo');
    expect(out).not.toContain('http');
  });

  it('sin valor, no inventa nada', () => {
    expect(themeLabel(undefined)).toBeNull();
    expect(themeLabel('   ')).toBeNull();
  });
});

describe('spatialLabel', () => {
  it('traduce el territorio, que en este catálogo es siempre el mismo', () => {
    expect(spatialLabel('http://datos.gob.es/recurso/sector-publico/territorio/Autonomia/Castilla-Leon'))
      .toBe('Castilla y León');
  });

  it('resuelve provincias', () => {
    expect(spatialLabel('http://datos.gob.es/recurso/sector-publico/territorio/Provincia/Avila')).toBe('Ávila');
  });

  it('ignora la barra final y los fragmentos', () => {
    expect(spatialLabel('http://datos.gob.es/…/territorio/Autonomia/Castilla-Leon/')).toBe('Castilla y León');
  });
});

describe('looksLikeUri', () => {
  it('distingue URI de texto', () => {
    expect(looksLikeUri('http://datos.gob.es/x')).toBe(true);
    expect(looksLikeUri('Castilla y León')).toBe(false);
    expect(looksLikeUri(undefined)).toBe(false);
  });
});

/**
 * La regresión que motivó el arreglo: la URI de la comunidad contiene la
 * subcadena "leon", así que el gazetteer devolvía la ciudad de León para los
 * 825 datasets del catálogo.
 */
describe('getSpatialCoords', () => {
  const CASTILLA_LEON = SPATIAL_COORDS['castilla y leon'];
  const LEON_CIUDAD = SPATIAL_COORDS['leon'];

  it('la URI de la comunidad no se confunde con la ciudad de León', () => {
    const coords = getSpatialCoords('http://datos.gob.es/recurso/sector-publico/territorio/Autonomia/Castilla-Leon');
    expect(coords).toEqual(CASTILLA_LEON);
    expect(coords).not.toEqual(LEON_CIUDAD);
  });

  it('sigue resolviendo la ciudad cuando de verdad es la ciudad', () => {
    expect(getSpatialCoords('http://datos.gob.es/recurso/sector-publico/territorio/Provincia/Leon'))
      .toEqual(LEON_CIUDAD);
  });

  it('con texto libre gana la clave más específica', () => {
    expect(getSpatialCoords('Provincia de Salamanca')).toEqual(SPATIAL_COORDS['provincia de salamanca']);
    expect(getSpatialCoords('Comunidad de Castilla y León')).toEqual(CASTILLA_LEON);
  });

  it('sin cobertura reconocible devuelve null en vez de un punto cualquiera', () => {
    expect(getSpatialCoords(undefined)).toBeNull();
    expect(getSpatialCoords('Provincia de Cuenca')).toBeNull();
  });
});
