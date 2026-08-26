'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  MapPinOff, ExternalLink, Info, Loader2, AlertTriangle, RefreshCw,
  Layers, ServerCrash, Package,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TableExplorer } from '@/components/quality/table-explorer';
import { GEO_FORMAT_NAMES } from '@/lib/geo';
import { spatialLabel } from '@/lib/vocabularies';
import { readShapefile, describeZip, ShapefileError } from '@/lib/shapefile-read';
import { ZipError } from '@/lib/zip-read';
import { diagnose, sniff, ogcException, type Diagnosis } from '@/lib/geo-diagnose';
import { formatBytes } from '@/lib/quality-labels';
import { MAP_AUTOLOAD_CAP, needsRangeDownload, rangeChunkCount } from '@/lib/download-budget';
import { DownloadError, downloadResource, type Progress } from '@/lib/progressive-fetch';
import {
  bboxParam, budgetExhausted, heaviestPerFeature, looksTruncatedByCap, nextPageSize, padView,
  pageFingerprint, shouldRefetchView, shrinkPageSize, type ViewBox,
  WFS_MAX_PAGE_SIZE, WFS_MAX_PAGES, WFS_MAX_SHRINKS, WFS_MAX_TOTAL_BYTES,
  WFS_PROBE_SIZE, WFS_TARGET_PAGE_BYTES,
} from '@/lib/wfs-paging';
import { simplifyGeometry, toleranceForZoom } from '@/lib/geo-simplify';
import { cn } from '@/lib/utils';
import type { Bbox, GeoSpec, MapFeature } from '@/components/quality/geo-preview-map';

const GeoPreviewMap = dynamic(() => import('@/components/quality/geo-preview-map'), {
  ssr: false,
  loading: () => <div className="h-[460px] w-full animate-pulse rounded-xl border border-border bg-fill" />,
});

type OgcLayer = { name: string; title: string; bbox?: Bbox | null; queryable?: boolean; crs?: string };

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

/**
 * La página del WFS no cabe en una petición del proxy: hay que volver a pedirla
 * con menos entidades. No es un fallo del servicio.
 */
class OversizePage extends Error {}

/**
 * Por qué se dejó de pedir páginas a un WFS. Cada motivo se cuenta distinto,
 * porque «el servicio no pudo» y «paramos nosotros» son cosas diferentes y
 * antes se enseñaban las dos con la misma frase.
 */
type WfsStop =
  /** Llegaron todas las entidades de la capa. */
  | 'completa'
  /** El servicio dejó de entregar antes de terminar. */
  | 'servicio'
  /** El servicio es WFS 1.x: sin `startIndex` solo hay una página. */
  | 'sin-paginacion'
  /** Se alcanzó el máximo que el visor descarga de una capa. */
  | 'presupuesto'
  /** Se alcanzó el tope de páginas. */
  | 'paginas';

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

/**
 * Resolución a la que se pide la leyenda, en puntos por pulgada.
 *
 * `GetLegendGraphic` devuelve un PNG del tamaño que decida el servicio, y el de
 * GeoServer sale a 90 ppp: 157×93 px para una capa de cinco clases, que dentro
 * del mapa se lee pequeño. Ampliarlo por CSS emborrona el texto, así que se le
 * pide al servicio que lo dibuje más grande: a 180 ppp la misma leyenda sale a
 * 296×132 px, rotulada y con sus símbolos a esa escala, no interpolada.
 *
 * `LEGEND_OPTIONS` es una extensión de GeoServer —16 de los 18 servicios del
 * catálogo lo son—. El ArcGIS Server de `suelos.itacyl.es` la ignora y devuelve
 * su leyenda normal, que es el comportamiento correcto para un parámetro que no
 * se conoce; para el servidor que algún día no lo haga está `plain`.
 */
const LEGEND_DPI = 180;

