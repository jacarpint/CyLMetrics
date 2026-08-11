import { describe, it, expect } from 'vitest';
import { presentationForFormat } from '@/components/quality/issue-explorer';

/**
 * La cuadrícula de filas y columnas solo describe bien a los formatos
 * tabulares. En JSON la unidad es el registro y en XML/KML/SHP no hay filas,
 * así que una tabla ahí inventa una estructura que el recurso no tiene.
 */
describe('presentationForFormat', () => {
  it('usa tabla en los formatos tabulares', () => {
    for (const fmt of ['CSV', 'TSV', 'XLSX', 'XLS', 'TXT', 'csv']) {
      expect(presentationForFormat(fmt)).toBe('table');
    }
  });

  it('usa la vista de registro en JSON y GeoJSON', () => {
    expect(presentationForFormat('JSON')).toBe('record');
    expect(presentationForFormat('GeoJSON')).toBe('record');
  });

  it('cae en la vista plana para todo lo demás', () => {
    for (const fmt of ['XML', 'RDF', 'RSS', 'KML', 'SHP', 'WMS', 'WFS', 'ZIP', 'ECW', 'OTRO']) {
      expect(presentationForFormat(fmt)).toBe('plain');
    }
  });

  it('sin formato conocido, no asume tabla', () => {
    expect(presentationForFormat(undefined)).toBe('plain');
    expect(presentationForFormat('')).toBe('plain');
  });
});
