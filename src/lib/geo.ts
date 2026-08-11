/**
 * Utilidades geoespaciales compartidas.
 *
 * Formatos geo del catálogo, nombres legibles, un gazetteer aproximado para
 * situar datasets en el mapa a partir de su cobertura espacial declarada
 * (dct:spatial) y helpers de normalización.
 *
 * Sin imports de servidor: apto para Server Components y componentes cliente.
 */

import type { DataFormat } from '@/lib/types';
import { spatialLabel } from '@/lib/vocabularies';

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

/**
 * Gazetteer aproximado: normaliza un texto de cobertura espacial a coordenadas.
 * No es geocodificación real; sitúa marcadores orientativos en el mapa.
 */
export const SPATIAL_COORDS: Record<string, [number, number]> = {
  'castilla y leon': [41.65, -4.73],
  'regio leonesa': [42.60, -5.57],
  'comunidad de castilla y leon': [41.65, -4.73],
  'provincia de leon': [42.60, -5.57],
  'provincia de palencia': [42.01, -4.53],
  'provincia de burgos': [42.34, -3.70],
  'provincia de salamanca': [40.97, -5.66],
  'provincia de segovia': [40.95, -4.12],
  'provincia de soria': [41.76, -2.47],
  'provincia de zamora': [41.50, -5.75],
  'provincia de avila': [40.66, -4.70],
  'avila': [40.66, -4.70],
  'zamora': [41.50, -5.75],
  'valladolid': [41.65, -4.73],
  'salamanca': [40.97, -5.66],
  'burgos': [42.34, -3.70],
  'leon': [42.60, -5.57],
  'palencia': [42.01, -4.53],
  'segovia': [40.95, -4.12],
  'soria': [41.76, -2.47],
  'aranda de duero': [41.67, -3.69],
  'medina del campo': [41.24, -5.26],
  'tordesillas': [41.50, -5.00],
  'benavente': [42.00, -5.67],
  'astorga': [42.46, -6.05],
  'ponferrada': [42.55, -6.59],
  'bembibre': [42.62, -6.42],
  'villablino': [42.70, -6.32],
  'miranda de ebro': [42.69, -2.95],
};

/** Minúsculas, sin tildes ni espacios sobrantes, para comparar texto libre. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Coordenadas orientativas a partir de la cobertura espacial declarada.
 *
 * El catálogo declara la cobertura como URI del vocabulario NTI-RISP
 * (`…/territorio/Autonomia/Castilla-Leon`), no como texto libre. Buscar
 * subcadenas sobre eso hacía que `castilla-leon` casara antes con la clave
 * `leon` que con `castilla y leon`, y TODOS los mapas de respaldo acababan
 * en la ciudad de León en vez de en el centro de la comunidad.
 *
 * Ahora se resuelve primero la URI a su etiqueta y, sobre texto libre, se
 * prueban las claves de más larga a más corta para que gane la más específica.
 */
export function getSpatialCoords(spatial: string | undefined): [number, number] | null {
  if (!spatial) return null;

  const label = spatialLabel(spatial);
  const haystack = normalizeText(label ?? spatial);
  if (!haystack) return null;

  const exact = SPATIAL_COORDS[haystack];
  if (exact) return exact;

  const keys = Object.keys(SPATIAL_COORDS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (haystack.includes(key)) return SPATIAL_COORDS[key];
  }
  return null;
}

/** ¿El formato es geoespacial? */
export function isGeoFormat(fmt: string): boolean {
  return (GEO_FORMATS as string[]).includes(fmt);
}
