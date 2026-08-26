/**
 * Disponibilidad de los recursos: ¿se puede abrir el fichero, sí o no?
 *
 * El portal mezclaba dos preguntas muy distintas en un solo número:
 *   - ¿el recurso se puede usar?      → disponibilidad (bloqueante)
 *   - ¿el contenido está limpio?      → calidad de contenido (gradual)
 *
 * Mezclarlas engañaba en las dos direcciones. Por volumen, el 98,8% de las
 * "incidencias" del informe son celdas vacías y tipos incoherentes: un CSV
 * correcto con 9.072 celdas opcionales vacías salía mil veces peor que un
 * fichero que no existe. Y al revés, la media de calidad (78,7%) tapaba que
 * un tercio de los ficheros no abre.
 *
 * Este módulo es la fuente única de la primera pregunta. Client-safe: solo
 * importa tipos de `quality-report` y funciones de `quality-labels`.
 */

import type { DistributionResult, QualityDatasetSummary, QualityReport } from './quality-report';
import { ISSUE_LABELS, issueLabel, isPortalLimitation } from './quality-labels';
import { isBlockingCode } from './alerts';

/**
 * Estado de entrega de una distribución.
 *
 * `no-entrega` existe porque el analizador y la interfaz no se ponían de
 * acuerdo: `engine.py` marca como "omitida" la URL que devuelve una página
 * HTML en vez del fichero (para no penalizar al organismo, ya que suele ser
 * un problema de la plataforma), pero `alerts.ts` la trataba como bloqueante.
 * Ambas cosas son ciertas, así que tiene categoría propia: se ve y se cuenta
 * aparte, pero no entra en el score.
 *
 * `no-analizado` se separó de `omitida` por lo mismo. `omitida` juntaba dos
 * hechos que no se parecen: «no lo intentamos» (supera el tope de descarga, el
 * catálogo no publica URL) y «lo descargamos entero y no teníamos con qué
 * abrirlo». El segundo caso alcanzaba a 364 archivos del informe —341 XLSX sin
 * openpyxl instalado— y al no tener estado propio salía en la tabla con el
 * `fetch.status` crudo por etiqueta: «downloaded», en inglés, con HTTP 200 al
 * lado y «openpyxl no está instalado» como resumen. Tres datos correctos que
 * juntos no querían decir nada.
 */
export type DeliveryState = 'ok' | 'roto' | 'no-entrega' | 'omitida' | 'no-analizado';

/** Códigos que significan "la URL no devuelve el archivo prometido". */
const NOT_A_FILE_CODES = new Set(['no-es-archivo', 'no-es-imagen']);

/**
 * Resultado de la descarga, según `fetch.status` del analizador.
 *
 * - `downloaded` / `truncated`: los bytes llegaron. `truncated` es un fichero
 *   grande del que se leyó una parte, pero se leyó.
 * - `too_large`: no se intentó por superar el tope. No sabemos si abre.
 * - `no_url`: el catálogo describe el recurso sin dar enlace. Tampoco se intentó.
 * - `service`: es un WMS/WFS. No hay archivo que descargar; lo comprueba el
 *   analizador OGC. Ver `FETCH_SERVICE`.
 * - `http_error` / `unreachable` / `error`: la descarga falló.
 */
const FETCH_DELIVERED = new Set(['downloaded', 'truncated']);
/**
 * `no_url` está aquí y no en el grupo de fallos porque no se intentó nada.
 * `engine.py` ya lo marca como «omitida», pero al no figurar en ninguno de los
 * dos conjuntos caía al respaldo `'fallido'` y `classifyDelivery` lo devolvía
 * como `roto`: una distribución que nunca tuvo URL se contaba como «no se puede
 * descargar ni abrir», que afirma más de lo que sabemos.
 */
const FETCH_NOT_EVALUATED = new Set(['too_large', 'no_url']);

/**
 * WMS y WFS no descargan ningún archivo, y eso NO es un fallo de entrega.
 *
 * `engine.py` le pone `fetch.status: 'service'` a todo servicio OGC antes de
 * saber cómo ha ido —significa «aquí no hay bytes, pregúntale al analizador»—,
 * pero aquí caía al respaldo `'fallido'` y `classifyDelivery` devolvía `roto`
 * para los 18 servicios del catálogo **sin excepción**. El informe dice otra
 * cosa: 9 de 10 WMS y 8 de 8 WFS responden a `GetCapabilities` y declaran sus
 * capas, y son las mismas que la vista previa geoespacial dibuja sin problema.
 * El portal las pintaba en rojo con el motivo «El servicio de origen no atendió
 * la petición» mientras enseñaba sus capas dos pantallas más allá.
 *
 * Para un servicio, la pregunta «¿se puede usar?» la responde el análisis de
 * las capacidades, no la descarga: un servicio caído deja `servicio-no-disponible`
 * o `servicio-error`, que ya son códigos bloqueantes y siguen dando `roto` por
 * la vía normal.
 */
const FETCH_SERVICE = 'service';

type FetchOutcome = 'entregado' | 'fallido' | 'no-evaluado' | 'servicio';