/**
 * URLs de la leyenda de una capa WMS, o null si no se puede componer.
 *
 * Sin leyenda los colores de un WMS no significan nada. Estaba en una tarjeta
 * debajo del mapa, así que para saber qué era cada color había que apartar la
 * vista del mapa y volver; ahora la pinta el propio mapa en su esquina (ver
 * `legendControl` en `geo-preview-map.tsx`) y esto solo arma las direcciones.
 */
function legendUrls(getMapUrl: string, version: string, layer: string): { url: string; plain: string } | null {
  try {
    const u = new URL(getMapUrl);
    u.searchParams.set('service', 'WMS');
    u.searchParams.set('request', 'GetLegendGraphic');
    u.searchParams.set('version', version);
    u.searchParams.set('format', 'image/png');
    u.searchParams.set('layer', layer);
    u.searchParams.set('transparent', 'true');
    const plain = u.toString();

    u.searchParams.set('LEGEND_OPTIONS', `dpi:${LEGEND_DPI}`);
    return { url: u.toString(), plain };
  } catch {
    // `getMapUrl` sale de las capacidades del servicio y debería ser absoluta;
    // si no lo es, no hay leyenda que pedir, pero el mapa se pinta igual.
    return null;
  }
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

/**
 * El hueco del mapa cuando no hay ninguna geometría que dibujar.
 *
 * Lo que había antes era un mapa de verdad con un punto en el centro de la
 * cobertura declarada del conjunto. En este catálogo esa cobertura es la misma
 * para casi todo —Castilla y León—, así que el respaldo de cualquier fallo era
 * el mismo punto en Valladolid, y al pulsarlo salía la URI del vocabulario en
 * crudo. Enseñar un mapa con algo dentro afirma que ese algo es el recurso;
 * cuando el recurso no se ha podido cargar, la respuesta honesta es un hueco
 * que lo diga, no un marcador que rellene el espacio.
 */
function NoGeometry({ reason, coverage }: { reason: string; coverage?: string | null }) {
  return (
    <div className="flex min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-fill px-6 py-8 text-center">
      <MapPinOff className="h-6 w-6 text-faint" aria-hidden />
      <p className="max-w-prose text-sm font-medium text-body">{reason}</p>
      {coverage && (
        <p className="max-w-prose text-xs leading-relaxed text-faint">
          El catálogo declara que este conjunto cubre{' '}
          <strong className="font-medium text-body">{coverage}</strong>, pero eso es la cobertura
          del conjunto de datos, no la geometría del archivo: no hay nada que situar en el mapa.
        </p>
      )}
    </div>
  );
}

/** Por qué el mapa enseña menos entidades de las que tiene la capa. */
const WFS_STOP_NOTES: Record<WfsStop | 'cargando', string> = {
  completa: '',
  cargando: 'todavía se están descargando',
  servicio: 'el servicio dejó de entregarlas',
  'sin-paginacion': 'el servicio es WFS 1.x y no admite pedir más páginas',
  // «de esta zona» y no «de una capa»: desde que se pide por `bbox`, el tope se
  // agota sobre lo que hay en el encuadre, y acercarse lo resuelve.
  presupuesto: 'el visor paró al llegar al máximo que descarga de una zona; acércate para verlas todas',
  paginas: 'el visor paró al llegar a su tope de páginas',
};

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
  /** Bytes recibidos del recurso geográfico, para la barra de progreso. */
  const [progress, setProgress] = useState<Progress | null>(null);

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

    /**
     * Descarga por el proxy conservando el error real del origen.
     *
     * Pasa por `downloadResource`, así que un shapefile o un GeoJSON de más de
     * lo que cabe en una petición se trae por tramos en lugar de rechazarse, y
     * el progreso llega a la interfaz mientras baja.
     */
    async function fetchRaw(target: string): Promise<{ buffer: ArrayBuffer; status: number }> {
      try {
        const bytes = await downloadResource(target, {
          signal: controller.signal,
          raw: true,
          knownSize: sizeBytes ?? null,
          onProgress: (p) => { if (!cancelled) setProgress(p); },
        });
        return { buffer: bytes.slice().buffer, status: 200 };
      } catch (err) {
        if (err instanceof DownloadError) {
          // 400 del proxy = host fuera de la lista permitida, no un fallo del
          // origen; el resto se presenta como fallo del proxy, con su código.
          if (err.status === 400) throw new OutsideDomain();
          throw new ProxyFailure(err.status ?? 502);
        }
        throw err;
      }
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
        if (sizeBytes != null && sizeBytes > MAP_AUTOLOAD_CAP && attempt === 0) {
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

  /* ── 2. Entidades del WFS: las de la vista, no «la capa entera» ────────────
     Ver `shouldRefetchView` en `lib/wfs-paging.ts`. Traer una capa completa no
     es alcanzable —763 MB en la peor del catálogo— y subir el tope solo cambia
     cuánto se tarda en no conseguirlo. Lo que sí se puede es traer lo que se
     está mirando, que es lo que se venía a ver. */

  /**
   * Lo que se está pidiendo ahora mismo: la caja (ya con su margen) y el zoom.
   *
   * Es el único estado de la vista, y cambia SOLO cuando hay que ir a buscar
   * algo. Un arrastre que cae dentro de lo ya traído devuelve el mismo objeto,
   * React no re-renderiza y el efecto ni se entera.
   *
   * La decisión se toma en el manejador y no al derivar durante el render: leer
   * durante el render lo que se cargó la última vez obliga a guardarlo en una
   * ref y consultarla ahí, que es justo lo que React no garantiza (y lo que
   * `react-hooks/refs` señala).
   */
  const [viewRequest, setViewRequest] = useState<{ box: ViewBox; zoom: number } | null>(null);

  const onViewportChange = useCallback((next: ViewBox & { zoom: number }) => {
    setViewRequest((current) =>
      shouldRefetchView(current, { box: next, zoom: next.zoom })
        ? { box: padView(next), zoom: next.zoom }
        : current
    );
  }, []);

  /** Marca de lo pedido, para las dependencias del efecto. */
  const viewKey = viewRequest ? `${bboxParam(viewRequest.box)}|${viewRequest.zoom}` : 'sin-vista';

  /**
   * La clave del resultado es la CAPA, no la vista.
   *
   * Tentador meter `viewKey` aquí, y está mal: `wfsFor` compara esta clave con la
   * del último resultado, así que al mover el mapa dejaría de casar y las
   * entidades desaparecerían de la pantalla hasta que llegara la primera página
   * nueva. Lo que se está viendo tiene que seguir viéndose mientras se recarga.
   * La vista entra solo en las dependencias del efecto, más abajo.
   */
  const wfsKey = source?.kind === 'wfs' && selected ? `${sourceKey}|${selected}|${attempt}` : null;
  const [wfsResult, setWfsResult] = useState<
    | { key: string; layer: VectorLayer; matched: number | null; stop: WfsStop | null; bytes: number }
    | { key: string; error: string; detail?: string }
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

    /**
     * La caja que se pide, con su margen. `null` mientras el mapa no ha dicho
     * qué se ve, y en WFS 1.x: allí no hay `startIndex`, así que solo se puede
     * pedir una página y acotarla no ayuda a recorrer la capa.
     */
    const box = isV2 && viewRequest ? viewRequest.box : null;
    /* La tolerancia sale del zoom al que se pidió: un píxel de pantalla. Ver
       `geo-simplify`. Sin vista todavía, se asume la de la comunidad entera, que
       es el encuadre de arranque. */
    const tolerance = toleranceForZoom(viewRequest?.zoom ?? 7);

    const request = (extra: Record<string, string>) => {
      const gf = new URL(source.getFeatureUrl);
      gf.searchParams.set('service', 'WFS');
      gf.searchParams.set('version', source.version);
      gf.searchParams.set('request', 'GetFeature');
      gf.searchParams.set(isV2 ? 'typeNames' : 'typeName', selected);
      gf.searchParams.set('srsName', 'EPSG:4326');
      if (box) gf.searchParams.set('bbox', bboxParam(box));
      for (const [k, v] of Object.entries(extra)) gf.searchParams.set(k, v);
      return `/api/proxy?url=${encodeURIComponent(gf.toString())}`;
    };

    (async () => {
      // `resultType=hits` devuelve solo el recuento y responde en milisegundos:
      // sirve para saber de antemano cuántas entidades tiene la capa.
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

      /**
       * Una página. Devuelve también lo que ha pesado, que es lo que permite
       * dimensionar la siguiente.
       *
       * Se lee como texto y se parsea aquí en lugar de con `res.json()` porque
       * el tamaño del cuerpo es justo el dato que hacía falta: cuando el proxy
       * corta una respuesta por pasarse de su tope, lo que llega es un JSON
       * partido, y sin mirar el tamaño ese fallo era indistinguible de un
       * servicio que devuelve basura.
       */
      const load = async (extra: Record<string, string>): Promise<{ features: MapFeature[]; bytes: number }> => {
        let text: string;
        try {
          const res = await fetch(request({ outputFormat: 'application/json', ...extra }), { signal: controller.signal });
          // El proxy responde 413 cuando el origen declara más de su tope.
          if (res.status === 413) throw new OversizePage();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          text = await res.text();
        } catch (err) {
          if (err instanceof OversizePage) throw err;
          if ((err as Error).name === 'AbortError') throw err;
          // El corte del proxy llega como fallo de red al leer el cuerpo: la
          // respuesta empezó con 200 y se abortó a mitad.
          if (err instanceof TypeError) throw new OversizePage();
          throw err;
        }

        const bytes = text.length;
        let data: { features?: unknown };
        try {
          data = JSON.parse(text);
        } catch {
          if (looksTruncatedByCap(bytes)) throw new OversizePage();
          // Un GeoServer que no sabe servir esta capa en JSON contesta un
          // ExceptionReport; decirlo vale más que «no es JSON válido».
          const exception = ogcException(text.slice(0, 8192));
          throw new Error(exception?.text ?? 'el servicio no devolvió GeoJSON');
        }

        const list: unknown[] = Array.isArray(data?.features) ? data.features : [];
        const features: MapFeature[] = list.map((f) => {
          const feature = f as { geometry?: GeoJSON.Geometry; properties?: unknown };
          return {
            /* Se simplifica AQUÍ, antes de guardar nada: las geometrías del
               IDECyL traen una mediana de 2.571 puntos por entidad y 20,3
               millones en la capa completa, casi todos por debajo del tamaño de
               un píxel. Quedarse con los que se ven quita el 94% a escala de
               comunidad y no cambia el dibujo. Ver `geo-simplify`. */
            geometry: simplifyGeometry(feature.geometry ?? null, tolerance),
            properties: toProperties(feature.properties),
          };
        });
        return { features, bytes };
      };

      /**
       * Paginación con la talla medida, no fijada.
       *
       * Antes las páginas eran de 500 entidades siempre. En las capas de
       * polígonos del IDECyL —del orden de 100 KB por entidad— eso son ~50 MB
       * por página, por encima del tope del proxy, que cortaba el cuerpo y
       * dejaba un JSON partido; el visor no dibujaba NADA de una capa que el
       * servicio entrega sin problema en trozos más cortos.
       *
       * Ahora la primera página es de sondeo y cada una de las siguientes se
       * dimensiona con los bytes por entidad recién observados. Si aun así una
       * página no cabe, se reintenta esa misma más corta en vez de abandonar la
       * capa. Ver `lib/wfs-paging.ts`.
       */
      const collected: MapFeature[] = [];
      const seenPages = new Set<string>();
      let lastError = 'sin respuesta';
      let lastDetail: string | undefined;
      /**
       * En WFS 2.0 la primera página es de sondeo: hay muchas más detrás y sale
       * a cuenta medir con una corta. En 1.x no hay `startIndex`, así que esa
       * primera página es la única que se va a poder pedir y sondear con ella
       * sería quedarse con 25 entidades de la capa; se pide todo lo que cabe y,
       * si no cabe, el reintento más corto lo recoge.
       */
      let pageSize = isV2 ? WFS_PROBE_SIZE : WFS_MAX_PAGE_SIZE;
      let shrinks = 0;
      let totalBytes = 0;
      let perFeature = 0;
      let stop: WfsStop | null = null;

      for (let page = 0; page < WFS_MAX_PAGES && stop === null; page++) {
        const paging: Record<string, string> = {
          [isV2 ? 'count' : 'maxFeatures']: String(pageSize),
        };
        // `startIndex` es de WFS 2.0. En 1.x no existe: solo se puede pedir la
        // primera página, así que se para ahí y se dice que es parcial.
        if (collected.length > 0) {
          if (!isV2) { stop = 'sin-paginacion'; break; }
          paging.startIndex = String(collected.length);
        }

        try {
          const { features, bytes } = await load(paging);
          if (cancelled) return;
          if (features.length === 0) { stop = 'completa'; break; }

          // Un servicio que ignora `startIndex` devuelve la misma página una y
          // otra vez. Sin esta comprobación, el bucle acumularía duplicados
          // hasta agotar el tope de páginas.
          const fingerprint = pageFingerprint(features[0]);
          if (seenPages.has(fingerprint)) { stop = 'sin-paginacion'; break; }
          seenPages.add(fingerprint);

          collected.push(...features);
          totalBytes += bytes;
          setWfsResult({
            key,
            layer: { name: selected, features: [...collected], fields: fieldsOf(collected) },
            matched,
            stop: null,
            bytes: totalBytes,
          });

          if (features.length < pageSize) { stop = 'completa'; break; }
          if (matched !== null && collected.length >= matched) { stop = 'completa'; break; }

          perFeature = heaviestPerFeature(perFeature, bytes, features.length);
          if (budgetExhausted(totalBytes, perFeature)) { stop = 'presupuesto'; break; }
          pageSize = nextPageSize(pageSize, perFeature, WFS_MAX_TOTAL_BYTES - totalBytes);
        } catch (err) {
          if (cancelled || (err as Error).name === 'AbortError') return;

          if (err instanceof OversizePage && shrinks < WFS_MAX_SHRINKS) {
            // La página no cupo: se vuelve a pedir la misma, más corta. No
            // cuenta como página consumida.
            shrinks++;
            pageSize = shrinkPageSize(pageSize);
            page--;
            continue;
          }

          if (err instanceof OversizePage) {
            // `OversizePage` cubre también el fallo de red al leer el cuerpo, así
            // que el mensaje dice lo que se ha observado —la respuesta se cortó—
            // y deja la causa más probable para el detalle.
            lastError = `la respuesta se cortó incluso pidiendo ${pageSize} entidades`;
            lastDetail = `Suele significar que cada entidad pesa más de ${formatBytes(WFS_TARGET_PAGE_BYTES / pageSize)}, más de lo que el portal puede retransmitir de una vez.`;
          } else {
            lastError = (err as Error).message;
          }
          stop = 'servicio';
          break;
        }
      }

      if (cancelled) return;
      if (collected.length === 0) { setWfsResult({ key, error: lastError, detail: lastDetail }); return; }
      setWfsResult({
        key,
        layer: { name: selected, features: collected, fields: fieldsOf(collected) },
        matched,
        stop: stop === 'completa' && matched !== null && collected.length < matched ? 'servicio' : stop ?? 'paginas',
        bytes: totalBytes,
      });
    })();

    return () => { cancelled = true; controller.abort(); };
    // `viewKey` entra en las dependencias porque resume lo pedido en una cadena:
    // mientras el mapa se mueva dentro de lo ya traído no cambia, y el efecto no
    // vuelve a ejecutarse por muchos `moveend` que lleguen.
  }, [source, selected, wfsKey, viewKey, viewRequest]);

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
        legend: legendUrls(source.getMapUrl, source.version, selected),
      };
    }
    if (activeLayer && activeLayer.projected !== false && activeLayer.features.length) {
      return { kind: 'features', features: activeLayer.features, selected: featureIndex };
    }
    /*
     * Y aquí no hay respaldo, a propósito.
     *
     * Cuando no se podía dibujar el recurso, se pintaba un mapa de verdad con
     * UN punto en el centro de la cobertura declarada del conjunto: para los
     * 825 datasets de este catálogo, el mismo punto en Valladolid, y al pulsarlo
     * salía la URI del vocabulario (`…/territorio/Autonomia/Castilla-Leon`).
     * Un mapa con un marcador dentro se lee como «esto es el recurso», así que
     * el respaldo de un fallo era indistinguible de una capa de un solo punto.
     * Ahora el hueco lo ocupa `NoGeometry`, que dice que no hay geometría.
     */
    return null;
  }, [source, selected, opacity, activeLayer, featureIndex]);

  const tileKey = `${sourceKey}|${selected}`;
  const onTileError = useCallback(() => setTileFailedFor(tileKey), [tileKey]);
  const tileFailed = tileFailedFor === tileKey;

  /**
   * Tabla de atributos de la capa activa.
   *
   * Memoizada porque se construía en el JSX: una copia completa de los
   * atributos de TODAS las entidades en cada render —incluido mover el
   * deslizador de opacidad o seleccionar una entidad—, que además obligaba a
   * `TableExplorer` a reperfilar y reanalizar las columnas cada vez. Con 77.000
   * entidades eso es lo que dejaba la interfaz clavada.
   */
  const attributeRows = useMemo(
    () =>
      activeLayer
        ? activeLayer.features.map((f) => activeLayer.fields.map((k) => f.properties[k] ?? ''))
        : [],
    [activeLayer]
  );

  if (loading) {
    const total = progress?.total ?? sizeBytes ?? null;
    const pct = progress && total ? Math.min(100, Math.round((progress.loaded / total) * 100)) : null;
    return (
      <div className="rounded-xl border border-border bg-fill p-4">
        <div className="flex items-center gap-2 text-sm text-faint">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>
            Cargando el recurso
            {progress ? ` · ${formatBytes(progress.loaded)}${total ? ` de ${formatBytes(total)}` : ''}` : '…'}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-card" aria-hidden>
          <div
            className={cn('h-full rounded-full bg-link transition-[width] duration-200', pct == null && 'animate-pulse')}
            style={{ width: pct == null ? '25%' : `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>
    );
  }

  if (source.kind === 'too-big') {
    // Ningún tamaño impide ya dibujarlo: por encima del tope por petición se
    // trae en tramos. Lo que queda es avisar de lo que va a costar.
    const chunks = rangeChunkCount(source.size);
    return (
      <Banner tone="warn" icon={AlertTriangle} title={`El recurso ocupa ${formatBytes(source.size)}`}>
        <p className="mt-1">
          No se descarga solo para no cargar tantos datos en el navegador sin avisar.
          {needsRangeDownload(source.size) && (
            <> Se traerá en {chunks.toLocaleString('es-ES')} tramos, así que tardará un poco.</>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
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

  /**
   * Qué se dice en el hueco del mapa. El detalle largo lo dan los avisos de
   * abajo (diagnóstico, proyección, fallo del WFS); aquí va solo la frase que
   * explica por qué no hay dibujo, para no repetirla dos veces seguidas.
   */
  const coverage = spatialLabel(spatial);
  const noGeometryReason =
    source.kind === 'none' && source.note
      ? source.note
      : wfsFor && 'error' in wfsFor
      ? 'El servicio no ha entregado las entidades de esta capa.'
      : activeLayer?.projected === false
      ? 'La geometría llegó en un sistema de referencia que el visor no sabe convertir a coordenadas geográficas.'
      : activeLayer && activeLayer.features.length === 0
      ? 'El recurso se ha leído, pero no contiene ninguna entidad geográfica.'
      : 'No se ha podido dibujar la geometría de este recurso.';

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
        <GeoPreviewMap
          spec={spec}
          onTileError={onTileError}
          onSelectFeature={selectFeature}
          onViewportChange={onViewportChange}
        />
      ) : source.kind === 'none' && source.diagnosis ? (
        // El diagnóstico de abajo ya dice qué llegó y de quién es el fallo:
        // repetirlo aquí arriba serían dos cajas diciendo lo mismo.
        null
      ) : (
        <NoGeometry reason={noGeometryReason} coverage={coverage} />
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
          {wfsLayer && wfsLayer.stop !== 'completa' ? (
            <>
              {/* «en esta vista» y no «que tiene la capa»: el recuento sale de un
                  `resultType=hits` con el MISMO `bbox` que las entidades, así que
                  es lo que hay en lo que se está mirando, no en la capa entera.
                  Decir «de 4.513» aquí daba a entender que faltan 4.381 cuando
                  fuera del encuadre no falta ninguna. */}
              {wfsLayer.matched ? <> de {wfsLayer.matched.toLocaleString('es-ES')} en esta vista</> : null}
              {' — '}{WFS_STOP_NOTES[wfsLayer.stop ?? 'cargando']}
              {wfsLayer.bytes ? <> ({formatBytes(wfsLayer.bytes)} descargados)</> : null}
            </>
          ) : (
            <> · el recurso completo</>
          )}
          {activeLayer.crs ? <> · origen en {activeLayer.crs}, reproyectado a WGS84</> : null}
          {activeLayer.nullGeometries ? <> · {activeLayer.nullGeometries.toLocaleString('es-ES')} sin geometría</> : null}
          . Pulsa una entidad en el mapa o una fila de la tabla y se resaltan a la vez.
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
            De <strong className="text-body">{selectedTitle || selected}</strong> no llegó ninguna
            entidad: {wfsFor.error}. El visor pide la capa por páginas y va acortándolas cuando la
            respuesta no cabe, así que esto significa que el servicio tampoco entrega las más cortas.
          </p>
          {wfsFor.detail && <p className="mt-1 text-xs text-faint">{wfsFor.detail}</p>}
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

      {/* El WFS entregó una parte: qué se está viendo y por dónde seguir ──────
          El enlace al WMS hermano solo salía cuando la capa fallaba entera. En
          las capas pesadas —que ahora sí dibujan un trozo en vez de nada— es
          justo donde más falta hace: por WMS se ve la cartografía completa, que
          es lo que el usuario venía buscando. */}
      {wfsLayer && wfsLayer.stop === 'presupuesto' && (
        <Banner tone="info" icon={Info} title="Se está viendo una parte de esta zona">
          <p className="mt-1">
            Las entidades de <strong className="text-body">{selectedTitle || selected}</strong> son
            muy pesadas: con {formatBytes(wfsLayer.bytes)} descargados caben{' '}
            {shownFeatures.toLocaleString('es-ES')}
            {wfsLayer.matched ? <> de las {wfsLayer.matched.toLocaleString('es-ES')}</> : null} que
            hay en el encuadre actual. <strong className="text-body">Acércate</strong> y se traerán
            todas las de la zona; para ver la capa completa de un vistazo, el WMS la dibuja en el
            servidor.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {serviceSiblings.filter((s) => s.format === 'WMS').map((s) => (
              <Link
                key={s.idx}
                href={`/catalogo/${datasetId}/${s.slug}`}
                className="text-xs font-medium text-link underline-offset-2 hover:underline"
              >
                Ver la cartografía completa por WMS
              </Link>
            ))}
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-link underline-offset-2 hover:underline">
              <ExternalLink className="h-3 w-3" aria-hidden /> Abrir el servicio en un SIG
            </a>
          </div>
        </Banner>
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
            rows={attributeRows}
            voice="record"
            dataLabel="Entidades"
            downloadUrl={url}
            selectedRow={featureIndex}
            onSelectRow={selectFeature}
            summary={
              <>
                {shownFeatures.toLocaleString('es-ES')} entidades
                {wfsLayer && wfsLayer.stop !== 'completa' && wfsLayer.matched
                  ? ` de ${wfsLayer.matched.toLocaleString('es-ES')}`
                  : wfsLayer && wfsLayer.stop !== 'completa'
                  ? ''
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
