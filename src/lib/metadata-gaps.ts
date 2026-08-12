/**
 * Huecos de metadatos de un dataset, en términos de lo que hay que hacer para
 * cerrarlos.
 *
 * El portal calculaba `QualityBreakdown` (completitud, formato, actualidad,
 * licencia) dentro de `computeQuality` y lo devolvía sin que nadie lo consumiera:
 * un publicador veía «metadatos 78%» y no tenía forma de saber qué campo le
 * faltaba. Este módulo convierte esa aritmética en una lista de tareas.
 *
 * `findMetadataGaps` es además la ÚNICA definición de la completitud: la usa
 * `computeQuality` para su 40%. Calcular la nota por un lado y la lista de
 * huecos por otro es exactamente cómo se desincronizó `classifyDelivery` del
 * criterio que decía aplicar.
 *
 * Client-safe: sin node:fs ni imports de servidor.
 */

import type { DataFormat, License } from './types';

export type MetadataGapCode =
  // Campos que entran en la completitud (40% del score de metadatos).
  | 'sin-titulo'
  | 'sin-descripcion'
  | 'sin-licencia-identificada'
  | 'sin-organismo'
  | 'sin-fecha-publicacion'
  | 'sin-idioma'
  | 'sin-cobertura'
  | 'sin-tematica'
  | 'sin-palabras-clave'
  // No entran en la completitud, pero sí condicionan otros ejes o la reutilización.
  | 'sin-fecha-actualizacion'
  | 'sin-periodicidad'
  | 'licencia-restrictiva'
  | 'sin-formato-abierto'
  // Recomendaciones DCAT-AP que el portal no puntúa.
  | 'sin-identificador'
  | 'sin-punto-contacto';

export interface MetadataGapInfo {
  /** Qué falta, en una línea. */
  label: string;
  /** Por qué importa para quien reutiliza los datos. */
  why: string;
  /** Qué tiene que hacer el publicador. */
  action: string;
  /** Elemento DCAT concreto, para que el publicador sepa dónde tocar. */
  field: string;
  /**
   * `completitud` entra en el 40% de completitud del score de metadatos.
   * `actualidad` y `apertura` afectan a sus propios ejes.
   * `recomendacion` no afecta a ninguna puntuación.
   */
  axis: 'completitud' | 'actualidad' | 'apertura' | 'recomendacion';
}

