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

/** Mapa base oscuro: el claro deslumbra sobre el lienzo oscuro del portal. */
export const DARK_TILES = {
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

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
