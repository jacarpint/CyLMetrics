import { describe, it, expect } from 'vitest';
import { matchesQuery, normalizeForSearch } from '@/lib/catalog-filters';

/**
 * El buscador tiene que encontrar lo que hay.
 *
 * Antes comparaba con `toLowerCase()` y exigiendo la cadena entera contigua, así
 * que fallaba en los dos casos más frecuentes de este catálogo: escribir sin
 * tildes —«poblacion» contra «Población»— y escribir dos palabras que en el
 * título van separadas por preposiciones.
 */
describe('normalizeForSearch', () => {
  it('quita los diacríticos del español', () => {
    expect(normalizeForSearch('Población')).toBe('poblacion');
    expect(normalizeForSearch('Señalización Áerea')).toBe('senalizacion aerea');
  });

  it('colapsa espacios y recorta', () => {
    expect(normalizeForSearch('  dos   palabras  ')).toBe('dos palabras');
  });
});

describe('matchesQuery', () => {
  const TITULO = 'Hospitales de la Comunidad de Castilla y León';

  it('encuentra sin tildes lo que está con tildes, y al revés', () => {
    expect(matchesQuery('Padrón municipal de habitantes', 'padron')).toBe(true);
    expect(matchesQuery('Padron municipal de habitantes', 'padrón')).toBe(true);
  });

  it('acepta palabras salteadas y en cualquier orden', () => {
    expect(matchesQuery(TITULO, 'hospitales castilla')).toBe(true);
    expect(matchesQuery(TITULO, 'castilla hospitales')).toBe(true);
  });

  it('exige TODAS las palabras, no cualquiera de ellas', () => {
    // Con OR, acotar la búsqueda devolvería más resultados en vez de menos.
    expect(matchesQuery(TITULO, 'hospitales farmacias')).toBe(false);
  });

  it('una consulta vacía o de solo espacios no filtra', () => {
    expect(matchesQuery(TITULO, '')).toBe(true);
    expect(matchesQuery(TITULO, '   ')).toBe(true);
  });

  it('sigue encontrando por trozos de palabra', () => {
    expect(matchesQuery(TITULO, 'hospi')).toBe(true);
  });

  it('no encuentra lo que no está', () => {
    expect(matchesQuery(TITULO, 'presupuesto')).toBe(false);
  });
});
