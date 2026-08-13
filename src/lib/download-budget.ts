/**
 * Cuánto descarga este portal y cuánto espera, en un solo sitio.
 *
 * Los números estaban repartidos en cuatro ficheros sin referencia entre ellos
 * —12 s en la ruta OGC, 25 s en el proxy, 30 s en el explorador de archivos, 8 MB
 * de tope aquí, 24 MB allí— y no se sostenían entre sí:
 *
 *  - El explorador se daba 30 s, pero solo descarga a través del proxy, que
 *    aborta a los 25 s. Los 30 no podían llegar nunca: el servidor contestaba
 *    antes con su propio error. El plazo del cliente aparentaba gobernar la
 *    espera cuando la gobernaba otro.
 *  - Los dos topes de autocarga ignoraban el techo duro del proxy (32 MB), así
 *    que ofrecían «de todos modos» sobre archivos que el proxy iba a rechazar.
 *
 * El plazo del cliente se deriva del del servidor a propósito: no es un
 * presupuesto para el origen —ese lo pone el proxy— sino un seguro por si la
 * ruta propia se queda colgada. Derivarlo impide que vuelva a caer por debajo
 * del servidor, donde no serviría de nada.
 *
 * Client-safe: solo constantes y funciones puras.
 *
 * Queda fuera el plazo de `rdf-catalog.ts`: ese descarga el catálogo al
 * construir el sitio, no pasa por el proxy y tiene su propio respaldo (la copia
 * local). Meterlo aquí juntaría dos cosas que no se limitan entre sí.
 */

/**
 * Techo duro: por encima de esto el proxy responde 413 y no hay descarga.
 *
 * Está por encima del tope del analizador (25 MB) para que el visor pueda
 * enseñar el fichero completo y no una parte.
 */
export const PROXY_MAX_BYTES = 32 * 1024 * 1024;

/** Lo que el proxy espera al origen antes de rendirse. */
export const PROXY_TIMEOUT_MS = 25_000;

/**
 * Lo que la ruta OGC espera a un servicio de mapas. Más corto que el del proxy
 * porque son peticiones de metadatos (capacidades, recuentos) que responden en
 * milisegundos cuando el servicio está vivo: esperar más solo alarga la espera
 * de quien ya no va a recibir nada.
 */
export const OGC_TIMEOUT_MS = 12_000;

/** Margen sobre el plazo del servidor, para que su error llegue a explicarse. */
const CLIENT_GRACE_MS = 5_000;

/**
 * Lo que el navegador espera a nuestra propia ruta. Siempre por encima del plazo
 * del proxy: si se agota este, el problema es del portal, no del origen.
 */
export const CLIENT_TIMEOUT_MS = PROXY_TIMEOUT_MS + CLIENT_GRACE_MS;

/**
 * Desde qué tamaño se pregunta antes de descargar.
 *
 * No son límites técnicos sino de cortesía: descargar 20 MB sin avisar en una
 * conexión móvil es una factura que el portal no debería girarle a nadie. El
 * mapa admite más que la tabla porque un shapefile o un GeoJSON provinciales
 * pesan eso de forma normal, y cortarlos a 8 MB dejaría sin previsualización a
 * la mayoría de los recursos geográficos.
 */
export const TABLE_AUTOLOAD_CAP = 8 * 1024 * 1024;
export const MAP_AUTOLOAD_CAP = 24 * 1024 * 1024;

/**
 * Si el archivo no cabe en el proxy, ofrecer «de todos modos» es prometer algo
 * que va a fallar. Quien llama debe enseñar el enlace de descarga y nada más.
 */
export function exceedsProxyLimit(bytes: number | null | undefined): boolean {
  return bytes != null && bytes > PROXY_MAX_BYTES;
}
