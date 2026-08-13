import { describe, it, expect } from 'vitest';
import {
  buildRepairActions,
  contentActions,
  deliveryActions,
  metadataActions,
} from '../repair-actions';
import type { SystemicCause } from '../availability';
import type { Dataset } from '../types';
import type { QualityReport } from '../quality-report';

function cause(partial: Partial<SystemicCause> = {}): SystemicCause {
  return {
    key: 'CSV:descarga',
    format: 'CSV',
    causeCode: 'descarga',
    causeLabel: 'No se descarga',
    affected: 10,
    formatTotal: 100,
    datasets: 8,
    wholeFormat: false,
    ...partial,
  };
}

/** Informe con `count` distribuciones afectadas por `code`. */
function reportWithIssue(code: string, count: number): QualityReport {
  return {
    datasets: [
      {
        distribution_results: Array.from({ length: count }, () => ({
          analysis: {
            ok: false,
            score: null,
            summary: '',
            metrics: {},
            issues: [{ code, label: code, severity: 'error' as const, count: 1 }],
          },
        })),
      },
    ],
  } as unknown as QualityReport;
}

/** `count` datasets a los que les falta el campo `gap`. */
function datasetsMissing(gap: string, count: number): Dataset[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `https://example.org/ds/${i}`,
    metadataGaps: [gap],
  })) as unknown as Dataset[];
}

describe('deliveryActions', () => {
  it('traduce cada causa en una tarea con su «qué hacer»', () => {
    const [action] = deliveryActions([cause()]);
    expect(action.family).toBe('entrega');
    expect(action.action).toContain('Restablecer el enlace');
    expect(action.affected).toBe(10);
    expect(action.unit).toBe('archivos');
  });

  it('un código sin acción conocida recibe una genérica, no queda en blanco', () => {
    const [action] = deliveryActions([cause({ causeCode: 'codigo-que-no-existe' })]);
    expect(action.action).toBeTruthy();
  });

  it('cuando alcanza a todo el formato lo explica como proceso roto', () => {
    const [action] = deliveryActions([cause({ wholeFormat: true, affected: 40, formatTotal: 40 })]);
    expect(action.why).toContain('proceso de publicación roto');
  });
});

describe('contentActions', () => {
  it('cuenta archivos afectados y adjunta la corrección', () => {
    const [action] = contentActions(reportWithIssue('encabezado-vacio', 5));
    expect(action.family).toBe('contenido');
    expect(action.affected).toBe(5);
    expect(action.action).toContain('Poner nombre');
  });

  /**
   * Las celdas opcionales vacías son ~1,2 millones repartidas por el catálogo.
   * Como tarea ahogarían la lista entera, así que solo salen en la ficha.
   */
  it('las celdas vacías no generan tarea', () => {
    expect(contentActions(reportWithIssue('celda-faltante', 900))).toEqual([]);
  });

  it('sin informe no hay tareas de contenido', () => {
    expect(contentActions(null)).toEqual([]);
  });
});

describe('metadataActions', () => {
  it('cuenta conjuntos de datos, no archivos', () => {
    const [action] = metadataActions(datasetsMissing('sin-descripcion', 3));
    expect(action.unit).toBe('conjuntos de datos');
    expect(action.affected).toBe(3);
  });

  /**
   * Las recomendaciones DCAT-AP no penalizan y les faltan a 824 de 824, así que
   * encabezarían las prioridades por volumen sin ser lo más urgente.
   */
  it('las recomendaciones DCAT-AP quedan fuera de la lista de tareas', () => {
    expect(metadataActions(datasetsMissing('sin-identificador', 800))).toEqual([]);
    expect(metadataActions(datasetsMissing('sin-punto-contacto', 800))).toEqual([]);
  });
});

describe('buildRepairActions: orden', () => {
  it('un fallo que alcanza a todo un formato encabeza, aunque afecte a menos', () => {
    const actions = buildRepairActions({
      causes: [
        cause({ key: 'CSV:descarga', affected: 200, wholeFormat: false }),
        cause({ key: 'KML:zip-invalido', format: 'KML', causeCode: 'zip-invalido', affected: 4, formatTotal: 4, wholeFormat: true }),
      ],
      report: null,
      datasets: [],
    });
    expect(actions[0].format).toBe('KML');
  });

  /**
   * El fallo que corrige este orden: `affected` se comparaba entre unidades
   * distintas, así que un campo ausente en 749 fichas se colocaba por encima de
   * 180 archivos que no se pueden descargar. Con doce tareas visibles, el
   * publicador veía primero lo menos grave.
   */
  it('lo que no se puede usar va antes que una ficha incompleta, aunque esta afecte a más', () => {
    const actions = buildRepairActions({
      causes: [cause({ affected: 180 })],
      report: null,
      datasets: datasetsMissing('sin-descripcion', 749),
    });
    expect(actions.map((a) => a.family)).toEqual(['entrega', 'metadatos']);
  });

  it('un archivo que no abre va antes que uno que solo necesita limpieza', () => {
    const actions = buildRepairActions({
      causes: [cause({ affected: 2 })],
      report: reportWithIssue('error-tipo', 300),
      datasets: [],
    });
    expect(actions.map((a) => a.family)).toEqual(['entrega', 'contenido']);
  });

  it('dentro de la misma familia sí manda el volumen', () => {
    const actions = buildRepairActions({
      causes: [
        cause({ key: 'CSV:descarga', affected: 5 }),
        cause({ key: 'JSON:json-invalido', format: 'JSON', causeCode: 'json-invalido', affected: 50 }),
      ],
      report: null,
      datasets: [],
    });
    expect(actions.map((a) => a.affected)).toEqual([50, 5]);
  });

  it('sin nada que corregir devuelve una lista vacía', () => {
    expect(buildRepairActions({ causes: [], report: null, datasets: [] })).toEqual([]);
  });
});
