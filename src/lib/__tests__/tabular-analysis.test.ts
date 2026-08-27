import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  valueType,
  toNumber,
  columnProfiles,
  findTabularIssues,
  NUMBER_LITERAL,
  DECIMAL_COMMA,
} from '../tabular-analysis';

const issue = (code: string, issues: ReturnType<typeof findTabularIssues>) =>
  issues.find((i) => i.code === code);

describe('valueType', () => {
  it('clasifica los tipos estrictos', () => {
    expect(valueType('123')).toBe('number');
    expect(valueType('12.5')).toBe('number');
    expect(valueType('-3')).toBe('number');
    expect(valueType('2024-03-01')).toBe('date');
    expect(valueType('true')).toBe('bool');
    expect(valueType('FALSE')).toBe('bool');
    expect(valueType('hola')).toBe('str');
  });

  it('trata como vacío el nulo y el espacio en blanco', () => {
    expect(valueType(null)).toBe('empty');
    expect(valueType('')).toBe('empty');
    expect(valueType('   ')).toBe('empty');
  });

  // `Number('')` vale 0: sin la comprobación previa, una celda vacía sería número.
  it('una celda en blanco no es un número', () => {
    expect(valueType(' ')).not.toBe('number');
  });

  /**
   * El decimal a la española. Lo que decide es la COMA: `1.234` a secas es
   * ambiguo —mil doscientos treinta y cuatro, o uno coma doscientos treinta y
   * cuatro— y se lee con la regla de siempre, la del punto decimal;
   * `210.826.129,02` no tiene ambigüedad ninguna.
   */
  it('reconoce los números escritos en castellano', () => {
    expect(valueType('1234,56')).toBe('number');
    expect(valueType('3632981672,59')).toBe('number');
    expect(valueType('-4,683243')).toBe('number');
    expect(valueType('210.826.129,02')).toBe('number');
    expect(valueType('7.876,62')).toBe('number');
  });

  it('no se traga lo que no es un número claro', () => {
    expect(valueType('-,0083333')).toBe('str');   // sin parte entera
    expect(valueType('1,')).toBe('str');
    expect(valueType(',5')).toBe('str');
    expect(valueType('1,2,3')).toBe('str');
    expect(valueType('12.34.56')).toBe('str');
    expect(valueType('3305.06 - 3305.99')).toBe('str');
  });

  it('una fecha mal formada es texto, no fecha', () => {
    expect(valueType('01/03/2024')).toBe('str');
    expect(valueType('2024-13-45')).toBe('str');
  });
});

describe('columnProfiles', () => {
  const header = ['nombre', 'edad', 'alta'];
  const rows = [
    ['Ana', '33', '2024-01-02'],
    ['Luis', '41', '2024-03-05'],
    ['Eva', '', '2023-11-30'],
  ];

  it('infiere el tipo dominante de cada columna', () => {
    const p = columnProfiles(header, rows);
    expect(p.map((c) => c.type)).toEqual(['string', 'number', 'date']);
  });

  it('cuenta nulos y distintos sobre todas las filas', () => {
    const p = columnProfiles(header, rows);
    expect(p[1]).toMatchObject({ null_count: 1, distinct: 2 });
    expect(p[0]).toMatchObject({ null_count: 0, distinct: 3 });
  });

  it('da el rango de números y de fechas', () => {
    const p = columnProfiles(header, rows);
    expect(p[1]).toMatchObject({ min: 33, max: 41 });
    expect(p[2]).toMatchObject({ min: '2023-11-30', max: '2024-03-05' });
  });

  // El analizador cortaba en 1.000 y la ficha mostraba «1000+».
  it('no tiene tope de valores distintos', () => {
    const many = Array.from({ length: 1500 }, (_, i) => [`v${i}`]);
    expect(columnProfiles(['c'], many)[0].distinct).toBe(1500);
  });
});

describe('findTabularIssues · celdas vacías', () => {
  it('señala las vacías de una columna mayoritariamente rellena', () => {
    const rows = [['a', '1'], ['b', ''], ['c', '3'], ['d', '4']];
    const found = issue('celda-faltante', findTabularIssues(['x', 'y'], rows));
    expect(found?.occurrences).toEqual([{ row: 1, col: 1 }]);
  });

  // Regla MIN_FILL del analizador: teléfono, email u observaciones casi vacíos
  // no son un fallo del dataset.
  it('ignora las columnas opcionales, rellenas por debajo del 50%', () => {
    const rows = [['a', '1'], ['b', ''], ['c', ''], ['d', '']];
    expect(issue('celda-faltante', findTabularIssues(['x', 'opcional'], rows))).toBeUndefined();
  });

  it('encuentra TODOS los casos, no una muestra', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ['x', i % 2 === 0 ? '' : '1']);
    const found = issue('celda-faltante', findTabularIssues(['a', 'b'], rows));
    expect(found?.occurrences).toHaveLength(100);
  });
});

