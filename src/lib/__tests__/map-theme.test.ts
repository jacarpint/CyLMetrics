import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { basemapFor, DARK_BASEMAP_CLASS, OSM_TILES } from '@/lib/map-theme';

/**
 * El mapa base de los dos temas.
 *
 * El oscuro lo servía `dark_all` de CARTO, hasta que CARTO pasó sus mapas base a
 * exigir clave y empezó a estampar «API Key Required» sobre las teselas. Ahora
 * los dos temas salen de OpenStreetMap y el oscuro se consigue invirtiendo por
 * CSS.
 */
describe('basemapFor', () => {
  it('el tema claro usa OpenStreetMap, sin filtro', () => {
    const base = basemapFor(false);
    expect(base.url).toBe(OSM_TILES.url);
    expect(base.className).toBeUndefined();
  });

  it('el tema oscuro usa el mismo origen, marcado para invertir', () => {
    const base = basemapFor(true);
    expect(base.url).toBe(OSM_TILES.url);
    expect(base.className).toBe(DARK_BASEMAP_CLASS);
  });

  it('ningún tema depende de un proveedor con clave', () => {
    for (const dark of [true, false]) {
      const base = basemapFor(dark);
      expect(base.url).not.toMatch(/cartocdn|carto\.com|api[_-]?key|access[_-]?token/i);
      expect(base.attribution).not.toMatch(/carto/i);
      expect(base.attribution).toMatch(/openstreetmap/i);
    }
  });
});

const ROOT = process.cwd();

describe('el filtro del mapa oscuro', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf-8');

  it('existe y se aplica a la clase que pone la capa base', () => {
    const regla = new RegExp(`\\.${DARK_BASEMAP_CLASS}\\s*\\{[^}]*filter:[^}]*invert`, 'i');
    expect(CSS).toMatch(regla);
  });

  /**
   * La comprobación que importa. En `.leaflet-tile-pane` conviven el mapa base y
   * las capas WMS del servicio, así que un filtro sobre el panel entero invierte
   * también la cartografía que se ha ido a ver. La regla anterior lo hacía.
   */
  it('no cuelga de `.leaflet-tile-pane`, que también lleva las capas de datos', () => {
    const filtraElPanel = /\.leaflet-tile-pane\s*\{[^}]*filter:/i.test(CSS);
    expect(filtraElPanel, 'el filtro alcanzaría a las capas WMS').toBe(false);
  });
});

describe('la política de contenido', () => {
  const CONFIG = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf-8');

  /**
   * Se lee la lista, no el fichero.
   *
   * La primera versión de este test buscaba «cartocdn» en todo `next.config.ts` y
   * fallaba contra el comentario que explica por qué se quitó CARTO. Un guardián
   * que salta con su propia documentación no vale: acaba borrándose el comentario
   * en vez de arreglarse el test.
   */
  const hosts = /const TILE_HOSTS\s*=\s*\[([\s\S]*?)\]/.exec(CONFIG)?.[1] ?? '';

  it('la lista de teselas se encuentra y no está vacía', () => {
    expect(hosts.trim()).not.toBe('');
  });

  it('ya no autoriza a CARTO a cargar imágenes', () => {
    // Si alguien vuelve a añadir un proveedor de teselas, que sea a sabiendas.
    expect(hosts).not.toMatch(/cartocdn/i);
  });

  it('sigue autorizando a OpenStreetMap, que es de donde salen las teselas', () => {
    expect(hosts).toMatch(/tile\.openstreetmap\.org/);
  });
});
