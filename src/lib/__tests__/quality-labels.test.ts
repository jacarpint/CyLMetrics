import { describe, it, expect } from 'vitest';
import { analyzedCells, distributionVolume, formatBytes } from '../quality-labels';

/**
 * `distributionVolume` traduce los nombres que emite cada analizador de
 * `src/analysis` a las dos cifras que enseña la ficha. Existe porque la UI
 * leía `row_count`/`col_count`, claves que el analizador no escribe en ningún
 * formato: las tarjetas de volumen salían siempre vacías. Estos casos son los
 * que aparecen de verdad en `reports/`.
 */
describe('distributionVolume', () => {
  it('CSV: rows/columns → filas y columnas', () => {
    const v = distributionVolume('CSV', { rows: 16710, columns: 24, delimiter: ';', encoding: 'utf_8' });
    expect(v.primary).toEqual({ value: 16710, label: 'Filas' });
    expect(v.secondary).toEqual({ value: 24, label: 'Columnas' });
  });

  it('JSON: elements/columns → elementos y campos', () => {
    const v = distributionVolume('JSON', { kind: 'list', elements: 24415, rows: 24415, columns: 24 });
    expect(v.primary).toEqual({ value: 24415, label: 'Elementos' });
    expect(v.secondary).toEqual({ value: 24, label: 'Campos' });
  });

  it('XLSX: total_rows/sheet_count, que no usan rows ni columns', () => {
    const v = distributionVolume('XLSX', { sheet_count: 2, total_rows: 336, error_cells: 11 });
    expect(v.primary).toEqual({ value: 336, label: 'Filas totales' });
    expect(v.secondary).toEqual({ value: 2, label: 'Hojas' });
  });

  it('XML/RSS: total_elements e items', () => {
    expect(distributionVolume('XML', { root: 'document', total_elements: 3187 }).primary)
      .toEqual({ value: 3187, label: 'Elementos' });
    expect(distributionVolume('RSS', { total_elements: 3309, items: 824 }).secondary)
      .toEqual({ value: 824, label: 'Registros' });
  });

  it('WFS/SHP: tipos de entidad y entidades', () => {
    expect(distributionVolume('WFS', { service: 'WFS', feature_types: 7 }).primary)
      .toEqual({ value: 7, label: 'Tipos de entidad' });
    expect(distributionVolume('SHP', { features: 120, fields: 9 }).primary)
      .toEqual({ value: 120, label: 'Entidades' });
  });

  it('no inventa cifras cuando no hay métricas', () => {
    expect(distributionVolume('SHP', {})).toEqual({ primary: null, secondary: null });
    expect(distributionVolume(undefined, null)).toEqual({ primary: null, secondary: null });
  });

  it('ignora la clave inexistente row_count que usaba la UI', () => {
    expect(distributionVolume('CSV', { row_count: 99, col_count: 5 }).primary).toBeNull();
  });
});

describe('analyzedCells', () => {
  it('multiplica filas por columnas cuando ambas existen', () => {
    expect(analyzedCells({ rows: 100, columns: 4 })).toBe(400);
  });

  it('devuelve 0 si falta alguna, para no dividir por un total inventado', () => {
    expect(analyzedCells({ rows: 100 })).toBe(0);
    expect(analyzedCells(undefined)).toBe(0);
  });
});

describe('formatBytes', () => {
  it('escala la unidad', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
  });

  // El portal está en español: el separador decimal es la coma, no el punto.
  it('usa coma decimal', () => {
    expect(formatBytes(3_500_000)).toBe('3,5 MB');
    expect(formatBytes(2_713_979_656)).toBe('2,71 GB');
  });
});
