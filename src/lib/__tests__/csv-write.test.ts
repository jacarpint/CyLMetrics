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

describe('inyección de fórmulas', () => {
  /*
   * Estos CSV los rellena el catálogo de la Junta —títulos, temáticas, URL— y se
   * ofrecen para abrirlos en Excel. Es contenido de terceros yendo a un formato
   * que ejecuta fórmulas, que es el escenario exacto de la inyección en CSV.
   * Entrecomillar no protege: la hoja de cálculo mira el primer carácter del
   * valor, no del campo.
   */
  it('desactiva los arranques que Excel interpreta', () => {
    expect(escapeCsvValue('=SUMA(A1:A9)')).toBe("'=SUMA(A1:A9)");
    expect(escapeCsvValue('+1234')).toBe("'+1234");
    expect(escapeCsvValue('@import')).toBe("'@import");
    // Sin comillas: con delimitador `;`, un tabulador dentro del campo no las
    // necesita. Lo que hace falta es el apóstrofo, y ahí está.
    expect(escapeCsvValue('\tcosa')).toBe("'\tcosa");
  });

  it('neutraliza el caso que llega a ejecutar un programa', () => {
    const ataque = "=cmd|'/c calc'!A1";
    const salida = escapeCsvValue(ataque);
    expect(salida.startsWith("\"'=cmd") || salida.startsWith("'=cmd")).toBe(true);
  });

  it('un número negativo sigue siendo un número', () => {
    // Anteponerle el apóstrofo lo convertiría en texto y estropearía la hoja.
    expect(escapeCsvValue('-5')).toBe('-5');
    expect(escapeCsvValue('-12,5')).toBe('-12,5');
    expect(escapeCsvValue(-7)).toBe('-7');
  });

  it('pero un guion que no abre un número sí se neutraliza', () => {
    expect(escapeCsvValue('-1+1+cmd|x')).toBe("'-1+1+cmd|x");
    expect(escapeCsvValue('-- comentario')).toBe("'-- comentario");
  });

  it('el texto normal no se toca', () => {
    expect(escapeCsvValue('Áreas de peligro de incendio')).toBe('Áreas de peligro de incendio');
    expect(escapeCsvValue('https://datosabiertos.jcyl.es/x.csv')).toBe('https://datosabiertos.jcyl.es/x.csv');
    expect(escapeCsvValue(42)).toBe('42');
    expect(escapeCsvValue(null)).toBe('');
  });

  it('el apóstrofo va DENTRO del campo entrecomillado', () => {
    // Al revés quedaría fuera y partiría la fila.
    const salida = escapeCsvValue('=A1;B2');
    expect(salida).toBe('"\'=A1;B2"');
    expect(salida.startsWith('"')).toBe(true);
  });
});
