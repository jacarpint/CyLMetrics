import { isAllowedHost, isAllowedResponse } from "@/lib/proxy-allow";
import { PROXY_MAX_BYTES, PROXY_TIMEOUT_MS } from "@/lib/download-budget";

export const revalidate = 3600;
export const runtime = "nodejs";
/**
 * Sin esto, la plataforma corta la función a los 10 s y `PROXY_TIMEOUT_MS` —que
 * es mayor— no puede dispararse nunca: el usuario recibe un 504 sin cuerpo en
 * lugar del error explicado de más abajo. 60 s es el máximo del plan Hobby.
 *
 * Va escrito como número literal y no importado de `download-budget` porque
 * Next extrae estas constantes de segmento leyendo el fichero, sin ejecutarlo:
 * una importación se queda sin valor y el build falla con «Invalid segment
 * configuration export». `download-budget.test.ts` comprueba que este número y
 * `PLATFORM_MAX_DURATION_S` no se separen.
 */
export const maxDuration = 60;

/**
 * Proxy de solo lectura para recursos de *.jcyl.es. Evita el bloqueo CORS del
 * navegador al previsualizar JSON o consumir servicios OGC (WFS GeoJSON, KML…).
 *
 *   GET  /api/proxy?url=<url absoluta en jcyl.es>[&raw=1]
 *   HEAD /api/proxy?url=…    -> tamaño real y si el origen admite tramos
 *
 * Con `raw=1` se devuelve la respuesta del origen tal cual, con su código de
 * estado y su cuerpo. Lo necesita el visor geográfico: buena parte de los
 * recursos rotos contestan un error legible (un `ExceptionReport` de GeoServer
 * diciendo qué capa falta, un listado de directorio…) y convertirlo en un 502
 * genérico tira justo la información que hay que enseñar.
 *
 * ## Por qué transmite en lugar de acumular
 *
 * Antes hacía `await upstream.arrayBuffer()`: hasta 32 MB en el montón de la
 * función antes de empezar a responder, y con `Transfer-Encoding: chunked` el
 * pre-chequeo de `content-length` se saltaba entero (el `?? "0"` daba 0), así
 * que un recurso de 500 MB se descargaba completo **para luego rechazarlo**.
 * Ahora el cuerpo pasa por un `TransformStream` que cuenta bytes y corta en
 * cuanto se pasa: memoria constante y el navegador recibe los primeros bytes de
 * inmediato.
 *
 * ## Por qué reenvía `Range`
 *
 * Es lo que permite ver un archivo más grande que el tope: el visor pide tramos
 * sucesivos en lugar de rendirse. Sin esto, «pesa más de 32 MB» era sinónimo de
 * «no se puede previsualizar».
 */

/** Cabeceras del origen que tienen sentido reenviar al navegador. */
const FORWARDED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

function jsonError(status: number, error: string, reason: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json",
      // Para que el cliente pueda distinguir «tardó demasiado» de «no existe»
      // sin adivinarlo por el texto.
      "x-error-reason": reason,
    },
  });
}

/**
 * Petición al origen con el plazo del proxy. Devuelve la respuesta o el motivo
 * del fallo, distinguiendo el vencimiento de todo lo demás: hasta ahora un
 * `catch {}` los igualaba y la interfaz tenía que adivinar cuál había sido.
 */
async function fetchUpstream(
  url: string,
  request: Request,
  method: "GET" | "HEAD"
): Promise<{ response: Response } | { error: Response }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "user-agent": "JCyL-DataQuality-Portal/1.0",
    accept: "*/*",
  };
  // El tramo que pide el navegador se traslada tal cual al origen.
  const range = request.headers.get("range");
  if (range) headers.range = range;

  try {
    const response = await fetch(url, { method, signal: controller.signal, headers, redirect: "follow" });
    // La allowlist también tiene que valer para el destino de los redirects.
    if (!isAllowedResponse(response, url)) {
      return { error: jsonError(400, "El recurso redirige fuera de los dominios permitidos", "redirect-fuera-de-dominio") };
    }
    return { response };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        error: jsonError(
          504,
          `El origen no respondió en ${Math.round(PROXY_TIMEOUT_MS / 1000)} segundos`,
          "timeout"
        ),
      };
    }
    return { error: jsonError(502, "No se pudo acceder al recurso", "inalcanzable") };
  } finally {
    clearTimeout(timer);
  }
}

