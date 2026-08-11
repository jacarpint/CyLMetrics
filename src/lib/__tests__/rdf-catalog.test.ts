import { describe, it, expect } from 'vitest';
import { computeQuality } from '../rdf-catalog';
import type { DataFormat, License } from '../types';

type ComputeQualityInput = Parameters<typeof computeQuality>[0];

const now = new Date('2025-06-01T00:00:00Z');

const baseInput: ComputeQualityInput = {
  title: 'Presupuesto municipal 2024',
  description: 'Datos del presupuesto del ayuntamiento',
  license: 'CC-BY-4.0' as License,
  publisher: 'http://example.org/org/1',
  issued: '2024-01-01',
  modified: '2024-06-01',
  language: 'es',
  spatial: 'http://example.org/castilla-leon',
  themes: ['http://datos.gob.es/kos/sector-publico/sector/hacienda'],
  keywords: ['presupuesto', 'municipio'],
  periodicityMonths: 12,
  formats: ['CSV', 'JSON'] as DataFormat[],
  now,
};

describe('computeQuality', () => {
  it('returns healthy score for complete dataset', () => {
    const { score, status } = computeQuality(baseInput);
    expect(score).toBeGreaterThanOrEqual(70);
    expect(status).toBe('healthy');
  });

  it('lowers score when description is missing', () => {
    const { score: withDesc } = computeQuality(baseInput);
    const { score: withoutDesc } = computeQuality({ ...baseInput, description: '' });
    expect(withDesc).toBeGreaterThan(withoutDesc);
  });

  it('lowers score when no issued date', () => {
    const { score: withDate } = computeQuality(baseInput);
    const { score: withoutDate } = computeQuality({ ...baseInput, issued: '', modified: '' });
    expect(withDate).toBeGreaterThan(withoutDate);
  });

  it('gives CC-BY-4.0 higher license score than IGCYL-NC', () => {
    const { score: cc } = computeQuality(baseInput);
    const { score: igcyl } = computeQuality({ ...baseInput, license: 'IGCYL-NC' });
    expect(cc).toBeGreaterThan(igcyl);
  });

  it('returns critical status for low-completeness dataset', () => {
    const { status } = computeQuality({
      ...baseInput,
      title: '',
      description: '',
      license: 'Otro' as const,
      publisher: '',
      issued: '',
      modified: '',
      language: '',
      spatial: '',
      themes: [],
      keywords: [],
      formats: [],
    });
    expect(status).toBe('critical');
  });

  it('freshnessSource is modified when modified date exists', () => {
    const { freshnessSource } = computeQuality(baseInput);
    expect(freshnessSource).toBe('modified');
  });

  it('freshnessSource is issued when only issued exists', () => {
    const { freshnessSource } = computeQuality({ ...baseInput, modified: '' });
    expect(freshnessSource).toBe('issued');
  });
});