function fetchOutcome(dist: DistributionResult): FetchOutcome {
  const status = dist.fetch?.status;
  if (!status) return 'fallido';
  if (FETCH_DELIVERED.has(status)) return 'entregado';
  if (FETCH_NOT_EVALUATED.has(status)) return 'no-evaluado';
  if (status === FETCH_SERVICE) return 'servicio';
  return 'fallido';
}

/**
 * Etiquetas en masculino, concordando con «archivo».
 *
 * Estaban en femenino porque concordaban con «distribución», pero las tablas que
 * las pintan llaman «archivo» a la fila: se leía «archivo … Rota». Es el rastro
 * visible de haber tenido cuatro nombres —distribución, fichero, archivo,
 * recurso— para la misma cosa.
 */
export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  ok: 'Se descarga y se abre',
  roto: 'No se puede descargar ni abrir',
  'no-entrega': 'La URL no devuelve el archivo',
  omitida: 'Sin comprobar',
  'no-analizado': 'Sin analizar: falta el lector en el portal',
};

export const DELIVERY_SHORT: Record<DeliveryState, string> = {
  ok: 'Correcto',
  roto: 'No abre',
  'no-entrega': 'No entrega el archivo',
  omitida: 'Sin comprobar',
  'no-analizado': 'Sin analizar',
};

/** Explicación de cada estado que no es «se descarga y se abre». */
export const DELIVERY_EXPLANATIONS: Record<Exclude<DeliveryState, 'ok'>, string> = {
  roto: 'El servidor no devolvió el archivo, o el archivo llegó y no se pudo interpretar. El dato no es reutilizable tal cual.',
  'no-entrega':
    'La URL responde, pero devuelve una página web en lugar del archivo de datos. Bloquea la reutilización automatizada; suele ser un problema de la plataforma de publicación, no del dato en sí, y por eso no penaliza la puntuación.',
  omitida:
    'El análisis no llegó a intentar la descarga de este archivo, porque supera el tamaño máximo descargable o porque el catálogo no publica una URL de acceso.',
  'no-analizado':
    'El archivo se descargó completo, pero este portal no tiene con qué leer su formato, así que su contenido no se ha comprobado. No es un defecto del archivo: puede estar perfectamente.',
};

function issueCodes(dist: DistributionResult): string[] {
  return (dist.analysis?.issues ?? []).map((i) => i.code);
}

/**
 * Clasifica una distribución del informe por su estado de entrega.
 *
 * El criterio es si el fichero LLEGA y ABRE, no el `status` que le pone el
 * analizador. Esa era la confusión que sobredimensionaba el titular del portal:
 * `engine.py` marca `status: 'error'` en cuanto hay una incidencia de severidad
 * `error`, y «tipos mezclados en una columna» es una de ellas. Resultado: un
 * XLSX que responde HTTP 200, se descarga, se abre y del que se leen 336 filas
 * en 2 hojas con puntuación 80 se contaba como «no se puede descargar o abrir».
 *
 * De las 582 distribuciones que el analizador marca en error, 328 son de este
 * tipo: abren y traen filas. Las otras 254 son las que de verdad no se pueden
 * usar. Mezclarlas convertía el 15% real en un 35%, y metía en «Qué arreglar»
 * —la lista de lo inutilizable— ficheros perfectamente legibles que solo
 * necesitan limpieza, que es lo que mide el otro eje.
 */
export function classifyDelivery(dist: DistributionResult): DeliveryState {
  const codes = issueCodes(dist);

  // Lo más específico primero: la URL respondió, pero con una página web.
  if (codes.some((c) => NOT_A_FILE_CODES.has(c))) return 'no-entrega';

  const outcome = fetchOutcome(dist);
  // No llegó el fichero: da igual lo que diga el resto.
  if (outcome === 'fallido') return 'roto';
  // No se intentó (supera el tope de tamaño): no se puede afirmar nada.
  if (outcome === 'no-evaluado') return 'omitida';

  // `servicio` sigue por aquí a propósito: un WMS/WFS no tiene bytes que
  // esperar, así que su estado sale de los códigos de abajo igual que el de un
  // archivo entregado. Ver `FETCH_SERVICE`.

  // Llegó. Solo es «roto» si además no se puede interpretar: un JSON inválido,
  // un ZIP corrupto, un shapefile sin sus piezas.
  if (codes.some(isBlockingCode)) return 'roto';

  // Llegó, pero el análisis no llegó a mirar dentro por una limitación nuestra:
  // no teníamos el lector, se rompió nuestro propio código, se cortó por nuestro
  // tope. Antes esto caía al `return 'omitida'` del final, indistinguible de un
  // archivo que ni se intentó descargar.
  if (codes.some(isPortalLimitation)) return 'no-analizado';

  // Llegó y abrió. Si el analizador lo marcó en error, es por el CONTENIDO, y
  // eso lo mide el eje de calidad, no este.
  if (dist.status === 'ok' || dist.status === 'error') return 'ok';

  return 'omitida';
}

