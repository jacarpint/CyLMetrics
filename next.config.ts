import type { NextConfig } from "next";
import { ALLOWED_DOMAINS } from "./src/lib/proxy-allow";

/**
 * Política de contenido.
 *
 * Los datos tabulares y las capacidades OGC pasan por `/api/proxy` y `/api/ogc`,
 * así que `connect-src 'self'` basta para eso. Las IMÁGENES, en cambio, sí van
 * directas: las teselas del mapa base vienen de OpenStreetMap y CARTO, y las
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

/** Mapas base del visor: ver `src/lib/map-theme.ts`. */
const TILE_HOSTS = ["https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com"];

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

const nextConfig: NextConfig = {
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
