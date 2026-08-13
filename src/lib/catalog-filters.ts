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
import { compositeScore } from '@/lib/quality';
import { datasetSlug } from '@/lib/utils';

export const DEFAULT_PAGE_SIZE = 24;
/** Tamaños que ofrece el desplegable de la interfaz. */
export const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;
/** Tope de la API: la interfaz solo usa PAGE_SIZE_OPTIONS, pero un cliente puede pedir más. */
export const MAX_PAGE_SIZE = 200;
export type PageSort = 'quality-desc' | 'quality-asc' | 'title-asc' | 'date-desc' | 'date-asc';

/**
 * Orden por defecto: lo más reciente primero.
 *
 * No por calidad: eso deja arriba siempre los mismos conjuntos y esconde las
 * publicaciones nuevas, que es lo que la mayoría viene a ver.
 */
export const DEFAULT_SORT: PageSort = 'date-desc';

export const SORT_OPTIONS: { value: PageSort; label: string }[] = [
  { value: 'date-desc', label: 'Más recientes primero' },
  { value: 'date-asc', label: 'Más antiguos primero' },
  { value: 'quality-desc', label: 'Mayor calidad' },
  { value: 'quality-asc', label: 'Menor calidad' },
  { value: 'title-asc', label: 'Título (A–Z)' },
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

const SORT_VALUES = new Set<string>([
  'quality-desc', 'quality-asc', 'title-asc', 'date-desc', 'date-asc',
]);
const ANALYSIS_VALUES = new Set<string>(['ok', 'parcial', 'error', 'sin-datos']);

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

/**
 * Interpreta los searchParams de la página como filtros activos.
 *
 * `strictPageSize` es lo que distingue la interfaz de la API. En la interfaz el
 * tamaño de página tiene que ser uno de los del desplegable, o el `<select>` se
 * queda en blanco. La API, en cambio, es un endpoint documentado con `?limit=`:
 * ahí vale cualquier valor razonable, acotado a `MAX_PAGE_SIZE`. Con la regla
 * estricta aplicada a las dos, `/api/catalog?limit=1` respondía en silencio con
 * 24 elementos.
 */
export function parseActiveFilters(params: SearchParams, strictPageSize = true): ActiveFilters {
  const page = Math.max(1, parseInt(readParam(params, 'page') ?? '1', 10) || 1);
  const limitRaw = parseInt(readParam(params, 'limit') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const limit = strictPageSize
    ? PAGE_SIZE_OPTIONS.includes(limitRaw as typeof PAGE_SIZE_OPTIONS[number])
      ? limitRaw
      : DEFAULT_PAGE_SIZE
    : Math.min(Math.max(limitRaw, 1), MAX_PAGE_SIZE);

  // Un `sort` desconocido tiene que caer al valor por defecto aquí: `sortDatasets`
  // ya no tiene rama para lo inesperado, y un valor libre dejaría además el
  // `<select>` de la interfaz sin ninguna opción seleccionada.
  const sortRaw = readParam(params, 'sort');
  const sort = sortRaw && SORT_VALUES.has(sortRaw) ? (sortRaw as PageSort) : DEFAULT_SORT;

  const analisisRaw = readParam(params, 'analisis');
  const analisis = analisisRaw && ANALYSIS_VALUES.has(analisisRaw)
    ? (analisisRaw as ActiveFilters['analisis'])
    : undefined;

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
    analisis,
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
      const lit = analysisBySlug[datasetSlug(ds.id)];
      if (f.analisis === 'sin-datos') {
        // «Sin analizar» incluye los datasets que no salen en el informe.
        if (lit && lit.status !== 'sin-datos') return false;
      } else if (!lit || lit.status !== f.analisis) {
        return false;
      }
    }
    return true;
  });
}

