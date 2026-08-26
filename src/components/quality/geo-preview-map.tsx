'use client';

import 'leaflet/dist/leaflet.css';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { basemapFor, escapeHtml, isDarkTheme, themeToken, watchTheme } from '@/lib/map-theme';
import type { ViewBox } from '@/lib/wfs-paging';

/**
 * La extensión de un mapa, en grados.
 *
 * Alias de `ViewBox` y no una segunda definición: era el mismo objeto declarado
 * dos veces —aquí y en `wfs-paging`, que la usa para pedir por `bbox`— y dos
 * tipos idénticos con distinto nombre acaban separándose.
 */
export type Bbox = ViewBox;

/** Entidad lista para pintar: geometría en lon/lat y sus atributos. */
export interface MapFeature {
  geometry: GeoJSON.Geometry | null;
  properties: Record<string, string>;
}

/**
 * Qué puede pintar este mapa. Solo cosas que SON el recurso.
 *
 * Hubo un tercer tipo, `locator`: un marcador en el centro de la cobertura
 * declarada del conjunto, que se usaba de respaldo cuando el recurso no se podía
 * dibujar. Se retiró porque mentía por omisión —un mapa con un punto dentro se
 * lee como «el recurso está aquí», y ese punto era el mismo para todo el
 * catálogo—. Cuando no hay geometría, el visor enseña un hueco que lo dice
 * (`NoGeometry`, en `distribution-map.tsx`) en lugar de un mapa.
 */
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
      /**
       * `GetLegendGraphic` de la capa, si el servicio la ofrece. Se pinta dentro
       * del mapa: los colores de un WMS no significan nada sin ella, y tenerla
       * en una tarjeta aparte obligaba a mirar fuera del mapa para leerlo.
       *
       * `url` la pide dibujada a mayor resolución (extensión de GeoServer) y
       * `plain` es la misma petición sin extensiones, como respaldo para un
       * servidor que rechace lo que no conoce.
       */
      legend?: { url: string; plain: string } | null;
    }
  | {
      kind: 'features';
      features: MapFeature[];
      /** Índice de la entidad resaltada, sincronizado con la tabla. */
      selected: number | null;
    };

const CYL_CENTER: [number, number] = [41.7, -4.8];
const CYL_BOUNDS: [[number, number], [number, number]] = [[40.0, -7.1], [43.3, -1.8]];
/** A partir de aquí se dibuja en canvas: con SVG el navegador se arrodilla. */
const CANVAS_THRESHOLD = 2000;

/**
 * Control con la leyenda del WMS, en la esquina inferior derecha.
 *
 * Es un control de Leaflet y no una caja flotante encima del mapa porque así el
 * reparto de esquinas lo hace Leaflet: se coloca en el hueco de abajo a la
 * derecha y, como los controles de las esquinas inferiores se insertan delante
 * de los que ya había, queda por encima de la atribución en lugar de taparla.
 * Y como cualquier otro control, no se lleva por delante el arrastre del mapa.
 */
function legendControl(
  L: typeof Leaflet,
  legend: { url: string; plain: string },
  layerName: string
): Leaflet.Control {
  const control = new L.Control({ position: 'bottomright' });

  control.onAdd = () => {
    const box = L.DomUtil.create('div', 'leaflet-control map-legend');
    box.dataset.open = 'true';

    const toggle = L.DomUtil.create('button', 'map-legend-toggle', box);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'true');
    const label = L.DomUtil.create('span', '', toggle);
    label.textContent = 'Leyenda';
    const chevron = L.DomUtil.create('span', '', toggle);
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';

    const body = L.DomUtil.create('div', 'map-legend-body', box);
    const img = L.DomUtil.create('img', '', body) as HTMLImageElement;
    img.alt = `Leyenda de la capa ${layerName}`;
    img.src = legend.url;

    let retried = false;
    img.addEventListener('error', () => {
      // Primero se prueba sin la petición ampliada: si el servicio rechaza la
      // extensión de GeoServer, su leyenda normal sigue siendo mejor que nada.
      if (!retried && legend.plain !== legend.url) {
        retried = true;
        img.src = legend.plain;
        return;
      }
      // No todos los servicios sirven `GetLegendGraphic`. Una caja vacía
      // rotulada «Leyenda» confunde más que no enseñar nada.
      box.style.display = 'none';
    });

    toggle.addEventListener('click', () => {
      const open = box.dataset.open !== 'false';
      box.dataset.open = open ? 'false' : 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      chevron.textContent = open ? '▸' : '▾';
    });

    // Sin esto, pulsar la leyenda deselecciona la entidad activa, arrastrarla
    // mueve el mapa y la rueda del ratón hace zoom en vez de recorrerla.
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  };

  return control;
}

