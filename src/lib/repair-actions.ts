/**
 * Lista de tareas de un publicador, ordenada por lo que se recupera al hacerlas.
 *
 * El portal sabía decir qué está mal —incidencias por código, causas por formato,
 * porcentajes por eje— pero nunca qué hacer, y lo accionable estaba repartido en
 * cinco pestañas de indicadores. Aquí las tres familias de defecto se reducen a
 * un mismo modelo:
 *
 *   entrega    el fichero no llega o no se puede interpretar
 *   contenido  el fichero abre, pero los datos vienen sucios
 *   metadatos  la ficha DCAT está incompleta o no permite verificar nada
 *
 * Todo se construye sobre funciones que ya existían: `findSystemicCauses` para
 * agrupar entrega por formato × causa, `distributionsAffectedByIssue` para contar
 * recursos (no ocurrencias) por incidencia, y `findMetadataGaps` para los huecos
 * de la ficha. Lo único nuevo es el «qué hacer».
 *
 * Client-safe.
 */

import type { QualityReport } from './quality-report';
import type { Dataset } from './types';
import { distributionsAffectedByIssue, type SystemicCause } from './availability';
import { issueLabel } from './quality-labels';
import { isBlockingCode } from './alerts';
import { METADATA_GAPS, type MetadataGapCode } from './metadata-gaps';

export type ActionFamily = 'entrega' | 'contenido' | 'metadatos';

export const FAMILY_LABELS: Record<ActionFamily, string> = {
  entrega: 'Entrega',
  contenido: 'Contenido',
  metadatos: 'Metadatos',
};

/** Una tarea concreta, con su alcance y su enlace a los afectados. */
export interface RepairAction {
  /** Clave estable, para React y para enlazar. */
  key: string;
  family: ActionFamily;
  /** Qué pasa, en una línea. */
  title: string;
  /** Qué hay que hacer para cerrarlo. */
  action: string;
  /** Por qué importa. */
  why?: string;
  /** Recursos (distribuciones o datasets) que se arreglan al hacerlo. */
  affected: number;
  /** Unidad de `affected`, para redactar bien el recuento. */
  unit: 'distribuciones' | 'datasets';
  /** Datasets distintos implicados, si se puede saber. */
  datasets?: number;
  /** Denominador cuando el fallo alcanza a un formato entero. */
  scopeTotal?: number;
  /** Etiqueta del formato afectado, si la acción es específica de uno. */
  format?: string;
  /** true si alcanza a TODOS los recursos de su formato: proceso roto. */
  wholeFormat?: boolean;
  /** Adónde ir para ver la lista. */
  href: string;
}

/**
 * Códigos de contenido que merecen una tarea propia.
 *
 * `celda-faltante` queda fuera a propósito: son 1,2 millones de celdas
 * opcionales vacías repartidas por todo el catálogo, y presentarlo como tarea
 * ahogaría el resto de la lista. Sale en la pestaña de ficheros, donde se puede
 * mirar recurso a recurso.
 */
const CONTENT_ACTIONS: Record<string, string> = {
  'error-tipo':
    'Revisar la columna afectada: normalmente es un total, un «N/D» o una nota de pie colada en una columna numérica o de fecha.',
  'encabezado-vacio':
    'Poner nombre a todas las columnas de la primera fila. Una columna sin nombre rompe la carga automática.',
  'encabezado-duplicado':
    'Renombrar las columnas repetidas para que cada una tenga un nombre único.',
  'fila-vacia': 'Eliminar las filas en blanco, habituales al exportar desde una hoja de cálculo.',
  'celda-extra':
    'Cuadrar el número de celdas de cada fila con el encabezado: suele ser un punto y coma de más dentro de un campo sin entrecomillar.',
  'fila-duplicada': 'Eliminar las filas repetidas o documentar por qué el dato aparece más de una vez.',
  'error-encoding':
    'Publicar en UTF-8. Con otra codificación los acentos y las eñes llegan corrompidos.',
  'xls-legado':
    'Exportar en XLSX real: el archivo está declarado como XLSX pero es un Excel 97-2003.',
  'geometria-nula': 'Revisar las entidades sin geometría: no se pueden situar en un mapa.',
};

