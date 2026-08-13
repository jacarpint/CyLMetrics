/**
 * Vocabularios controlados del catálogo (NTI-RISP / datos.gob.es).
 *
 * El RDF trae `dcat:theme` y `dct:spatial` como URIs
 * (`…/kos/sector-publico/sector/medio-ambiente`), y la ficha las estaba
 * pintando tal cual, como un enlace ilegible. Aquí se traducen a castellano.
 *
 * Client-safe: solo tablas y funciones puras.
 */

/** Los 21 sectores NTI-RISP que aparecen de verdad en este catálogo. */
const THEME_LABELS: Record<string, string> = {
  'ciencia-tecnologia': 'Ciencia y tecnología',
  'comercio': 'Comercio',
  'cultura-ocio': 'Cultura y ocio',
  'demografia': 'Demografía',
  'deporte': 'Deporte',
  'economia': 'Economía',
  'educacion': 'Educación',
  'empleo': 'Empleo',
  'energia': 'Energía',
  'hacienda': 'Hacienda',
  'industria': 'Industria',
  'legislacion-justicia': 'Legislación y justicia',
  'medio-ambiente': 'Medio ambiente',
  'medio-rural-pesca': 'Medio rural y pesca',
  'salud': 'Salud',
  'sector-publico': 'Sector público',
  'seguridad': 'Seguridad',
  'sociedad-bienestar': 'Sociedad y bienestar',
  'transporte': 'Transporte',
  'turismo': 'Turismo',
  'urbanismo-infraestructuras': 'Urbanismo e infraestructuras',
  'vivienda': 'Vivienda',
  'medio-rural': 'Medio rural',
};

/** Territorios NTI-RISP relevantes para Castilla y León. */
const TERRITORY_LABELS: Record<string, string> = {
  'castilla-leon': 'Castilla y León',
  'avila': 'Ávila',
  'burgos': 'Burgos',
  'leon': 'León',
  'palencia': 'Palencia',
  'salamanca': 'Salamanca',
  'segovia': 'Segovia',
  'soria': 'Soria',
  'valladolid': 'Valladolid',
  'zamora': 'Zamora',
  'espana': 'España',
};

/** Último segmento no vacío de una URI, en minúsculas y sin acentos. */
function lastSegment(value: string): string {
  const clean = value.trim().replace(/[#?].*$/, '').replace(/\/+$/, '');
  const segment = clean.slice(clean.lastIndexOf('/') + 1);
  return segment.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** `Castilla-Leon` → `Castilla Leon`, como reserva cuando no está en la tabla. */
function humanize(segment: string): string {
  const words = segment.replace(/[-_]+/g, ' ').trim();
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** ¿El valor parece una URI en lugar de texto ya legible? */
export function looksLikeUri(value: string | undefined | null): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/**
 * Etiqueta legible de un `dcat:theme`. Acepta tanto la URI del vocabulario
 * como un texto ya legible, que devuelve sin tocar.
 */
export function themeLabel(value: string | undefined | null): string | null {
  if (!value?.trim()) return null;
  if (!looksLikeUri(value)) return value.trim();
  const segment = lastSegment(value);
  return THEME_LABELS[segment] ?? humanize(segment) ?? null;
}

/** Etiqueta legible de un `dct:spatial`. */
export function spatialLabel(value: string | undefined | null): string | null {
  if (!value?.trim()) return null;
  if (!looksLikeUri(value)) return value.trim();
  const segment = lastSegment(value);
  if (!segment) return null;
  return TERRITORY_LABELS[segment] ?? humanize(segment) ?? null;
}

/**
 * Periodicidad declarada (`dct:accrualPeriodicity`) en palabras.
 *
 * Estaba escrita dos veces, una por página, y las dos versiones NO coincidían:
 * un conjunto con periodicidad inferior al mes se llamaba «Continua» en su ficha
 * y «diaria» en el informe de calidad. Mismo dato, dos nombres, en el mismo
 * portal.
 *
 * `capitalized` es lo único que cambia entre los dos usos: la ficha lo pinta como
 * valor de un campo y el informe lo intercala en una frase.
 */
const PERIODICITY_LABELS: Record<number, string> = {
  1: 'mensual',
  3: 'trimestral',
  6: 'semestral',
  12: 'anual',
};

export function periodicityLabel(
  months: number | null | undefined,
  { capitalized = false }: { capitalized?: boolean } = {}
): string | null {
  if (months == null || months <= 0) return null;
  const label =
    PERIODICITY_LABELS[months] ??
    // Por debajo del mes el catálogo no distingue el intervalo exacto, así que
    // se dice lo único que consta: que se actualiza más de una vez al mes.
    (months < 1 ? 'más de una vez al mes' : `cada ${Math.round(months)} meses`);
  return capitalized ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}
