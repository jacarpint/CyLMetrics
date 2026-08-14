/**
 * Utilidades geoespaciales compartidas: qué formatos del catálogo son
 * geoespaciales y cómo se llaman en castellano.
 *
 * Aquí vivía además un gazetteer (`SPATIAL_COORDS`, `getSpatialCoords`) que
 * convertía la cobertura declarada del conjunto —`dct:spatial`, casi siempre la
 * URI de Castilla y León— en unas coordenadas. Servía para una sola cosa: pintar
 * un marcador de respaldo cuando el recurso no se podía dibujar, que es
 * justamente lo que no había que hacer (ver `GeoSpec` en `geo-preview-map.tsx`).
 * Se retiró con él; para enseñar la cobertura en texto está `spatialLabel`.
 *
 * Sin imports de servidor: apto para Server Components y componentes cliente.
 */

import type { DataFormat } from '@/lib/types';

/** Formatos considerados geoespaciales dentro del catálogo. */
export const GEO_FORMATS: DataFormat[] = ['SHP', 'KML', 'GML', 'WMS', 'WFS', 'GeoJSON', 'ECW'];

/** Nombre legible por formato geoespacial. */
export const GEO_FORMAT_NAMES: Record<string, string> = {
  SHP: 'Shapefile',
  KML: 'KML (Google Earth)',
  GML: 'GML (OGC)',
  WMS: 'WMS (servicio)',
  WFS: 'WFS (servicio)',
  GeoJSON: 'GeoJSON',
  ECW: 'ECW (raster)',
};

/** ¿El formato es geoespacial? */
export function isGeoFormat(fmt: string): boolean {
  return (GEO_FORMATS as string[]).includes(fmt);
}
