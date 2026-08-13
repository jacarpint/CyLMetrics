import { describe, it, expect } from 'vitest';
import {
  affectedColumns,
  expandRows,
  isLocatable,
  isTruncated,
  issuePositions,
  positionCount,
  type IssueDetail,
} from '../report-bundle';

/** Incidencia con dos columnas afectadas, tal y como la escribe `bundle.py`. */
function issue(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    code: 'error-tipo',
    label: 'Valores con un tipo distinto al mayoritario de su columna',
    severity: 'error',
    count: 5,
    stored: 5,
    columns: [
      // Filas absolutas 2, 3, 7 -> deltas 2, 1, 4
      { col: 1, field: 'FECHA', rows: [2, 1, 4], cells: ['12-13/02', 'sin fecha', '—'] },
      // Filas absolutas 4, 9 -> deltas 4, 5
      { col: 3, field: 'IMPORTE', rows: [4, 5], cells: ['n/d', 'pendiente'] },
    ],
    ...overrides,
  };
}

describe('expandRows', () => {
  it('deshace la codificación delta', () => {
    expect(expandRows([2, 1, 4])).toEqual([2, 3, 7]);
  });

  it('una lista vacía no produce posiciones', () => {
    expect(expandRows([])).toEqual([]);
  });

  it('soporta saltos grandes sin acumular error', () => {
    expect(expandRows([1200, 1, 1, 8000])).toEqual([1200, 1201, 1202, 9202]);
  });
});

describe('positionCount', () => {
  it('suma las posiciones de todas las columnas', () => {
    expect(positionCount(issue())).toBe(5);
  });

  it('cuenta también las incidencias de fila entera', () => {
    expect(positionCount({ ...issue({ columns: undefined }), rows: [3, 2, 2] })).toBe(3);
  });

  it('una incidencia de fichero entero no tiene posiciones', () => {
    expect(positionCount(issue({ columns: undefined, stored: 0 }))).toBe(0);
  });
});

describe('issuePositions', () => {
  it('expande la primera página con columna, campo y valor', () => {
    expect(issuePositions(issue(), 0, 2)).toEqual([
      { row: 2, col: 1, sheet: undefined, field: 'FECHA', cell: '12-13/02' },
      { row: 3, col: 1, sheet: undefined, field: 'FECHA', cell: 'sin fecha' },
    ]);
  });

  it('el desplazamiento cruza el límite entre columnas', () => {
    // Las tres primeras son de FECHA; la cuarta ya es de IMPORTE.
    const positions = issuePositions(issue(), 3, 10);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({ row: 4, col: 3, field: 'IMPORTE', cell: 'n/d' });
    expect(positions[1]).toMatchObject({ row: 9, col: 3, field: 'IMPORTE' });
  });

  it('respeta el límite aunque queden posiciones', () => {
    expect(issuePositions(issue(), 0, 1)).toHaveLength(1);
  });

  it('un desplazamiento más allá del final no devuelve nada', () => {
    expect(issuePositions(issue(), 99, 10)).toEqual([]);
  });

  it('las incidencias de fila entera no traen columna', () => {
    const rowIssue: IssueDetail = {
      code: 'fila-vacia',
      label: 'Filas completamente vacías',
      severity: 'error',
      count: 2,
      stored: 2,
      rows: [10, 5],
    };
    expect(issuePositions(rowIssue, 0, 10)).toEqual([
      { row: 10, col: null },
      { row: 15, col: null },
    ]);
  });

  it('recorre primero las columnas y después las filas sueltas', () => {
    const mixed = issue({ rows: [100], count: 6, stored: 6 });
    const positions = issuePositions(mixed, 0, 10);
    expect(positions).toHaveLength(6);
    expect(positions[5]).toEqual({ row: 100, col: null });
  });

  it('sin valores guardados, `cell` queda indefinido y la columna no se pinta', () => {
    const missing = issue({
      code: 'celda-faltante',
      columns: [{ col: 0, field: 'NOMBRE', rows: [2, 1] }],
      count: 2,
      stored: 2,
    });
    expect(issuePositions(missing, 0, 10).every((p) => p.cell === undefined)).toBe(true);
  });
});

describe('affectedColumns', () => {
  it('ordena de más a menos casos', () => {
    expect(affectedColumns(issue())).toEqual([
      { col: 1, field: 'FECHA', sheet: undefined, count: 3 },
      { col: 3, field: 'IMPORTE', sheet: undefined, count: 2 },
    ]);
  });

  it('sin columnas, no hay nada que listar', () => {
    expect(affectedColumns(issue({ columns: undefined }))).toEqual([]);
  });
});

describe('recorte declarado', () => {
  it('`stored` menor que `count` es un recorte y hay que decirlo', () => {
    expect(isTruncated(issue({ count: 2_500_000, stored: 2_000_000 }))).toBe(true);
  });

  it('una incidencia completa no está recortada', () => {
    expect(isTruncated(issue())).toBe(false);
  });

  it('una incidencia de fichero entero no cuenta como recorte', () => {
    // `stored: 0` significa «no hay nada que localizar dentro del archivo», no
    // «se perdieron las posiciones». Confundirlo haría que la ficha avisara de
    // un recorte inexistente en cada enlace roto del catálogo.
    const download: IssueDetail = {
      code: 'descarga',
      label: 'No se pudo descargar',
      severity: 'error',
      count: 1,
      stored: 0,
    };
    expect(isTruncated(download)).toBe(false);
    expect(isLocatable(download)).toBe(false);
  });
});
