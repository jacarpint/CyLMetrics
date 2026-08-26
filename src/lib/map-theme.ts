/**
 * Piezas compartidas por los tres mapas Leaflet del portal.
 *
 * Solo constantes y lectura del DOM: sin importar `leaflet`, para que se pueda
 * usar desde cualquier componente cliente sin arrastrar la librería.
 */

export const OSM_TILES = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

/**
 * Clase que marca el mapa base cuando toca pintarlo oscuro.
 *
 * El filtro vive en `globals.css` y se aplica al contenedor de ESTA capa, no a
 * `.leaflet-tile-pane`: en esa capa comparten sitio el mapa base y las capas WMS
 * de datos, así que filtrar el panel entero invertía también la cartografía del
 * servicio, que es justo lo que se ha ido a ver.
 */
export const DARK_BASEMAP_CLASS = 'basemap-oscuro';

/**
 * El mapa base según el tema.
 *
 * Los dos salen de OpenStreetMap. El oscuro era `dark_all` de CARTO, y CARTO ha
 * pasado sus mapas base a exigir clave: las teselas siguen llegando, pero con una
 * marca de agua «API Key Required» encima. No se cambia por otro proveedor porque
 * los que dan un tema oscuro gratis lo hacen a cambio de registrarse, y una clave
 * en un portal público es una cuenta que mantener y una dependencia que puede
 * volver a caducar.
 *
 * En su lugar se invierte OSM por CSS, que es la solución clásica: mismo origen
 * para los dos temas, ningún tercero, nada que renovar, y un host menos en la
 * CSP. La contrapartida es que un mapa invertido no está tan cuidado como uno
 * diseñado en oscuro; a cambio no puede dejar de funcionar por decisión ajena.
 */
export function basemapFor(dark: boolean): {
  url: string;
  attribution: string;
  className?: string;
} {
  return dark ? { ...OSM_TILES, className: DARK_BASEMAP_CLASS } : OSM_TILES;
}

export function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/**
 * Observa el cambio de tema del portal (la clase `dark` en <html>, que pone
 * ThemeToggle). Devuelve la función de limpieza.
 */
export function watchTheme(onChange: (dark: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(() => onChange(isDarkTheme()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** Lee un token de color del tema, para pintar geometrías igual que la UI. */
export function themeToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
