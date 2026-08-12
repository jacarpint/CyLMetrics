import { describe, it, expect } from 'vitest';
import { mapLicense } from '@/lib/rdf-catalog';

describe('mapLicense tolera las variantes de URI', () => {
  it('reconoce la licencia IGCYL en cualquier forma', () => {
    for (const v of [
      { '@_resource': 'https://www.jcyl.es/licencia-IGCYL-NC' },
      { '@_resource': 'http://www.jcyl.es/licencia-IGCYL-NC' },
      { '@_resource': 'https://www.jcyl.es/licencia-IGCYL-NC/' },
      { '@_resource': 'https://jcyl.es/web/licencia-igcyl-nc' },
      { '#text': 'https://www.jcyl.es/licencia-IGCYL-NC' },
    ]) {
      expect(mapLicense(v), JSON.stringify(v)).toBe('IGCYL-NC');
    }
  });

  it('reconoce CC-BY 4.0 en cualquier forma', () => {
    for (const v of [
      { '@_resource': 'https://creativecommons.org/licenses/by/4.0/deed.es_ES' },
      { '@_resource': 'https://creativecommons.org/licenses/by/4.0/' },
      { '@_resource': 'http://creativecommons.org/licenses/by/4.0/deed.es' },
      { '#text': 'https://creativecommons.org/licenses/by/4.0/deed.es_ES' },
    ]) {
      expect(mapLicense(v), JSON.stringify(v)).toBe('CC-BY-4.0');
    }
  });

  it('no confunde BY con BY-SA', () => {
    expect(mapLicense({ '@_resource': 'https://creativecommons.org/licenses/by-sa/4.0/' })).toBe('CC-BY-SA-4.0');
  });

  it('sin licencia o desconocida da Otro', () => {
    expect(mapLicense(undefined)).toBe('Otro');
    expect(mapLicense({})).toBe('Otro');
    expect(mapLicense({ '@_resource': '' })).toBe('Otro');
    expect(mapLicense({ '@_resource': 'https://example.org/mi-licencia' })).toBe('Otro');
  });
});
