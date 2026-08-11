/**
 * Identificador legible de una distribución dentro de su dataset.
 *
 * Las URLs eran `/catalogo/1285142020827/0`, `/1`, `/2`: un índice de posición
 * que no dice nada y que cambia si el catálogo reordena las distribuciones.
 * Ahora se usa el formato (`/csv`, `/json`, `/wms`), con sufijo numérico solo
 * cuando un dataset repite formato —el 6% de los casos, hasta 7 CSV en el peor—.
 *
 * Los enlaces antiguos siguen funcionando: `resolveDistributionIndex` acepta
 * tanto el slug nuevo como el índice numérico de siempre.
 */

/** `GeoJSON` → `geojson`, `iCal` → `ical`, `OTRO` → `otro`. */
function normalizeFormat(format: string): string {
  const clean = format
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'archivo';
}

/**
 * Slug de cada distribución, en el mismo orden que las distribuciones.
 * El primero de cada formato va sin sufijo; los siguientes numeran desde 2,
 * para que la URL más habitual sea la limpia (`/csv`, no `/csv-1`).
 */
export function distributionSlugs(formats: string[]): string[] {
  const total = new Map<string, number>();
  for (const format of formats) {
    const base = normalizeFormat(format);
    total.set(base, (total.get(base) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return formats.map((format) => {
    const base = normalizeFormat(format);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return total.get(base)! > 1 && n > 1 ? `${base}-${n}` : base;
  });
}

/**
 * Índice de la distribución a partir del segmento de URL, o -1 si no existe.
 * Acepta el slug (`csv-2`) y el índice numérico heredado (`1`).
 */
export function resolveDistributionIndex(formats: string[], param: string): number {
  if (/^\d+$/.test(param)) {
    const idx = Number(param);
    return idx >= 0 && idx < formats.length ? idx : -1;
  }
  return distributionSlugs(formats).indexOf(param.toLowerCase());
}

/** Ruta canónica de una distribución. */
export function distributionHref(datasetSlug: string, formats: string[], index: number): string {
  const slug = distributionSlugs(formats)[index];
  return `/catalogo/${datasetSlug}/${slug ?? index}`;
}
