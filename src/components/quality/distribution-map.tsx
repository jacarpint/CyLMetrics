'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  MapPin, ExternalLink, Info, Loader2, AlertTriangle, RefreshCw,
  Image as ImageIcon, Layers, ServerCrash, Package,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TableExplorer } from '@/components/quality/table-explorer';
import { getSpatialCoords, GEO_FORMAT_NAMES } from '@/lib/geo';
import { readShapefile, describeZip, ShapefileError } from '@/lib/shapefile-read';
import { ZipError } from '@/lib/zip-read';
import { diagnose, sniff, ogcException, type Diagnosis } from '@/lib/geo-diagnose';
import { formatBytes } from '@/lib/quality-labels';
import { cn } from '@/lib/utils';
import type { Bbox, GeoSpec, MapFeature } from '@/components/quality/geo-preview-map';

const GeoPreviewMap = dynamic(() => import('@/components/quality/geo-preview-map'), {
  ssr: false,
  loading: () => <div className="h-[460px] w-full animate-pulse rounded-xl border border-border bg-fill" />,
});

type OgcLayer = { name: string; title: string; bbox?: Bbox | null; queryable?: boolean; crs?: string };

/**
 * Por encima de esto no se descarga sin preguntar: son megas que hay que
 * parsear en el navegador. Está por debajo del tope del proxy (32 MB) y por
 * encima del shapefile más grande que se lee bien (20,3 MB).
 */
const AUTOLOAD_CAP = 24 * 1024 * 1024;
/**
 * Escalera de reserva cuando la capa entera no llega.
 *
 * Hay capas del IDECyL cuyas entidades son polígonos enormes —200 de ellas
 * ocupan 27 MB y tardan medio minuto—, así que un único plan B de 200 tampoco
 * sirve: se va bajando hasta poder enseñar algo.
 */
const WFS_FALLBACK_COUNTS = [200, 25];

interface DistributionMapProps {
  format: string;
  url: string;
  datasetId: string;
  spatial?: string;
  dead?: boolean;
  sizeBytes?: number | null;
  serviceSiblings?: { format: string; idx: number; slug: string }[];
}

/* ── Utilidades ───────────────────────────────────────────────────────── */

/** El proxy solo alcanza los dominios de la Junta recogidos en la allowlist. */
class OutsideDomain extends Error {}

/** El proxy respondió, pero no con el recurso: su código dice por qué. */
class ProxyFailure extends Error {
  constructor(readonly status: number) {
    super(`proxy ${status}`);
  }
}

/** Propiedades de una entidad a texto plano, que es lo que pinta la tabla. */
function toProperties(input: unknown): Record<string, string> {
  if (input === null || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] =
      value === null || value === undefined ? ''
      : typeof value === 'object' ? JSON.stringify(value)
      : String(value);
  }
  return out;
}

/** Campos de una colección, en el orden en que aparecen por primera vez. */
function fieldsOf(features: MapFeature[]): string[] {
  const seen = new Set<string>();
  const fields: string[] = [];
  for (const f of features) {
    for (const key of Object.keys(f.properties)) {
      if (!seen.has(key)) { seen.add(key); fields.push(key); }
    }
  }
  return fields;
}

/* ── KML → entidades (mínimo, con DOMParser del navegador) ── */

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

