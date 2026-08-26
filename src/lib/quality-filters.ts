/**
 * Filtros de la pestaña Calidad, en la URL.
 *
 * `/catalogo` ya tenía el viaje completo de ida y vuelta (`catalog-filters.ts`) y
 * `/calidad` no: sus filtros vivían en `useState` sembrado una sola vez desde el
 * servidor, y de ahí salían tres fallos distintos.
 *
 * 1. Lo que no era `familia` ni `causa` no se podía enlazar. Una tarjeta que dice
 *    «Error de descarga · GML — 32 de 32 archivos GML» enlazaba a
 *    `?vista=ficheros&causa=descarga`, que son los 179 errores de descarga del
 *    catálogo entero, de todos los formatos. La tarjeta prometía 32 archivos y la
 *    tabla enseñaba 179, y como la tira de chips tampoco mencionaba GML, la
 *    discrepancia no se veía.
 * 2. Al ser solo la semilla de un `useState`, navegar de una tarjeta a otra sin
 *    recargar dejaba el filtro anterior puesto.
 * 3. Una vista filtrada no se podía compartir ni sobrevivía a recargar la página.
 *
 * `familia`, `causa` y `hueco` se conservan con el mismo nombre y el mismo
 * significado: viajan en enlaces ya publicados y en las redirecciones heredadas de
 * `next.config.ts`. Lo demás solo añade.
 *
 * Sin imports de servidor: se usa desde la página (Server Component) y desde la
 * tabla (cliente).
 */

import type { IssueFamily } from './availability';

/** Las tres vistas. Los identificadores viajan en la URL. */
export type Vista = 'prioridades' | 'ficheros' | 'metadatos';

/**
 * Las etiquetas dicen qué se va a ver; los `id` NO cambian nunca.
 *
 * «Prioridades», «Archivos» y «Metadatos» nombraban la materia, no la vista, y
 * las tres se confundían: «Archivos» parecía el listado del catálogo entero en
 * vez de solo lo defectuoso, y «Metadatos» no dejaba claro si enseñaba los
 * metadatos o lo que les falta. Los rótulos nuevos son los que el portal ya usa
 * por dentro —«Qué arreglar primero» es el título de esa vista y el botón de la
 * portada, «archivo a archivo» abre el texto de la tabla, «ficha incompleta» es
 * la etiqueta de la tarjeta de metadatos—.
 *
 * Los identificadores viajan en enlaces publicados y en las redirecciones de
 * `next.config.ts`, así que renombrarlos rompería direcciones guardadas.
 */
export const VISTAS: { id: Vista; label: string }[] = [
  { id: 'prioridades', label: 'Qué arreglar primero' },
  { id: 'ficheros', label: 'Archivo por archivo' },
  { id: 'metadatos', label: 'Fichas incompletas' },
];

const VISTA_VALUES = new Set<string>(VISTAS.map((v) => v.id));

/**
 * Vistas que ya no existen.
 *
 * Se mantienen para no romper los enlaces publicados ni las redirecciones de
 * `next.config.ts`, que apuntan a estas vistas.
 *
 * `evolucion` era la serie histórica del catálogo, retirada para que el portal
 * hable solo de la última foto. Su identificador sigue resolviendo a Prioridades
 * en vez de dar un 404: es la que estaba enlazada desde la portada y desde la
 * redirección de `/tendencias`, y quien la tenga guardada merece aterrizar en
 * algo útil.
 */
const LEGACY_VISTAS: Record<string, Vista> = {
  resumen: 'prioridades',
  organismos: 'prioridades',
  reparar: 'ficheros',
  incidencias: 'ficheros',
  evolucion: 'prioridades',
};

export type FamilyFilter = 'todas' | IssueFamily;

export interface QualityFilters {
  vista: Vista;
  /** Dimensión del defecto: no se puede usar, o abre con errores. */
  familia: FamilyFilter;
  /**
   * Códigos de incidencia, en OR.
   *
   * Es una lista y no un valor único porque las consecuencias de la portada
   * agrupan varios códigos que rompen la reutilización por el mismo motivo —un
   * encabezado vacío y uno duplicado estropean igual la carga automática—. Con un
   * solo valor esas tarjetas no se podían enlazar, y de hecho no se enlazaban.
   */
  causas: string[];
  /** Formato del archivo (`GML`, `CSV`…). El que faltaba. */
  formato?: string;
  /** Categoría temática del conjunto de datos. */
  tematica?: string;
  /** Búsqueda libre sobre título, temática, formato y URL. */
  q?: string;
  /** Hueco de metadatos, para la vista de metadatos. */
  hueco?: string;
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

export function resolveVista(raw: string | undefined): Vista {
  if (!raw) return 'prioridades';
  if (VISTA_VALUES.has(raw)) return raw as Vista;
  return LEGACY_VISTAS[raw] ?? 'prioridades';
}

/**
 * Interpreta los searchParams como filtros activos.
 *
 * Acepta tanto `URLSearchParams` (cliente, vía `useSearchParams`) como el objeto
 * plano que da `page.tsx` en el servidor, para que las dos mitades no tengan que
 * traducir nada.
 */
export function parseQualityFilters(input: SearchParams | URLSearchParams): QualityFilters {
  const params: SearchParams =
    input instanceof URLSearchParams ? Object.fromEntries(input.entries()) : input;

  const vistaRaw = readParam(params, 'vista');
  const vista = resolveVista(vistaRaw);

  const familiaRaw = readParam(params, 'familia');
  const familia: FamilyFilter =
    familiaRaw === 'entrega' || familiaRaw === 'contenido'
      ? familiaRaw
      : familiaRaw === 'todas'
      ? 'todas'
      : // Al llegar desde la vista «Incidencias», que solo enseñaba contenido, se
        // preselecciona esa familia para que el enlace antiguo siga significando
        // lo mismo que significaba.
        vistaRaw === 'incidencias'
      ? 'contenido'
      : 'todas';

  return {
    vista,
    familia,
    causas: splitList(readParam(params, 'causa')),
    formato: readParam(params, 'formato')?.trim() || undefined,
    tematica: readParam(params, 'tematica')?.trim() || undefined,
    q: readParam(params, 'q')?.trim() || undefined,
    hueco: readParam(params, 'hueco')?.trim() || undefined,
  };
}

/** Construye la URL de Calidad a partir de los filtros (los vacíos se omiten). */
export function buildQualityUrl(f: Partial<QualityFilters>, base = '/calidad'): string {
  const params = new URLSearchParams();
  if (f.vista) params.set('vista', f.vista);
  if (f.familia && f.familia !== 'todas') params.set('familia', f.familia);
  if (f.causas && f.causas.length > 0) params.set('causa', f.causas.join(','));
  if (f.formato) params.set('formato', f.formato);
  if (f.tematica) params.set('tematica', f.tematica);
  if (f.q) params.set('q', f.q);
  if (f.hueco) params.set('hueco', f.hueco);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/*
 * No hay aquí un `hasSubFilter`: `FicherosSection` necesita esa respuesta sobre su
 * estado local —que puede ir por delante de la URL mientras se escribe en el
 * buscador—, no sobre estos filtros, así que la calcula allí. Un helper exportado
 * que nadie llama y que el componente contradice es peor que no tenerlo.
 */
