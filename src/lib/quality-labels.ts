/**
 * Etiquetas legibles de códigos de incidencia del informe de análisis.
 *
 * Módulo "client-safe": SIN imports de node:* para poder usarse desde
 * componentes cliente (a diferencia de `quality-report.ts`, que lee el
 * informe con fs y solo puede usarse en servidor).
 *
 * La lista de códigos se mantiene sincronizada con los analizadores de
 * `src/analysis` (ver cada "code" emitido en formats/*.py y engine.py).
 */

export type IssueCategory = 'availability' | 'format' | 'content';

/* ── Formateo (aquí y no en quality-report.ts, para que también lo puedan
      usar los componentes cliente) ── */

/** Decimal con coma: `toFixed` siempre usa punto y el portal está en español. */
function esNumber(value: number, decimals: number): string {
  return value.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  if (bytes >= 1e9) return `${esNumber(bytes / 1e9, 2)} GB`;
  if (bytes >= 1e6) return `${esNumber(bytes / 1e6, 1)} MB`;
  if (bytes >= 1e3) return `${esNumber(bytes / 1e3, 0)} KB`;
  return `${esNumber(bytes, 0)} B`;
}

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${esNumber(s, 1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/* ── Volumen de datos analizado ────────────────────────────────────────────
   El analizador nombra las métricas según el formato (`rows`/`columns` en
   CSV y JSON tabular, `total_rows`/`sheet_count` en XLSX, `total_elements`
   en XML/RSS). La UI leía `row_count`/`col_count`, claves que el analizador
   NO emite en ningún formato: por eso los contadores salían siempre vacíos.
   Este helper es el único sitio donde vive esa correspondencia.            */

export interface VolumeMetric {
  value: number;
  label: string;
}

export interface DistributionVolume {
  /** Eje principal: filas, elementos, entidades… */
  primary: VolumeMetric | null;
  /** Eje secundario: columnas, campos, hojas… */
  secondary: VolumeMetric | null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function distributionVolume(
  format: string | undefined,
  metrics: Record<string, unknown> | null | undefined
): DistributionVolume {
  const m = metrics ?? {};
  const rows = asNumber(m.rows);
  const columns = asNumber(m.columns);
  const fmt = (format ?? '').toUpperCase();

  if (fmt === 'JSON' || fmt === 'GEOJSON') {
    const elements = asNumber(m.elements) ?? rows;
    return {
      primary: elements != null ? { value: elements, label: 'Elementos' } : null,
      secondary: columns != null ? { value: columns, label: 'Campos' } : null,
    };
  }

  if (fmt === 'XLSX' || fmt === 'XLS') {
    const totalRows = asNumber(m.total_rows) ?? rows;
    const sheets = asNumber(m.sheet_count);
    return {
      primary: totalRows != null ? { value: totalRows, label: 'Filas totales' } : null,
      secondary: sheets != null ? { value: sheets, label: 'Hojas' } : columns != null ? { value: columns, label: 'Columnas' } : null,
    };
  }

  if (fmt === 'XML' || fmt === 'RDF' || fmt === 'RSS') {
    const elements = asNumber(m.total_elements);
    const items = asNumber(m.items) ?? asNumber(m.dcat_datasets);
    return {
      primary: elements != null ? { value: elements, label: 'Elementos' } : null,
      secondary: items != null ? { value: items, label: 'Registros' } : null,
    };
  }

  if (fmt === 'WFS') {
    const types = asNumber(m.feature_types);
    return { primary: types != null ? { value: types, label: 'Tipos de entidad' } : null, secondary: null };
  }

  if (fmt === 'WMS') {
    const layers = asNumber(m.layers);
    return { primary: layers != null ? { value: layers, label: 'Capas' } : null, secondary: null };
  }

  if (fmt === 'SHP') {
    const features = asNumber(m.features);
    const fields = asNumber(m.fields);
    return {
      primary: features != null ? { value: features, label: 'Entidades' } : null,
      secondary: fields != null ? { value: fields, label: 'Campos' } : null,
    };
  }

  if (fmt === 'TXT' && rows == null) {
    const lines = asNumber(m.lines);
    return { primary: lines != null ? { value: lines, label: 'Líneas' } : null, secondary: null };
  }

  return {
    primary: rows != null ? { value: rows, label: 'Filas' } : null,
    secondary: columns != null ? { value: columns, label: 'Columnas' } : null,
  };
}

/** Celdas analizadas (filas × columnas), para calcular el % de incidencias. */
export function analyzedCells(metrics: Record<string, unknown> | null | undefined): number {
  const rows = asNumber((metrics ?? {}).rows);
  const columns = asNumber((metrics ?? {}).columns);
  return rows != null && columns != null ? rows * columns : 0;
}

/** Categoriza un código de incidencia en disponibilidad, formato o contenido. */
export function issueCategory(code: string): IssueCategory {
  if (code in AVAILABILITY_ISSUES) return 'availability';
  if (code in FORMAT_ISSUES) return 'format';
  return 'content';
}

/** Etiqueta legible para un código de incidencia (para nivel dataset). */
export function issueLabel(code: string): string {
  return ISSUE_LABELS[code] ?? code;
}

/** Etiqueta legible para una categoría de incidencia. */
export function categoryLabel(cat: IssueCategory): string {
  return CATEGORY_LABELS[cat];
}

/** Etiqueta legible para el tipo de una columna del esquema inferido. */
export function schemaTypeLabel(type: string): string {
  return SCHEMA_TYPE_LABELS[type] ?? type;
}

const SCHEMA_TYPE_LABELS: Record<string, string> = {
  string: 'Texto',
  number: 'Numérico',
  date: 'Fecha',
  boolean: 'Booleano',
  unknown: 'Desconocido',
};

const AVAILABILITY_ISSUES: Record<string, true> = {
  'descarga': true,
  'error-fuente': true,
  'no-es-archivo': true,
  'archivo-vacio': true,
  'servicio-no-disponible': true,
  // El origen contesta, pero con un error OGC en vez del archivo: el recurso
  // publicado apunta a una capa que ya no existe en el servidor.
  'servicio-error': true,
};

/**
 * `descarga-truncada` no entra en ninguna categoría a propósito: no es un fallo
 * del recurso sino del tope de descarga del analizador, y clasificarlo como
 * problema de disponibilidad o de formato penalizaría al publicador por una
 * limitación nuestra.
 */

const FORMAT_ISSUES: Record<string, true> = {
  'formato-no-esperado': true,
  'json-invalido': true,
  'xml-no-bien-formado': true,
  'xlsx-invalido': true,
  'zip-invalido': true,
  'xml-reparado': true,
  'error-encoding': true,
  'tipo-detectado': true,
  'tipo-no-identificado': true,
  'xls-legado': true,
  'dependencia-faltante': true,
  'error-validacion': true,
  'error-esquema': true,
  'ical-invalido': true,
  'firma-invalida': true,
  'geojson-invalido': true,
  'raiz-invalida': true,
  'shp-faltante': true,
  'zip-extraccion': true,
  'shp-lectura': true,
  'no-es-imagen': true,
};

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  availability: 'Disponibilidad',
  format: 'Conformidad del formato',
  content: 'Calidad de contenido',
};

export const ISSUE_LABELS: Record<string, string> = {
  // Estados de la descarga (`fetch.status`). No son incidencias del analizador,
  // pero `deliveryCause` cae a ellos cuando la descarga falla sin dejar código,
  // y sin etiqueta se enseñaban en crudo: «http_error».
  http_error: 'El servidor respondió con un error HTTP',
  unreachable: 'No se pudo contactar con el servidor',
  service: 'El servicio de origen no atendió la petición',
  too_large: 'Supera el tamaño máximo descargable',
  'celda-faltante': 'Celdas vacías en filas con datos',
  'error-tipo': 'Valores con tipo distinto al de su columna',
  'encabezado-vacio': 'Encabezados de columna vacíos',
  'fila-vacia': 'Filas completamente vacías',
  'celda-extra': 'Celdas de más (filas más largas que el encabezado)',
  'encabezado-duplicado': 'Encabezados de columna duplicados',
  'fila-duplicada': 'Filas duplicadas',
  'error-restriccion': 'Valores fuera de las restricciones del esquema',
  'error-unico': 'Valores duplicados en una columna única',
  'error-esquema': 'Problemas al inferir el esquema de datos',
  'zip-invalido': 'El archivo no es un ZIP válido',
  'servicio-error': 'El servicio de origen rechaza la petición del archivo',
  'descarga-truncada': 'No se pudo verificar: la descarga se cortó por tamaño',
  'json-invalido': 'JSON no válido (no se puede parsear)',
  'xlsx-invalido': 'XLSX no válido',
  'formato-no-esperado': 'El contenido no coincide con el formato declarado',
  'xml-no-bien-formado': 'XML no bien formado',
  'archivo-vacio': 'El archivo descargado está vacío (0 bytes)',
  'error-encoding': 'Error de codificación de caracteres',
  'no-es-archivo': 'La URL no devuelve un archivo',
  'error-fuente': 'Error de la fuente de datos',
  'xml-reparado': 'XML reparado automáticamente (encoding/entidades)',
  'descarga': 'Error de descarga',
  'fallo-analizador': 'Fallo interno del analizador',
  'tipo-detectado': 'El contenido real difiere del formato declarado',
  'tipo-no-identificado': 'No se pudo identificar el tipo de archivo',
  'xls-legado': 'Declarado XLSX pero el archivo es Excel 97-2003 (.xls)',
  'dependencia-faltante': 'Componente de análisis no disponible',
  'error-validacion': 'La validación de la estructura falló',
  'servicio-no-disponible': 'El servicio (WMS/WFS) no responde',
  'no-es-imagen': 'El contenido descargado no es una imagen',
  'sin-datos': 'El archivo no contiene filas de datos',
  'sin-contenido': 'El archivo está vacío',
  'sin-entidades': 'El documento no contiene elementos declarados',
  'sin-eventos': 'El calendario no contiene eventos',
  'errores-linea': 'Líneas mal formadas ignoradas por el parser',
  'sin-capas': 'El servicio WMS no declara capas',
  'sin-feature-types': 'El servicio WFS no declara FeatureTypes',
  'imagen-corrupta': 'La imagen no se puede decodificar',
  'firma-invalida': 'La firma (magic bytes) no es la esperada',
  'geojson-invalido': 'El archivo no es GeoJSON válido',
  'raiz-invalida': 'La raíz del documento no es la esperada',
  'tipo-desconocido': 'Tipo GeoJSON no reconocido',
  'geometria-nula': 'Elementos sin geometría',
  'sin-features': 'El recurso no contiene elementos geográficos',
  'sin-prj': 'El shapefile no incluye proyección (.prj)',
  'shp-faltante': 'El ZIP no contiene un shapefile (.shp)',
  'zip-extraccion': 'No se pudo extraer el shapefile del ZIP',
  'shp-lectura': 'El shapefile no se pudo leer',
  'ical-invalido': 'El archivo no es iCalendar válido',
};