function kmlToFeatures(xmlText: string): MapFeature[] {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const features: MapFeature[] = [];

  for (const pm of Array.from(doc.getElementsByTagName('Placemark'))) {
    const properties: Record<string, string> = {
      nombre: pm.getElementsByTagName('name')[0]?.textContent?.trim() ?? '',
      descripcion: pm.getElementsByTagName('description')[0]?.textContent?.trim() ?? '',
    };
    // Los datos extendidos del KML son el equivalente a los campos del .dbf.
    for (const data of Array.from(pm.getElementsByTagName('Data'))) {
      const name = data.getAttribute('name');
      const value = data.getElementsByTagName('value')[0]?.textContent?.trim();
      if (name) properties[name] = value ?? '';
    }
    for (const data of Array.from(pm.getElementsByTagName('SimpleData'))) {
      const name = data.getAttribute('name');
      if (name) properties[name] = data.textContent?.trim() ?? '';
    }

    const coordsText = (el: Element) => el.getElementsByTagName('coordinates')[0]?.textContent ?? null;

    for (const pt of Array.from(pm.getElementsByTagName('Point'))) {
      const c = parseCoordString(coordsText(pt));
      if (c[0]) features.push({ geometry: { type: 'Point', coordinates: c[0] }, properties });
    }
    for (const ls of Array.from(pm.getElementsByTagName('LineString'))) {
      const c = parseCoordString(coordsText(ls));
      if (c.length >= 2) features.push({ geometry: { type: 'LineString', coordinates: c }, properties });
    }
    for (const poly of Array.from(pm.getElementsByTagName('Polygon'))) {
      const outer =
        poly.getElementsByTagName('outerBoundaryIs')[0]?.getElementsByTagName('coordinates')[0]?.textContent ??
        coordsText(poly);
      const ring = parseCoordString(outer);
      if (ring.length >= 3) features.push({ geometry: { type: 'Polygon', coordinates: [ring] }, properties });
    }
  }
  return features;
}

/* ── Fuente del recurso ───────────────────────────────────────────────── */

interface VectorLayer {
  name: string;
  features: MapFeature[];
  fields: string[];
  crs?: string | null;
  /** false = venía en una proyección que no sabemos convertir. */
  projected?: boolean;
  nullGeometries?: number;
}

type Source =
  | { kind: 'wms'; getMapUrl: string; version: string; format: string; layers: OgcLayer[]; bbox: Bbox | null }
  | { kind: 'wfs'; getFeatureUrl: string; version: string; featureTypes: OgcLayer[] }
  | { kind: 'vector'; layers: VectorLayer[]; note?: string }
  | { kind: 'too-big'; size: number }
  | { kind: 'none'; diagnosis?: Diagnosis; note?: string };

/* ── Piezas de UI ─────────────────────────────────────────────────────── */

function MapNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-faint">{children}</p>;
}