/**
 * Estados en los que el análisis no llega a afirmar nada del archivo.
 *
 * Quien calcula porcentajes tiene que dejarlos FUERA del denominador, no
 * contarlos como fallo: son el hueco de cobertura del análisis. Se agrupan en un
 * predicado porque son dos estados y hasta ahora los sitios que los descartaban
 * comprobaban `=== 'omitida'` a mano, así que al añadir `no-analizado` habrían
 * empezado a contar como archivos que no abren los 364 que solo nos faltaba
 * leer.
 */
export function isUnevaluated(state: DeliveryState): boolean {
  return state === 'omitida' || state === 'no-analizado';
}

export interface DeliveryCause {
  code: string;
  label: string;
}

/**
 * Motivo concreto por el que una distribución no está disponible, o null si sí
 * lo está.
 *
 * Se pregunta por el estado de entrega, no por `dist.status`: un fichero que
 * abre pero trae tipos mezclados no tiene «motivo de indisponibilidad», y antes
 * devolvía «Valores con tipo distinto al de su columna» como si lo fuera.
 *
 * El orden importa, y estaba mal. Se preguntaba por el código bloqueante y,
 * al no haberlo, se caía directamente a `fetch.status` — incluso cuando la
 * descarga había ido perfectamente. Un XLSX descargado sin incidencias del
 * archivo pero sin lector en el portal devolvía `'downloaded'` como si
 * «descargado» fuera el motivo de que no estuviera disponible, y así se pintaba
 * en la tabla. El código que sí lo explicaba —`dependencia-faltante`, con su
 * etiqueta escrita— no se consultaba nunca.
 *
 * `fetch.status` solo es el motivo cuando los bytes NO llegaron: ahí sí es lo
 * único que sabemos, y `http_error`/`unreachable` lo dicen bien. `service`
 * queda fuera por lo mismo que en `classifyDelivery`: no describe ningún fallo,
 * solo dice que el recurso es un servicio OGC.
 */
export function deliveryCause(dist: DistributionResult): DeliveryCause | null {
  if (classifyDelivery(dist) === 'ok') return null;
  const codes = issueCodes(dist);
  const outcome = fetchOutcome(dist);
  const fetchExplains = outcome !== 'entregado' && outcome !== 'servicio';
  const code =
    codes.find((c) => isBlockingCode(c)) ??
    codes.find((c) => isPortalLimitation(c)) ??
    (fetchExplains ? dist.fetch?.status : undefined) ??
    codes[0] ??
    'desconocido';

  /*
   * Si el código no está en `ISSUE_LABELS`, se usa la etiqueta que escribió el
   * propio analizador antes de caer al texto genérico.
   *
   * `ISSUE_LABELS` se mantiene a mano y `DEFAULT_ISSUE` de `formats/tabular.py`
   * puede emitir cualquier tipo crudo de Frictionless como código, así que llegar
   * con un código sin traducir es una situación normal, no una anomalía. Sin este
   * paso, todos esos casos distintos colapsaban en un mismo «Incidencia sin
   * descripción» —y `repair-actions.ts` llegaba a titular una tarea con él—,
   * cuando el informe ya trae una frase para cada uno.
   */
  const label = ISSUE_LABELS[code] ?? issueOwnLabel(dist, code) ?? issueLabel(code);
  return { code, label };
}

/** La etiqueta que el analizador escribió para ese código en esta distribución. */
function issueOwnLabel(dist: DistributionResult, code: string): string | undefined {
  const own = (dist.analysis?.issues ?? []).find((i) => i.code === code)?.label?.trim();
  return own || undefined;
}

/* ------------------------------------------------------------------ */
/* Agregados                                                           */
/* ------------------------------------------------------------------ */

export interface DeliverySummary {
  total: number;
  ok: number;
  roto: number;
  noEntrega: number;
  omitida: number;
  /**
   * Archivos que llegaron completos y que no hemos analizado por falta de lector.
   *
   * Se cuenta aparte de `omitida` a propósito: son la medida de nuestra propia
   * cobertura, no del estado del catálogo, y mezclarlos escondía que 364 archivos
   * del informe no se habían mirado por un problema nuestro.
   */
  noAnalizado: number;
  /** Porcentaje de distribuciones rotas sobre el total (0-100, redondeado). */
  brokenPct: number;
  /** Porcentaje que no entrega archivo, aparte de las rotas. */
  notAFilePct: number;
  /** Datasets con al menos una distribución rota o que no entrega. */
  affectedDatasets: number;
  totalDatasets: number;
}

