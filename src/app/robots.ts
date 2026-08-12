import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/**
 * El contenido es público y conviene que se indexe. Las rutas de API quedan
 * fuera: `/api/proxy` reenvía ficheros de terceros y no tiene sentido que un
 * buscador los rastree a través de este dominio.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
