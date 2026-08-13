/**
 * Tipos de dominio compartidos del portal.
 *
 * Derivan de la estructura real del catálogo RDF/XML (DCAT) de datos abiertos
 * de la Junta de Castilla y León:
 * https://datosabiertos.jcyl.es/web/jcyl/risp/es/ciencia-tecnologia/general/1284166186527.rdf
 */

import type { FreshnessReport, MetadataGapCode } from './metadata-gaps';

export type DatasetStatus = 'healthy' | 'warning' | 'critical';

/** Formatos presentes en el catálogo real de jcyl (mapeados desde dct:IMT). */
export type DataFormat =
  | 'CSV'
  | 'JSON'
  | 'GeoJSON'
  | 'XLSX'
  | 'SHP'
  | 'XML'
  | 'RDF'
  | 'RSS'
  | 'KML'
  | 'GML'
  | 'WMS'
  | 'WFS'
  | 'TXT'
  | 'JPEG'
  | 'iCal'
  | 'ECW'
  | 'BIN'
  | 'OTRO';

/** Licencias reales del catálogo: CC-BY-4.0 e IGCYL-NC (resto no usado). */
export type License =
  | 'CC-BY-4.0'
  | 'IGCYL-NC'
  | 'CC0'
  | 'ODbL'
  | 'CC-BY-SA-4.0'
  | 'Otro';

/** Categorías de la UI, mapeadas desde los temas de datos.gob.es. */
export type Category =
  | 'Medio Ambiente'
  | 'Transporte'
  | 'Economía'
  | 'Servicios Públicos'
  | 'Salud'
  | 'Educación'
  | 'Cultura'
  | 'Demografía'
  | 'Otros';

export interface DistributionUrl {
  /** Formato normalizado a partir del MIME type. */
  format: DataFormat;
  /** MIME type original (dct:IMT rdf:value). */
  mimeType: string;
  /** URL de acceso (dcat:accessURL). */
  url: string;
}

export interface Dataset {
  /** URI estable del dataset (rdf:about del dcat:Dataset). */
  id: string;
  title: string;
  description: string;
  qualityScore: number;
  status: DatasetStatus;
  formats: DataFormat[];
  category: Category;
  license: License;
  /** Fecha de publicación (dct:issued). */
  lastUpdated: string;
  /** Fecha de última modificación conocida (dct:modified), si existe. */
  modified?: string;
  /** Texto humanizado de antigüedad calculado desde dct:issued o dct:modified. */
  updatedAgo: string;
  /** Fuente de la métrica de frescura: 'modified' | 'issued' | 'none'. */
  freshnessSource: 'modified' | 'issued' | 'none';
  publisher: string;
  province?: string;
  /** Tema original de datos.gob.es. */
  theme?: string;
  keywords?: string[];
  /** Periodicidad declarada en meses (dct:accrualPeriodicity). */
  periodicityMonths?: number;
  spatial?: string;
  distributionUrls: DistributionUrl[];
  /**
   * Huecos de metadatos concretos, para poder decirle al publicador qué falta
   * en lugar de solo darle un porcentaje. Se calculan al parsear el catálogo
   * (una vez por hora, con su caché) desde la misma función que alimenta la
   * completitud del score.
   */
  metadataGaps: MetadataGapCode[];
  /** Por qué la actualidad de este dataset puntúa lo que puntúa. */
  freshness: FreshnessReport;
}

export interface CatalogStats {
  totalDatasets: number;
  totalDistributions: number;
  averageQuality: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  /** Distribución de datasets por formato (un dataset cuenta por cada formato). */
  formatsBreakdown: Partial<Record<DataFormat, number>>;
  /** Distribución de datasets por categoría. */
  byCategory: Partial<Record<Category, number>>;
  /** Distribución de datasets por licencia. */
  licenseBreakdown: Partial<Record<License, number>>;
  /** Rango de fechas de publicación (dct:issued) presentes en el catálogo. */
  dateRange: { min: string; max: string };
}

export interface CatalogData {
  datasets: Dataset[];
  stats: CatalogStats;
  source: {
    url: string;
    fetchedAt: string;
    datasetCount: number;
    distributionCount: number;
    /**
     * De dónde salieron los datos: del RDF remoto, de la copia local de
     * respaldo, o de ningún sitio.
     *
     * `none` es un catálogo vacío de emergencia. Antes no se distinguía, así que
     * si fallaban la red y la copia local la interfaz pintaba «0 datasets» como
     * si fuera el dato real del catálogo.
     */
    origin: 'remote' | 'local' | 'none';
  };
}