export function summarizeDelivery(report: QualityReport | null): DeliverySummary {
  const empty: DeliverySummary = {
    total: 0, ok: 0, roto: 0, noEntrega: 0, omitida: 0, noAnalizado: 0,
    brokenPct: 0, notAFilePct: 0, affectedDatasets: 0, totalDatasets: 0,
  };
  if (!report) return empty;

  let ok = 0, roto = 0, noEntrega = 0, omitida = 0, noAnalizado = 0, affected = 0;

  for (const ds of report.datasets) {
    let dsAffected = false;
    for (const dist of ds.distribution_results) {
      const state = classifyDelivery(dist);
      if (state === 'ok') ok++;
      else if (state === 'roto') { roto++; dsAffected = true; }
      else if (state === 'no-entrega') { noEntrega++; dsAffected = true; }
      else if (state === 'no-analizado') noAnalizado++;
      else omitida++;
      // Ni `omitida` ni `no-analizado` marcan el dataset como afectado: en los
      // dos casos el problema es de cobertura del análisis, no del catálogo.
    }
    if (dsAffected) affected++;
  }

  const total = ok + roto + noEntrega + omitida + noAnalizado;
  return {
    total, ok, roto, noEntrega, omitida, noAnalizado,
    brokenPct: total > 0 ? Math.round((roto / total) * 100) : 0,
    notAFilePct: total > 0 ? Math.round((noEntrega / total) * 100) : 0,
    affectedDatasets: affected,
    totalDatasets: report.datasets.length,
  };
}

export interface ContentSummary {
  /** Distribuciones entregadas con puntuación de contenido. */
  scored: number;
  /** Media de la calidad de contenido de esas, o null si no hay ninguna. */
  avgScore: number | null;
}

/**
 * Calidad de contenido de lo que SÍ se puede abrir.
 *
 * `report.totals.avg_score` promedia todas las distribuciones a las que el
 * analizador pudo poner nota: 1.470 de 1.655, e incluye 215 que no se entregan
 * (un fichero que descarga a medias o que no parsea también deja métricas
 * parciales). El portal, en cambio, afirma que esa media «no incluye los
 * archivos rotos». Aquí se calcula sobre el conjunto que el portal dice medir,
 * para que la afirmación sea verdad.
 */
export function summarizeContent(report: QualityReport | null): ContentSummary {
  if (!report) return { scored: 0, avgScore: null };
  let scored = 0;
  let sum = 0;
  for (const ds of report.datasets) {
    for (const dist of ds.distribution_results) {
      const score = readableScore(dist);
      if (score === null) continue;
      scored++;
      sum += score;
    }
  }
  return { scored, avgScore: roundedMean(sum, scored) };
}

/**
 * La nota de contenido de una distribución que SÍ se puede abrir, o null.
 *
 * Es el predicado único de la calidad de contenido, y lo comparten la media
 * global (`summarizeContent`) y la de cada conjunto de datos
 * (`datasetContentScore`). Estaba escrito solo dentro de `summarizeContent`, así
 * que la media del dataset se calculaba en otro sitio y con otro criterio: ver
 * el comentario de `datasetContentScore`.
 *
 * No hace falta descartar aquí las limitaciones del portal —el `openpyxl` que
 * falta, el analizador que se rompe— porque `classifyDelivery` ya las devuelve
 * como `no-analizado` y nunca como `ok`. Esa es justamente la ventaja de
 * derivar de `classifyDelivery` en lugar de mirar `dist.status`.
 */
function readableScore(dist: DistributionResult): number | null {
  if (classifyDelivery(dist) !== 'ok') return null;
  const score = dist.analysis?.score;
  return typeof score === 'number' ? score : null;
}

/**
 * Calidad de contenido de un conjunto de datos: media de sus archivos legibles.
 *
 * Gemelo de `datasetAvailabilityPct`, y por el mismo motivo. El valor que traía
 * el informe (`QualityDatasetSummary.score`) lo calcula `aggregate()` en
 * `report.py` promediando **solo las distribuciones con `status == 'ok'`**, y
 * `engine.py` pone `status: 'error'` ante cualquier incidencia de severidad
 * error —«tipos mezclados en una columna» es una de ellas—. El resultado es que
 * toda distribución con contenido regular quedaba fuera de su propia media: de
 * las 1.478 con nota, 533 se descartaban, y **entre ellas todas las que puntúan
 * por debajo de 80**. Los 430 conjuntos con nota salían entre 95 y 100, y el
 * eje de contenido —el 30% del índice compuesto— no distinguía nada.
 *
 * Es el mismo error que `classifyDelivery` corrigió para el eje de entrega
 * («no basta con que `engine.py` le ponga `status: 'error'`»), que había
 * sobrevivido intacto un nivel más arriba, en la agregación por conjunto.
 *
 * Devuelve null si no queda ningún archivo legible que medir. Eso NO es un
 * cero: `compositeScore` decide qué hacer con la ausencia, y lo cuenta como
 * cero solo cuando el conjunto sí se llegó a comprobar.
 */
export function datasetContentScore(
  ds: Pick<QualityDatasetSummary, 'distribution_results'> | null | undefined
): number | null {
  if (!ds) return null;
  let scored = 0;
  let sum = 0;
  for (const dist of ds.distribution_results) {
    const score = readableScore(dist);
    if (score === null) continue;
    scored++;
    sum += score;
  }
  // Redondeo a entero, como venía haciendo `report.py`: es una nota que se
  // pinta en un círculo, no una media que se vuelva a promediar.
  return scored === 0 ? null : Math.round(sum / scored);
}

