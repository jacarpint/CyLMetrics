import { describe, it, expect } from 'vitest';
import {
  COMPLETENESS_GAPS,
  METADATA_GAPS,
  completenessRatio,
  diagnoseFreshness,
  findMetadataGaps,
  type MetadataInput,
} from '../metadata-gaps';
import { computeQuality } from '../rdf-catalog';
import type { DataFormat, License } from '../types';

const now = new Date('2026-08-12T00:00:00Z');

const completo: MetadataInput = {
  title: 'Zonas de baño',
  description: 'Calificación semanal de las zonas de baño',
  license: 'CC-BY-4.0' as License,
  publisher: 'https://datosabiertos.jcyl.es/Organismo/A07002862',
  issued: '2026-06-01',
  modified: '2026-08-01',
  language: 'es',
  spatial: 'http://datos.gob.es/recurso/territorio/CastillaLeon',
  themes: ['http://datos.gob.es/kos/sector-publico/sector/salud'],
  keywords: ['baño', 'agua'],
  periodicityMonths: 1,
  formats: ['CSV', 'JSON'] as DataFormat[],
  identifier: 'urn:jcyl:1285663381041',
  contactPoint: 'mailto:datosabiertos@jcyl.es',
};

describe('findMetadataGaps', () => {
  it('un dataset completo no tiene huecos', () => {
    expect(findMetadataGaps(completo)).toEqual([]);
  });

  it('detecta cada campo de completitud que falta', () => {
    expect(findMetadataGaps({ ...completo, description: '' })).toContain('sin-descripcion');
    expect(findMetadataGaps({ ...completo, keywords: [] })).toContain('sin-palabras-clave');
    expect(findMetadataGaps({ ...completo, themes: [] })).toContain('sin-tematica');
    expect(findMetadataGaps({ ...completo, issued: '' })).toContain('sin-fecha-publicacion');
    expect(findMetadataGaps({ ...completo, spatial: '' })).toContain('sin-cobertura');
    expect(findMetadataGaps({ ...completo, language: '' })).toContain('sin-idioma');
    expect(findMetadataGaps({ ...completo, publisher: '' })).toContain('sin-organismo');
    expect(findMetadataGaps({ ...completo, title: '' })).toContain('sin-titulo');
  });

  // Una licencia sin URI reconocible cae en `Otro` al mapearla.
  it('distingue licencia no identificable de licencia restrictiva', () => {
    expect(findMetadataGaps({ ...completo, license: 'Otro' })).toContain('sin-licencia-identificada');
    const restrictiva = findMetadataGaps({ ...completo, license: 'IGCYL-NC' });
    expect(restrictiva).toContain('licencia-restrictiva');
    expect(restrictiva).not.toContain('sin-licencia-identificada');
  });

  // El hueco mayoritario del catálogo: 749 de 824 datasets.
  it('detecta la falta de dct:modified y de periodicidad', () => {
    expect(findMetadataGaps({ ...completo, modified: undefined })).toContain('sin-fecha-actualizacion');
    expect(findMetadataGaps({ ...completo, periodicityMonths: undefined })).toContain('sin-periodicidad');
    expect(findMetadataGaps({ ...completo, periodicityMonths: 0 })).toContain('sin-periodicidad');
  });

  it('marca la ausencia de formato abierto solo si hay distribuciones', () => {
    expect(findMetadataGaps({ ...completo, formats: ['ECW', 'JPEG'] as DataFormat[] })).toContain('sin-formato-abierto');
    expect(findMetadataGaps({ ...completo, formats: ['GeoJSON'] as DataFormat[] })).not.toContain('sin-formato-abierto');
    // Sin ninguna distribución no se puede reprochar el formato.
    expect(findMetadataGaps({ ...completo, formats: [] })).not.toContain('sin-formato-abierto');
  });

  it('recoge las recomendaciones DCAT-AP que el catálogo no publica', () => {
    const gaps = findMetadataGaps({ ...completo, identifier: undefined, contactPoint: undefined });
    expect(gaps).toContain('sin-identificador');
    expect(gaps).toContain('sin-punto-contacto');
    // Y no son de completitud: no pueden bajar el score.
    expect(METADATA_GAPS['sin-identificador'].axis).toBe('recomendacion');
    expect(METADATA_GAPS['sin-punto-contacto'].axis).toBe('recomendacion');
  });

  it('todo código declarado tiene etiqueta, porqué, acción y campo DCAT', () => {
    for (const [code, info] of Object.entries(METADATA_GAPS)) {
      expect(info.label, code).toBeTruthy();
      expect(info.why, code).toBeTruthy();
      expect(info.action, code).toBeTruthy();
      expect(info.field, code).toMatch(/^(dct|dcat):/);
    }
  });
});

