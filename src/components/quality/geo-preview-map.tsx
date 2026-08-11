'use client';

import 'leaflet/dist/leaflet.css';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { DARK_TILES, OSM_TILES, escapeHtml, isDarkTheme, themeToken, watchTheme } from '@/lib/map-theme';

export type Bbox = { west: number; south: number; east: number; north: number };

/** Entidad lista para pintar: geometría en lon/lat y sus atributos. */
export interface MapFeature {
  geometry: GeoJSON.Geometry | null;
  properties: Record<string, string>;
}

export type GeoSpec =
  | {
      kind: 'wms';
      getMapUrl: string;
      /** Una sola capa. Pedir varias a la vez tumba a los servicios del IDECyL. */
      layers: string;
      version: string;
      format?: string;
      bbox?: Bbox | null;
      opacity?: number;
    }
  | {
      kind: 'features';
      features: MapFeature[];
      /** Índice de la entidad resaltada, sincronizado con la tabla. */
      selected: number | null;
    }
  | { kind: 'locator'; lat: number; lng: number; label: string; hasError?: boolean };

const CYL_CENTER: [number, number] = [41.7, -4.8];
const CYL_BOUNDS: [[number, number], [number, number]] = [[40.0, -7.1], [43.3, -1.8]];
/** A partir de aquí se dibuja en canvas: con SVG el navegador se arrodilla. */
const CANVAS_THRESHOLD = 2000;

interface GeoPreviewMapProps {
  spec: GeoSpec;
  /** Se llama cuando el servicio de teselas falla, para poder avisar en la UI. */
  onTileError?: () => void;
  /** Clic sobre una entidad del mapa; `null` al pulsar fuera. */
  onSelectFeature?: (index: number | null) => void;
  className?: string;
}