function LayerPicker({
  label, layers, value, onChange,
}: {
  label: string;
  layers: { name: string; title?: string }[];
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
          <option key={l.name} value={l.name}>{l.title || l.name}</option>
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

function Banner({
  tone, icon: Icon, title, children,
}: {
  tone: 'warn' | 'bad' | 'info';
  icon: typeof Info;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Card tone={tone}>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon
          className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-info')}
          aria-hidden
        />
        <div className="min-w-0 text-sm leading-relaxed text-body">
          {title && <p className="font-semibold text-strong">{title}</p>}
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

/** Explica un fallo diciendo también de quién es, que es la mitad de la información. */
function DiagnosisBanner({ diagnosis, url }: { diagnosis: Diagnosis; url: string }) {
  return (
    <Banner
      tone={diagnosis.origin === 'portal' ? 'warn' : 'bad'}
      icon={ServerCrash}
      title={diagnosis.reason}
    >
      {diagnosis.detail && (
        <p className="mt-1 break-words font-mono text-xs text-faint">{diagnosis.detail}</p>
      )}
      <p className="mt-2 text-xs text-faint">
        {diagnosis.origin === 'publicador'
          ? 'El fallo está en el origen: el recurso publicado en el catálogo ya no entrega los datos que anuncia.'
          : diagnosis.origin === 'portal'
          ? 'El fallo es de este portal, no del archivo publicado.'
          : 'No ha sido posible determinar el origen del fallo.'}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="ml-1 inline-flex items-center gap-1 font-medium text-link underline-offset-2 hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden /> Comprobar la URL original
        </a>
      </p>
    </Banner>
  );
}

/* ── Componente principal ─────────────────────────────────────────────── */

export function DistributionMap({
  format, url, datasetId, spatial, dead, sizeBytes, serviceSiblings = [],
}: DistributionMapProps) {
  const isService = format === 'WMS' || format === 'WFS';
  const sourceKey = `${format}|${url}`;

  /**
   * Los resultados asíncronos se guardan junto a la clave de la petición que
   * los produjo y se comparan en el render. Así el estado solo se toca después
   * de un `await` (nada de renders en cascada) y un resultado que llega tarde
   * nunca se pinta sobre una selección que ya cambió.
   */
  const [sourceResult, setSourceResult] = useState<{ key: string; source: Source } | null>(null);
  const source = sourceResult?.key === sourceKey ? sourceResult.source : null;
  const loading = source === null;

  const [attempt, setAttempt] = useState(0);
  const [opacity, setOpacity] = useState(0.8);
  const [selectedOverride, setSelectedOverride] = useState<{ key: string; name: string } | null>(null);
  const [tileFailedFor, setTileFailedFor] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<{ key: string; index: number } | null>(null);

  const coords = useMemo(() => getSpatialCoords(spatial), [spatial]);

  const pickable: { name: string; title?: string }[] =
    source?.kind === 'wms' ? source.layers
    : source?.kind === 'wfs' ? source.featureTypes
    : source?.kind === 'vector' ? source.layers.map((l) => ({ name: l.name, title: l.name }))
    : [];

  // La primera capa es la selección por defecto: se deriva, no se copia a
  // estado, así que cambiar de recurso no deja seleccionada la capa anterior.
  const selected = selectedOverride?.key === sourceKey ? selectedOverride.name : pickable[0]?.name ?? '';
  const setSelected = (name: string) => {
    setSelectedOverride({ key: sourceKey, name });
    setSelectedFeature(null);
  };

  /* ── 1. Cargar el recurso ── */
  useEffect(() => {
    let cancelled = false;
    const key = sourceKey;
    const controller = new AbortController();

    /** Descarga por el proxy conservando el error real del origen. */
    async function fetchRaw(target: string): Promise<{ buffer: ArrayBuffer; status: number }> {
      const res = await fetch(`/api/proxy?raw=1&url=${encodeURIComponent(target)}`, { signal: controller.signal });
      // 400 del proxy = host fuera de la lista permitida, no un fallo del origen.
      if (res.status === 400) throw new OutsideDomain();
      if (!res.ok) throw new ProxyFailure(res.status);
      return {
        buffer: await res.arrayBuffer(),
        status: Number(res.headers.get('x-origin-status') ?? 200),
      };
    }

    async function run(): Promise<Source> {
      try {
        if (isService) {
          const res = await fetch(`/api/ogc?service=${format}&url=${encodeURIComponent(url)}`, { signal: controller.signal });
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

        // Archivos: primero se mira si conviene descargarlos sin preguntar.
        if (sizeBytes != null && sizeBytes > AUTOLOAD_CAP && attempt === 0) {
          return { kind: 'too-big', size: sizeBytes };
        }

        const { buffer, status } = await fetchRaw(url);
        if (cancelled) return { kind: 'none' };

        const kind = sniff(buffer);
        const expected = format === 'SHP' ? 'un shapefile comprimido' : `un archivo ${format}`;

        // Un ZIP puede traer un shapefile (se pinta) o cualquier otra cosa
        // (se dice qué es, que ya es más de lo que había).
        if (kind === 'zip') {
          try {
            const shapes = await readShapefile(buffer);
            return {
              kind: 'vector',
              layers: shapes.map((s) => ({
                name: s.name,
                features: s.features,
                fields: s.fields,
                crs: s.crs,
                projected: s.projected,
                nullGeometries: s.nullGeometries,
              })),
            };
          } catch (err) {
            if (err instanceof ZipError) return { kind: 'none', diagnosis: diagnose(buffer, expected) };
            if (err instanceof ShapefileError) {
              const { extensions } = await describeZip(buffer).catch(() => ({ extensions: [] as string[] }));
              const gpkg = extensions.includes('gpkg');
              return {
                kind: 'none',
                diagnosis: {
                  reason: gpkg
                    ? 'El archivo es un GeoPackage comprimido, un formato que el visor todavía no sabe dibujar.'
                    : 'El archivo comprimido no contiene un shapefile.',
                  detail: extensions.length ? `Dentro del ZIP hay: ${extensions.join(', ')}.` : err.message,
                  origin: 'portal',
                },
              };
            }
            throw err;
          }
        }

        if (format === 'KML' && (kind === 'xml' || kind === 'texto')) {
          const xml = new TextDecoder('utf-8').decode(buffer);
          const exception = ogcException(xml);
          if (!exception) {
            const features = kmlToFeatures(xml);
            if (features.length) {
              return { kind: 'vector', layers: [{ name: 'KML', features, fields: fieldsOf(features) }] };
            }
          }
        }

        if (kind === 'json') {
          const data = JSON.parse(new TextDecoder('utf-8').decode(buffer));
          const list: unknown[] = Array.isArray(data?.features) ? data.features : [];
          const features: MapFeature[] = list.map((f) => {
            const feature = f as { geometry?: GeoJSON.Geometry; properties?: unknown };
            return { geometry: feature.geometry ?? null, properties: toProperties(feature.properties) };
          });
          if (features.length) {
            return { kind: 'vector', layers: [{ name: 'GeoJSON', features, fields: fieldsOf(features) }] };
          }
        }

        // Nada de lo anterior: se explica qué llegó de verdad.
        return { kind: 'none', diagnosis: diagnose(buffer, expected, status) };
      } catch (err) {
        if ((err as Error).name === 'AbortError') return { kind: 'none' };
        let host = 'otro dominio';
        try { host = new URL(url).hostname; } catch { /* la URL del catálogo puede venir mal formada */ }

        if (err instanceof OutsideDomain) {
          return {
            kind: 'none',
            diagnosis: {
              reason: `El recurso está alojado en ${host}, fuera de los dominios que este portal puede consultar.`,
              detail: 'Solo se descargan recursos de los dominios de la Junta recogidos en el catálogo, para no convertir el portal en un proxy abierto. El archivo puede seguir siendo válido: se abre con el enlace de descarga.',
              origin: 'portal',
            },
          };
        }

        if (err instanceof ProxyFailure) {
          if (err.status === 413) {
            return {
              kind: 'none',
              diagnosis: {
                reason: 'El recurso supera el tamaño que el portal puede descargar para previsualizar.',
                detail: 'El archivo puede estar perfectamente; simplemente no cabe en el visor. Descárgalo y ábrelo en un SIG.',
                origin: 'portal',
              },
            };
          }
          return {
            kind: 'none',
            diagnosis: {
              reason: `No se pudo contactar con ${host}.`,
              detail: 'El servidor de origen no respondió a tiempo, rechazó la conexión o no existe. El recurso sigue anunciado en el catálogo.',
              origin: 'publicador',
            },
          };
        }

        return { kind: 'none', note: 'No se pudo cargar la previsualización del recurso.' };
      }
    }

    run().then((value) => {
      if (!cancelled) setSourceResult({ key, source: value });
    });

    return () => { cancelled = true; controller.abort(); };
  }, [sourceKey, format, url, isService, sizeBytes, attempt]);

  /* ── 2. Entidades del WFS: la capa entera siempre que el servicio pueda ── */
  const wfsKey = source?.kind === 'wfs' && selected ? `${sourceKey}|${selected}|${attempt}` : null;
  const [wfsResult, setWfsResult] = useState<
    | { key: string; layer: VectorLayer; matched: number | null; complete: boolean }
    | { key: string; error: string }
    | null
  >(null);
  const wfsFor = wfsResult?.key === wfsKey ? wfsResult : null;
  const wfsLayer = wfsFor && !('error' in wfsFor) ? wfsFor : null;
  const wfsLoading = wfsKey !== null && wfsFor === null;

  useEffect(() => {
    if (!source || source.kind !== 'wfs' || !selected || !wfsKey) return;
    let cancelled = false;
    const controller = new AbortController();
    const key = wfsKey;
    const isV2 = source.version.startsWith('2');

    const request = (extra: Record<string, string>) => {
      const gf = new URL(source.getFeatureUrl);
      gf.searchParams.set('service', 'WFS');
      gf.searchParams.set('version', source.version);
      gf.searchParams.set('request', 'GetFeature');
      gf.searchParams.set(isV2 ? 'typeNames' : 'typeName', selected);
      gf.searchParams.set('srsName', 'EPSG:4326');
      for (const [k, v] of Object.entries(extra)) gf.searchParams.set(k, v);
      return `/api/proxy?url=${encodeURIComponent(gf.toString())}`;
    };

    (async () => {
      // `resultType=hits` devuelve solo el recuento y responde en milisegundos:
      // sirve para saber de antemano cuántas entidades tiene la capa y para
      // contrastar después si se han traído todas.
      let matched: number | null = null;
      try {
        const res = await fetch(request({ resultType: 'hits' }), { signal: controller.signal });
        const text = await res.text();
        const hit = /numberMatched="(\d+)"|numberOfFeatures="(\d+)"/.exec(text);
        if (hit) matched = Number(hit[1] ?? hit[2]);
      } catch {
        // El recuento es opcional: si no llega, se sigue igualmente.
      }
      if (cancelled) return;

      const load = async (extra: Record<string, string>) => {
        const res = await fetch(request({ outputFormat: 'application/json', ...extra }), { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list: unknown[] = Array.isArray(data?.features) ? data.features : [];
        if (!list.length) throw new Error('sin entidades');
        const features: MapFeature[] = list.map((f) => {
          const feature = f as { geometry?: GeoJSON.Geometry; properties?: unknown };
          return { geometry: feature.geometry ?? null, properties: toProperties(feature.properties) };
        });
        return features;
      };

      // Primero la capa completa; esa es la idea. Si el servicio no puede, se
      // baja el listón hasta poder enseñar algo, diciendo que es una parte.
      let lastError = 'sin respuesta';
      for (const count of [null, ...WFS_FALLBACK_COUNTS]) {
        try {
          const features = await load(count === null ? {} : { [isV2 ? 'count' : 'maxFeatures']: String(count) });
          if (cancelled) return;
          setWfsResult({
            key,
            layer: { name: selected, features, fields: fieldsOf(features) },
            matched,
            complete: count === null && (matched === null || features.length >= matched),
          });
          return;
        } catch (err) {
          if (cancelled || (err as Error).name === 'AbortError') return;
          lastError = (err as Error).message;
        }
      }
      if (!cancelled) setWfsResult({ key, error: lastError });
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [source, selected, wfsKey]);

  /* ── 3. Qué se pinta ── */
  const activeLayer: VectorLayer | null =
    source?.kind === 'vector'
      ? source.layers.find((l) => l.name === selected) ?? source.layers[0] ?? null
      : wfsLayer?.layer ?? null;

  const featureIndex = selectedFeature?.key === `${sourceKey}|${selected}` ? selectedFeature.index : null;
  const selectFeature = useCallback(
    (index: number | null) => {
      setSelectedFeature(index === null ? null : { key: `${sourceKey}|${selected}`, index });
    },
    [sourceKey, selected]
  );

  const spec: GeoSpec | null = useMemo(() => {
    if (source?.kind === 'wms' && selected) {
      const layer = source.layers.find((l) => l.name === selected);
      return {
        kind: 'wms',
        getMapUrl: source.getMapUrl,
        layers: selected,
        version: source.version,
        format: source.format,
        bbox: layer?.bbox ?? source.bbox,
        opacity,
      };
    }
    if (activeLayer && activeLayer.projected !== false && activeLayer.features.length) {
      return { kind: 'features', features: activeLayer.features, selected: featureIndex };
    }
    if (coords) {
      return { kind: 'locator', lat: coords[0], lng: coords[1], label: spatial ?? 'Cobertura declarada', hasError: dead };
    }
    return null;
  }, [source, selected, opacity, activeLayer, featureIndex, coords, spatial, dead]);

  const tileKey = `${sourceKey}|${selected}`;
  const onTileError = useCallback(() => setTileFailedFor(tileKey), [tileKey]);
  const tileFailed = tileFailedFor === tileKey;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-fill p-4 text-sm text-faint">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando y dibujando el recurso completo…
      </div>
    );
  }

  if (source.kind === 'too-big') {
    return (
      <Banner tone="warn" icon={AlertTriangle} title={`El recurso ocupa ${formatBytes(source.size)}`}>
        <p className="mt-1">
          No se descarga solo para no cargar tantos datos en el navegador sin avisar.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="font-medium text-link underline-offset-2 hover:underline"
          >
            Dibujarlo de todos modos
          </button>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-link underline-offset-2 hover:underline">
            <ExternalLink className="h-3 w-3" aria-hidden /> Descargar el recurso
          </a>
        </div>
      </Banner>
    );
  }

  const selectedTitle = pickable.find((l) => l.name === selected)?.title;
  const shownFeatures = activeLayer?.features.length ?? 0;

  return (
    <div className="space-y-3">
      {/* Controles */}
      {(pickable.length > 1 || source.kind === 'wms') && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
          <LayerPicker
            label={source.kind === 'wms' ? 'Capa' : source.kind === 'wfs' ? 'Entidad' : 'Capa'}
            layers={pickable}
            value={selected}
            onChange={setSelected}
          />
          {source.kind === 'wms' && (
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
        <div className="flex h-[460px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-fill text-sm text-faint">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Descargando la capa completa del servicio…
        </div>
      ) : spec ? (
        <GeoPreviewMap spec={spec} onTileError={onTileError} onSelectFeature={selectFeature} />
      ) : source.kind === 'none' && source.diagnosis ? null : (
        <Card tone="muted">
          <CardContent className="flex items-start gap-3 p-4">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
            <p className="text-sm text-body">
              No se puede previsualizar la geometría de este recurso ni situarlo en el mapa
              {source.kind === 'none' && source.note ? <> — {source.note.toLowerCase()}</> : '.'}
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
      {spec?.kind === 'features' && activeLayer && (
        <MapNote>
          {shownFeatures.toLocaleString('es-ES')} entidades dibujadas
          {wfsLayer && !wfsLayer.complete && wfsLayer.matched
            ? <> de {wfsLayer.matched.toLocaleString('es-ES')} que tiene la capa — el servicio no pudo entregarla entera</>
            : <> · el recurso completo</>}
          {activeLayer.crs ? <> · origen en {activeLayer.crs}, reproyectado a WGS84</> : null}
          {activeLayer.nullGeometries ? <> · {activeLayer.nullGeometries.toLocaleString('es-ES')} sin geometría</> : null}
          . Pulsa una entidad en el mapa o una fila de la tabla y se resaltan a la vez.
        </MapNote>
      )}
      {spec?.kind === 'locator' && (
        <MapNote>
          Ubicación orientativa según la cobertura declarada{spatial ? ` (${spatial})` : ''}; no es la geometría real
          del recurso, que no se ha podido dibujar.
        </MapNote>
      )}

      {/* Por qué no se ve el recurso */}
      {source.kind === 'none' && source.diagnosis && <DiagnosisBanner diagnosis={source.diagnosis} url={url} />}

      {/* La geometría existe pero no sabemos dónde ponerla */}
      {activeLayer && activeLayer.projected === false && (
        <Banner tone="warn" icon={AlertTriangle} title="No se puede situar la geometría en el mapa">
          <p className="mt-1">
            El shapefile usa el sistema de referencia{' '}
            <strong className="text-body">{activeLayer.crs ?? 'no declarado'}</strong>, que el visor no sabe
            convertir a coordenadas geográficas. Los atributos sí se pueden consultar abajo.
          </p>
        </Banner>
      )}

      {/* El servicio respondió, pero no pintó nada */}
      {tileFailed && (
        <Banner tone="warn" icon={AlertTriangle}>
          El servicio no devolvió la cartografía de esta capa. Puede estar temporalmente
          caído o no admitir el sistema de referencia del visor.
          {pickable.length > 1 && ' Prueba con otra capa del desplegable.'}
        </Banner>
      )}

      {/* El WFS no entregó las entidades */}
      {wfsFor && 'error' in wfsFor && (
        <Banner tone="warn" icon={AlertTriangle} title="El servicio WFS no entregó esta capa">
          <p className="mt-1">
            <strong className="text-body">{selectedTitle || selected}</strong> no llegó ni completa ni
            en muestra ({wfsFor.error}). Es habitual en capas de polígonos muy pesadas.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-field px-2.5 py-1 text-xs font-medium text-body transition-colors hover:bg-fill"
            >
              <RefreshCw className="h-3 w-3" aria-hidden /> Reintentar
            </button>
            {serviceSiblings.filter((s) => s.format === 'WMS').map((s) => (
              <Link
                key={s.idx}
                href={`/catalogo/${datasetId}/${s.slug}`}
                className="text-xs font-medium text-link underline-offset-2 hover:underline"
              >
                Ver esta cartografía por WMS
              </Link>
            ))}
          </div>
        </Banner>
      )}

      {/* Leyenda del WMS */}
      {source.kind === 'wms' && selected && (
        <WmsLegend getMapUrl={source.getMapUrl} version={source.version} layer={selected} />
      )}

      {/* ── Atributos de las entidades ──────────────────────────────────
          Antes esto solo existía como globo al pulsar en el mapa, y la lista
          de capas se repetía en una tarjeta aparte. Ahora los atributos se
          exploran como cualquier otro formato tabular y la selección va en los
          dos sentidos: del mapa a la tabla y de la tabla al mapa. */}
      {activeLayer && activeLayer.features.length > 0 && (
        <section className="pt-1">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
            <Layers className="h-4 w-4 text-faint" aria-hidden />
            Entidades y sus atributos
          </h3>
          <TableExplorer
            header={activeLayer.fields}
            rows={activeLayer.features.map((f) => activeLayer.fields.map((k) => f.properties[k] ?? ''))}
            voice="record"
            dataLabel="Entidades"
            downloadUrl={url}
            selectedRow={featureIndex}
            onSelectRow={selectFeature}
            summary={
              <>
                {shownFeatures.toLocaleString('es-ES')} entidades
                {wfsLayer && !wfsLayer.complete && wfsLayer.matched
                  ? ` de ${wfsLayer.matched.toLocaleString('es-ES')}`
                  : ' · recurso completo'}
              </>
            }
          />
        </section>
      )}

      {/* Servicios hermanos cuando este recurso no se puede dibujar */}
      {!isService && spec?.kind !== 'features' && serviceSiblings.length > 0 && (
        <Card tone="ok">
          <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm text-body">
            <Info className="h-4 w-4 shrink-0 text-ok" aria-hidden />
            Este dataset también ofrece servicios visualizables:
            {serviceSiblings.map((s) => (
              <Link
                key={s.idx}
                href={`/catalogo/${datasetId}/${s.slug}`}
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
          {isService ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
            : <Package className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />}
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