describe('findTabularIssues · tipos incoherentes', () => {
  it('señala el valor que rompe el tipo dominante', () => {
    const rows = [['1'], ['2'], ['3'], ['ochenta']];
    const found = issue('error-tipo', findTabularIssues(['n'], rows));
    expect(found?.occurrences).toEqual([{ row: 3, col: 0 }]);
  });

  it('no señala nada en una columna de texto', () => {
    const rows = [['uno'], ['dos'], ['tres'], ['4']];
    expect(issue('error-tipo', findTabularIssues(['t'], rows))).toBeUndefined();
  });

  it('con menos de tres valores no se infiere tipo', () => {
    const rows = [['1'], ['dos']];
    expect(issue('error-tipo', findTabularIssues(['n'], rows))).toBeUndefined();
  });

  it('en empate no se señala nada', () => {
    const rows = [['1'], ['2'], ['a'], ['b']];
    expect(issue('error-tipo', findTabularIssues(['n'], rows))).toBeUndefined();
  });

  it('una celda vacía no es un error de tipo', () => {
    const rows = [['1'], ['2'], ['3'], ['']];
    expect(issue('error-tipo', findTabularIssues(['n'], rows))).toBeUndefined();
  });
});

describe('findTabularIssues · encabezados y filas', () => {
  it('detecta columnas sin nombre', () => {
    const found = issue('encabezado-vacio', findTabularIssues(['a', 'Columna 2'], [['1', '2']]));
    expect(found?.occurrences).toEqual([{ row: -1, col: 1 }]);
  });

  it('detecta nombres repetidos, sin distinguir mayúsculas', () => {
    const found = issue('encabezado-duplicado', findTabularIssues(['fecha', 'FECHA'], [['1', '2']]));
    expect(found?.occurrences).toEqual([{ row: -1, col: 1 }]);
  });

  it('detecta filas con más campos que columnas', () => {
    const found = issue('celda-extra', findTabularIssues(['a', 'b'], [['1', '2'], ['1', '2', '3']]));
    expect(found?.occurrences).toEqual([{ row: 1, col: 1 }]);
  });
});

describe('findTabularIssues · orden', () => {
  it('los errores van antes que los avisos', () => {
    const rows = [['1', 'x'], ['2', ''], ['3', 'z'], ['texto', 'w']];
    const codes = findTabularIssues(['n', 'y'], rows).map((i) => i.code);
    expect(codes.indexOf('error-tipo')).toBeLessThan(codes.indexOf('celda-faltante'));
  });

  it('un fichero limpio no produce incidencias', () => {
    expect(findTabularIssues(['a', 'b'], [['1', 'x'], ['2', 'y'], ['3', 'z']])).toEqual([]);
  });
});

/**
 * Los dos patrones que TIENEN que decir lo mismo a los dos lados.
 *
 * El analizador (Python) calcula el informe y el visor (TypeScript) analiza el
 * mismo fichero en el navegador. Cada discrepancia entre sus reglas es un
 * `error-tipo` que aparece en una pantalla y no en la otra sobre el mismo
 * archivo, que es exactamente lo que hace dudar de las dos cifras. Ya pasó con
 * los literales nativos: `int('1_000')` en Python vale 1000 y `Number('1_000')`
 * es NaN; al revés, `Number('0x1A')` vale 26 y `float('0x1A')` falla.
 *
 * El test lee el fuente de Python. Es tosco, y es mucho mejor que descubrirlo en
 * producción; hay precedente en `portal-limitation-parity.test.ts`.
 */
describe('paridad de los patrones numéricos entre Python y TypeScript', () => {
  const TABULAR_PY = fs.readFileSync(
    path.join(process.cwd(), 'src', 'analysis', 'formats', 'tabular.py'),
    'utf-8'
  );

  /** El cuerpo de un `re.compile(r"...")` con el nombre dado. */
  function pythonPattern(name: string): string {
    const match = new RegExp(`${name}\\s*=\\s*re\\.compile\\(r"(.*)"\\)`).exec(TABULAR_PY);
    if (!match) throw new Error(`No se encuentra ${name} en tabular.py`);
    return match[1];
  }

  it('el decimal con coma es el mismo patrón', () => {
    // Contra el `.source` del regex de verdad, no contra un literal copiado a
    // mano: un literal se queda viejo en silencio y entonces el test de paridad
    // deja de comparar las dos implementaciones para compararse consigo mismo.
    expect(pythonPattern('_DECIMAL_COMMA')).toBe(DECIMAL_COMMA.source);
  });

  it('el literal numérico de siempre sigue siendo el mismo', () => {
    expect(pythonPattern('_NUMBER_LITERAL')).toBe(NUMBER_LITERAL.source);
  });
});

describe('toNumber', () => {
  it('convierte las dos formas de escribir un decimal', () => {
    expect(toNumber('1234,56')).toBe(1234.56);
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber('210.826.129,02')).toBe(210826129.02);
    expect(toNumber('-4,683243')).toBe(-4.683243);
  });

  /**
   * `Number()` es generoso de un modo que aquí hace daño: `Number('')` vale 0 —una
   * celda vacía entrando en el mínimo como un cero que nadie escribió— y
   * `Number('0x1A')` vale 26, mientras que el `float('0x1A')` del analizador falla.
   * Por eso la conversión se ata a los mismos patrones que `valueType`.
   */
  it('no inventa números donde no los hay', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber('   ')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber('0x1A')).toBeNull();
    expect(toNumber('Cañada')).toBeNull();
    expect(toNumber('-,0083333')).toBeNull();
  });

  it('el rango de una columna a la española sale bien', () => {
    const [perfil] = columnProfiles(
      ['importe'],
      [['3632981672,59'], ['5500,00'], ['210.826.129,02']]
    );

    expect(perfil.type).toBe('number');
    expect(perfil.min).toBe(5500);
    expect(perfil.max).toBe(3632981672.59);
  });
});