export default function GeoPreviewMap({ spec, onTileError, onSelectFeature, className }: GeoPreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const baseLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const overlayRef = useRef<Leaflet.Layer | null>(null);
  /** Índice de entidad → capa de Leaflet, para poder resaltar desde la tabla. */
  const byIndexRef = useRef<Map<number, Leaflet.Path | Leaflet.Layer>>(new Map());
  /** Se marca de forma síncrona: el doble montaje de StrictMode dispara el
   *  efecto dos veces antes de que el `await import` del primero resuelva, y
   *  sin esto se instanciaban dos mapas sobre el mismo contenedor. */
  const initStartedRef = useRef(false);
  const tileErrorNotifiedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(isDarkTheme);

  // Los callbacks viven en refs para que cambiarlos no obligue a rehacer la
  // capa; la asignación va en un efecto, no en el cuerpo del render.
  const onTileErrorRef = useRef(onTileError);
  const onSelectRef = useRef(onSelectFeature);
  useEffect(() => {
    onTileErrorRef.current = onTileError;
    onSelectRef.current = onSelectFeature;
  }, [onTileError, onSelectFeature]);

  /* ── 1. Crear el mapa una sola vez ── */
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    let disposed = false;

    (async () => {
      const L = (await import('leaflet')) as typeof Leaflet;
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: CYL_CENTER,
        zoom: 7,
        // La rueda hace zoom siempre que el puntero está sobre el mapa.
        scrollWheelZoom: true,
        zoomControl: true,
        attributionControl: true,
        // Miles de geometrías en canvas en lugar de miles de nodos SVG.
        preferCanvas: true,
      });
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

      // Pulsar fuera de cualquier entidad deshace la selección.
      map.on('click', () => onSelectRef.current?.(null));

      leafletRef.current = L;
      mapRef.current = map;
      setReady(true);
    })();

    // La ref se copia aquí porque en la limpieza ya podría apuntar a otra cosa.
    const byIndex = byIndexRef.current;
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      overlayRef.current = null;
      baseLayerRef.current = null;
      byIndex.clear();
      initStartedRef.current = false;
      setReady(false);
    };
  }, []);

  /* ── 2. Seguir el tema del portal ── */
  useEffect(() => watchTheme(setDark), []);

  /* ── 3. Mapa base según el tema, con reserva al claro si el oscuro falla ── */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const container = containerRef.current;
    if (!ready || !L || !map || !container) return;

    const source = dark ? DARK_TILES : OSM_TILES;
    container.dataset.basemap = dark ? 'dark' : 'light';

    const layer = L.tileLayer(source.url, { attribution: source.attribution, maxZoom: 19 });
    let fallback: Leaflet.TileLayer | null = null;

    if (dark) {
      // Si el proveedor oscuro no responde, se vuelve a OSM y se marca el
      // contenedor para que el CSS lo atenúe en lugar de deslumbrar.
      layer.once('tileerror', () => {
        if (fallback || !mapRef.current) return;
        map.removeLayer(layer);
        fallback = L.tileLayer(OSM_TILES.url, { attribution: OSM_TILES.attribution, maxZoom: 19 });
        fallback.addTo(map);
        fallback.bringToBack();
        container.dataset.basemap = 'light';
      });
    }

    layer.addTo(map);
    layer.bringToBack();
    baseLayerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      if (fallback) map.removeLayer(fallback);
    };
  }, [ready, dark]);

  /* ── 4. Capa de datos: se sustituye sin recrear el mapa ──────────────
     `spec.selected` se excluye a propósito de las dependencias: resaltar no
     debe reconstruir 77.000 geometrías, de eso se encarga el efecto 5.       */
  const specKey =
    spec.kind === 'features'
      ? `features|${spec.features.length}|${spec.features[0]?.geometry?.type ?? ''}`
      : JSON.stringify(spec);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
      overlayRef.current = null;
    }
    // Copia local: en la limpieza la ref puede apuntar ya a otra colección.
    const byIndex = byIndexRef.current;
    byIndex.clear();
    tileErrorNotifiedRef.current = false;

    const okSolid = themeToken('--ok-solid', '#059669');
    const badSolid = themeToken('--bad-solid', '#dc2626');
    const cardBg = themeToken('--card', '#ffffff');

    if (spec.kind === 'wms') {
      const wms = L.tileLayer.wms(spec.getMapUrl, {
        layers: spec.layers,
        format: spec.format ?? 'image/png',
        transparent: true,
        version: spec.version,
        crs: L.CRS.EPSG3857,
        opacity: spec.opacity ?? 0.8,
      });
      // Un WMS caído y un WMS vacío se ven exactamente igual: hay que avisar.
      wms.on('tileerror', () => {
        if (tileErrorNotifiedRef.current) return;
        tileErrorNotifiedRef.current = true;
        onTileErrorRef.current?.();
      });
      wms.addTo(map);
      overlayRef.current = wms;

      const b = spec.bbox;
      if (b) map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [12, 12] });
      else map.fitBounds(CYL_BOUNDS);
    } else if (spec.kind === 'features') {
      const heavy = spec.features.length > CANVAS_THRESHOLD;
      const collection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: spec.features.flatMap((f, i) =>
          f.geometry ? [{ type: 'Feature' as const, id: i, geometry: f.geometry, properties: f.properties }] : []
        ),
      };

      const layer = L.geoJSON(collection, {
        style: { color: okSolid, weight: heavy ? 1.5 : 2, fillColor: okSolid, fillOpacity: 0.22 },
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, {
            radius: heavy ? 3.5 : 5,
            color: cardBg,
            fillColor: okSolid,
            fillOpacity: 0.95,
            weight: heavy ? 1 : 1.5,
          }),
        onEachFeature: (feature, lyr) => {
          const index = typeof feature.id === 'number' ? feature.id : -1;
              if (index >= 0) byIndex.set(index, lyr);
          lyr.on('click', (event) => {
            // Sin esto el clic llega al mapa y deshace la selección recién hecha.
            L.DomEvent.stopPropagation(event as unknown as Event);
            onSelectRef.current?.(index);
          });
        },
      });
      layer.addTo(map);
      overlayRef.current = layer;

      const b = layer.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [20, 20] });
    } else {
      const color = spec.hasError ? badSolid : okSolid;
      const icon = L.divIcon({
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2.5px solid ${cardBg};box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
        className: '',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker([spec.lat, spec.lng], { icon, alt: spec.label });
      marker.bindPopup(`<strong style="font-size:12px">${escapeHtml(spec.label)}</strong>`);
      marker.addTo(map);
      overlayRef.current = marker;
      map.setView([spec.lat, spec.lng], 8);
    }

    return () => {
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
      byIndex.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, specKey, dark]);

  /* ── 5. Resaltar la entidad seleccionada y llevarla a la vista ── */
  const selected = spec.kind === 'features' ? spec.selected : null;
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || selected === null) return;

    const layer = byIndexRef.current.get(selected);
    if (!layer) return;

    const accent = themeToken('--warn-solid', '#c26a06');
    const path = layer as Leaflet.Path & { setStyle?: (s: Leaflet.PathOptions) => void; getBounds?: () => Leaflet.LatLngBounds };
    const previous = { ...(path.options ?? {}) } as Leaflet.PathOptions;

    path.setStyle?.({ color: accent, fillColor: accent, weight: 4, fillOpacity: 0.45, radius: 8 } as Leaflet.PathOptions);
    (path as unknown as { bringToFront?: () => void }).bringToFront?.();

    // Encuadre: los polígonos y líneas tienen extensión; los puntos, no.
    const bounds = path.getBounds?.();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } else {
      const latlng = (layer as Leaflet.CircleMarker).getLatLng?.();
      if (latlng) map.setView(latlng, Math.max(map.getZoom(), 13));
    }

    const props = (layer as unknown as { feature?: { properties?: Record<string, string> } }).feature?.properties ?? {};
    const rows = Object.entries(props)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .slice(0, 12)
      .map(
        ([k, v]) =>
          `<div style="display:flex;gap:.75rem;justify-content:space-between"><span style="opacity:.7">${escapeHtml(
            k
          )}</span><strong style="font-weight:600;text-align:right">${escapeHtml(String(v))}</strong></div>`
      )
      .join('');
    if (rows) {
      const popup = L.popup({ maxWidth: 280 })
        .setContent(`<div style="font-size:11px;display:grid;gap:2px">${rows}</div>`);
      const at = bounds && bounds.isValid() ? bounds.getCenter() : (layer as Leaflet.CircleMarker).getLatLng?.();
      if (at) popup.setLatLng(at).openOn(map);
    }

    return () => {
      path.setStyle?.(previous);
      map.closePopup();
    };
  }, [ready, selected, dark, specKey]);

  return (
    <div
      ref={containerRef}
      className={className ?? 'w-full h-[460px] rounded-xl border border-border overflow-hidden'}
      role="application"
      aria-label="Mapa de previsualización del recurso geoespacial"
    />
  );
}