/** Cabeceras de respuesta comunes a GET y HEAD. */
function responseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
  headers.set("cache-control", "public, max-age=3600");
  headers.set("x-origin-status", String(upstream.status));
  headers.set("x-origin-url", upstream.url);
  // Se anuncia el tope por petición para que el cliente sepa de qué tamaño
  // pedir los tramos sin tenerlo escrito por duplicado.
  headers.set("x-max-bytes", String(PROXY_MAX_BYTES));
  return headers;
}

/**
 * Envuelve el cuerpo del origen contando bytes y cortando si se pasa del tope.
 *
 * Cortar a mitad de la transmisión deja al cliente con una respuesta
 * incompleta, y eso es correcto: el estado (200) ya se envió. Por eso se aborta
 * el flujo con un error, que en el navegador llega como fallo de red y no como
 * un archivo truncado que parezca bueno.
 */
function limitedBody(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          controller.error(new Error(`El recurso supera ${limit} bytes por petición`));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
}

function guard(request: Request): { url: string } | { error: Response } {
  const url = new URL(request.url).searchParams.get("url");
  if (!url || !isAllowedHost(url)) {
    return { error: jsonError(400, "URL no permitida", "dominio-no-permitido") };
  }
  return { url };
}

/**
 * Tamaño real y soporte de tramos, sin descargar nada.
 *
 * El visor lo necesita porque hasta ahora decidía con `dcat:byteSize` del
 * catálogo, que muchas distribuciones no declaran: con el tamaño a `null` las
 * dos puertas de aviso (8 MB en tablas, 24 MB en mapas) se saltaban enteras y
 * el archivo se descargaba sin preguntar, fuese lo que fuese.
 */
export async function HEAD(request: Request): Promise<Response> {
  const checked = guard(request);
  if ("error" in checked) return checked.error;

  const result = await fetchUpstream(checked.url, request, "HEAD");
  if ("error" in result) return result.error;

  const upstream = result.response;
  const headers = responseHeaders(upstream);
  return new Response(null, { status: upstream.ok ? 200 : 502, headers });
}

export async function GET(request: Request): Promise<Response> {
  const checked = guard(request);
  if ("error" in checked) return checked.error;
  const raw = new URL(request.url).searchParams.get("raw") === "1";

  const result = await fetchUpstream(checked.url, request, "GET");
  if ("error" in result) return result.error;
  const upstream = result.response;

  if (!upstream.ok && !raw) {
    // 206 es correcto: es la respuesta a un `Range`, no un fallo.
    if (upstream.status !== 206) {
      return jsonError(502, `Origen respondió ${upstream.status}`, `origen-${upstream.status}`);
    }
  }

  const declared = Number(upstream.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > PROXY_MAX_BYTES) {
    return jsonError(
      413,
      "El recurso supera el tamaño máximo por petición; pídelo por tramos",
      "demasiado-grande"
    );
  }

  const headers = responseHeaders(upstream);
  const body = upstream.body ? limitedBody(upstream.body, PROXY_MAX_BYTES) : null;

  return new Response(body, {
    // En modo `raw` la respuesta sigue siendo 200 para que el cuerpo llegue al
    // cliente; el estado real del origen viaja en `x-origin-status`. Fuera de
    // `raw`, un 206 del origen se conserva: es lo que hace que el navegador
    // sepa que le han dado un tramo y no el archivo entero.
    status: raw ? 200 : upstream.status === 206 ? 206 : 200,
    headers,
  });
}
