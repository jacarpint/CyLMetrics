import { describe, it, expect } from 'vitest';
import { parseCsv, guessDelimiter, parseTable } from '../csv-parse';

describe('parseCsv', () => {
  it('separa filas y campos', () => {
    expect(parseCsv('a;b;c\n1;2;3', ';')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('respeta el delimitador dentro de comillas', () => {
    expect(parseCsv('a;b\n"uno;dos";tres', ';')).toEqual([
      ['a', 'b'],
      ['uno;dos', 'tres'],
    ]);
  });

  it('entiende las comillas escapadas de RFC 4180', () => {
    expect(parseCsv('a\n"dijo ""hola"""', ';')).toEqual([['a'], ['dijo "hola"']]);
  });

  it('admite saltos de línea dentro de un campo entrecomillado', () => {
    expect(parseCsv('a;b\n"primera\nsegunda";x', ';')).toEqual([
      ['a', 'b'],
      ['primera\nsegunda', 'x'],
    ]);
  });

  it('normaliza CRLF y la última fila sin salto final', () => {
    expect(parseCsv('a;b\r\n1;2\r\n3;4', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('descarta las filas completamente vacías', () => {
    expect(parseCsv('a\n1\n\n2\n', ';')).toEqual([['a'], ['1'], ['2']]);
  });

  it('respeta el límite de filas', () => {
    const text = Array.from({ length: 100 }, (_, i) => `f${i}`).join('\n');
    expect(parseCsv(text, ';', 10).length).toBeLessThanOrEqual(11);
  });
});

describe('guessDelimiter', () => {
  it('detecta el punto y coma, habitual en datos abiertos españoles', () => {
    expect(guessDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
  });

  it('detecta la coma', () => {
    expect(guessDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
  });

  it('detecta el tabulador', () => {
    expect(guessDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('no se deja engañar por comas dentro de campos entrecomillados', () => {
    expect(guessDelimiter('a;b\n"uno, dos";x\n"tres, cuatro";y')).toBe(';');
  });
});

describe('parseTable', () => {
  it('separa encabezado de filas', () => {
    const t = parseTable('nombre;edad\nAna;33\nLuis;41');
    expect(t.header).toEqual(['nombre', 'edad']);
    expect(t.rows).toEqual([['Ana', '33'], ['Luis', '41']]);
    expect(t.delimiter).toBe(';');
  });

  it('quita el BOM del primer encabezado', () => {
    expect(parseTable('﻿nombre;edad\nAna;33').header).toEqual(['nombre', 'edad']);
  });

  it('nombra las columnas sin encabezado', () => {
    expect(parseTable('nombre;;edad\nAna;x;33').header).toEqual(['nombre', 'Columna 2', 'edad']);
  });

  it('sobrevive a un fichero vacío', () => {
    expect(parseTable('')).toEqual({ header: [], rows: [], delimiter: ';' });
  });
});
