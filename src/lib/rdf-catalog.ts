/**
 * Integración del catálogo RDF/XML (DCAT) de datos abiertos de la Junta de
 * Castilla y León.
 *
 * - Fuente primaria: descarga del RDF oficial en tiempo de request
 *   (con revalidación de 1h a través del fetch de Next).
 * - Fuente de respaldo: copia local `src/data/rdf-catalog.rdf` (para desarrollo
 *   sin red o si el servicio de jcyl no responde).
 *
 * Este módulo SOLO debe importarse desde código de servidor (Server Components,
 * Route Handlers o scripts Node). No es apto para componentes cliente.
 */

import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { CatalogData, CatalogStats, Category, DataFormat, Dataset, DatasetStatus, DistributionUrl, License } from '@/lib/types';
import { METADATA_WEIGHTS, getScoreLevel, timeAgo, type ScoreLevel } from '@/lib/quality';
import {
  completenessRatio,
  diagnoseFreshness,
  findMetadataGaps,
  type FreshnessReport,
  type MetadataGapCode,
} from '@/lib/metadata-gaps';

export const RDF_CATALOG_URL =
  'https://datosabiertos.jcyl.es/web/jcyl/risp/es/ciencia-tecnologia/general/1284166186527.rdf';

const LOCAL_CATALOG_PATH = path.join(process.cwd(), 'src', 'data', 'rdf-catalog.rdf');

/** Revalidación de la copia remota del catálogo (1 hora). */
const REVALIDATE_SECONDS = 3600;

/* ------------------------------------------------------------------ */
/* Mapeos del catálogo real                                            */
/* ------------------------------------------------------------------ */

const IMT_TO_FORMAT: Record<string, DataFormat> = {
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'application/geo+json': 'GeoJSON',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/x-zipped-shp': 'SHP',
  'application/xml': 'XML',
  'application/rdf+xml': 'RDF',
  'application/rss+xml': 'RSS',
  'application/vnd.google-earth.kml+xml': 'KML',
  'application/gml+xml': 'GML',
  'text/wms': 'WMS',
  'text/wfs': 'WFS',
  'text/plain': 'TXT',
  'image/jpeg': 'JPEG',
  'text/calendar': 'iCal',
  'application/ecw': 'ECW',
  'application/octet-stream': 'BIN',
};

/**
 * Reconocimiento de licencias por patrón, no por igualdad de cadena.
 *
 * Antes era un diccionario con dos URIs exactas. Cualquier variación —una barra
 * final, `http` en vez de `https`, `deed.es` en vez de `deed.es_ES`, otra ruta
 * para la licencia IGCYL— caía en `Otro` en silencio, y eso tiene dos costes:
 * el dataset pierde un punto de completitud por una licencia que SÍ declara, y
 * la pestaña de metadatos le reprocha al publicador un hueco que no existe.
 *
 * Se observó de verdad: el feed en vivo devolvió una variante en la que 169
 * datasets con licencia IGCYL declarada acabaron como `Otro`.
 */
const LICENSE_PATTERNS: { test: RegExp; label: License }[] = [
  { test: /creativecommons\.org\/licenses\/by-sa\/4\.0/i, label: 'CC-BY-SA-4.0' },
  { test: /creativecommons\.org\/licenses\/by\/4\.0/i, label: 'CC-BY-4.0' },
  { test: /creativecommons\.org\/publicdomain\/zero\/1\.0/i, label: 'CC0' },
  { test: /opendatacommons\.org\/licenses\/odbl/i, label: 'ODbL' },
  // La licencia propia de la Junta: uso no comercial.
  { test: /igcyl/i, label: 'IGCYL-NC' },
];