describe('completenessRatio', () => {
  it('solo cuentan los huecos de completitud', () => {
    expect(completenessRatio([])).toBe(1);
    // Un hueco que no es de completitud no baja el ratio.
    expect(completenessRatio(['sin-identificador', 'licencia-restrictiva'])).toBe(1);
    expect(completenessRatio(['sin-descripcion'])).toBeCloseTo(8 / 9, 5);
  });

  it('los nueve códigos de completitud son de eje completitud', () => {
    for (const code of COMPLETENESS_GAPS) {
      expect(METADATA_GAPS[code].axis, code).toBe('completitud');
    }
    expect(COMPLETENESS_GAPS).toHaveLength(9);
  });
});

/**
 * La decisión fue explícita: reenfocar la presentación SIN mover ninguna cifra.
 * Estos casos fijan que derivar la completitud de `findMetadataGaps` da el mismo
 * resultado que la lista de comprobaciones que había antes en `computeQuality`.
 */
describe('el score no se mueve al derivar la completitud de los huecos', () => {
  /** Réplica literal de la lista de campos anterior. */
  function completitudAnterior(d: MetadataInput): number {
    const fields = [
      !!d.title,
      !!d.description,
      d.license !== 'Otro',
      !!d.publisher,
      !!d.issued,
      !!d.language,
      !!d.spatial,
      d.themes.length > 0,
      d.keywords.length > 0,
    ];
    return (fields.filter(Boolean).length / fields.length) * 100;
  }

  const casos: MetadataInput[] = [
    completo,
    { ...completo, description: '' },
    { ...completo, keywords: [], themes: [] },
    { ...completo, license: 'Otro' as License },
    { ...completo, license: 'IGCYL-NC' as License },
    { ...completo, issued: '', modified: undefined },
    { ...completo, language: '', spatial: '', publisher: '' },
    { ...completo, title: '', description: '', keywords: [] },
    { ...completo, identifier: undefined, contactPoint: undefined },
    { ...completo, formats: ['ECW'] as DataFormat[] },
  ];

  it.each(casos.map((c, i) => [i, c] as const))('caso %i: misma completitud', (_i, caso) => {
    const { breakdown } = computeQuality({ ...caso, now });
    expect(breakdown.completeness).toBeCloseTo(completitudAnterior(caso), 10);
  });
});

describe('diagnoseFreshness', () => {
  it('al día cuando no ha pasado ni un periodo', () => {
    const r = diagnoseFreshness({ issued: '2026-07-20', modified: '2026-08-01', periodicityMonths: 1, now });
    expect(r.diagnosis).toBe('al-dia');
    expect(r.reference).toBe('modified');
  });

  it('vencido cuando publica modified y ha pasado más de un periodo', () => {
    const r = diagnoseFreshness({ issued: '2020-01-01', modified: '2026-01-01', periodicityMonths: 1, now });
    expect(r.diagnosis).toBe('vencido');
    expect(r.reference).toBe('modified');
    expect(r.periodsLate).toBeGreaterThan(6);
  });

  /**
   * El caso que estaba confundido y que afecta a 670 datasets: sin
   * `dct:modified` se mide desde la fecha de PUBLICACIÓN, que no dice nada de la
   * última actualización. El retraso es aparente, no demostrado.
   */
  it('no verificable cuando el retraso se mide desde la fecha de publicación', () => {
    const r = diagnoseFreshness({ issued: '2011-01-01', periodicityMonths: 1, now });
    expect(r.diagnosis).toBe('no-verificable');
    expect(r.reference).toBe('issued');
    expect(r.periodsLate).toBeGreaterThan(100);
  });

  it('sin periodicidad no se puede juzgar el retraso', () => {
    const r = diagnoseFreshness({ issued: '2011-01-01', now });
    expect(r.diagnosis).toBe('sin-periodicidad');
    expect(r.periodsLate).toBeNull();
  });

  it('sin ninguna fecha no hay nada que medir', () => {
    const r = diagnoseFreshness({ issued: '', periodicityMonths: 12, now });
    expect(r.diagnosis).toBe('sin-fecha');
    expect(r.reference).toBe('none');
  });

  it('una fecha ilegible se trata como ausente', () => {
    expect(diagnoseFreshness({ issued: 'no es fecha', periodicityMonths: 1, now }).diagnosis).toBe('sin-fecha');
  });

  it('una fecha futura no produce retraso negativo', () => {
    const r = diagnoseFreshness({ issued: '2027-01-01', modified: '2027-01-01', periodicityMonths: 1, now });
    expect(r.periodsLate).toBe(0);
    expect(r.diagnosis).toBe('al-dia');
  });
});
