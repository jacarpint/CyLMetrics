import { isAllowedHost, isAllowedResponse } from "@/lib/proxy-allow";
import { PROXY_MAX_BYTES, PROXY_TIMEOUT_MS } from "@/lib/download-budget";

export const revalidate = 3600;

// El techo y el plazo viven en , junto a los topes del
// visor que dependen de ellos.

/**
 * Proxy de solo lectura para recursos de *.jcyl.es. Evita el bloqueo CORS del
 * navegador al previsualizar JSON o consumir servicios OGC (WFS GeoJSON, KML…).
 * GET /api/proxy?url=<url absoluta en jcyl.es>[&raw=1]
 *
 * Con `raw=1` se devuelve la respuesta del origen tal cual, con su código de
 * estado y su cuerpo. Lo necesita el visor geográfico: buena parte de los
 * recursos rotos contestan un error legible (un `ExceptionReport` de GeoServer
 * diciendo qué capa falta, un listado de directorio…) y convertirlo en un 502
 * genérico tira justo la información que hay que enseñar.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const raw = params.get("raw") === "1";
  if (!url || !isAllowedHost(url)) {
    return new Response(JSON.stringify({ error: "URL no permitida" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "JCyL-DataQuality-Portal/1.0", accept: "*/*" },
      redirect: "follow",
    });
    // La allowlist también tiene que valer para el destino de los redirects.
    if (!isAllowedResponse(upstream, url)) {
      return new Response(JSON.stringify({ error: "El recurso redirige fuera de los dominios permitidos" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (!upstream.ok && !raw) {
      return new Response(JSON.stringify({ error: `Origen respondió ${upstream.status}` }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    const len = Number(upstream.headers.get("content-length") ?? "0");
    if (len > PROXY_MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Recurso demasiado grande" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > PROXY_MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Recurso demasiado grande" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    return new Response(buf, {
      // En modo `raw` la respuesta sigue siendo 200 para que el cuerpo llegue
      // al cliente; el estado real del origen viaja en una cabecera propia.
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
        "x-origin-status": String(upstream.status),
        "x-origin-url": upstream.url,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "No se pudo acceder al recurso" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}
