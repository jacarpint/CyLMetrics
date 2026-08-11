import { describe, it, expect } from 'vitest';
import { jsonToTable, isTabularJson, describeJson, findRecords, jsonRecordTable } from '../json-to-table';

describe('isTabularJson', () => {
  it('acepta listas de objetos', () => {
    expect(isTabularJson([{ a: 1 }, { a: 2 }])).toBe(true);
  });

  it('rechaza lo que no es una lista de registros', () => {
    expect(isTabularJson({ a: 1 })).toBe(false);
    expect(isTabularJson([])).toBe(false);
    expect(isTabularJson([1, 2, 3])).toBe(false);
    expect(isTabularJson(null)).toBe(false);
  });
});

describe('jsonToTable', () => {
  it('usa las claves del primer registro como columnas, igual que el analizador', () => {
    const t = jsonToTable([{ nombre: 'Ana', edad: 33 }, { nombre: 'Luis', edad: 41 }])!;
    expect(t.header).toEqual(['nombre', 'edad']);
    expect(t.rows).toEqual([['Ana', '33'], ['Luis', '41']]);
  });

  it('distingue el vacío del texto "null"', () => {
    const t = jsonToTable([{ a: null }, { a: 'null' }])!;
    expect(t.rows).toEqual([[''], ['null']]);
  });

  it('serializa los valores anidados en vez de mostrar [object Object]', () => {
    const t = jsonToTable([{ pos: { lat: 1, lon: 2 } }])!;
    expect(t.rows[0][0]).toBe('{"lat":1,"lon":2}');
  });

  it('cuenta los registros a los que les falta alguna clave', () => {
    const t = jsonToTable([{ a: 1, b: 2 }, { a: 3 }])!;
    expect(t.irregular).toBe(1);
    expect(t.rows[1]).toEqual(['3', '']);
  });

  it('admite listas de listas', () => {
    const t = jsonToTable([[1, 2], [3, 4, 5]])!;
    expect(t.header).toEqual(['Columna 1', 'Columna 2', 'Columna 3']);
    expect(t.rows).toEqual([['1', '2'], ['3', '4', '5']]);
  });

  it('devuelve null cuando no hay tabla que hacer', () => {
    expect(jsonToTable({ total: 5 })).toBeNull();
    expect(jsonToTable([])).toBeNull();
  });
});

describe('findRecords', () => {
  it('devuelve el documento cuando ya es la lista', () => {
    const found = findRecords([{ a: 1 }])!;
    expect(found.path).toBe('');
    expect(found.items).toHaveLength(1);
  });

  it('encuentra la lista dentro del envoltorio', () => {
    const found = findRecords({ document: { date: '2026-01-01', list: [{ a: 1 }, { a: 2 }] } })!;
    expect(found.path).toBe('document.list');
    expect(found.items).toHaveLength(2);
  });

  it('deshace el envoltorio de un solo campo por registro', () => {
    const found = findRecords({ document: { list: [{ element: { a: 1 } }, { element: { a: 2 } }] } })!;
    expect(found.path).toBe('document.list[].element');
    expect(found.items).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('no deshace nada si los registros traen más de una clave', () => {
    const found = findRecords([{ a: { x: 1 }, b: 2 }])!;
    expect(found.path).toBe('');
  });

  it('se queda con la lista más larga', () => {
    const found = findRecords({ meta: [{ a: 1 }], datos: [{ a: 1 }, { a: 2 }, { a: 3 }] })!;
    expect(found.path).toBe('datos');
  });

  it('devuelve null si no hay ninguna lista de registros', () => {
    expect(findRecords({ error: 'no autorizado' })).toBeNull();
  });
});

describe('jsonRecordTable', () => {
  it('tabula los registros envueltos y dice de dónde salen', () => {
    const t = jsonRecordTable({ document: { list: [{ element: { nombre: 'Ana' } }] } })!;
    expect(t.path).toBe('document.list[].element');
    expect(t.header).toEqual(['nombre']);
    expect(t.rows).toEqual([['Ana']]);
  });

  // Codificación habitual en el portal: los campos van como lista de pares.
  it('convierte los pares nombre/valor en columnas de verdad', () => {
    const t = jsonRecordTable([
      { attribute: [{ name: 'Titulo', string: 'Albergue' }, { name: 'CP', valor: '05120' }] },
      { attribute: [{ name: 'Titulo', string: 'Museo' }, { name: 'CP', valor: '47001' }] },
    ])!;
    expect(t.path).toBe('[].attribute');
    expect(t.header).toEqual(['Titulo', 'CP']);
    expect(t.rows).toEqual([['Albergue', '05120'], ['Museo', '47001']]);
  });

  it('acepta que la clave del valor cambie según el tipo', () => {
    const t = jsonRecordTable([
      { attribute: [{ name: 'Fecha', date: '2026-01-01' }, { name: 'Web', link: 'https://x' }, { name: 'Vacio' }] },
    ])!;
    expect(t.rows[0]).toEqual(['2026-01-01', 'https://x', '']);
  });

  it('junta en una columna los nombres repetidos dentro de un registro', () => {
    const t = jsonRecordTable([
      { attribute: [{ name: 'Telefono', valor: '900' }, { name: 'Telefono', valor: '901' }] },
    ])!;
    expect(t.header).toEqual(['Telefono']);
    expect(t.rows).toEqual([['900 · 901']]);
  });

  it('reúne los campos que solo aparecen en registros posteriores', () => {
    const t = jsonRecordTable([
      { attribute: [{ name: 'A', valor: '1' }] },
      { attribute: [{ name: 'A', valor: '2' }, { name: 'B', valor: '3' }] },
    ])!;
    expect(t.header).toEqual(['A', 'B']);
    expect(t.rows).toEqual([['1', ''], ['2', '3']]);
    expect(t.irregular).toBe(1);
  });

  it('no fuerza el aplanado si los registros no siguen el patrón', () => {
    const t = jsonRecordTable([{ attribute: [{ sinNombre: 1 }] }])!;
    expect(t.header).toEqual(['attribute']);
  });
});

describe('describeJson', () => {
  it('resume la forma del documento', () => {
    expect(describeJson([1, 2, 3])).toContain('3 elementos');
    expect(describeJson({ a: 1, b: 2 })).toContain('2 claves');
    expect(describeJson('hola')).toBe('Valor string');
  });
});
