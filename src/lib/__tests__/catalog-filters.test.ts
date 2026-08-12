import { describe, it, expect } from 'vitest';
import {
  applyFilters, sortDatasets, buildFilterUrl, DEFAULT_SORT, DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE, parseActiveFilters,
} from '../catalog-filters';
import type { ActiveFilters } from '../catalog-filters';
import type { Dataset } from '../types';

function makeDataset(overrides: Partial<Dataset> & { id: string }): Dataset {
  return {
    id: overrides.id,
    title: overrides.title ?? 'Test Dataset',
    description: overrides.description ?? '',
    qualityScore: overrides.qualityScore ?? 75,
    status: overrides.status ?? 'warning',
    formats: overrides.formats ?? ['CSV'],
    category: overrides.category ?? 'Otros',
    license: overrides.license ?? 'CC-BY-4.0',
    lastUpdated: overrides.lastUpdated ?? '2024-01-01',
    updatedAgo: '—',
    freshnessSource: 'issued',
    statusLabel: '—',
    publisher: overrides.publisher ?? 'http://example.org/1',
    records: 0,
    distributionUrls: [],
    metadataGaps: overrides.metadataGaps ?? [],
    freshness: overrides.freshness ?? { diagnosis: 'al-dia', periodsLate: 0, reference: 'issued' },
  };
}

const baseFilters: ActiveFilters = {
  categorias: [],
  formatos: [],
  licencias: [],
  q: undefined,
  desde: undefined,
  hasta: undefined,
  page: 1,
  limit: 24,
  sort: DEFAULT_SORT,
};

const datasets = [
  makeDataset({ id: 'https://example.org/1', title: 'Alpha CSV', formats: ['CSV'], category: 'Salud', qualityScore: 90 }),
  makeDataset({ id: 'https://example.org/2', title: 'Beta JSON', formats: ['JSON'], category: 'Economía', qualityScore: 60 }),
  makeDataset({ id: 'https://example.org/3', title: 'Gamma CSV', formats: ['CSV', 'JSON'], category: 'Salud', qualityScore: 30, lastUpdated: '2020-01-01' }),
];

