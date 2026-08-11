'use client';

import 'leaflet/dist/leaflet.css';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { GeoDataset } from '@/lib/types';
import { DARK_TILES, OSM_TILES, escapeHtml, isDarkTheme, themeToken, watchTheme } from '@/lib/map-theme';

interface LeafletMapProps {
  datasets: GeoDataset[];
}

export default function LeafletMap({ datasets }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const markersRef = useRef<Leaflet.LayerGroup | null>(null);
  /** Guard síncrono: sin él, el doble montaje de StrictMode instancia dos
   *  mapas sobre el mismo contenedor (el `await import` resuelve después). */
  const initStartedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(isDarkTheme);

  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    let disposed = false;

    (async () => {
      const L = (await import('leaflet')) as typeof Leaflet;
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [41.65, -4.73], // Valladolid
        zoom: 8,
        scrollWheelZoom: false,
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
      markersRef.current = null;
      initStartedRef.current = false;
      setReady(false);
    };
  }, []);

  useEffect(() => watchTheme(setDark), []);

  /* Mapa base según el tema */
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

    return () => {
      map.removeLayer(layer);
      if (fallback) map.removeLayer(fallback);
    };
  }, [ready, dark]);

  /* Marcadores */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    const okSolid = themeToken('--ok-solid', '#059669');
    const badSolid = themeToken('--bad-solid', '#dc2626');
    const cardBg = themeToken('--card', '#ffffff');
    const faint = themeToken('--faint', '#5b6979');
    const fill = themeToken('--fill', '#f1f5f9');
    const body = themeToken('--body', '#475569');

    const dot = (color: string) =>
      L.divIcon({
        html: `<div style="width:13px;height:13px;border-radius:50%;background:${color};border:2px solid ${cardBg};box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
        className: '',
        iconSize: [13, 13],
        iconAnchor: [6.5, 6.5],
      });
    const markerIcon = dot(okSolid);
    const failIcon = dot(badSolid);

    const group = L.layerGroup().addTo(map);
    markersRef.current = group;

    const located = datasets.filter((d) => d.latitude != null && d.longitude != null);
    for (const ds of located) {
      const marker = L.marker([ds.latitude!, ds.longitude!], {
        icon: ds.hasError ? failIcon : markerIcon,
        alt: ds.title,
      });
      marker.bindPopup(
        `<div style="min-width:200px;color:${body}">
          <strong style="font-size:13px">${escapeHtml(ds.title)}</strong>
          <div style="font-size:11px;margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
            ${ds.formats
              .map(
                (f) =>
                  `<span style="background:${fill};padding:1px 6px;border-radius:4px">${escapeHtml(f)}</span>`
              )
              .join('')}
          </div>
          ${ds.publisher ? `<div style="font-size:11px;color:${faint};margin-top:6px">${escapeHtml(ds.publisher)}</div>` : ''}
        </div>`
      );
      marker.addTo(group);
    }

    if (located.length > 0) {
      const bounds = L.latLngBounds(located.map((d) => [d.latitude!, d.longitude!] as [number, number]));
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    return () => {
      map.removeLayer(group);
      markersRef.current = null;
    };
  }, [ready, datasets, dark]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[500px] rounded-xl border border-border overflow-hidden"
      role="application"
      aria-label="Mapa de datasets con cobertura espacial conocida"
    />
  );
}