const THEME_TO_CATEGORY: Record<string, Category> = {
  'http://datos.gob.es/kos/sector-publico/sector/medio-ambiente': 'Medio Ambiente',
  'http://datos.gob.es/kos/sector-publico/sector/energia': 'Medio Ambiente',
  'http://datos.gob.es/kos/sector-publico/sector/medio-rural-pesca': 'Medio Ambiente',
  'http://datos.gob.es/kos/sector-publico/sector/transporte': 'Transporte',
  'http://datos.gob.es/kos/sector-publico/sector/economia': 'Economía',
  'http://datos.gob.es/kos/sector-publico/sector/empleo': 'Economía',
  'http://datos.gob.es/kos/sector-publico/sector/comercio': 'Economía',
  'http://datos.gob.es/kos/sector-publico/sector/industria': 'Economía',
  'http://datos.gob.es/kos/sector-publico/sector/hacienda': 'Economía',
  'http://datos.gob.es/kos/sector-publico/sector/salud': 'Salud',
  'http://datos.gob.es/kos/sector-publico/sector/educacion': 'Educación',
  'http://datos.gob.es/kos/sector-publico/sector/cultura-ocio': 'Cultura',
  'http://datos.gob.es/kos/sector-publico/sector/turismo': 'Cultura',
  'http://datos.gob.es/kos/sector-publico/sector/deporte': 'Cultura',
  'http://datos.gob.es/kos/sector-publico/sector/demografia': 'Demografía',
  'http://datos.gob.es/kos/sector-publico/sector/sector-publico': 'Servicios Públicos',
  'http://datos.gob.es/kos/sector-publico/sector/sociedad-bienestar': 'Servicios Públicos',
  'http://datos.gob.es/kos/sector-publico/sector/seguridad': 'Servicios Públicos',
  'http://datos.gob.es/kos/sector-publico/sector/legislacion-justicia': 'Servicios Públicos',
  'http://datos.gob.es/kos/sector-publico/sector/urbanismo-infraestructuras': 'Servicios Públicos',
  'http://datos.gob.es/kos/sector-publico/sector/ciencia-tecnologia': 'Servicios Públicos',
};

/** Apertura de formato (0-100) para el scoring de calidad. */
const FORMAT_OPENNESS: Partial<Record<DataFormat, number>> = {
  CSV: 100,
  JSON: 100,
  GeoJSON: 100,
  RDF: 85,
  RSS: 80,
  KML: 80,
  GML: 80,
  XLSX: 80,
  WMS: 70,
  WFS: 70,
  iCal: 70,
  SHP: 60,
  TXT: 60,
  JPEG: 30,
  ECW: 20,
  BIN: 10,
  OTRO: 40,
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj['#text'] === 'string') return obj['#text'].trim();
  }
  return '';
}

function resourceOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const res = obj['@_resource'];
    return typeof res === 'string' ? res : '';
  }
  return String(value).trim();
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function mapFormat(mimeType: string): DataFormat {
  return IMT_TO_FORMAT[mimeType.trim().toLowerCase()] ?? 'OTRO';
}

/**
 * Identifica la licencia a partir de lo que declare el RDF.
 *
 * Acepta tanto `rdf:resource` como el texto del nodo: hay feeds que la publican
 * de una forma y otros de la otra, y leer solo el atributo dejaba la licencia
 * como no identificada.
 */
export function mapLicense(value: unknown): License {
  const declared = (resourceOf(value) || textOf(value)).trim();
  if (!declared) return 'Otro';
  return LICENSE_PATTERNS.find((p) => p.test.test(declared))?.label ?? 'Otro';
}

function mapCategory(theme: string): Category {
  return THEME_TO_CATEGORY[theme] ?? 'Otros';
}