export const METADATA_GAPS: Record<MetadataGapCode, MetadataGapInfo> = {
  'sin-titulo': {
    label: 'Sin título',
    field: 'dct:title',
    why: 'Sin título el dataset no se puede buscar ni citar.',
    action: 'Añadir un título descriptivo.',
    axis: 'completitud',
  },
  'sin-descripcion': {
    label: 'Sin descripción',
    field: 'dct:description',
    why: 'La descripción es lo que permite decidir si un dataset sirve antes de descargarlo.',
    action: 'Añadir una descripción que diga qué contiene y con qué criterio se recoge.',
    axis: 'completitud',
  },
  'sin-licencia-identificada': {
    label: 'Sin licencia identificable',
    field: 'dct:license',
    why: 'Sin licencia reconocible nadie puede saber si tiene derecho a reutilizar el dato, y ante la duda no se reutiliza.',
    action: 'Declarar la licencia con una URI conocida (CC-BY-4.0 o la licencia IGCYL).',
    axis: 'completitud',
  },
  'sin-organismo': {
    label: 'Sin organismo publicador',
    field: 'dct:publisher',
    why: 'Es lo que indica quién responde del dato.',
    action: 'Declarar el organismo publicador.',
    axis: 'completitud',
  },
  'sin-fecha-publicacion': {
    label: 'Sin fecha de publicación',
    field: 'dct:issued',
    why: 'Sin fecha de publicación no se puede situar el dato en el tiempo ni evaluar su vigencia.',
    action: 'Añadir la fecha de publicación.',
    axis: 'completitud',
  },
  'sin-idioma': {
    label: 'Sin idioma declarado',
    field: 'dct:language',
    why: 'Los recolectores multilingües lo necesitan para clasificar el recurso.',
    action: 'Declarar el idioma del dataset.',
    axis: 'completitud',
  },
  'sin-cobertura': {
    label: 'Sin cobertura territorial',
    field: 'dct:spatial',
    why: 'Es lo que permite filtrar por territorio y cruzar el dato con otras fuentes geográficas.',
    action: 'Declarar el ámbito territorial que cubre el dataset.',
    axis: 'completitud',
  },
  'sin-tematica': {
    label: 'Sin temática',
    field: 'dcat:theme',
    why: 'Sin temática el dataset no aparece en las búsquedas por sector ni se agrega en datos.gob.es.',
    action: 'Asignar al menos una temática del vocabulario sectorial.',
    axis: 'completitud',
  },
  'sin-palabras-clave': {
    label: 'Sin palabras clave',
    field: 'dcat:keyword',
    why: 'Las palabras clave son la vía principal de descubrimiento cuando el título no coincide con lo que se busca.',
    action: 'Añadir palabras clave con los términos que usaría quien busca este dato.',
    axis: 'completitud',
  },
  'sin-fecha-actualizacion': {
    label: 'Sin fecha de última actualización',
    field: 'dct:modified',
    why: 'Es el hueco de metadatos más extendido del catálogo. Sin esta fecha nadie —ni este portal, ni datos.gob.es, ni ningún recolector— puede saber cuándo se refrescó el dato por última vez, así que la actualidad no se puede verificar y el dataset la pierde en la puntuación aunque se esté actualizando a diario.',
    action: 'Publicar dct:modified y mantenerlo al día en cada actualización.',
    axis: 'actualidad',
  },
  'sin-periodicidad': {
    label: 'Sin periodicidad declarada',
    field: 'dct:accrualPeriodicity',
    why: 'Sin periodicidad no hay forma de saber si un dato de hace ocho meses va con retraso o es justo lo esperado.',
    action: 'Declarar cada cuánto se actualiza el dataset.',
    axis: 'actualidad',
  },
  'licencia-restrictiva': {
    label: 'Licencia con restricciones de uso',
    field: 'dct:license',
    why: 'Una licencia de uso no comercial excluye a empresas y a cualquier proyecto con ánimo de lucro, que son buena parte de los reutilizadores.',
    action: 'Valorar el paso a CC-BY-4.0, que solo exige atribución.',
    axis: 'apertura',
  },
  'sin-formato-abierto': {
    label: 'Sin ningún formato abierto',
    field: 'dcat:distribution',
    why: 'Publicar solo en formatos propietarios o binarios obliga a quien reutiliza a tener el programa concreto que los abre.',
    action: 'Añadir una distribución en CSV, JSON o GeoJSON junto a las existentes.',
    axis: 'apertura',
  },
  'sin-identificador': {
    label: 'Sin identificador persistente',
    field: 'dct:identifier',
    why: 'Un identificador estable permite citar el dataset y seguirlo aunque cambie su URL.',
    action: 'Publicar dct:identifier con un identificador que no cambie.',
    axis: 'recomendacion',
  },
  'sin-punto-contacto': {
    label: 'Sin punto de contacto',
    field: 'dcat:contactPoint',
    why: 'Es a quién escribir para avisar de un error en el dato. Sin él, un fallo detectado por un reutilizador no llega a quien puede corregirlo.',
    action: 'Publicar dcat:contactPoint con un buzón atendido.',
    axis: 'recomendacion',
  },
};

/** Códigos que entran en la completitud del score de metadatos, en orden. */
export const COMPLETENESS_GAPS: MetadataGapCode[] = [
  'sin-titulo',
  'sin-descripcion',
  'sin-licencia-identificada',
  'sin-organismo',
  'sin-fecha-publicacion',
  'sin-idioma',
  'sin-cobertura',
  'sin-tematica',
  'sin-palabras-clave',
];

/** Formatos que cuentan como abiertos y estándar para la reutilización. */
const OPEN_FORMATS: ReadonlySet<string> = new Set<DataFormat>(['CSV', 'JSON', 'GeoJSON']);

export interface MetadataInput {
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
}

/**
 * Huecos de metadatos de un dataset.
 *
 * El orden de salida es estable (completitud, actualidad, apertura,
 * recomendaciones) para que las listas de la interfaz no bailen.
 */
