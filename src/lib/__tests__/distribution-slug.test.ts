import { describe, it, expect } from 'vitest';
import { distributionSlugs, resolveDistributionIndex } from '../distribution-slug';

describe('distributionSlugs', () => {
  it('usa el formato en minúsculas cuando no se repite', () => {
    expect(distributionSlugs(['CSV', 'JSON', 'WMS'])).toEqual(['csv', 'json', 'wms']);
  });

  it('numera desde 2 solo los formatos repetidos', () => {
    expect(distributionSlugs(['CSV', 'CSV', 'JSON'])).toEqual(['csv', 'csv-2', 'json']);
  });

  it('aguanta el caso peor del catálogo: siete CSV en un dataset', () => {
    const slugs = distributionSlugs(Array(7).fill('CSV'));
    expect(slugs).toEqual(['csv', 'csv-2', 'csv-3', 'csv-4', 'csv-5', 'csv-6', 'csv-7']);
    expect(new Set(slugs).size).toBe(7);
  });

  it('normaliza formatos con mayúsculas mezcladas o símbolos', () => {
    expect(distributionSlugs(['GeoJSON', 'iCal', 'OTRO'])).toEqual(['geojson', 'ical', 'otro']);
  });

  it('nunca produce un slug vacío', () => {
    expect(distributionSlugs(['', '  '])).toEqual(['archivo', 'archivo-2']);
  });
});

describe('resolveDistributionIndex', () => {
  const formats = ['CSV', 'CSV', 'JSON'];

  it('resuelve por slug', () => {
    expect(resolveDistributionIndex(formats, 'csv')).toBe(0);
    expect(resolveDistributionIndex(formats, 'csv-2')).toBe(1);
    expect(resolveDistributionIndex(formats, 'json')).toBe(2);
  });

  // Los enlaces publicados antes del cambio no deben romperse.
  it('sigue aceptando el índice numérico heredado', () => {
    expect(resolveDistributionIndex(formats, '0')).toBe(0);
    expect(resolveDistributionIndex(formats, '2')).toBe(2);
  });

  it('es indiferente a mayúsculas', () => {
    expect(resolveDistributionIndex(formats, 'JSON')).toBe(2);
  });

  it('devuelve -1 si no existe', () => {
    expect(resolveDistributionIndex(formats, 'xml')).toBe(-1);
    expect(resolveDistributionIndex(formats, '9')).toBe(-1);
    expect(resolveDistributionIndex(formats, 'csv-9')).toBe(-1);
  });
});