/** Media a un decimal, o null si no hay nada que promediar. */
function roundedMean(sum: number, count: number): number | null {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

/**
 * La nota de contenido de una distribución, o null si esa nota no mide el archivo.
 *
 * Es el criterio único de `formatContentScores`. Lo compartía con
 * `reportContentScore`, que alimentaba la serie histórica y se retiró con ella;
 * las dos lo tenían copiado con un comentario que afirmaba que coincidían, que es
 * exactamente lo que se desincroniza.
 *
 * Descarta las distribuciones con una incidencia de `PORTAL_LIMITATION_CODES`,
 * porque `report.py` mete en las medias la nota de TODO resultado que la tenga y
 * los analizadores devolvían `score: 0` al no encontrar su lector. En el informe
 * del 13 de agosto eso deja `XLSX: avg_score 0` a partir de 341 ceros que no miden
 * la calidad de ningún Excel: miden que no teníamos openpyxl instalado.
 *
 * NO filtra por `classifyDelivery === 'ok'`, que es lo que hace `summarizeContent`.
 * La diferencia importa para los servicios OGC: no descargan ningún archivo y su
 * nota sale del análisis de las capacidades, así que se conserva aunque el eje de
 * entrega diga otra cosa. (Mientras `service` contaba como descarga fallida, esto
 * era lo único que evitaba borrar el 90 % de WMS y el 100 % de WFS de las medias.)
 * Un cero legítimo —una imagen que resultó ser HTML— también se queda, porque ese
 * sí habla del archivo.
 */
function measuredScore(dist: DistributionResult): number | null {
  for (const issue of dist.analysis?.issues ?? []) {
    if (isPortalLimitation(issue.code)) return null;
  }
  const score = dist.analysis?.score;
  return typeof score === 'number' ? score : null;
}

/**
 * Calidad media por formato, sin las notas que no miden el archivo.
 *
 * Existe porque `by_format[fmt].avg_score` del informe no se puede usar tal cual
 * (ver `measuredScore`). Publicado como «0 %», decía que los Excel del catálogo no
 * valen nada. Un formato del que no queda ninguna nota utilizable devuelve `null`,
 * que la interfaz pinta «—»: no lo sabemos, que es la verdad y no es cero.
 *
 * PARCHE DE MIGRACIÓN, no un cálculo permanente. Los analizadores ya devuelven
 * `score: None` cuando no miden nada, así que en cuanto no quede publicado ningún
 * informe anterior a ese cambio, `by_format[fmt].avg_score` vuelve a ser válido y
 * esta función se puede borrar junto con su uso en `FicherosSection`.
 */
export function formatContentScores(
  report: QualityReport | null
): Record<string, ContentSummary> {
  if (!report) return {};
  const cached = formatScoreCache.get(report);
  if (cached) return cached;

  const acc = new Map<string, { scored: number; sum: number }>();
  for (const ds of report.datasets) {
    for (const dist of ds.distribution_results) {
      let entry = acc.get(dist.format);
      if (!entry) { entry = { scored: 0, sum: 0 }; acc.set(dist.format, entry); }
      const score = measuredScore(dist);
      if (score === null) continue;
      entry.scored++;
      entry.sum += score;
    }
  }

  const out: Record<string, ContentSummary> = {};
  for (const [format, { scored, sum }] of acc) {
    out[format] = { scored, avgScore: roundedMean(sum, scored) };
  }
  formatScoreCache.set(report, out);
  return out;
}

/**
 * Memoria por informe: `/calidad` se renderiza en cada petición (lee
 * `searchParams`), así que sin esto cada visita recorría las 1.658 distribuciones
 * otra vez. El informe es el mismo objeto en todas las peticiones porque
 * `getQualityReport` lo cachea en el módulo, así que sirve de clave.
 */
const formatScoreCache = new WeakMap<QualityReport, Record<string, ContentSummary>>();

/**
 * Porcentaje de distribuciones de un dataset que se descargan y abren (0-100).
 *
 * Las que el analizador no llegó a evaluar quedan fuera del denominador: no
 * son un fallo del dataset, simplemente no se comprobaron. Devuelve null si no
 * se evaluó ninguna, para poder distinguir "no lo sabemos" de "no funciona".
 */
export function datasetAvailabilityPct(
  ds: Pick<QualityDatasetSummary, 'distribution_results'> | null | undefined
): number | null {
  if (!ds) return null;
  let evaluated = 0;
  let ok = 0;
  for (const dist of ds.distribution_results) {
    const state = classifyDelivery(dist);
    if (isUnevaluated(state)) continue;
    evaluated++;
    if (state === 'ok') ok++;
  }
  return evaluated === 0 ? null : Math.round((ok / evaluated) * 100);
}

/**
 * Estado agregado por formato dentro de un dataset: para poder colorear la
 * etiqueta de cada formato en la tarjeta del catálogo sin volcar recuentos.
 */
export type FormatState = 'ok' | 'parcial' | 'roto' | 'sin-datos';

export function formatStates(
  ds: Pick<QualityDatasetSummary, 'distribution_results'> | null | undefined
): Record<string, FormatState> {
  const out: Record<string, FormatState> = {};
  if (!ds) return out;
  const acc = new Map<string, { evaluated: number; ok: number }>();

  for (const dist of ds.distribution_results) {
    let entry = acc.get(dist.format);
    if (!entry) { entry = { evaluated: 0, ok: 0 }; acc.set(dist.format, entry); }
    const state = classifyDelivery(dist);
    if (isUnevaluated(state)) continue;
    entry.evaluated++;
    if (state === 'ok') entry.ok++;
  }

  for (const [format, { evaluated, ok }] of acc) {
    out[format] = evaluated === 0 ? 'sin-datos' : ok === evaluated ? 'ok' : ok === 0 ? 'roto' : 'parcial';
  }
  return out;
}

/**
 * Cuántas DISTRIBUCIONES sufre cada incidencia (no cuántas celdas).
 *
 * `issues_by_code` del informe suma ocurrencias, y eso hace que "celdas
 * vacías" salga con más de un millón mientras "el archivo no descarga" sale
 * con 182. Para hablar de impacto, lo comparable es a cuántos recursos afecta
 * cada problema, contando cada uno una sola vez.
 */
export function distributionsAffectedByIssue(report: QualityReport | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!report) return counts;
  for (const ds of report.datasets) {
    for (const dist of ds.distribution_results) {
      for (const code of new Set(issueCodes(dist))) {
        counts[code] = (counts[code] ?? 0) + 1;
      }
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Consecuencias para quien reutiliza                                  */
/* ------------------------------------------------------------------ */

/**
 * Un problema técnico contado por lo que impide hacer, con su cifra real.
 *
 * Varios códigos distintos rompen la reutilización por el mismo motivo —un
 * encabezado vacío y uno duplicado estropean igual la carga automática—, así
 * que se agrupan: quien lee la portada necesita el efecto, no el código.
 */
export interface ReuseConsequence {
  /** Clave del icono; cada página la resuelve con su propio import. */
  icon: 'enlace' | 'no-archivo' | 'encabezado' | 'tipo';
  /** `bad` impide abrir el archivo; `warn` obliga a limpiarlo antes de usarlo. */
  severity: 'bad' | 'warn';
  /** Distribuciones afectadas, sumadas sobre los códigos del grupo. */
  count: number;
  title: string;
  text: string;
  /**
   * Los códigos del grupo, para poder enlazar a la tabla ya filtrada.
   *
   * Se descartaban al construir el resumen, y por eso estas tarjetas eran las
   * únicas del portal que daban una cifra concreta sin ninguna forma de ver a qué
   * archivos correspondía.
   */
  codes: string[];
}

/** Códigos que comparten consecuencia, y cómo se cuenta cada grupo. */
const CONSEQUENCE_GROUPS: ReadonlyArray<Omit<ReuseConsequence, 'count'>> = [
  {
    codes: ['descarga'],
    icon: 'enlace',
    severity: 'bad',
    title: 'Un enlace roto es un dato que no existe',
    text: 'Da igual lo bien documentado que esté: si el servidor no responde, quien lo necesita se encuentra un error. Es la diferencia entre publicar y estar disponible.',
  },
  {
    codes: ['no-es-archivo', 'no-es-imagen'],
    icon: 'no-archivo',
    severity: 'warn',
    title: 'Un archivo que no es un archivo',
    text: 'La URL responde, pero devuelve una página web en lugar del CSV o el mapa. Una persona lo sortea a mano; un programa que actualiza datos cada noche, no.',
  },
  {
    codes: ['encabezado-vacio', 'encabezado-duplicado'],
    icon: 'encabezado',
    severity: 'warn',
    title: 'Encabezados vacíos o repetidos',
    text: 'Las columnas sin nombre o con el nombre duplicado rompen la carga automática en hojas de cálculo y en cualquier programa. Obligan a limpiar a mano antes de poder empezar.',
  },
  {
    codes: ['error-tipo'],
    icon: 'tipo',
    severity: 'warn',
    title: 'Tipos mezclados en una misma columna',
    text: 'Un texto colado en una columna de números o fechas no da error: da un resultado equivocado. Son los fallos más caros porque nadie los ve venir.',
  },
];

/**
 * Consecuencias presentes en este catálogo, de mayor a menor impacto.
 *
 * Se descartan las que no ocurren —una consecuencia con cero afectados es
 * ruido—. El orden es gravedad primero y volumen después, no volumen a secas:
 * lo que impide abrir el archivo va antes que lo que solo obliga a limpiarlo,
 * aunque afecte a menos archivos. Es el mismo criterio que separa las dos
 * preguntas del portal, y ordenar solo por cantidad lo contradecía.
 */
const SEVERITY_ORDER: Record<ReuseConsequence['severity'], number> = { bad: 0, warn: 1 };

export function reuseConsequences(report: QualityReport | null): ReuseConsequence[] {
  /**
   * Un archivo cuenta UNA vez por grupo, aunque traiga varios de sus códigos.
   *
   * Antes se sumaban los recuentos por código, y un archivo con el encabezado
   * vacío Y con encabezados duplicados se contaba dos veces: con 119 vacíos y 45
   * duplicados la tarjeta decía «164 archivos afectados» cuando los archivos
   * distintos eran 136, porque 28 traen las dos cosas. Mientras la tarjeta no
   * enlazaba a ninguna parte el error era invisible; en cuanto enlaza a la tabla,
   * la tabla la desmiente.
   *
   * Una sola pasada para todos los grupos: contar cada grupo por separado
   * recorría el informe entero cuatro veces.
   */
  const groupOfCode = new Map<string, number>();
  CONSEQUENCE_GROUPS.forEach((group, index) => {
    for (const code of group.codes) groupOfCode.set(code, index);
  });

  const counts = new Array<number>(CONSEQUENCE_GROUPS.length).fill(0);
  if (report) {
    for (const ds of report.datasets) {
      for (const dist of ds.distribution_results) {
        const seen = new Set<number>();
        for (const issue of dist.analysis?.issues ?? []) {
          const index = groupOfCode.get(issue.code);
          if (index !== undefined) seen.add(index);
        }
        for (const index of seen) counts[index]++;
      }
    }
  }

  return CONSEQUENCE_GROUPS.map((group, index) => ({
    ...group,
    count: counts[index],
  }))
    .filter((consequence) => consequence.count > 0)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count
    );
}

/* ------------------------------------------------------------------ */
/* Fila de fichero con problema                                        */
/* ------------------------------------------------------------------ */

/**
 * Familia del defecto de un fichero, que es también la corrección que toca.
 *
 * `entrega` el fichero no llega o no se puede interpretar.
 * `contenido` el fichero abre, pero los datos vienen con errores.
 */
export type IssueFamily = 'entrega' | 'contenido';

/**
 * Un fichero con algún defecto, listo para pintar en tabla.
 *
 * Cubre las dos familias: antes solo existían las filas de entrega, así que los
 * ~328 ficheros que se abren con errores de contenido no aparecían en ninguna
 * tabla explorable —estaban únicamente en una lista de alertas por dataset— y no
 * se podían filtrar, buscar ni exportar.
 *
 * Estas filas viajan enteras al navegador (la tabla filtra en cliente), así que
 * no llevan nada derivable: la etiqueta de la causa se saca de `causeCode` con
 * `issueLabel`, que es client-safe. Enviarla ya resuelta costaba ~40 KB de
 * cadenas repetidas. `publisher` tampoco viaja: la vista no lo usa —el catálogo
 * declara el mismo organismo en todos— y el agrupado se hace por temática.
 */
export interface FileIssueRow {
  datasetSlug: string;
  datasetTitle: string;
  category: string;
  format: string;
  url: string;
  /** Slug de la distribución para la URL (/csv, /csv-2). */
  distSlug: string;
  family: IssueFamily;
  /** Estado de entrega. En las filas de contenido es siempre `ok`. */
  state: DeliveryState;
  /** Causa de entrega, o incidencia principal de contenido. La que se rotula. */
  causeCode: string;
  /**
   * TODAS las incidencias de error del archivo, para poder filtrar por cualquiera.
   *
   * `causeCode` es solo la primera, y filtrar por ella descuadraba las cifras: las
   * tarjetas de contenido cuentan un archivo si el código aparece en cualquier
   * posición (`distributionsAffectedByIssue`), así que una tarjeta podía prometer
   * 120 archivos y la tabla enseñar los 80 en los que ese código salía primero.
   * Los otros 40 existían y no había forma de verlos.
   *
   * Solo se rellena cuando hay más de un código, para no repetir `causeCode` en las
   * ~1.000 filas que viajan al navegador.
   */
  causeCodes?: string[];
  /** Solo en contenido: incidencias de severidad error del fichero. */
  errorIssues?: number;
  /**
   * Índice de la nota del analizador dentro de `FileIssueRows.notes`, para dar
   * contexto en la fila expandida. Va por índice porque el analizador genera
   * las notas desde plantillas y solo 326 de las 711 son distintas: repetirlas
   * literalmente en cada fila costaba el doble de bytes.
   */
  noteIdx?: number;
  httpStatus?: number | null;
}

/**
 * ¿Coincide esta fila con alguno de los códigos pedidos?
 *
 * Aquí y no en la tabla porque lo usan los dos lados: la tabla para filtrar y los
 * recuentos para comprobar que dicen lo mismo. Con la lista vacía no filtra.
 */
export function rowMatchesCauses(row: FileIssueRow, causes: readonly string[]): boolean {
  if (causes.length === 0) return true;
  if (causes.includes(row.causeCode)) return true;
  return row.causeCodes?.some((code) => causes.includes(code)) ?? false;
}

/** Filas de la pestaña de ficheros más las tablas que comparten. */
export interface FileIssueRows {
  rows: FileIssueRow[];
  /** Notas del analizador sin repetir; las filas apuntan aquí por índice. */
  notes: string[];
  /** Distribuciones analizadas por formato, para calcular proporciones. */
  formatTotals: Record<string, number>;
  totalDistributions: number;
}

/** Acumulador de notas sin duplicados, para construir `FileIssueRows.notes`. */
export function createNoteTable() {
  const notes: string[] = [];
  const index = new Map<string, number>();
  return {
    notes,
    /** Devuelve el índice de la nota, o undefined si está vacía. */
    add(note: string | undefined): number | undefined {
      if (!note) return undefined;
      const existing = index.get(note);
      if (existing != null) return existing;
      const next = notes.length;
      notes.push(note);
      index.set(note, next);
      return next;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Causas sistémicas                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un mismo fallo repetido en muchos recursos no son N incidencias: es una.
 * GML falla en 32 de 32 y KML en 16 de 16 — eso no son 48 problemas de datos,
 * es un proceso de publicación roto. Agrupar por (formato × causa) convierte
 * una lista inabarcable en una lista de arreglos priorizables.
 */
export interface SystemicCause {
  key: string;
  format: string;
  causeCode: string;
  causeLabel: string;
  /** Recursos afectados por esta combinación. */
  affected: number;
  /** Total de recursos de ese formato, para dar la proporción. */
  formatTotal: number;
  /** Datasets distintos que se recuperarían al arreglarlo. */
  datasets: number;
  /** true si afecta a TODOS los recursos del formato: apunta a un fallo de proceso. */
  wholeFormat: boolean;
}

export function findSystemicCauses(rows: FileIssueRow[], formatTotals: Record<string, number>): SystemicCause[] {
  const groups = new Map<string, { format: string; causeCode: string; affected: number; datasets: Set<string> }>();

  for (const row of rows) {
    const key = `${row.format}|${row.causeCode}`;
    let g = groups.get(key);
    if (!g) {
      g = { format: row.format, causeCode: row.causeCode, affected: 0, datasets: new Set() };
      groups.set(key, g);
    }
    g.affected++;
    g.datasets.add(row.datasetSlug);
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      const formatTotal = formatTotals[g.format] ?? g.affected;
      return {
        key,
        format: g.format,
        causeCode: g.causeCode,
        causeLabel: issueLabel(g.causeCode),
        affected: g.affected,
        formatTotal,
        datasets: g.datasets.size,
        wholeFormat: formatTotal > 1 && g.affected === formatTotal,
      };
    })
    // Primero lo que delata un proceso roto, luego por volumen recuperable.
    .sort((a, b) => Number(b.wholeFormat) - Number(a.wholeFormat) || b.affected - a.affected);
}

/**
 * Agrupa los ficheros con problema por un campo de texto.
 *
 * Solo por categoría o formato: en este catálogo todos los datasets declaran el
 * mismo organismo (`…/Organismo/A07002862`, la Junta como entidad única), así
 * que agrupar por ahí devuelve un solo grupo y no ayuda a repartir el trabajo.
 * La categoría temática sí discrimina.
 */
export interface FieldFailures {
  value: string;
  affected: number;
  datasets: number;
}

export function groupByField(
  rows: FileIssueRow[],
  field: 'category' | 'format',
  fallback = 'Sin clasificar'
): FieldFailures[] {
  const map = new Map<string, { affected: number; datasets: Set<string> }>();
  for (const row of rows) {
    const key = row[field] || fallback;
    let g = map.get(key);
    if (!g) { g = { affected: 0, datasets: new Set() }; map.set(key, g); }
    g.affected++;
    g.datasets.add(row.datasetSlug);
  }
  return [...map.entries()]
    .map(([value, g]) => ({ value, affected: g.affected, datasets: g.datasets.size }))
    .sort((a, b) => b.affected - a.affected);
}

/**
 * Agrupa los ficheros por causa, para poder ofrecer la causa como filtro.
 *
 * No sirve `groupByField`: la causa no es un campo de texto único. Un archivo
 * puede fallar por varios motivos a la vez —un encabezado vacío y otro
 * duplicado—, y `causeCode` guarda solo el primero. Contar por ahí daría cifras
 * más bajas que las que ya publican las tarjetas de la portada, que cuentan un
 * archivo si el código aparece en cualquier posición.
 *
 * Por eso se recorre el mismo conjunto de códigos que mira `rowMatchesCauses`:
 * lo que se cuenta aquí y lo que filtra la tabla tienen que ser lo mismo, o la
 * cifra del botón no cuadrará con las filas que enseña al pulsarlo.
 *
 * Consecuencia esperada: un archivo con tres causas suma en las tres, así que el
 * total de los grupos supera al de filas. Es un recuento por causa, no un
 * reparto de las filas, y quien lo pinte debe rotularlo como tal.
 */
export interface CauseFailures {
  code: string;
  affected: number;
  datasets: number;
}

export function groupByCause(rows: FileIssueRow[]): CauseFailures[] {
  const map = new Map<string, { affected: number; datasets: Set<string> }>();
  for (const row of rows) {
    // `causeCodes` solo se rellena cuando hay más de uno, y entonces ya incluye
    // a `causeCode`; si no está, la única causa es `causeCode`.
    for (const code of row.causeCodes ?? [row.causeCode]) {
      let g = map.get(code);
      if (!g) { g = { affected: 0, datasets: new Set() }; map.set(code, g); }
      g.affected++;
      g.datasets.add(row.datasetSlug);
    }
  }
  return [...map.entries()]
    .map(([code, g]) => ({ code, affected: g.affected, datasets: g.datasets.size }))
    .sort((a, b) => b.affected - a.affected);
}