function parseIssued(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* ------------------------------------------------------------------ */
/* Scoring de calidad                                                  */
/* ------------------------------------------------------------------ */

export interface QualityBreakdown {
  completeness: number;
  formatScore: number;
  freshness: number;
  licenseScore: number;
}

/** Puntuación de apertura del formato (0-100). */
function formatOpenness(format: DataFormat): number {
  return FORMAT_OPENNESS[format] ?? 40;
}

/**
 * `DatasetStatus` es el nombre que este módulo da a los niveles de calidad.
 * Se traduce desde `ScoreLevel` en vez de recalcular los umbrales, que es lo que
 * hacía antes con su propio `score >= 80 ? … : …`.
 */
const DATASET_STATUS_BY_LEVEL: Record<ScoreLevel, DatasetStatus> = {
  ok: 'healthy',
  warn: 'warning',
  bad: 'critical',
};

/**
 * Calcula el índice de calidad de un dataset (0-100) a partir SOLO de los
 * metadatos presentes en el RDF, con cuatro factores:
 *
 * - Completitud: título, descripción, licencia, publisher, fecha de publicación,
 *   idioma, ámbito espacial, temas y palabras clave.
 * - Formatos abiertos: el mejor formato disponible, con bonificación por
 *   diversidad.
 * - Frescura: dct:modified si existe, si no dct:issued, contra la periodicidad
 *   declarada.
 * - Apertura de licencia: CC-BY-4.0 (100) / IGCYL-NC (55) / sin identificar (60).
 *
 * Los pesos de los cuatro están en `METADATA_WEIGHTS` (`lib/quality.ts`), que es
 * también de donde los lee la página de Metodología para publicarlos.
 */
export function computeQuality(dataset: {
  title: string;
  description: string;
  license: License;
  publisher: string;
  issued: string;
  modified?: string;
  language: string;
  spatial: string;
  themes: string[];
  keywords: string[];
  periodicityMonths?: number;
  formats: DataFormat[];
  identifier?: string;
  contactPoint?: string;
  now: Date;
}): {
  score: number;
  status: DatasetStatus;
  breakdown: QualityBreakdown;
  freshnessSource: 'modified' | 'issued' | 'none';
  /** Huecos concretos, para que la interfaz pueda decir qué falta. */
  gaps: MetadataGapCode[];
  /**
   * Por qué la actualidad puntúa lo que puntúa. No es el valor del eje —ese va
   * en `breakdown.freshness`—, es su explicación.
   */
  freshnessReport: FreshnessReport;
} {
  const { now } = dataset;

  // 1) Completitud de metadatos.
  // Derivada de `findMetadataGaps`, que es la única definición de qué campos
  // cuentan: si la nota se calculara aparte de la lista de huecos, acabarían
  // discrepando (el mismo fallo que tuvo `classifyDelivery`).
  const gaps = findMetadataGaps(dataset);
  const completeness = completenessRatio(gaps) * 100;

  // 2) Disponibilidad de formatos abiertos.
  let formatScore = 0;
  if (dataset.formats.length > 0) {
    const best = Math.max(...dataset.formats.map(formatOpenness));
    const diversity = (Math.min(dataset.formats.length, 3) / 3) * 100;
    formatScore = 0.8 * best + 0.2 * diversity;
  }

  // 3) Frescura: preferir dct:modified sobre dct:issued
  let freshness: number;
  let freshnessSource: 'modified' | 'issued' | 'none' = 'none';
  const modified = dataset.modified ? parseIssued(dataset.modified) : null;
  const issued = parseIssued(dataset.issued);
  const referenceDate = modified ?? issued;

  if (referenceDate) {
    freshnessSource = modified ? 'modified' : 'issued';
    if (dataset.periodicityMonths && dataset.periodicityMonths > 0) {
      const monthsSince = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      const ratio = monthsSince / dataset.periodicityMonths;
      freshness = ratio <= 1 ? 100 : ratio <= 2 ? 75 : ratio <= 4 ? 50 : 25;
    } else {
      // Sin periodicidad declarada: dataset estático, no se puede medir frescura.
      freshness = 80;
    }
  } else {
    freshness = 40;
  }

  // 4) Apertura de licencia.
  const licenseScore = dataset.license === 'CC-BY-4.0' ? 100 : dataset.license === 'IGCYL-NC' ? 55 : 60;

  // Los pesos y los umbrales viven en `lib/quality.ts`, que es de donde los lee
  // también la página de Metodología para publicarlos.
  const score = Math.round(
    METADATA_WEIGHTS.completeness * completeness +
      METADATA_WEIGHTS.formats * formatScore +
      METADATA_WEIGHTS.freshness * freshness +
      METADATA_WEIGHTS.license * licenseScore
  );
  const status: DatasetStatus = DATASET_STATUS_BY_LEVEL[getScoreLevel(score)];

  return {
    score,
    status,
    breakdown: { completeness, formatScore, freshness, licenseScore },
    freshnessSource,
    gaps,
    freshnessReport: diagnoseFreshness({
      issued: dataset.issued,
      modified: dataset.modified,
      periodicityMonths: dataset.periodicityMonths,
      now,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Parseo RDF/XML                                                      */
/* ------------------------------------------------------------------ */

interface RawDistribution {
  Distribution?: {
    '@_about'?: string;
    format?: { IMT?: { '@_value'?: string; '@_label'?: string } };
    accessURL?: unknown;
  };
}

interface RawDataset {
  Dataset?: {
    '@_about'?: string;
    title?: unknown;
    description?: unknown;
    theme?: unknown;
    keyword?: unknown;
    language?: unknown;
    publisher?: unknown;
    license?: unknown;
    issued?: unknown;
    modified?: unknown;
    spatial?: unknown;
    accrualPeriodicity?: unknown;
    distribution?: unknown;
    // Recomendaciones DCAT-AP que el catálogo no publica hoy (0 de 824). Se leen
    // para poder informar del hueco; no entran en la puntuación.
    identifier?: unknown;
    contactPoint?: unknown;
  };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
});

/** Parsea el XML RDF/XML del catálogo y devuelve los datasets normalizados. */
export function parseCatalog(
  xml: string,
  sourceUrl: string,
  fetchedAt: string,
  origin: CatalogData['source']['origin'] = 'remote'
): CatalogData {
  const doc = xmlParser.parse(xml) as { RDF?: { Catalog?: { dataset?: RawDataset | RawDataset[] } } };
  const rawDatasets = toArray<RawDataset>(doc?.RDF?.Catalog?.dataset);
  const now = new Date();

  const datasets: Dataset[] = rawDatasets
    .map((entry) => entry?.Dataset)
    .filter((d): d is NonNullable<RawDataset['Dataset']> => d != null)
    .map((d) => {
      const uri = d['@_about'] ?? '';
      const title = textOf(d.title);
      const description = textOf(d.description);
      const themes = toArray(d.theme).map(resourceOf).filter(Boolean);
      const theme = themes[0] ?? '';
      const keywords = toArray(d.keyword).map(textOf).filter(Boolean);
      const publisher = resourceOf(d.publisher);
      const license = mapLicense(d.license);
      const issued = textOf(d.issued);
      const modified = textOf(d.modified);
      const spatial = resourceOf(d.spatial);
      const language = textOf(d.language);
      const identifier = textOf(d.identifier) || resourceOf(d.identifier);
      // `contactPoint` es un nodo vCard: basta con saber si viene o no.
      const contactPoint = resourceOf(d.contactPoint) || (d.contactPoint != null ? 'presente' : '');

      const periodicityMonths = parsePeriodicityMonths(d.accrualPeriodicity);

      const distributionUrls: DistributionUrl[] = toArray<RawDistribution>(d.distribution as RawDistribution | RawDistribution[] | undefined)
        .map((dist) => dist?.Distribution)
        .filter((dist): dist is NonNullable<RawDistribution['Distribution']> => dist != null)
        .map((dist) => {
          const mimeType = dist.format?.IMT?.['@_value'] ?? '';
          const url = textOf(dist.accessURL) || dist['@_about'] || '';
          return { format: mapFormat(mimeType), mimeType, url };
        })
        .filter((dist) => dist.url.length > 0);

      const formats = Array.from(new Set(distributionUrls.map((d) => d.format)));

      const { score, status, freshnessSource, gaps, freshnessReport } = computeQuality({
        title,
        description,
        license,
        publisher,
        issued,
        modified,
        language,
        spatial,
        themes,
        keywords,
        periodicityMonths,
        formats,
        identifier,
        contactPoint,
        now,
      });

      const issuedDate = parseIssued(issued);
      const modifiedDate = modified ? parseIssued(modified) : null;
      const referenceDate = modifiedDate ?? issuedDate;
      const category = themes.map(mapCategory).find((c) => c !== 'Otros') ?? 'Otros';

      return {
        id: uri,
        title,
        description,
        qualityScore: score,
        status,
        formats,
        category,
        license,
        lastUpdated: issued,
        modified: modified || undefined,
        updatedAgo: referenceDate
          ? (freshnessSource === 'modified' ? 'Actualizado ' : 'Publicado ') + timeAgo(referenceDate.toISOString(), now)
          : 'Fecha desconocida',
        freshnessSource,
        publisher,
        theme: theme || undefined,
        spatial: spatial || undefined,
        keywords: keywords.length > 0 ? keywords : undefined,
        periodicityMonths,
        distributionUrls,
        metadataGaps: gaps,
        freshness: freshnessReport,
      };
    });

  datasets.sort((a, b) => b.qualityScore - a.qualityScore || a.title.localeCompare(b.title, 'es'));

  return {
    datasets,
    stats: computeStats(datasets),
    source: {
      url: sourceUrl,
      fetchedAt,
      datasetCount: datasets.length,
      distributionCount: datasets.reduce((n, d) => n + d.distributionUrls.length, 0),
      origin,
    },
  };
}

/** Extrae los meses de periodicidad de dct:accrualPeriodicity (time:DurationDescription). */
function parsePeriodicityMonths(value: unknown): number | undefined {
  try {
    type PeriodicityNode = {
      Frequency?: { value?: { DurationDescription?: { months?: unknown; days?: unknown; years?: unknown } } };
    };
    const desc = (value as PeriodicityNode | undefined)?.Frequency?.value?.DurationDescription;
    if (!desc) return undefined;
    // El catálogo real expresa la periodicidad como months, days o years.
    const months = parseFloat(textOf(desc.months));
    const days = parseFloat(textOf(desc.days));
    const years = parseFloat(textOf(desc.years));
    if (Number.isFinite(months) && months > 0) return months;
    if (Number.isFinite(days) && days > 0) return days / 30.44;
    if (Number.isFinite(years) && years > 0) return years * 12;
    return undefined;
  } catch {
    return undefined;
  }
}

export function computeStats(datasets: Dataset[]): CatalogStats {
  const byCategory: Partial<Record<Category, number>> = {};
  const formatsBreakdown: Partial<Record<DataFormat, number>> = {};
  const licenseBreakdown: Partial<Record<License, number>> = {};
  let minDate = '';
  let maxDate = '';

  for (const ds of datasets) {
    byCategory[ds.category] = (byCategory[ds.category] ?? 0) + 1;
    for (const fmt of ds.formats) {
      formatsBreakdown[fmt] = (formatsBreakdown[fmt] ?? 0) + 1;
    }
    licenseBreakdown[ds.license] = (licenseBreakdown[ds.license] ?? 0) + 1;
    const day = ds.lastUpdated.slice(0, 10);
    if (day) {
      if (!minDate || day < minDate) minDate = day;
      if (!maxDate || day > maxDate) maxDate = day;
    }
  }

  const healthyCount = datasets.filter((d) => d.status === 'healthy').length;
  const warningCount = datasets.filter((d) => d.status === 'warning').length;
  const criticalCount = datasets.filter((d) => d.status === 'critical').length;
  const totalQuality = datasets.reduce((sum, d) => sum + d.qualityScore, 0);

  return {
    totalDatasets: datasets.length,
    totalDistributions: datasets.reduce((n, d) => n + d.distributionUrls.length, 0),
    averageQuality: datasets.length > 0 ? Math.round((totalQuality / datasets.length) * 10) / 10 : 0,
    healthyCount,
    warningCount,
    criticalCount,
    formatsBreakdown,
    byCategory,
    licenseBreakdown,
    dateRange: { min: minDate, max: maxDate },
  };
}

/* ------------------------------------------------------------------ */
/* Carga del catálogo                                                  */
/* ------------------------------------------------------------------ */

interface CatalogSource {
  xml: string;
  sourceUrl: string;
  origin: 'remote' | 'local';
}

const FETCH_TIMEOUT_MS = 15000;

async function loadCatalogXml(): Promise<CatalogSource | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(RDF_CATALOG_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { 'User-Agent': 'CyLDataQualityPortal/1.0' },
      signal: controller.signal,
    });
    if (res.ok) {
      const xml = await res.text();
      if (xml.trim().length > 0) {
        return { xml, sourceUrl: RDF_CATALOG_URL, origin: 'remote' };
      }
    }
  } catch {
    // Sin red, timeout o error de jcyl: se usa la copia local.
  } finally {
    clearTimeout(timer);
  }

  try {
    if (fs.existsSync(LOCAL_CATALOG_PATH)) {
      const xml = fs.readFileSync(LOCAL_CATALOG_PATH, 'utf-8');
      if (xml.trim().length > 0) {
        return { xml, sourceUrl: `file://${LOCAL_CATALOG_PATH}`, origin: 'local' };
      }
    }
  } catch {
    // Copia local corrupta o ilegible: se devuelve null.
  }

  return null;
}

/**
 * Último catálogo servible y cuándo toca volver a intentar refrescarlo.
 *
 * `nextAttemptAt` se separa de la fecha del dato a propósito: un refresco
 * fallido no invalida lo que ya teníamos, solo adelanta el siguiente intento.
 */
let cachedCatalog: { data: CatalogData; nextAttemptAt: number } | null = null;

/** Reintento corto tras un fallo, en vez de esperar la hora completa. */
const RETRY_AFTER_FAILURE_MS = 60 * 1000;

function emptyCatalog(): CatalogData {
  const now = new Date().toISOString();
  return {
    datasets: [],
    stats: {
      totalDatasets: 0,
      totalDistributions: 0,
      averageQuality: 0,
      healthyCount: 0,
      warningCount: 0,
      criticalCount: 0,
      formatsBreakdown: {},
      byCategory: {},
      licenseBreakdown: {},
      dateRange: { min: '', max: '' },
    },
    source: {
      url: RDF_CATALOG_URL,
      fetchedAt: now,
      datasetCount: 0,
      distributionCount: 0,
      origin: 'none',
    },
  };
}

/**
 * Intenta obtener un catálogo utilizable, o null si no hay forma.
 *
 * Un parseo "exitoso" que no produce ni un dataset se trata como fallo: casi
 * siempre significa que la fuente devolvió una página de error con código 200.
 */
async function refreshCatalog(): Promise<CatalogData | null> {
  const source = await loadCatalogXml();
  if (!source) return null;
  try {
    const data = parseCatalog(source.xml, source.sourceUrl, new Date().toISOString(), source.origin);
    return data.datasets.length > 0 ? data : null;
  } catch {
    // XML corrupto o con un esquema no esperado.
    return null;
  }
}

/**
 * Devuelve el catálogo completo (datasets + stats): siempre lo más actualizado
 * que se pueda conseguir.
 *
 * La copia remota se revalida cada hora. Si el refresco falla —red caída, jcyl
 * sin responder, XML corrupto— se sigue sirviendo el último catálogo bueno y se
 * reintenta en un minuto, en lugar de reemplazarlo. Antes cualquier fallo
 * puntual guardaba un catálogo VACÍO en la caché durante la hora entera: un
 * parpadeo de red en el momento justo dejaba el portal enseñando «0 datasets» y
 * medias al 0% durante sesenta minutos, teniendo el dato bueno un segundo antes.
 *
 * Nunca lanza. Solo devuelve el catálogo vacío si nunca se ha conseguido
 * ninguno, y en ese caso no lo memoriza: el siguiente request vuelve a probar.
 */
export async function getCatalog(): Promise<CatalogData> {
  const now = Date.now();
  if (cachedCatalog && now < cachedCatalog.nextAttemptAt) {
    return cachedCatalog.data;
  }

  const fresh = await refreshCatalog();
  if (fresh) {
    cachedCatalog = { data: fresh, nextAttemptAt: now + REVALIDATE_SECONDS * 1000 };
    return fresh;
  }

  if (cachedCatalog) {
    cachedCatalog.nextAttemptAt = now + RETRY_AFTER_FAILURE_MS;
    return cachedCatalog.data;
  }

  return emptyCatalog();
}