interface GeoPreviewMapProps {
  spec: GeoSpec;
  /** Se llama cuando el servicio de teselas falla, para poder avisar en la UI. */
  onTileError?: () => void;
  /** Clic sobre una entidad del mapa; `null` al pulsar fuera. */
  onSelectFeature?: (index: number | null) => void;
  /**
   * Qué se está mirando, cada vez que cambia.
   *
   * Lo necesita quien carga las capas WFS: una capa de 4.513 polígonos no se
   * puede traer entera, pero sí las que caen en la vista. Ver `shouldRefetchView`
   * en `lib/wfs-paging.ts`.
   */
  onViewportChange?: (view: ViewBox & { zoom: number }) => void;
  className?: string;
}

export default function GeoPreviewMap({
  spec,
  onTileError,
  onSelectFeature,
  onViewportChange,
  className,
}: GeoPreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const baseLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const overlayRef = useRef<Leaflet.Layer | null>(null);
  /** La leyenda es un control, no una capa: se quita con el overlay del WMS. */
  const legendRef = useRef<Leaflet.Control | null>(null);
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
  const onViewportRef = useRef(onViewportChange);
  useEffect(() => {
    onTileErrorRef.current = onTileError;
    onSelectRef.current = onSelectFeature;
    onViewportRef.current = onViewportChange;
  }, [onTileError, onSelectFeature, onViewportChange]);

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

      /* Lo que se está mirando, cada vez que el mapa se queda quieto.
         `moveend` cubre también el zoom, así que no hace falta escuchar
         `zoomend` aparte: se dispararían los dos por el mismo gesto. */
      const reportView = () => {
        const b = map.getBounds();
        onViewportRef.current?.({
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
          zoom: map.getZoom(),
        });
      };
      map.on('moveend', reportView);
      // Y una vez al arrancar: quien carga la capa necesita saber la vista
      // inicial sin esperar a que el usuario toque nada.
      reportView();

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
      legendRef.current = null;
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

    // Aquí había un plan B: si el proveedor oscuro no respondía, se retiraba la
    // capa y se volvía a OSM atenuado por CSS. Ya no hace falta ni tiene sentido
    // —los dos temas salen del mismo servidor, así que no hay un segundo origen
    // que pueda caerse por su cuenta—, y con él se va el baile de
    // `data-basemap` sobre el contenedor.
    const source = basemapFor(dark);
    const layer = L.tileLayer(source.url, {
      attribution: source.attribution,
      maxZoom: 19,
      // Leaflet la pone en el contenedor de ESTA capa. Es lo que permite
      // invertir solo el mapa base y no las capas WMS, que viven en el mismo
      // panel de teselas.
      className: source.className,
    });

    layer.addTo(map);
    layer.bringToBack();
    baseLayerRef.current = layer;

    return () => {
      map.removeLayer(layer);
    };
  }, [ready, dark]);

  /* ── 4. Capa de datos: se sustituye sin recrear el mapa ──────────────
     `spec.selected` se excluye a propósito de las dependencias: resaltar no
     debe reconstruir 77.000 geometrías, de eso se encarga el efecto 5.

     La opacidad tampoco entra en la clave: se aplica sobre la capa viva en el
     efecto 4b. Estaba dentro porque la clave era `JSON.stringify(spec)`, así
     que cada paso del deslizador tiraba la capa WMS entera y volvía a pedir
     todas las teselas al servicio —y, ahora que la leyenda vive dentro del
     mapa, también la replegaba a mitad del arrastre.                         */
  const specKey =
    spec.kind === 'features'
      ? `features|${spec.features.length}|${spec.features[0]?.geometry?.type ?? ''}`
      : spec.kind === 'wms'
      ? `wms|${spec.getMapUrl}|${spec.layers}|${spec.version}|${spec.format ?? ''}|${JSON.stringify(spec.bbox ?? null)}|${spec.legend?.url ?? ''}`
      : JSON.stringify(spec);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
      overlayRef.current = null;
    }
    if (legendRef.current) {
      legendRef.current.remove();
      legendRef.current = null;
    }
    // Copia local: en la limpieza la ref puede apuntar ya a otra colección.
    const byIndex = byIndexRef.current;
    byIndex.clear();
    tileErrorNotifiedRef.current = false;

    const okSolid = themeToken('--ok-solid', '#059669');
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

      if (spec.legend) {
        const legend = legendControl(L, spec.legend, spec.layers);
        legend.addTo(map);
        legendRef.current = legend;
      }

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
    }

    return () => {
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
      if (legendRef.current) {
        legendRef.current.remove();
        legendRef.current = null;
      }
      byIndex.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, specKey, dark]);

  /* ── 4b. Opacidad del WMS, sobre la capa que ya está puesta ── */
  const wmsOpacity = spec.kind === 'wms' ? spec.opacity ?? 0.8 : null;
  useEffect(() => {
    const layer = overlayRef.current as Leaflet.TileLayer | null;
    if (!ready || wmsOpacity == null || !layer || typeof layer.setOpacity !== 'function') return;
    layer.setOpacity(wmsOpacity);
  }, [ready, specKey, wmsOpacity]);

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
