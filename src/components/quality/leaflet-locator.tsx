'use client';

import 'leaflet/dist/leaflet.css';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { DARK_TILES, OSM_TILES, escapeHtml, isDarkTheme, themeToken, watchTheme } from '@/lib/map-theme';

interface LeafletLocatorProps {
  lat: number;
  lng: number;
  label: string;
  hasError?: boolean;
}

/** Mapa localizador de un único punto (cobertura espacial declarada de una distribución). */
export default function LeafletLocator({ lat, lng, label, hasError }: LeafletLocatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
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

      const map = L.map(containerRef.current, { center: [lat, lng], zoom: 8, scrollWheelZoom: false });
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
      markerRef.current = null;
      initStartedRef.current = false;
      setReady(false);
    };
    // El punto se reposiciona en el efecto del marcador, no recreando el mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => watchTheme(setDark), []);

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

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    const color = themeToken(hasError ? '--bad-solid' : '--ok-solid', hasError ? '#dc2626' : '#059669');
    const cardBg = themeToken('--card', '#ffffff');
    const icon = L.divIcon({
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2.5px solid ${cardBg};box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
      className: '',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    const marker = L.marker([lat, lng], { icon, alt: label });
    marker.bindPopup(`<strong style="font-size:12px">${escapeHtml(label)}</strong>`);
    marker.addTo(map);
    markerRef.current = marker;
    map.setView([lat, lng], 8);

    return () => {
      map.removeLayer(marker);
      markerRef.current = null;
    };
  }, [ready, lat, lng, label, hasError, dark]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[360px] rounded-xl border border-border overflow-hidden"
      role="application"
      aria-label={`Mapa localizador: ${label}`}
    />
  );
}
