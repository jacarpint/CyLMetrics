import { isAllowedHost } from "@/lib/proxy-allow";

export const revalidate = 3600;

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const TIMEOUT_MS = 12000;

/**
 * Proxy de solo lectura para recursos de *.jcyl.es. Evita el bloqueo CORS del
 * navegador al previsualizar JSON o consumir servicios OGC (WFS GeoJSON, KML…).
 * GET /api/proxy?url=<url absoluta en jcyl.es>
 */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url || !isAllowedHost(url)) {
    return new Response(JSON.stringify({ error: "URL no permitida" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "JCyL-DataQuality-Portal/1.0", accept: "*/*" },
      redirect: "follow",
    });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Origen respondió ${upstream.status}` }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    const len = Number(upstream.headers.get("content-length") ?? "0");
    if (len > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Recurso demasiado grande" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Recurso demasiado grande" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
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