export function findMetadataGaps(input: MetadataInput): MetadataGapCode[] {
  const gaps: MetadataGapCode[] = [];

  if (!input.title) gaps.push('sin-titulo');
  if (!input.description) gaps.push('sin-descripcion');
  // `Otro` es el valor al que cae `mapLicense` cuando la URI no se reconoce.
  if (input.license === 'Otro') gaps.push('sin-licencia-identificada');
  if (!input.publisher) gaps.push('sin-organismo');
  if (!input.issued) gaps.push('sin-fecha-publicacion');
  if (!input.language) gaps.push('sin-idioma');
  if (!input.spatial) gaps.push('sin-cobertura');
  if (input.themes.length === 0) gaps.push('sin-tematica');
  if (input.keywords.length === 0) gaps.push('sin-palabras-clave');

  if (!input.modified) gaps.push('sin-fecha-actualizacion');
  if (!input.periodicityMonths || input.periodicityMonths <= 0) gaps.push('sin-periodicidad');

  if (input.license === 'IGCYL-NC') gaps.push('licencia-restrictiva');
  if (input.formats.length > 0 && !input.formats.some((f) => OPEN_FORMATS.has(f))) {
    gaps.push('sin-formato-abierto');
  }

  if (!input.identifier) gaps.push('sin-identificador');
  if (!input.contactPoint) gaps.push('sin-punto-contacto');

  return gaps;
}

/**
 * Cuántos de los campos de completitud están presentes, sobre el total.
 *
 * `computeQuality` deriva de aquí su 40% de completitud, para que la nota y la
 * lista de huecos no puedan discrepar.
 */
export function completenessRatio(gaps: readonly MetadataGapCode[]): number {
  const missing = gaps.filter((g) => COMPLETENESS_GAPS.includes(g)).length;
  return (COMPLETENESS_GAPS.length - missing) / COMPLETENESS_GAPS.length;
}

/* ------------------------------------------------------------------ */
/* Actualidad                                                          */
/* ------------------------------------------------------------------ */

/**
 * Por qué la actualidad de un dataset puntúa lo que puntúa.
 *
 * `no-verificable` es el caso mayoritario del catálogo y el que estaba
 * confundido: el dataset declara una periodicidad pero no publica
 * `dct:modified`, así que la única fecha disponible es la de publicación y el
 * cálculo lo trata como si llevara siglos sin actualizarse. No está demostrado
 * que el dato esté obsoleto; lo que está demostrado es que no se puede
 * comprobar. Son dos acciones distintas: publicar el metadato, o actualizar
 * el dato.
 */
export type FreshnessDiagnosis =
  | 'al-dia'
  | 'vencido'
  | 'no-verificable'
  | 'sin-periodicidad'
  | 'sin-fecha';

export interface FreshnessReport {
  diagnosis: FreshnessDiagnosis;
  /** Periodos declarados transcurridos desde la fecha de referencia. */
  periodsLate: number | null;
  /** De dónde sale la fecha de referencia usada para medir. */
  reference: 'modified' | 'issued' | 'none';
}

export interface FreshnessInput {
  issued: string;
  modified?: string;
  periodicityMonths?: number;
  now: Date;
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Diagnostica la actualidad SIN cambiar la puntuación: solo explica de dónde
 * viene. La fórmula del score sigue viviendo en `computeQuality`.
 */
export function diagnoseFreshness(input: FreshnessInput): FreshnessReport {
  const modified = parseDate(input.modified);
  const issued = parseDate(input.issued);
  const referenceDate = modified ?? issued;

  if (!referenceDate) {
    return { diagnosis: 'sin-fecha', periodsLate: null, reference: 'none' };
  }

  const reference = modified ? 'modified' : 'issued';

  if (!input.periodicityMonths || input.periodicityMonths <= 0) {
    return { diagnosis: 'sin-periodicidad', periodsLate: null, reference };
  }

  const monthsSince = (input.now.getTime() - referenceDate.getTime()) / MS_PER_MONTH;
  const periodsLate = Math.max(0, Math.round((monthsSince / input.periodicityMonths) * 10) / 10);

  if (periodsLate <= 1) return { diagnosis: 'al-dia', periodsLate, reference };

  // Sin `dct:modified` se ha medido desde la fecha de PUBLICACIÓN, que no dice
  // nada de la última actualización: el retraso es aparente, no demostrado.
  if (!modified) return { diagnosis: 'no-verificable', periodsLate, reference };

  return { diagnosis: 'vencido', periodsLate, reference };
}

export const FRESHNESS_LABELS: Record<FreshnessDiagnosis, string> = {
  'al-dia': 'Al día',
  vencido: 'Vencido',
  'no-verificable': 'No se puede verificar',
  'sin-periodicidad': 'Sin periodicidad declarada',
  'sin-fecha': 'Sin fecha',
};
