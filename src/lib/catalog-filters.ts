/**
 * Filtros del catálogo compartidos entre la Sidebar y la página de catálogo.
 *
 * Los filtros viven en la URL (`/catalogo?categorias=...&formatos=...&licencias=...`),
 * de modo que la Sidebar, los chips del catálogo y la página servidor comparten
 * el mismo estado de forma natural (deep-linkable y reproducible).
 *
 * Sin imports de servidor: puede usarse tanto en Server Components como en
 * componentes cliente.
 */

import type { Category, DataFormat, Dataset, License } from '@/lib/types';
import type { QualityDatasetLite } from '@/lib/quality-report';
import { isGeoFormat } from '@/lib/geo';

export const DEFAULT_PAGE_SIZE = 24;
export const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;
export type PageSort = 'quality-desc' | 'quality-asc' | 'title-asc' | 'date-desc' | 'date-asc';

/**
 * Modos de exploración del catálogo. `ficheros` lista las distribuciones que
 * no se pueden usar, heredando los mismos filtros que las otras dos vistas.
 */
export type CatalogVista = 'tarjetas' | 'mapa' | 'ficheros';

export function parseVista(raw: string | undefined): CatalogVista {
  return raw === 'mapa' || raw === 'ficheros' ? raw : 'tarjetas';
}

/** Añade `vista` a una URL de catálogo ya construida (tarjetas es el defecto). */
export function withVista(url: string, vista: CatalogVista): string {
  if (vista === 'tarjetas') return url;
  return `${url}${url.includes('?') ? '&' : '?'}vista=${vista}`;
}

export const SORT_OPTIONS: { value: PageSort; label: string }[] = [
  { value: 'quality-desc', label: 'Calidad (mayor)' },
  { value: 'quality-asc', label: 'Calidad (menor)' },
  { value: 'title-asc', label: 'Título (A-Z)' },
  { value: 'date-desc', label: 'Más reciente' },
  { value: 'date-asc', label: 'Más antiguo' },
];

export interface ActiveFilters {
  categorias: Category[];
  formatos: DataFormat[];
  licencias: License[];
  /** Fecha mínima de publicación (dct:issued), formato YYYY-MM-DD. */
  desde?: string;
  /** Fecha máxima de publicación (dct:issued), formato YYYY-MM-DD. */
  hasta?: string;
  /** Búsqueda de texto libre sobre título, descripción, editor y palabras clave. */
  q?: string;
  /** Página actual (1-indexed). */
  page: number;
  /** Elementos por página. */
  limit: number;
  /** Ordenación. */
  sort: PageSort;
  /** Filtro por estado del análisis de contenido. */
  analisis?: 'ok' | 'parcial' | 'error' | 'sin-datos';
  /** Preset: solo datasets con alguna distribución geoespacial. */
  geo?: boolean;
}

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

function splitList(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/** Interpreta los searchParams de la página como filtros activos. */
export function parseActiveFilters(params: SearchParams): ActiveFilters {
  const page = Math.max(1, parseInt(readParam(params, 'page') ?? '1', 10) || 1);
  const limitRaw = parseInt(readParam(params, 'limit') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const limit = PAGE_SIZE_OPTIONS.includes(limitRaw as typeof PAGE_SIZE_OPTIONS[number])
    ? limitRaw
    : DEFAULT_PAGE_SIZE;
  const sort = (readParam(params, 'sort') as PageSort) || 'quality-desc';

  return {
    categorias: splitList(readParam(params, 'categorias')) as Category[],
    formatos: splitList(readParam(params, 'formatos')) as DataFormat[],
    licencias: splitList(readParam(params, 'licencias')) as License[],
    desde: readParam(params, 'desde') || undefined,
    hasta: readParam(params, 'hasta') || undefined,
    q: readParam(params, 'q')?.trim() || undefined,
    page,
    limit,
    sort,
    analisis: (readParam(params, 'analisis') as ActiveFilters['analisis']) || undefined,
    geo: readParam(params, 'geo') === '1' || undefined,
  };
}

export function filtersAreActive(f: ActiveFilters): boolean {
  return (
    f.categorias.length > 0 ||
    f.formatos.length > 0 ||
    f.licencias.length > 0 ||
    Boolean(f.desde) ||
    Boolean(f.hasta) ||
    Boolean(f.q) ||
    Boolean(f.analisis) ||
    Boolean(f.geo)
  );
}

/** Aplica los filtros sobre el catálogo completo (los valores no incluidos no filtran). */
export function applyFilters(
  datasets: Dataset[],
  f: ActiveFilters,
  analysisBySlug?: Record<string, QualityDatasetLite>
): Dataset[] {
  return datasets.filter((ds) => {
    if (f.geo && !ds.formats.some((fmt) => isGeoFormat(fmt))) return false;
    if (f.categorias.length > 0 && !f.categorias.includes(ds.category)) return false;
    if (f.formatos.length > 0 && !ds.formats.some((fmt) => f.formatos.includes(fmt))) return false;
    if (f.licencias.length > 0 && !f.licencias.includes(ds.license)) return false;
    const day = ds.lastUpdated.slice(0, 10);
    if (f.desde && day < f.desde) return false;
    if (f.hasta && day > f.hasta) return false;
    if (f.q) {
      const needle = f.q.toLowerCase();
      const haystack = [ds.title, ds.description, ds.publisher, ...(ds.keywords ?? [])]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (f.analisis && analysisBySlug) {
      const slug = ds.id.replace(/\/+$/, '').match(/(\d+)$/)?.[1] ?? encodeURIComponent(ds.id);
      const lit = analysisBySlug[slug];
      if (!lit || lit.status !== f.analisis) return false;
    }
    return true;
  });
}

/** Ordena datasets según el criterio seleccionado. */
export function sortDatasets(datasets: Dataset[], sort: PageSort): Dataset[] {
  const sorted = [...datasets];
  switch (sort) {
    case 'quality-desc':
      return sorted.sort((a, b) => b.qualityScore - a.qualityScore);
    case 'quality-asc':
      return sorted.sort((a, b) => a.qualityScore - b.qualityScore);
    case 'title-asc':
      return sorted.sort((a, b) => a.title.localeCompare(b.title, 'es'));
    case 'date-desc':
      return sorted.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
    case 'date-asc':
      return sorted.sort((a, b) => a.lastUpdated.localeCompare(b.lastUpdated));
    default:
      return sorted;
  }
}

/** Construye la URL del catálogo a partir de los filtros (los vacíos se omiten). */
export function buildFilterUrl(f: ActiveFilters, base = '/catalogo'): string {
  const params = new URLSearchParams();
  if (f.categorias.length > 0) params.set('categorias', f.categorias.join(','));
  if (f.formatos.length > 0) params.set('formatos', f.formatos.join(','));
  if (f.licencias.length > 0) params.set('licencias', f.licencias.join(','));
  if (f.desde) params.set('desde', f.desde);
  if (f.hasta) params.set('hasta', f.hasta);
  if (f.q) params.set('q', f.q);
  if (f.analisis) params.set('analisis', f.analisis);
  if (f.geo) params.set('geo', '1');
  if (f.page > 1) params.set('page', String(f.page));
  if (f.limit !== DEFAULT_PAGE_SIZE) params.set('limit', String(f.limit));
  if (f.sort !== 'quality-desc') params.set('sort', f.sort);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Descripciones cortas para las licencias reales del catálogo. */
export const LICENSE_DESCRIPTIONS: Record<string, string> = {
  'CC-BY-4.0': 'Creative Commons Atribución 4.0',
  'IGCYL-NC': 'Licencia jcyl — uso no comercial',
};
