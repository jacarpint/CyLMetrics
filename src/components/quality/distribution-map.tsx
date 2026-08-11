'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { MapPin, ExternalLink, Layers, Info, Loader2, AlertTriangle, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { getSpatialCoords, GEO_FORMAT_NAMES } from '@/lib/geo';
import { cn } from '@/lib/utils';
import type { Bbox, GeoSpec } from '@/components/quality/geo-preview-map';

const GeoPreviewMap = dynamic(() => import('@/components/quality/geo-preview-map'), {
  ssr: false,
  loading: () => <div className="w-full h-[420px] rounded-xl border border-border bg-fill animate-pulse" />,
});

type OgcLayer = { name: string; title: string; bbox?: Bbox | null; queryable?: boolean; crs?: string };

/**
 * Nº de entidades que se piden al WFS en la primera carga.
 *
 * Deliberadamente bajo: en los servicios del IDECyL una capa de polígonos con
 * 500 entidades tarda más de dos minutos, muy por encima del timeout del proxy,
 * y el visor acababa cayendo al marcador orientativo sin explicar por qué.
 * Esto es una previsualización, no una descarga.
 */
const WFS_PREVIEW_COUNT = 50;
const WFS_RETRY_COUNT = 10;

interface DistributionMapProps {
  format: string;
  url: string;
  datasetId: string;
  spatial?: string;
  dead?: boolean;
  serviceSiblings?: { format: string; idx: number }[];
}

/* ── KML → GeoJSON (mínimo, con DOMParser del navegador) ── */
function parseCoordString(text: string | null): [number, number][] {
  if (!text) return [];
  return text
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const [lon, lat] = tuple.split(',').map(Number);
      return [lon, lat] as [number, number];
    })
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}

function kmlToGeoJSON(xmlText: string): { type: 'FeatureCollection'; features: unknown[] } {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const features: unknown[] = [];
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  for (const pm of placemarks) {
    const name = pm.getElementsByTagName('name')[0]?.textContent ?? '';
    const props = { name };
    const coordsText = (el: Element) => el.getElementsByTagName('coordinates')[0]?.textContent ?? null;

    for (const pt of Array.from(pm.getElementsByTagName('Point'))) {
      const c = parseCoordString(coordsText(pt));
      if (c[0]) features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c[0] } });
    }
    for (const ls of Array.from(pm.getElementsByTagName('LineString'))) {
      const c = parseCoordString(coordsText(ls));
      if (c.length >= 2) features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: c } });
    }
    for (const poly of Array.from(pm.getElementsByTagName('Polygon'))) {
      const outer = poly.getElementsByTagName('outerBoundaryIs')[0]?.getElementsByTagName('coordinates')[0]?.textContent
        ?? poly.getElementsByTagName('coordinates')[0]?.textContent ?? null;
      const ring = parseCoordString(outer);
      if (ring.length >= 3) features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/* ── Capacidades del servicio ── */

type Caps =
  | { kind: 'wms'; getMapUrl: string; version: string; format: string; layers: OgcLayer[]; bbox: Bbox | null }
  | { kind: 'wfs'; getFeatureUrl: string; version: string; featureTypes: OgcLayer[] }
  /** Geometrías ya resueltas en la propia carga (KML convertido en el cliente). */
  | { kind: 'inline'; data: unknown; count: number }
  | { kind: 'none'; note?: string };

/* ── Piezas de UI ── */

function MapNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-faint leading-relaxed">{children}</p>;
}

