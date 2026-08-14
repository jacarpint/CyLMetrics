import { describe, it, expect } from 'vitest';
import { themeLabel, spatialLabel, looksLikeUri } from '../vocabularies';

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

/*
 * Aquí había un bloque `getSpatialCoords`: el gazetteer que convertía la
 * cobertura declarada en coordenadas para pintar un marcador de respaldo en el
 * visor. El marcador se retiró —era el mismo punto para todo el catálogo y se
 * leía como si fuera la geometría del recurso— y con él la función. La
 * cobertura se sigue enseñando, pero en texto y con `spatialLabel`.
 */
