/**
 * Cuántas entidades pedirle a un WFS de cada vez.
 *
 * El visor pedía páginas fijas de 500 entidades. Con puntos y líneas eso son
 * unos pocos megas —2.887 puntos de incendios son 1,6 MB enteros—, pero las
 * capas de polígonos del IDECyL pesan del orden de 300 KB por entidad: 500 son
 * ~150 MB, muy por encima del tope por petición del proxy (`PROXY_MAX_BYTES`,
 * 48 MB). El proxy cortaba el cuerpo a mitad de la transmisión y el navegador
 * se encontraba un JSON partido:
 *
 *     Expected ',' or ']' after array element in JSON at position 50323422
 *
 * Ese error, tal cual, era lo único que veía el usuario —«no llegó ni completa
 * ni en muestra»— y la capa se quedaba sin dibujar entera, aunque el servicio
 * estuviera perfectamente y entregase sin problema páginas más cortas.
 *
 * La talla de página no puede fijarse de antemano porque depende del peso de
 * cada entidad, que solo se sabe al recibir la primera. Así que se mide: se
 * empieza con una página corta de sondeo y a partir de ahí cada página se
 * dimensiona con los bytes por entidad que se acaban de observar.
 *
 * Client-safe: solo constantes y funciones puras.
 */

import { PROXY_MAX_BYTES } from './download-budget';

/**
 * Página de sondeo. Corta a propósito: es la única que se pide a ciegas, y con
 * las entidades más pesadas medidas en el catálogo (~300 KB) son 7,6 MB, que
 * caben de sobra en una petición.
 */
export const WFS_PROBE_SIZE = 25;

/**
 * Peso al que se apunta en cada página: un cuarto del tope del proxy.
 *
 * El margen es tan holgado porque la estimación no es fina. Medido contra el
 * GeoServer real («Áreas peligro inc.forestales»): el sondeo da 298 KB por
 * entidad, la página siguiente sale a 678 KB y la de después a 366 KB. Con un
 * cuarto del tope, un error de esa magnitud sigue cabiendo; y si aun así no
 * cabe, `shrinkPageSize` lo recoge.
 */
export const WFS_TARGET_PAGE_BYTES = Math.floor(PROXY_MAX_BYTES / 4);

/** Suelo y techo de la talla de página. */
export const WFS_MIN_PAGE_SIZE = 5;
export const WFS_MAX_PAGE_SIZE = 1000;

/**
 * Tope de páginas: acota el bucle por si un servicio ignora la paginación de
 * una forma que la huella no detecte.
 */
export const WFS_MAX_PAGES = 200;

/**
 * Cuánto se llega a descargar de una capa, en total.
 *
 * No es un límite del servicio sino del navegador y de la paciencia: las 4.513
 * entidades de «Plan 2025 CyL. Áreas peligro inc.forestales» pesan ~300 KB cada
 * una, o sea 1,3 GB. Ninguna cantidad de páginas va a dibujar eso. Al alcanzar
 * el tope se para y se dice cuántas entidades se han traído de cuántas, que es
 * información honesta; seguir pidiendo solo sirve para colgar la pestaña.
 *
 * 64 MB son unos cinco minutos en el peor caso conocido y una fracción de
 * segundo en las capas normales, que no llegan a acercarse.
 */
export const WFS_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** Veces que se reintenta una página más corta antes de darla por perdida. */
export const WFS_MAX_SHRINKS = 3;

/**
 * ¿Queda presupuesto para otra página?
 *
 * No basta con mirar si ya se ha pasado: la talla de página tiene un suelo
 * (`WFS_MIN_PAGE_SIZE`), así que con entidades de más de un mega la página más
 * corta posible ya se sale del presupuesto. Preguntándolo antes de pedir, el
 * tope se respeta de verdad en vez de rebasarse por una página entera —82 MB
 * descargados con el tope en 64, medido contra el servicio real—.
 */
export function budgetExhausted(totalBytes: number, perFeatureBytes: number): boolean {
  const remaining = WFS_MAX_TOTAL_BYTES - totalBytes;
  if (remaining <= 0) return true;
  return perFeatureBytes > 0 && remaining < perFeatureBytes * WFS_MIN_PAGE_SIZE;
}

