/**
 * Triaje de datasets problemáticos del informe de análisis.
 *
 * Antes: cualquier dataset con ≥1 incidencia era una "alerta" (824/824), lo que
 * inundaba la página de Alertas y la hacía inutilizable como lista de corrección.
 *
 * Ahora: se priorizan las incidencias por impacto real en la reutilización:
 *   - CRÍTICO: el recurso es inutilizable (disponibilidad o conformidad de formato).
 *   - ADVERTENCIA: problemas de contenido con impacto (tipos, encabezados, filas,
 *     o un volumen alto de celdas vacías).
 * Las incidencias menores (celdas vacías esporádicas) no generan alerta.
 *
 * Módulo server-safe: depende de `quality-labels` (client-safe) y de tipos de
 * `quality-report`; puede importarse desde páginas servidor y route handlers.
 */

import type { QualityDatasetSummary, QualityReport } from './quality-report';

export type AlertLevel = 'critical' | 'warning';

/**
 * Causa de una alerta.
 *
 * Solo el código y el recuento: `label` y `category` se derivan de `code` con
 * `issueLabel` e `issueCategory`, ambas client-safe. La lista entera viaja al
 * navegador (se filtra en cliente), y mandar las etiquetas ya resueltas para
 * las ~1.400 causas de las 555 alertas engordaba el HTML sin aportar nada.
 */
export interface AlertCause {
  code: string;
  count: number;
}

export interface DatasetAlert {
  datasetId: string;
  title: string;
  /** Puntuación compuesta del dataset (metadatos + disponibilidad + contenido). */
  score: number | null;
  level: AlertLevel;
  causes: AlertCause[];
  failedDistributions: number;
  totalDistributions: number;
}

/**
 * Códigos que inutilizan el recurso (disponibilidad o conformidad de formato).
 *
 * Se exporta porque `report.py` necesita el mismo conjunto para no meter en la
 * media de contenido de un conjunto de datos los archivos que no llegan a
 * abrirse. Allí está copiado como `BLOCKING_ISSUE_CODES` en `checks.py`, igual
 * que ya lo estaban `PORTAL_LIMITATION_CODES` y `PUBLICATION_DEFECT_CODES`, y
 * `portal-limitation-parity.test.ts` comprueba que las dos listas coincidan.
 */
export const BLOCKING_ISSUE_CODES = new Set<string>([
  'descarga',
  'error-fuente',
  'no-es-archivo',
  'archivo-vacio',
  'servicio-no-disponible',
  'servicio-error',
  'no-es-imagen',
  'formato-no-esperado',
  'json-invalido',
  'xml-no-bien-formado',
  'xlsx-invalido',
  'zip-invalido',
  'tipo-no-identificado',
  'error-validacion',
  'error-esquema',
  'ical-invalido',
  'firma-invalida',
  'geojson-invalido',
  'raiz-invalida',
  'imagen-corrupta',
  'shp-faltante',
  'zip-extraccion',
  'shp-lectura',
]);

/** Códigos de impacto moderado: legibles pero con discrepancias o contenido erróneo. */
const HIGH_IMPACT_CONTENT_CODES = new Set<string>([
  'error-tipo',
  'celda-extra',
  'fila-vacia',
  'encabezado-vacio',
  'encabezado-duplicado',
  'fila-duplicada',
  'error-restriccion',
  'error-unico',
  'error-encoding',
  'xls-legado',
  'tipo-detectado',
  'sin-datos',
  'sin-contenido',
  'geometria-nula',
]);

/** Umbral de celdas vacías a partir del cual se considera incidencia accionable. */
const MISSING_CELL_THRESHOLD = 1000;

/** True si el código de incidencia inutiliza el recurso (disponibilidad/formato). */
export function isBlockingCode(code: string): boolean {
  return BLOCKING_ISSUE_CODES.has(code);
}

/**
 * Clasifica un dataset del informe en una alerta accionable, o null si solo
 * tiene incidencias menores (celdas vacías esporádicas) o ninguna.
 */
export function classifyDataset(
  ds: QualityDatasetSummary,
  /**
   * Nota de contenido con la que se decide el nivel y que se publica en la
   * alerta. Por defecto la del informe, que viene inflada por construcción (ver
   * `datasetContentScore` en `availability`): `report.py` promedia solo las
   * distribuciones con `status == 'ok'`, así que ninguna baja de 95 y la
   * condición «contenido por debajo de 50» no se cumplía nunca. Con ella, el
   * nivel crítico lo decidía en la práctica solo `hasBlocking`.
   *
   * Se inyecta en vez de importarse porque `availability` ya importa
   * `isBlockingCode` de este módulo, y al revés sería un ciclo.
   */
  contentScore: number | null = ds.score
): DatasetAlert | null {
  const causes: AlertCause[] = [];
  let hasBlocking = false;
  let hasContent = false;

  for (const [code, count] of Object.entries(ds.issues_by_code)) {
    if (BLOCKING_ISSUE_CODES.has(code)) {
      hasBlocking = true;
      causes.push({ code, count });
    } else if (
      HIGH_IMPACT_CONTENT_CODES.has(code) ||
      (code === 'celda-faltante' && count >= MISSING_CELL_THRESHOLD)
    ) {
      hasContent = true;
      causes.push({ code, count });
    }
  }

  if (!hasBlocking && !hasContent) return null;

  const level: AlertLevel =
    hasBlocking || (contentScore != null && contentScore < 50) ? 'critical' : 'warning';

  causes.sort(
    (a, b) =>
      Number(isBlockingCode(b.code)) - Number(isBlockingCode(a.code)) || b.count - a.count
  );

  return {
    datasetId: ds.dataset_id,
    title: ds.dataset_title,
    score: contentScore,
    level,
    causes,
    failedDistributions: ds.failed,
    totalDistributions: ds.distributions,
  };
}

/**
 * Construye la lista de alertas, de peor puntuación a mejor.
 *
 * Las dos notas que intervienen son distintas y por eso se inyectan por
 * separado:
 *
 * - `contentScore` es la calidad de contenido, y es la que decide el nivel
 *   (crítico si hay una incidencia bloqueante o si baja de 50). Pásale
 *   `datasetContentScore`; sin ella se usa la del informe, que viene inflada.
 * - `resolveScore` sustituye la nota que se PUBLICA en la alerta por la
 *   compuesta, que es la que ve el usuario en el resto del portal. No afecta al
 *   nivel.
 */
export function buildAlerts(
  report: QualityReport | null,
  options: {
    contentScore?: (ds: QualityDatasetSummary) => number | null;
    resolveScore?: (ds: QualityDatasetSummary) => number | null;
  } = {}
): DatasetAlert[] {
  if (!report) return [];
  const { contentScore, resolveScore } = options;
  const alerts: DatasetAlert[] = [];
  for (const ds of report.datasets) {
    const alert = classifyDataset(ds, contentScore ? contentScore(ds) : ds.score);
    if (!alert) continue;
    if (resolveScore) alert.score = resolveScore(ds);
    alerts.push(alert);
  }
  // Las que no tienen puntuación van primero: no hay nada legible que medir.
  alerts.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  return alerts;
}

