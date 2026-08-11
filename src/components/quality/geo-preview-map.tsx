'use client';

import 'leaflet/dist/leaflet.css';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { DARK_TILES, OSM_TILES, escapeHtml, isDarkTheme, themeToken, watchTheme } from '@/lib/map-theme';

export type Bbox = { west: number; south: number; east: number; north: number };

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
  | { kind: 'geojson'; data: unknown }
  | { kind: 'locator'; lat: number; lng: number; label: string; hasError?: boolean };

const CYL_CENTER: [number, number] = [41.7, -4.8];
const CYL_BOUNDS: [[number, number], [number, number]] = [[40.0, -7.1], [43.3, -1.8]];

interface GeoPreviewMapProps {
  spec: GeoSpec;
  /** Se llama cuando el servicio de teselas falla, para poder avisar en la UI. */
  onTileError?: () => void;
  className?: string;
}

export default function GeoPreviewMap({ spec, onTileError, className }: GeoPreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const baseLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const overlayRef = useRef<Leaflet.Layer | null>(null);
  /** Se marca de forma síncrona: el doble montaje de StrictMode dispara el
   *  efecto dos veces antes de que el `await import` del primero resuelva, y
   *  sin esto se instanciaban dos mapas sobre el mismo contenedor. */
  const initStartedRef = useRef(false);
  const tileErrorNotifiedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(isDarkTheme);

  // El callback se guarda en una ref para que cambiarlo no obligue a rehacer
  // la capa; la asignación va en un efecto, no en el cuerpo del render.
  const onTileErrorRef = useRef(onTileError);
  useEffect(() => {
    onTileErrorRef.current = onTileError;
  }, [onTileError]);

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
        // El zoom con rueda secuestraría el scroll de la página; se activa al
        // hacer clic en el mapa (ver más abajo) y se suelta al salir.
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      });
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

      map.on('click', () => map.scrollWheelZoom.enable());
      map.on('mouseout', () => map.scrollWheelZoom.disable());

      leafletRef.current = L;
      mapRef.current = map;
      setReady(true);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      overlayRef.current = null;
      baseLayerRef.current = null;
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

  /* ── 4. Capa de datos: se sustituye sin recrear el mapa ── */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
      overlayRef.current = null;
    }
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
    } else if (spec.kind === 'geojson') {
      const layer = L.geoJSON(spec.data as GeoJSON.GeoJsonObject, {
        style: { color: okSolid, weight: 2, fillColor: okSolid, fillOpacity: 0.22 },
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, { radius: 5, color: cardBg, fillColor: okSolid, fillOpacity: 0.95, weight: 1.5 }),
        onEachFeature: (feature, lyr) => {
          const props = (feature as { properties?: Record<string, unknown> }).properties;
          if (!props) return;
          const rows = Object.entries(props)
            .filter(([, v]) => v != null && v !== '')
            .slice(0, 10)
            .map(
              ([k, v]) =>
                `<div style="display:flex;gap:.5rem;justify-content:space-between"><span style="opacity:.7">${escapeHtml(
                  k
                )}</span><strong style="font-weight:600;text-align:right">${escapeHtml(String(v))}</strong></div>`
            )
            .join('');
          if (rows) lyr.bindPopup(`<div style="font-size:11px;max-width:260px;display:grid;gap:2px">${rows}</div>`);
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
    };
  }, [ready, spec, dark]);

  return (
    <div
      ref={containerRef}
      className={className ?? 'w-full h-[420px] rounded-xl border border-border overflow-hidden'}
      role="application"
      aria-label="Mapa de previsualización del recurso geoespacial"
    />
  );
}
