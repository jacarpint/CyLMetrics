import { describe, it, expect } from 'vitest';
import { escapeCsvValue, toCsv } from '../csv-write';

describe('escapeCsvValue', () => {
  it('deja en paz lo que no necesita comillas', () => {
    expect(escapeCsvValue('CSV')).toBe('CSV');
    expect(escapeCsvValue(42)).toBe('42');
  });

  it('vacía los huecos en vez de escribir "null" o "undefined"', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('entrecomilla cuando el valor lleva el delimitador', () => {
    expect(escapeCsvValue('Salud; Bienestar')).toBe('"Salud; Bienestar"');
  });

  it('duplica las comillas internas', () => {
    expect(escapeCsvValue('El fichero "roto"')).toBe('"El fichero ""roto"""');
  });

  /**
   * El fallo que traían las dos copias anteriores: solo miraban `"`, `;` y `\n`.
   * Un `\r` suelto —habitual en notas copiadas de un sistema Windows— salía sin
   * entrecomillar y partía la fila, desplazando todas las columnas siguientes.
   */
  it('entrecomilla también el retorno de carro suelto', () => {
    expect(escapeCsvValue('primera\rsegunda')).toBe('"primera\rsegunda"');
    expect(escapeCsvValue('primera\r\nsegunda')).toBe('"primera\r\nsegunda"');
    expect(escapeCsvValue('primera\nsegunda')).toBe('"primera\nsegunda"');
  });
});

describe('toCsv', () => {
  it('abre con BOM para que Excel no rompa los acentos', () => {
    expect(toCsv(['campo'], [['Peñafiel']]).startsWith('﻿')).toBe(true);
  });

  it('separa con punto y coma, no con coma', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toContain('a;b');
  });

  it('escribe una línea por fila', () => {
    const csv = toCsv(['formato'], [['CSV'], ['JSON']]);
    expect(csv.split('\r\n')).toEqual(['﻿formato', 'CSV', 'JSON']);
  });

  it('una cabecera sin filas sigue siendo un CSV válido', () => {
    expect(toCsv(['formato'], [])).toBe('﻿formato');
  });

  it('un valor multilínea no añade filas al CSV', () => {
    // 2 líneas lógicas: la cabecera y una fila cuyo salto va entrecomillado.
    const csv = toCsv(['nota'], [['dice\r\nesto']]);
    expect(csv).toBe('﻿nota\r\n"dice\r\nesto"');
  });
});
