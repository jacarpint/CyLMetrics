import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/**
 * El contenido es público y conviene que se indexe.
 *
 * La regla era `/api/` entera, y con la documentación de la API viviendo ahora
 * en `/api` eso tapaba justo la página que más interesa que se encuentre. El
 * motivo real de la exclusión, según decía este mismo comentario, era el proxy:
 * `/api/proxy` reenvía ficheros de terceros y no tiene sentido que un buscador
 * los rastree a través de este dominio. `/api/ogc` sale por lo mismo.
 *
 * Los endpoints de datos —`/api/quality`, `/api/catalog`…— pasan a ser
 * indexables, que es lo coherente en un portal cuyo argumento es que sus
 * propios datos están publicados.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/proxy", "/api/ogc"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
