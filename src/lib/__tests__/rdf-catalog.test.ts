import { describe, it, expect } from 'vitest';
import { computeQuality, parseCatalog } from '../rdf-catalog';
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

/**
 * El catálogo real, el 15 de septiembre de 2026, traía un dataset («Estadísticas
 * del impuesto sobre sucesiones y donaciones») cuya `dct:description` incluía un
 * `<ol>` de una lista pegado como texto plano, sin escapar y sin su `</ol>` de
 * cierre. El parser no distingue eso de una etiqueta XML real: la da por
 * abierta, y todo lo que sigue —licencia, tema, distribuciones— acaba colgando
 * de `description` en vez de ser hermano suyo, así que el dataset se queda sin
 * formatos y con la licencia sin identificar aunque el RDF sí la declare.
 */
describe('parseCatalog: descripciones con HTML suelto sin escapar', () => {
  const xmlWithStrayOl = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dcat="http://www.w3.org/ns/dcat#"
         xmlns:dct="http://purl.org/dc/terms/">
  <dcat:Catalog>
    <dcat:dataset>
      <dcat:Dataset rdf:about="https://datosabiertos.jcyl.es/set/es/x/1">
        <dct:title>Dataset con lista suelta</dct:title>
        <dct:description>Texto inicial.
<ol start="1" style="list-style-type: lower-alpha;">
	primer punto
	segundo punto
Texto final sin cerrar la lista.</dct:description>
        <dct:license rdf:resource="https://creativecommons.org/licenses/by/4.0/deed.es_ES"/>
        <dct:issued>2024-01-01</dct:issued>
        <dcat:distribution>
          <dcat:Distribution>
            <dct:format><dct:IMT rdf:value="text/csv"/></dct:format>
            <dcat:accessURL>https://datosabiertos.jcyl.es/x/1.csv</dcat:accessURL>
          </dcat:Distribution>
        </dcat:distribution>
      </dcat:Dataset>
    </dcat:dataset>
  </dcat:Catalog>
</rdf:RDF>`;

  it('reconoce la licencia y las distribuciones aunque la descripción traiga HTML sin cerrar', () => {
    const { datasets } = parseCatalog(xmlWithStrayOl, 'https://example.org', new Date().toISOString());

    expect(datasets).toHaveLength(1);
    expect(datasets[0].license).toBe('CC-BY-4.0');
    expect(datasets[0].formats).toEqual(['CSV']);
  });
});