/**
 * Peso por entidad con el que dimensionar, a partir de lo observado hasta ahora.
 *
 * Se queda con el MÁXIMO y no con la última página a propósito: en las capas
 * pesadas el peso por entidad va y viene (298 → 678 → 366 KB en tres páginas
 * seguidas de la misma capa), así que fiarse de la última medición sistemática-
 * mente subestima la siguiente. Con el máximo, la estimación falla del lado de
 * pedir de menos, que solo cuesta una petición más.
 *
 * Con una página vacía no hay nada que medir —es el final de la capa, no una
 * medición— y se conserva lo que hubiera.
 */
export function heaviestPerFeature(previous: number, bytes: number, features: number): number {
  if (bytes <= 0 || features <= 0) return previous;
  return Math.max(previous, bytes / features);
}

/**
 * Talla de la siguiente página, dado el peso por entidad observado.
 *
 * Sin medición (`perFeatureBytes` a cero) se conserva la talla actual.
 *
 * `remaining` es lo que queda de `WFS_MAX_TOTAL_BYTES`: cerca del final se pide
 * lo que quepa en el presupuesto y no la página completa. La otra mitad de esa
 * cuenta la lleva `budgetExhausted`.
 */
export function nextPageSize(
  current: number,
  perFeatureBytes: number,
  remaining = Number.POSITIVE_INFINITY
): number {
  if (!(perFeatureBytes > 0)) return current;
  const target = Math.min(WFS_TARGET_PAGE_BYTES, Math.max(0, remaining));
  const fits = Math.floor(target / perFeatureBytes);
  return Math.min(WFS_MAX_PAGE_SIZE, Math.max(WFS_MIN_PAGE_SIZE, fits));
}

/**
 * Talla tras una página que no cupo. Se divide por cuatro y no por dos porque
 * el fallo solo ocurre cuando la estimación se ha quedado muy corta, y cada
 * reintento cuesta una descarga entera que se tira.
 */
export function shrinkPageSize(current: number): number {
  return Math.max(WFS_MIN_PAGE_SIZE, Math.floor(current / 4));
}

/**
 * ¿Este texto es un JSON cortado por el tope del proxy, y no un JSON inválido?
 *
 * El proxy corta el cuerpo cuando pasa de `PROXY_MAX_BYTES`, así que un cuerpo
 * que llega justo en ese tamaño y no parsea es una página demasiado grande —hay
 * que reintentarla más corta— y no un servicio que devuelve basura, que es otro
 * problema y se cuenta de otra manera.
 */
export function looksTruncatedByCap(length: number): boolean {
  return length >= PROXY_MAX_BYTES * 0.98;
}

/**
 * Huella de una página, para detectar que el servicio ignora `startIndex` y
 * devuelve siempre la primera.
 *
 * Antes se usaba «número de entidades + atributos de la primera», pero con
 * páginas de talla variable el número deja de ser comparable: dos páginas
 * idénticas pedidas con talla distinta no coincidían y el bucle acumulaba la
 * misma página una y otra vez. Se mira la primera entidad y ya: su tipo de
 * geometría, su primera coordenada y sus atributos.
 */
export function pageFingerprint(feature: { geometry: unknown; properties: unknown } | undefined): string {
  if (!feature) return '';
  const geometry = feature.geometry as { type?: string; coordinates?: unknown } | null;
  return [
    geometry?.type ?? 'sin-geometria',
    firstCoordinate(geometry?.coordinates).join(','),
    JSON.stringify(feature.properties ?? {}).slice(0, 200),
  ].join('|');
}

/** Primer par de coordenadas de una geometría, sea del anidamiento que sea. */
function firstCoordinate(coordinates: unknown): number[] {
  let node = coordinates;
  while (Array.isArray(node) && Array.isArray(node[0])) node = node[0];
  return Array.isArray(node) ? (node.slice(0, 2) as number[]).filter((n) => typeof n === 'number') : [];
}