/** Qué hacer ante cada causa de entrega, por código de incidencia. */
const DELIVERY_ACTIONS: Record<string, string> = {
  descarga: 'Restablecer el enlace o actualizar la URL de acceso en el catálogo.',
  'error-fuente': 'Revisar el servicio de origen: rechaza la petición del archivo.',
  'servicio-no-disponible': 'Revisar el servicio: no responde a las peticiones.',
  'servicio-error': 'Revisar la configuración del servicio, que rechaza la petición.',
  'no-es-archivo':
    'Apuntar la URL al archivo en sí. Ahora devuelve una página web, así que ningún proceso automático puede consumirlo.',
  'no-es-imagen': 'Apuntar la URL a la imagen en vez de a una página web.',
  'json-invalido': 'Corregir el JSON: tal como se publica no se puede parsear.',
  'xml-no-bien-formado': 'Corregir el XML: no está bien formado.',
  'xlsx-invalido': 'Regenerar el XLSX: el archivo publicado no se puede abrir.',
  'zip-invalido': 'Regenerar el ZIP: no es un archivo comprimido válido.',
  'shp-faltante': 'Incluir en el ZIP los ficheros que acompañan al .shp (.dbf, .shx y .prj).',
  'zip-extraccion': 'Regenerar el ZIP: no se puede extraer su contenido.',
  'shp-lectura': 'Revisar el shapefile: no se puede leer.',
  'archivo-vacio': 'Volver a publicar el archivo: se descarga con 0 bytes.',
  'formato-no-esperado':
    'Hacer coincidir el contenido con el formato declarado, o corregir el formato en el catálogo.',
  'tipo-no-identificado': 'Revisar el archivo: no se puede identificar su tipo.',
  'geojson-invalido': 'Corregir el GeoJSON: no cumple la especificación.',
  'ical-invalido': 'Corregir el iCal: no se puede interpretar.',
  'imagen-corrupta': 'Volver a publicar la imagen: el archivo está corrupto.',
  'raiz-invalida': 'Revisar la estructura del documento: la raíz no es la esperada.',
};

function deliveryAction(code: string): string {
  return DELIVERY_ACTIONS[code] ?? 'Revisar el recurso: no se puede descargar o interpretar.';
}

/* ------------------------------------------------------------------ */

/** Acciones de entrega, a partir de las causas sistémicas ya calculadas. */
export function deliveryActions(causes: readonly SystemicCause[]): RepairAction[] {
  return causes.map((c) => ({
    key: `entrega:${c.key}`,
    family: 'entrega' as const,
    title: `${c.causeLabel} · ${c.format}`,
    action: deliveryAction(c.causeCode),
    why: c.wholeFormat
      ? `Falla en todos los recursos ${c.format} del catálogo: apunta a un proceso de publicación roto, no a ${c.affected} problemas independientes.`
      : undefined,
    affected: c.affected,
    unit: 'distribuciones' as const,
    datasets: c.datasets,
    scopeTotal: c.formatTotal,
    format: c.format,
    wholeFormat: c.wholeFormat,
    href: `/calidad?vista=ficheros&causa=${encodeURIComponent(c.causeCode)}`,
  }));
}

/**
 * Acciones de contenido: una por código de incidencia con acción conocida,
 * contando recursos afectados y no ocurrencias.
 */
export function contentActions(report: QualityReport | null): RepairAction[] {
  if (!report) return [];
  const affectedByCode = distributionsAffectedByIssue(report);

  return Object.entries(affectedByCode)
    .filter(([code, count]) => count > 0 && !isBlockingCode(code) && CONTENT_ACTIONS[code])
    .map(([code, count]) => ({
      key: `contenido:${code}`,
      family: 'contenido' as const,
      title: issueLabel(code),
      action: CONTENT_ACTIONS[code],
      affected: count,
      unit: 'distribuciones' as const,
      href: `/calidad?vista=ficheros&familia=contenido&causa=${encodeURIComponent(code)}`,
    }));
}

/**
 * Acciones de metadatos, contando datasets afectados por hueco.
 *
 * Las recomendaciones DCAT-AP quedan fuera de esta lista: no penalizan y, siendo
 * 824 de 824, encabezarían las prioridades por volumen sin ser lo más urgente.
 * Tienen su bloque propio en la pestaña de metadatos.
 */
export function metadataActions(datasets: readonly Dataset[]): RepairAction[] {
  const counts = new Map<MetadataGapCode, number>();
  for (const ds of datasets) {
    for (const gap of ds.metadataGaps) {
      counts.set(gap, (counts.get(gap) ?? 0) + 1);
    }
  }

  const actions: RepairAction[] = [];
  for (const [code, count] of counts) {
    const info = METADATA_GAPS[code];
    if (info.axis === 'recomendacion' || count === 0) continue;
    actions.push({
      key: `metadatos:${code}`,
      family: 'metadatos',
      title: `${info.label} (${info.field})`,
      action: info.action,
      why: info.why,
      affected: count,
      unit: 'datasets',
      href: `/calidad?vista=metadatos&hueco=${encodeURIComponent(code)}`,
    });
  }
  return actions;
}

/**
 * Todas las acciones, de mayor a menor impacto.
 *
 * Un fallo que alcanza a un formato entero sube primero aunque afecte a menos
 * recursos: delata un proceso roto y se arregla de una vez. Después, por volumen
 * recuperable. Las distribuciones y los datasets no son la misma unidad, así que
 * no se pueden comparar directamente; se ordena por número de recursos y la
 * unidad va escrita al lado para que el publicador juzgue.
 */
export function buildRepairActions(input: {
  causes: readonly SystemicCause[];
  report: QualityReport | null;
  datasets: readonly Dataset[];
}): RepairAction[] {
  return [
    ...deliveryActions(input.causes),
    ...contentActions(input.report),
    ...metadataActions(input.datasets),
  ].sort(
    (a, b) =>
      Number(Boolean(b.wholeFormat)) - Number(Boolean(a.wholeFormat)) ||
      b.affected - a.affected ||
      a.title.localeCompare(b.title, 'es')
  );
}
