import type { NextConfig } from "next";
import { ALLOWED_DOMAINS } from "./src/lib/proxy-allow";

/**
 * Política de contenido.
 *
 * Los datos tabulares y las capacidades OGC pasan por `/api/proxy` y `/api/ogc`,
 * así que `connect-src 'self'` basta para eso. Las IMÁGENES, en cambio, sí van
 * directas: las teselas del mapa base vienen de OpenStreetMap, y las
 * capas WMS y sus leyendas se piden a los servidores de la Junta con la URL que
 * declara el propio servicio. Los dominios de la Junta se reutilizan de la
 * allowlist del proxy para no mantener dos listas que se desincronizan.
 *
 * `'unsafe-inline'` en estilos es necesario porque hay anchuras y trazos
 * calculados que se inyectan con `style=`; en scripts, por el script anti-FOUC
 * del tema, y `'unsafe-eval'` solo en desarrollo, que es donde lo usa el runtime
 * de Turbopack.
 */
const isDev = process.env.NODE_ENV === "development";

/**
 * Mapas base del visor: ver `src/lib/map-theme.ts`.
 *
 * Un solo origen para los dos temas. Estaba también `basemaps.cartocdn.com`, que
 * servía el mapa oscuro hasta que CARTO pasó a exigir clave; el oscuro se hace
 * ahora invirtiendo OSM por CSS, así que ese host sobra. Un tercero menos con
 * permiso para cargar imágenes en el portal.
 */
const TILE_HOSTS = ["https://*.tile.openstreetmap.org"];

/** Servidores cartográficos de la Junta (WMS y GetLegendGraphic). */
const OGC_IMAGE_HOSTS = ALLOWED_DOMAINS.flatMap((domain) => [`https://${domain}`, `https://*.${domain}`]);

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${[...TILE_HOSTS, ...OGC_IMAGE_HOSTS].join(" ")}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: CSP },
];

/**
 * Secciones que se absorbieron dentro de Catálogo y Calidad.
 *
 * Van aquí y no como páginas con `redirect()`: así se resuelven antes del
 * sistema de ficheros, con un 308 cacheable, sin arrancar el render de un
 * componente de servidor solo para descartarlo. Se mantienen porque puede
 * haber enlaces entrantes a las URL antiguas.
 */
const LEGACY_ROUTES = [
  { source: "/gis", destination: "/catalogo?geo=1" },
  // `/tendencias` apuntaba a la serie histórica, retirada del portal: ahora lleva
  // al diagnóstico de la última foto, que es lo que queda.
  { source: "/tendencias", destination: "/calidad?vista=prioridades" },
  { source: "/transparencia", destination: "/calidad?vista=prioridades" },
  { source: "/alertas", destination: "/calidad?vista=ficheros&familia=contenido" },
];

/**
 * Ficheros del informe que hay que meter a mano en el bundle de las funciones.
 *
 * `quality-report.ts` los abre con `fs.readFileSync(path.join(process.cwd(), …))`.
 * Esa ruta se construye en tiempo de ejecución, así que el rastreador de Next no
 * puede verla: sin esta lista el informe NO viaja al despliegue y el portal
 * arranca sin datos —`/api/quality` responde 503 y todas las páginas se
 * renderizan vacías—. En local no se nota, porque ahí el fichero está en disco.
 *
 * El índice y los agregados del historial son pequeños y los necesita casi cada
 * página. Los fragmentos por distribución (`reports/current/d/`) pesan y solo los
 * lee la ficha de la distribución y la API de incidencias, así que se limitan a
 * esas rutas para no inflar el resto de funciones.
 */
const REPORT_INDEX_FILES = ["reports/current/index.json"];
/** Fragmentos por distribución: solo donde se abren de verdad. */
const REPORT_DETAIL_FILES = [...REPORT_INDEX_FILES, "reports/current/d/**"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": REPORT_INDEX_FILES,
    "/catalogo/**": REPORT_INDEX_FILES,
    "/calidad": REPORT_INDEX_FILES,
    "/catalogo/[datasetId]/[distIdx]": REPORT_DETAIL_FILES,
    "/api/**": REPORT_DETAIL_FILES,
  },
  async redirects() {
    return LEGACY_ROUTES.map((route) => ({ ...route, permanent: true }));
  },
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      {
        // El sello está pensado para incrustarse en otras webs, así que necesita
        // su propia política: sin `frame-ancestors 'self'` y con CORS abierto.
        source: "/api/sello",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