function LayerPicker({
  label, layers, value, onChange,
}: {
  label: string;
  layers: OgcLayer[];
  value: string;
  onChange: (name: string) => void;
}) {
  if (layers.length <= 1) return null;
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-faint sm:flex-none">
      <span className="shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-field bg-card px-2 py-1.5 text-xs text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:max-w-[22rem]"
      >
        {layers.map((l) => (
          <option key={l.name} value={l.name}>
            {l.title || l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Leyenda del servicio: sin ella los colores del WMS no significan nada. */
function WmsLegend({ getMapUrl, version, layer }: { getMapUrl: string; version: string; layer: string }) {
  // Se recuerda QUÉ leyenda falló, no un booleano: al cambiar de capa el
  // estado deja de aplicar solo, sin un efecto que lo rearme.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = useMemo(() => {
    const u = new URL(getMapUrl, window.location.href);
    u.searchParams.set('service', 'WMS');
    u.searchParams.set('request', 'GetLegendGraphic');
    u.searchParams.set('version', version);
    u.searchParams.set('format', 'image/png');
    u.searchParams.set('layer', layer);
    u.searchParams.set('transparent', 'true');
    return u.toString();
  }, [getMapUrl, version, layer]);

  if (failedSrc === src) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="eyebrow mb-2 flex items-center gap-1.5">
        <ImageIcon className="h-3 w-3" aria-hidden />
        Leyenda
      </p>
      {/* Imagen servida por el propio servicio OGC; next/image no aporta aquí. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Leyenda de la capa ${layer}`}
        className="max-w-full dark:rounded dark:bg-white/90 dark:p-1"
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}

function Banner({ tone, icon: Icon, children }: { tone: 'warn' | 'bad' | 'info'; icon: typeof Info; children: React.ReactNode }) {
  return (
    <Card tone={tone}>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon
          className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-info')}
          aria-hidden
        />
        <div className="text-sm leading-relaxed text-body">{children}</div>
      </CardContent>
    </Card>
  );
}

/* ── Componente principal ── */

export function DistributionMap({ format, url, datasetId, spatial, dead, serviceSiblings = [] }: DistributionMapProps) {
  const isService = format === 'WMS' || format === 'WFS';

  /**
   * Los resultados asíncronos se guardan junto a la clave de la petición que
   * los produjo y se comparan en el render. Así el estado solo se toca después
   * de un `await` (nada de renders en cascada) y un resultado que llega tarde
   * nunca se pinta sobre una selección que ya cambió.
   */
  const capsKey = `${format}|${url}`;
  const [capsResult, setCapsResult] = useState<{ key: string; caps: Caps } | null>(null);
  const caps = capsResult?.key === capsKey ? capsResult.caps : null;
  const capsLoading = caps === null;

  const [opacity, setOpacity] = useState(0.8);
  const [selectedOverride, setSelectedOverride] = useState<{ key: string; name: string } | null>(null);
  const [wfsCount, setWfsCount] = useState<{ key: string; count: number } | null>(null);
  const [tileFailedFor, setTileFailedFor] = useState<string | null>(null);

  const coords = useMemo(() => getSpatialCoords(spatial), [spatial]);

  const layerList: OgcLayer[] =
    caps?.kind === 'wms' ? caps.layers : caps?.kind === 'wfs' ? caps.featureTypes : [];
  // La primera capa es la selección por defecto: se deriva, no se copia a
  // estado, así que cambiar de recurso no deja seleccionada la capa anterior.
  const selected =
    selectedOverride?.key === capsKey ? selectedOverride.name : layerList[0]?.name ?? '';
  const setSelected = (name: string) => setSelectedOverride({ key: capsKey, name });

  const featureCount = wfsCount?.key === capsKey ? wfsCount.count : WFS_PREVIEW_COUNT;
  const featureKey = `${capsKey}|${selected}|${featureCount}`;
  const [featuresResult, setFeaturesResult] = useState<
    { key: string; data: unknown; shown: number; matched: number | null } | { key: string; error: true } | null
  >(null);
  const featuresFor = featuresResult?.key === featureKey ? featuresResult : null;
  const features = featuresFor && !('error' in featuresFor) ? featuresFor : null;
  const wfsFailed = caps?.kind === 'wfs' && !!featuresFor && 'error' in featuresFor;
  const wfsLoading = caps?.kind === 'wfs' && !!selected && featuresFor === null;

  const tileFailed = tileFailedFor === `${capsKey}|${selected}`;

  /* 1. Capacidades del servicio (o conversión directa para KML). */
  useEffect(() => {
    let cancelled = false;
    const key = `${format}|${url}`;

    async function run(): Promise<Caps> {
      try {
        if (format === 'WMS' || format === 'WFS') {
          const res = await fetch(`/api/ogc?service=${format}&url=${encodeURIComponent(url)}`);
          if (!res.ok) return { kind: 'none', note: `No se pudieron leer las capacidades del servicio ${format}.` };
          const cap = await res.json();

          if (format === 'WMS') {
            const layers: OgcLayer[] = (cap.layers ?? []).filter((l: OgcLayer) => l.name);
            if (!layers.length || !cap.getMapUrl) return { kind: 'none', note: 'El servicio WMS no expone capas renderizables.' };
            return {
              kind: 'wms',
              getMapUrl: cap.getMapUrl,
              version: cap.version ?? '1.3.0',
              format: cap.format ?? 'image/png',
              layers,
              bbox: cap.bbox ?? null,
            };
          }

          const featureTypes: OgcLayer[] = (cap.featureTypes ?? []).filter((t: OgcLayer) => t.name);
          if (!featureTypes.length || !cap.getFeatureUrl) {
            return { kind: 'none', note: 'El servicio WFS no expone tipos de entidad legibles.' };
          }
          return { kind: 'wfs', getFeatureUrl: cap.getFeatureUrl, version: cap.version ?? '2.0.0', featureTypes };
        }

        if (format === 'KML') {
          const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
          if (!res.ok) return { kind: 'none', note: 'El archivo KML no está disponible.' };
          const gj = kmlToGeoJSON(await res.text());
          if (!gj.features.length) return { kind: 'none', note: 'No se encontraron geometrías en el KML.' };
          return { kind: 'inline', data: gj, count: gj.features.length };
        }

        // SHP / GML / ECW / GeoJSON remoto: no previsualizables aquí.
        return { kind: 'none' };
      } catch {
        return { kind: 'none', note: 'No se pudo cargar la previsualización.' };
      }
    }

    run().then((value) => {
      if (!cancelled) setCapsResult({ key, caps: value });
    });

    return () => { cancelled = true; };
  }, [format, url]);

  /* 2. Entidades del WFS para el tipo seleccionado. */
  useEffect(() => {
    if (!caps || caps.kind !== 'wfs' || !selected) return;
    let cancelled = false;
    const controller = new AbortController();
    const key = featureKey;

    (async () => {
      try {
        const isV2 = caps.version.startsWith('2');
        const gf = new URL(caps.getFeatureUrl);
        gf.searchParams.set('service', 'WFS');
        gf.searchParams.set('version', caps.version);
        gf.searchParams.set('request', 'GetFeature');
        gf.searchParams.set(isV2 ? 'typeNames' : 'typeName', selected);
        gf.searchParams.set(isV2 ? 'count' : 'maxFeatures', String(featureCount));
        gf.searchParams.set('outputFormat', 'application/json');
        gf.searchParams.set('srsName', 'EPSG:4326');

        const res = await fetch(`/api/proxy?url=${encodeURIComponent(gf.toString())}`, { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const shown = Array.isArray(data?.features) ? data.features.length : 0;
        if (!shown) throw new Error('sin entidades');
        const matched =
          typeof data.numberMatched === 'number'
            ? data.numberMatched
            : typeof data.totalFeatures === 'number'
            ? data.totalFeatures
            : null;
        setFeaturesResult({ key, data, shown, matched });
      } catch (err) {
        if (cancelled || (err as Error).name === 'AbortError') return;
        setFeaturesResult({ key, error: true });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [caps, selected, featureCount, featureKey]);

  /* 3. Qué se pinta en el mapa. */
  const inlineData = caps?.kind === 'inline' ? caps.data : null;
  const spec: GeoSpec | null = useMemo(() => {
    if (caps?.kind === 'wms' && selected) {
      const layer = caps.layers.find((l) => l.name === selected);
      return {
        kind: 'wms',
        getMapUrl: caps.getMapUrl,
        layers: selected,
        version: caps.version,
        format: caps.format,
        bbox: layer?.bbox ?? caps.bbox,
        opacity,
      };
    }
    if (inlineData) return { kind: 'geojson', data: inlineData };
    if (features) return { kind: 'geojson', data: features.data };
    if (coords) {
      return { kind: 'locator', lat: coords[0], lng: coords[1], label: spatial ?? 'Cobertura declarada', hasError: dead };
    }
    return null;
  }, [caps, selected, opacity, inlineData, features, coords, spatial, dead]);

  const tileKey = `${capsKey}|${selected}`;
  const onTileError = useCallback(() => setTileFailedFor(tileKey), [tileKey]);

  if (capsLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-fill p-4 text-sm text-faint">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando la previsualización del recurso…
      </div>
    );
  }

  const selectedTitle = layerList.find((l) => l.name === selected)?.title;
  const inlineCount = caps?.kind === 'inline' ? caps.count : null;

  return (
    <div className="space-y-3">
      {/* Controles del servicio */}
      {layerList.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
          <LayerPicker
            label={caps?.kind === 'wms' ? 'Capa' : 'Entidad'}
            layers={layerList}
            value={selected}
            onChange={setSelected}
          />
          {caps?.kind === 'wms' && (
            <label className="flex items-center gap-2 text-xs text-faint">
              Opacidad
              <input
                type="range"
                min={20}
                max={100}
                step={5}
                value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                className="h-1.5 w-28 accent-[var(--primary)]"
                aria-label="Opacidad de la capa sobre el mapa base"
              />
              <span className="w-8 tabular-nums text-body">{Math.round(opacity * 100)}%</span>
            </label>
          )}
        </div>
      )}

      {/* Mapa */}
      {wfsLoading ? (
        <div className="flex h-[420px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-fill text-sm text-faint">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Descargando entidades del servicio…
        </div>
      ) : spec ? (
        <GeoPreviewMap spec={spec} onTileError={onTileError} />
      ) : (
        <Card tone="muted">
          <CardContent className="flex items-start gap-3 p-4">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
            <p className="text-sm text-body">
              No se puede previsualizar la geometría de este recurso ni situarlo en el mapa
              {caps?.kind === 'none' && caps.note ? <> — {caps.note.toLowerCase()}</> : '.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Qué se está viendo */}
      {spec?.kind === 'wms' && !tileFailed && (
        <MapNote>
          Cartografía renderizada en vivo desde el servicio WMS
          {selectedTitle ? <> — capa <strong className="text-body">{selectedTitle}</strong></> : null}, superpuesta al mapa base.
        </MapNote>
      )}
      {spec?.kind === 'geojson' && (features || inlineCount != null) && (
        <MapNote>
          {(features?.shown ?? inlineCount ?? 0).toLocaleString('es-ES')} entidades representadas
          {features && features.matched && features.matched > features.shown ? (
            <> de {features.matched.toLocaleString('es-ES')} disponibles (muestra)</>
          ) : null}
          {format === 'KML' ? ' desde el KML' : caps?.kind === 'wfs' ? ' desde el servicio WFS' : ''}. Pulsa una para ver sus atributos.
        </MapNote>
      )}
      {spec?.kind === 'locator' && (
        <MapNote>
          Ubicación orientativa según la cobertura declarada{spatial ? ` (${spatial})` : ''}; no es la geometría real del recurso.
        </MapNote>
      )}

      {/* El servicio respondió, pero no pintó nada */}
      {tileFailed && (
        <Banner tone="warn" icon={AlertTriangle}>
          El servicio no devolvió la cartografía de esta capa. Puede estar temporalmente
          caído o no admitir el sistema de referencia del visor.
          {layerList.length > 1 && ' Prueba con otra capa del desplegable.'}
        </Banner>
      )}

      {/* El WFS no entregó las entidades */}
      {wfsFailed && (
        <Banner tone="warn" icon={AlertTriangle}>
          El servicio WFS tardó demasiado o no devolvió GeoJSON para{' '}
          <strong className="text-body">{selectedTitle || selected}</strong>. Es habitual en capas de
          polígonos muy pesadas.
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {featureCount !== WFS_RETRY_COUNT && (
              <button
                type="button"
                onClick={() => setWfsCount({ key: capsKey, count: WFS_RETRY_COUNT })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-field px-2.5 py-1 text-xs font-medium text-body transition-colors hover:bg-fill"
              >
                <RefreshCw className="h-3 w-3" aria-hidden /> Reintentar con {WFS_RETRY_COUNT} entidades
              </button>
            )}
            {serviceSiblings
              .filter((s) => s.format === 'WMS')
              .map((s) => (
                <Link
                  key={s.idx}
                  href={`/catalogo/${datasetId}/${s.idx}`}
                  className="text-xs font-medium text-link underline-offset-2 hover:underline"
                >
                  Ver esta cartografía por WMS
                </Link>
              ))}
          </div>
        </Banner>
      )}

      {/* Leyenda + modelo del servicio */}
      {caps?.kind === 'wms' && selected && (
        <WmsLegend getMapUrl={caps.getMapUrl} version={caps.version} layer={selected} />
      )}

      {isService && layerList.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Layers className="h-4 w-4 text-ok" aria-hidden />
              <h3 className="text-sm font-semibold text-strong">
                Modelo del servicio {format}
                {caps?.kind === 'wms' || caps?.kind === 'wfs' ? ` · v${caps.version}` : ''}
              </h3>
              <span className="text-xs text-faint">
                {layerList.length} {caps?.kind === 'wms' ? 'capas' : 'tipos de entidad'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {layerList.slice(0, 24).map((l) => (
                <button
                  key={l.name}
                  type="button"
                  onClick={() => setSelected(l.name)}
                  title={l.name}
                  aria-pressed={l.name === selected}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    l.name === selected
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-border bg-fill text-body hover:border-border-strong hover:bg-fill-strong'
                  )}
                >
                  {l.title || l.name}
                </button>
              ))}
              {layerList.length > 24 && (
                <span className="px-2 py-1 text-[11px] text-faint">+{layerList.length - 24} más</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Servicios hermanos para formatos no previsualizables */}
      {!isService && spec?.kind !== 'geojson' && serviceSiblings.length > 0 && (
        <Card tone="ok">
          <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm text-body">
            <Info className="h-4 w-4 shrink-0 text-ok" aria-hidden />
            Este dataset también ofrece servicios visualizables:
            {serviceSiblings.map((s) => (
              <Link
                key={s.idx}
                href={`/catalogo/${datasetId}/${s.idx}`}
                className="inline-flex items-center gap-1 rounded-md border border-ok-line px-2 py-0.5 font-medium text-ok transition-colors hover:bg-ok-surface"
              >
                {s.format}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Nota + enlace al recurso */}
      <Card tone="muted">
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
          <div className="text-sm leading-relaxed text-body">
            {isService
              ? 'Puedes añadir la URL del servicio en tu SIG (QGIS, ArcGIS) o visor web.'
              : `Los archivos ${GEO_FORMAT_NAMES[format] ?? format}${dead ? ', además, no responden actualmente y' : ''} pueden abrirse en un SIG de escritorio.`}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-1 font-medium text-link underline-offset-2 hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden /> {isService ? 'Abrir servicio' : 'Descargar recurso'}
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