/**
 * El índice de calidad que la interfaz ENSEÑA para un conjunto de datos.
 *
 * `ds.qualityScore` es solo el eje de metadatos. La tarjeta del catálogo y la API
 * publican el compuesto, que además incluye si los archivos abren y cómo está su
 * contenido. Ordenar por uno mientras se muestra el otro dejaba «Mayor calidad»
 * devolviendo tarjetas con números en aparente desorden —lo peor que puede pasar
 * en un portal cuya materia es precisamente la calidad—.
 */
export function displayedScore(
  ds: Dataset,
  analysisBySlug?: Record<string, QualityDatasetLite>
): number | null {
  const lite = analysisBySlug?.[datasetSlug(ds.id)];
  return compositeScore({
    metadata: ds.qualityScore,
    availability: lite?.availability_pct ?? null,
    content: lite?.score ?? null,
  });
}

/**
 * Fecha con la que se ordena por antigüedad.
 *
 * La misma que decide el texto «Actualizado / Publicado hace…» de la tarjeta:
 * `dct:modified` si el conjunto la declara y, si no, `dct:issued`. Ordenar solo
 * por `issued` colocaba un conjunto refrescado ayer entre los de 2011 porque se
 * publicó entonces, contradiciendo su propia etiqueta.
 */
function sortableDate(ds: Dataset): string {
  return ds.modified ?? ds.lastUpdated;
}

/** Los que no tienen puntuación van al final en los dos sentidos. */
function compareNullableScores(a: number | null, b: number | null, descending: boolean): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return descending ? b - a : a - b;
}

/**
 * Ordena los conjuntos de datos según el criterio seleccionado.
 *
 * `analysisBySlug` hace falta para los criterios de calidad: sin él no se puede
 * componer el índice que se muestra, y el orden cae al eje de metadatos.
 */
export function sortDatasets(
  datasets: Dataset[],
  sort: PageSort,
  analysisBySlug?: Record<string, QualityDatasetLite>
): Dataset[] {
  const sorted = [...datasets];
  switch (sort) {
    case 'quality-desc':
    case 'quality-asc': {
      // El índice se calcula una vez por conjunto: dentro del comparador se
      // recalcularía O(n log n) veces.
      const scores = new Map(sorted.map((ds) => [ds.id, displayedScore(ds, analysisBySlug)]));
      const descending = sort === 'quality-desc';
      return sorted.sort(
        (a, b) =>
          compareNullableScores(scores.get(a.id) ?? null, scores.get(b.id) ?? null, descending) ||
          a.title.localeCompare(b.title, 'es')
      );
    }
    case 'title-asc':
      return sorted.sort((a, b) => a.title.localeCompare(b.title, 'es'));
    case 'date-desc':
      return sorted.sort((a, b) => sortableDate(b).localeCompare(sortableDate(a)));
    case 'date-asc':
      return sorted.sort((a, b) => sortableDate(a).localeCompare(sortableDate(b)));
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
  if (f.sort !== DEFAULT_SORT) params.set('sort', f.sort);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Estado de los archivos de un conjunto de datos, con UNA sola redacción.
 *
 * Es la etiqueta de `?analisis=`, y aparece a la vez en el panel de filtros, en
 * el chip del filtro activo y en los enlaces de la portada. Cada sitio con su
 * propia redacción daba tres nombres distintos al mismo filtro en una sola
 * pantalla, así que todos leen de aquí.
 */
export type AnalysisState = NonNullable<ActiveFilters['analisis']>;

export const ANALYSIS_LABELS: Record<AnalysisState, string> = {
  ok: 'Todos los archivos abren',
  parcial: 'Algunos archivos no abren',
  error: 'Ningún archivo abre',
  'sin-datos': 'Sin analizar',
};

/** Descripciones cortas para las licencias reales del catálogo. */
export const LICENSE_DESCRIPTIONS: Record<string, string> = {
  'CC-BY-4.0': 'Creative Commons Atribución 4.0',
  'IGCYL-NC': 'Licencia jcyl — uso no comercial',
};
