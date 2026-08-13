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
 * Lo que la plataforma concede a una función, en segundos.
 *
 * Es el techo real y hasta ahora estaba fuera del modelo: el proxy se concedía
 * 25 s (`PROXY_TIMEOUT_MS`) sin que ninguna ruta declarase `maxDuration`, y el
 * valor por defecto de Vercel es 10 s. Ese plazo de 25 s **no podía dispararse
 * nunca**: la plataforma mataba la función antes y devolvía un 504 opaco, así
 * que el mensaje cuidado del catch nunca llegaba a nadie.
 *
 * 60 s es el máximo del plan Hobby. Va aquí y las rutas lo exportan como
 * `maxDuration`, para que este fichero siga siendo el único sitio donde se
 * cambia un plazo.
 */
export const PLATFORM_MAX_DURATION_S = 60;

/**
 * Techo duro POR PETICIÓN: por encima de esto el proxy responde 413.
 *
 * Ya no es el tamaño máximo de un archivo visualizable. Con `Range`, el visor
 * baja un archivo grande en tramos sucesivos, y este número solo acota cuánto
 * puede pedir de una vez. El tope de archivo lo pone la memoria del navegador,
 * y quien decide es quien mira, avisado del tamaño.
 */
export const PROXY_MAX_BYTES = 48 * 1024 * 1024;

/**
 * Tamaño de cada tramo en la descarga escalonada. Ha de caber holgadamente en
 * `PROXY_MAX_BYTES` y bajarse dentro del plazo de la función incluso en una
 * conexión mediocre; 8 MB cumple las dos cosas con margen.
 */
export const RANGE_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Lo que el proxy espera al origen antes de rendirse.
 *
 * Se deriva del techo de la plataforma menos un margen, para que salte SIEMPRE
 * antes que ella: así el error que ve el usuario es el nuestro, que sabe decir
 * si el origen no respondió o si tardó demasiado, y no un 504 sin cuerpo.
 */
const PLATFORM_GRACE_MS = 8_000;
export const PROXY_TIMEOUT_MS = PLATFORM_MAX_DURATION_S * 1000 - PLATFORM_GRACE_MS;

/**
 * Lo que la ruta OGC espera a un servicio de mapas. Más corto que el del proxy
 * porque son peticiones de metadatos (capacidades, recuentos) que responden en
 * milisegundos cuando el servicio está vivo: esperar más solo alarga la espera
 * de quien ya no va a recibir nada.
 */
export const OGC_TIMEOUT_MS = 12_000;

/**
 * Tope del documento de capacidades. La ruta OGC no tenía ninguno: leía el XML
 * entero con `res.text()` y se lo pasaba a `fast-xml-parser`, que construye un
 * árbol de varias veces ese tamaño. Un servicio con miles de capas bastaba para
 * agotar la memoria de la función. 8 MB sobran para unas capacidades reales.
 */
export const OGC_MAX_BYTES = 8 * 1024 * 1024;

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
 * ¿Hay que bajarlo en tramos en lugar de en una sola petición?
 *
 * Antes esta pregunta era `exceedsProxyLimit`, y su respuesta era «no se puede
 * ver»: por encima de 32 MB el visor enseñaba el enlace al origen y se rendía.
 * Con `Range` la respuesta es «se baja por partes», así que la función cambió
 * de nombre porque cambió de significado.
 */
export function needsRangeDownload(bytes: number | null | undefined): boolean {
  return bytes != null && bytes > PROXY_MAX_BYTES;
}

/**
 * Cuántos tramos hacen falta para un archivo de este tamaño. Sirve para avisar
 * antes de empezar: «son 340 MB, 43 tramos» es una decisión informada.
 */
export function rangeChunkCount(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / RANGE_CHUNK_BYTES));
}
