import { describe, it, expect } from 'vitest';
import { unitWords, capitalize, presentationForFormat, type UnitVoice } from '@/lib/unit-words';

/**
 * Las palabras estaban repetidas en cuatro componentes y ya habían empezado a
 * separarse («Columna» en el esquema, «columna» en la tabla). Aquí se fija que
 * las dos voces sigan siendo simétricas: si una gana una palabra y la otra no,
 * vuelve la deriva.
 */
const VOCES: UnitVoice[] = ['table', 'record'];

describe('unitWords', () => {
  it('nombra la fila y la columna de un CSV', () => {
    expect(unitWords('table')).toEqual({ row: 'fila', rows: 'filas', col: 'columna', cols: 'columnas' });
  });

  it('nombra el registro y el campo de un JSON', () => {
    expect(unitWords('record')).toEqual({
      row: 'registro',
      rows: 'registros',
      col: 'campo',
      cols: 'campos',
    });
  });

  it('las dos voces traen exactamente las mismas palabras', () => {
    expect(Object.keys(unitWords('table')).sort()).toEqual(Object.keys(unitWords('record')).sort());
  });

  it('guarda todo en minúscula: la mayúscula la pone quien la necesita', () => {
    for (const voz of VOCES) {
      for (const palabra of Object.values(unitWords(voz))) {
        expect(palabra).toBe(palabra.toLowerCase());
      }
    }
  });

  it('el plural no coincide con el singular en ninguna voz', () => {
    for (const voz of VOCES) {
      const w = unitWords(voz);
      expect(w.row).not.toBe(w.rows);
      expect(w.col).not.toBe(w.cols);
    }
  });
});

describe('capitalize', () => {
  it('sube la primera letra y deja el resto', () => {
    expect(capitalize('columnas')).toBe('Columnas');
    expect(capitalize('campo')).toBe('Campo');
  });

  it('aguanta la cadena vacía', () => {
    expect(capitalize('')).toBe('');
  });
});

describe('presentationForFormat', () => {
  it('trata como tabla los formatos de filas y columnas', () => {
    for (const fmt of ['CSV', 'TSV', 'XLSX', 'XLS', 'TXT', 'csv']) {
      expect(presentationForFormat(fmt)).toBe('table');
    }
  });

  it('trata como registros los formatos de objetos', () => {
    expect(presentationForFormat('JSON')).toBe('record');
    expect(presentationForFormat('GeoJSON')).toBe('record');
  });

  it('no fuerza cuadrícula a lo que no la tiene', () => {
    for (const fmt of ['XML', 'KML', 'SHP', 'PDF', 'WMS']) {
      expect(presentationForFormat(fmt)).toBe('plain');
    }
  });

  it('sin formato, tampoco inventa estructura', () => {
    expect(presentationForFormat(undefined)).toBe('plain');
    expect(presentationForFormat('')).toBe('plain');
  });

  it('las voces que devuelve son claves válidas del vocabulario', () => {
    for (const fmt of ['CSV', 'JSON']) {
      const p = presentationForFormat(fmt);
      expect(p).not.toBe('plain');
      expect(unitWords(p as UnitVoice).row).toBeTruthy();
    }
  });
});