describe('applyFilters', () => {
  it('returns all datasets with empty filters', () => {
    expect(applyFilters(datasets, baseFilters)).toHaveLength(3);
  });

  it('filters by category', () => {
    const result = applyFilters(datasets, { ...baseFilters, categorias: ['Salud'] });
    expect(result).toHaveLength(2);
    result.forEach((d) => expect(d.category).toBe('Salud'));
  });

  it('filters by format', () => {
    const result = applyFilters(datasets, { ...baseFilters, formatos: ['JSON'] });
    expect(result).toHaveLength(2);
  });

  it('filters by text query', () => {
    const result = applyFilters(datasets, { ...baseFilters, q: 'Alpha' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Alpha CSV');
  });

  it('filters by desde date', () => {
    const result = applyFilters(datasets, { ...baseFilters, desde: '2023-01-01' });
    expect(result).toHaveLength(2);
  });

  it('filters by analisis status when analysisBySlug is provided', () => {
    const analysisBySlug = {
      '1': { status: 'ok', score: 90, distributions: 1, analyzed: 1, failed: 0, skipped: 0, coverage_pct: 100, issues_by_code: {}, dataset_index: 0, dataset_title: '', max_rows: null, max_cols: null, error_issues: 0, warning_issues: 0, availability_pct: 100, format_states: {} },
      '2': { status: 'error', score: 30, distributions: 1, analyzed: 0, failed: 1, skipped: 0, coverage_pct: 0, issues_by_code: {}, dataset_index: 1, dataset_title: '', max_rows: null, max_cols: null, error_issues: 1, warning_issues: 0, availability_pct: 0, format_states: {} },
    } as const;
    const result = applyFilters(datasets, { ...baseFilters, analisis: 'ok' }, analysisBySlug);
    expect(result).toHaveLength(1);
    expect(result[0].id).toContain('1');
  });
});

describe('sortDatasets', () => {
  it('sorts by quality desc (default)', () => {
    const sorted = sortDatasets(datasets, 'quality-desc');
    expect(sorted[0].qualityScore).toBe(90);
    expect(sorted[2].qualityScore).toBe(30);
  });

  it('sorts by quality asc', () => {
    const sorted = sortDatasets(datasets, 'quality-asc');
    expect(sorted[0].qualityScore).toBe(30);
  });

  it('sorts by title asc', () => {
    const sorted = sortDatasets(datasets, 'title-asc');
    expect(sorted[0].title).toBe('Alpha CSV');
    expect(sorted[2].title).toBe('Gamma CSV');
  });

  it('sorts by date desc', () => {
    const sorted = sortDatasets(datasets, 'date-desc');
    expect(sorted[0].lastUpdated).toBe('2024-01-01');
    expect(sorted[2].lastUpdated).toBe('2020-01-01');
  });

  it('sorts by date asc', () => {
    const sorted = sortDatasets(datasets, 'date-asc');
    expect(sorted[0].lastUpdated).toBe('2020-01-01');
  });
});

describe('buildFilterUrl', () => {
  it('returns /catalogo with empty filters', () => {
    expect(buildFilterUrl(baseFilters)).toBe('/catalogo');
  });

  // El catálogo ordena por fecha de publicación descendente si no se pide otra
  // cosa: solo se serializa el orden cuando difiere de ese.
  it('omite el orden por defecto y serializa el resto', () => {
    expect(DEFAULT_SORT).toBe('date-desc');
    expect(parseActiveFilters({}).sort).toBe(DEFAULT_SORT);
    expect(buildFilterUrl({ ...baseFilters, sort: 'quality-desc' })).toBe('/catalogo?sort=quality-desc');
  });

  it('includes category param', () => {
    const url = buildFilterUrl({ ...baseFilters, categorias: ['Salud'] });
    expect(url).toContain('categorias=Salud');
  });

  it('includes text query param', () => {
    const url = buildFilterUrl({ ...baseFilters, q: 'agua' });
    expect(url).toContain('q=agua');
  });

  it('omits default page and limit', () => {
    const url = buildFilterUrl({ ...baseFilters, page: 1, limit: 24 });
    expect(url).not.toContain('page=');
    expect(url).not.toContain('limit=');
  });

  it('includes non-default page', () => {
    const url = buildFilterUrl({ ...baseFilters, page: 3 });
    expect(url).toContain('page=3');
  });

  it('includes analisis filter', () => {
    const url = buildFilterUrl({ ...baseFilters, analisis: 'error' });
    expect(url).toContain('analisis=error');
  });

  it('no repite el parámetro de análisis', () => {
    const url = buildFilterUrl({ ...baseFilters, analisis: 'error' });
    expect(url.match(/analisis=/g)).toHaveLength(1);
  });
});

describe('parseActiveFilters: validación de parámetros', () => {
  it('descarta un orden desconocido en vez de dejar la lista sin ordenar', () => {
    // `sortDatasets` caía en su `default:` y devolvía el array tal cual, y el
    // `<select>` de la interfaz se quedaba sin ninguna opción seleccionada.
    expect(parseActiveFilters({ sort: 'loquesea' }).sort).toBe(DEFAULT_SORT);
    expect(parseActiveFilters({ sort: 'title-asc' }).sort).toBe('title-asc');
  });

  it('descarta un estado de análisis desconocido', () => {
    expect(parseActiveFilters({ analisis: 'inventado' }).analisis).toBeUndefined();
    expect(parseActiveFilters({ analisis: 'parcial' }).analisis).toBe('parcial');
  });

  describe('tamaño de página', () => {
    it('en la interfaz solo admite los valores del desplegable', () => {
      expect(parseActiveFilters({ limit: '48' }).limit).toBe(48);
      expect(parseActiveFilters({ limit: '7' }).limit).toBe(DEFAULT_PAGE_SIZE);
    });

    // La API documenta `?limit=`: pedir 1 tiene que devolver 1, no 24.
    it('en la API admite cualquier valor y lo acota', () => {
      expect(parseActiveFilters({ limit: '1' }, false).limit).toBe(1);
      expect(parseActiveFilters({ limit: '75' }, false).limit).toBe(75);
      expect(parseActiveFilters({ limit: '99999' }, false).limit).toBe(MAX_PAGE_SIZE);
      expect(parseActiveFilters({ limit: '0' }, false).limit).toBe(DEFAULT_PAGE_SIZE);
      expect(parseActiveFilters({ limit: '-5' }, false).limit).toBe(1);
    });
  });
});
