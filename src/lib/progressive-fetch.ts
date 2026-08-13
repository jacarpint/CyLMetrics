/**
 * Descarga de archivos grandes sin cortes ni esperas ciegas.
 *
 * El visor hacía `fetch(...)` y `await res.arrayBuffer()`: una sola petición,
 * sin progreso, sin poder pararla, y con un techo duro por encima del cual
 * simplemente se rendía («pesa más de 32 MB, aquí no se puede enseñar»). Tres
 * problemas distintos con una sola causa: pedir el archivo entero de una vez.
 *
 * Aquí se pide en tres pasos:
 *
 *   1. `probeResource` — un `HEAD` al proxy para saber el tamaño REAL y si el
 *      origen admite tramos. Antes el tamaño salía de `dcat:byteSize`, que
 *      muchas distribuciones no declaran: con el tamaño a `null` los avisos de
 *      «pesa mucho» se saltaban enteros y se descargaba sin preguntar.
 *   2. Si el archivo cabe en una petición, se lee del flujo con progreso.
 *   3. Si no cabe, se piden tramos sucesivos con `Range`. Esto es lo que
 *      convierte «no se puede ver» en «tarda un poco».
 *
 * En los dos casos se emite progreso y se puede abortar, que es lo que permite
 * enseñar una barra de verdad y un botón de parar.
 */

import { CLIENT_TIMEOUT_MS, RANGE_CHUNK_BYTES, PROXY_MAX_BYTES } from './download-budget';

export interface ResourceProbe {
  /**
   * Tamaño en bytes **cuando es de fiar**, o null.
   *
   * Ver `probeResource`: el portal de origen contesta al `HEAD` con un
   * `content-length` que no es el del archivo, así que no basta con leerlo.
   */
  size: number | null;
  /** El origen admite peticiones por tramos. */
  acceptsRanges: boolean;
  contentType: string | null;
  /** Estado del origen. 0 si no se pudo preguntar. */
  status: number;
}

export interface Progress {
  /** Bytes recibidos hasta ahora. */
  loaded: number;
  /** Total esperado, o null si el origen no lo declaró. */
  total: number | null;
}

export type ProgressHandler = (progress: Progress) => void;

/** Error de descarga con el motivo ya clasificado, no un texto que adivinar. */
export class DownloadError extends Error {
  constructor(
    readonly reason: 'http' | 'timeout' | 'network' | 'demasiado-grande' | 'cancelado',
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

function proxyUrl(url: string, raw = false): string {
  return `/api/proxy?${raw ? 'raw=1&' : ''}url=${encodeURIComponent(url)}`;
}

/**
 * Une un `AbortSignal` externo con un plazo propio.
 *
 * El plazo se reinicia en cada tramo a propósito: en una descarga escalonada lo
 * que hay que vigilar es que **cada** petición avance, no que el total quepa en
 * 30 segundos. Con un único plazo global, un archivo de 300 MB se abortaba a
 * mitad por «lento» cuando en realidad iba bien.
 */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), ms);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function classify(err: unknown, external: AbortSignal | undefined): DownloadError {
  if (err instanceof DownloadError) return err;
  if (external?.aborted) return new DownloadError('cancelado', 'Descarga cancelada.');
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new DownloadError('timeout', 'El origen tardó demasiado en responder.');
  }
  return new DownloadError('network', 'No se pudo contactar con el origen del archivo.');
}

/**
 * Tamaño y capacidades del recurso, sin descargarlo.
 *
 * El `content-length` del `HEAD` **solo se cree si el servidor anuncia
 * `accept-ranges: bytes`**, y esa cautela no es teórica: el portal de origen es
 * un Liferay que contesta al `HEAD` con `content-length: 830` para un CSV que
 * pesa 535.659 bytes —responde con la página, no con el archivo—. Un tamaño
 * falso es peor que ninguno: haría que el visor se saltara el aviso de «pesa
 * mucho» y que la descarga escalonada calculara mal los tramos.
 *
 * `accept-ranges: bytes` es la señal de que al otro lado hay algo sirviendo el
 * fichero de verdad, byte a byte, y no un portal improvisando una respuesta.
 */
export async function probeResource(url: string, signal?: AbortSignal): Promise<ResourceProbe> {
  const { signal: timed, done } = withTimeout(signal, CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(proxyUrl(url), { method: 'HEAD', signal: timed });
    const acceptsRanges = (res.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes');
    const length = Number(res.headers.get('content-length') ?? '');
    const declared = Number.isFinite(length) && length > 0 ? length : null;
    return {
      size: acceptsRanges ? declared : null,
      acceptsRanges,
      contentType: res.headers.get('content-type'),
      status: Number(res.headers.get('x-origin-status') ?? res.status),
    };
  } catch {
    // Que el HEAD falle no significa que el GET vaya a fallar: hay servidores
    // que no lo implementan. Se devuelve «no sé nada» y se intenta la descarga.
    return { size: null, acceptsRanges: false, contentType: null, status: 0 };
  } finally {
    done();
  }
}

/** Lee un cuerpo emitiendo progreso. Devuelve los trozos, sin concatenar aún. */
async function readWithProgress(
  res: Response,
  loadedSoFar: number,
  total: number | null,
  onProgress?: ProgressHandler,
  onBytes?: (chunk: Uint8Array) => void
): Promise<Uint8Array[]> {
  if (!res.body) {
    const whole = new Uint8Array(await res.arrayBuffer());
    onBytes?.(whole);
    return [whole];
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = loadedSoFar;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes?.(value);
    onProgress?.({ loaded, total });
  }
  return chunks;
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: ProgressHandler;
  /** Se pasa `raw=1` al proxy: el cuerpo del origen llega aunque no sea 2xx. */
  raw?: boolean;
  /** Tamaño conocido de antemano; evita repetir el `HEAD`. */
  knownSize?: number | null;
  /** Corta la descarga a estos bytes. Para previsualizar sin bajarlo todo. */
  maxBytes?: number;
  /**
   * Cada bloque de bytes, según llega. Es lo que permite decodificar y parsear
   * mientras baja en vez de al final.
   */
  onBytes?: (chunk: Uint8Array) => void;
}

/**
 * Descarga completa, en una petición o en tramos según haga falta.
 *
 * Devuelve los bytes; quien llama decide cómo interpretarlos. La decisión
 * «entero o por tramos» es interna a propósito: el visor no debería tener que
 * saber si el origen admite `Range`.
 */
export async function downloadResource(url: string, options: DownloadOptions = {}): Promise<Uint8Array> {
  const { signal, onProgress, onBytes, raw = false, maxBytes } = options;

  let size = options.knownSize ?? null;
  let acceptsRanges = false;
  if (size == null || size > PROXY_MAX_BYTES) {
    const probe = await probeResource(url, signal);
    size = probe.size ?? size;
    acceptsRanges = probe.acceptsRanges;
  }

  const limit = maxBytes ?? Infinity;
  const target = size != null ? Math.min(size, limit) : null;
  const needsChunks = target != null && target > PROXY_MAX_BYTES;

  try {
    if (!needsChunks) {
      const { signal: timed, done } = withTimeout(signal, CLIENT_TIMEOUT_MS);
      try {
        const res = await fetch(proxyUrl(url, raw), { signal: timed });
        if (!res.ok) {
          throw new DownloadError(
            res.status === 413 ? 'demasiado-grande' : 'http',
            `El origen devolvió HTTP ${res.status}.`,
            res.status
          );
        }
        const chunks = await readWithProgress(res, 0, target, onProgress, onBytes);
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        // Muchos orígenes no declaran `content-length` (responden troceado), así
        // que el exceso solo se descubre leyendo. Sin esto, el corte del proxy
        // llegaba como un fallo de red y el visor decía «no se pudo contactar
        // con el origen» sobre un archivo que estaba perfectamente: era
        // demasiado grande, que es otra cosa y se arregla de otra manera.
        if (total > PROXY_MAX_BYTES) {
          throw new DownloadError(
            'demasiado-grande',
            'El archivo supera lo que se puede traer de una vez y el origen no admite descargas por tramos.'
          );
        }
        return concat(chunks, total);
      } finally {
        done();
      }
    }

    // Descarga escalonada. Si el origen no admite tramos no hay nada que hacer
    // salvo decirlo: pedirle el archivo entero acabaría en 413.
    if (!acceptsRanges) {
      throw new DownloadError(
        'demasiado-grande',
        'El archivo supera lo que se puede traer de una vez y el origen no admite descargas por tramos.'
      );
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    for (let start = 0; start < target!; start += RANGE_CHUNK_BYTES) {
      if (signal?.aborted) throw new DownloadError('cancelado', 'Descarga cancelada.');
      const end = Math.min(start + RANGE_CHUNK_BYTES, target!) - 1;
      // Cada tramo estrena plazo: lo que se vigila es que avance, no que el
      // archivo entero quepa en una ventana de 30 segundos.
      const { signal: timed, done } = withTimeout(signal, CLIENT_TIMEOUT_MS);
      try {
        const res = await fetch(proxyUrl(url, raw), {
          signal: timed,
          headers: { range: `bytes=${start}-${end}` },
        });
        // 206 es lo esperado; un 200 significa que el origen ignoró el tramo y
        // está mandando el archivo entero, lo que no cabe.
        if (res.status !== 206) {
          throw new DownloadError('demasiado-grande', 'El origen no respetó la petición por tramos.', res.status);
        }
        const part = await readWithProgress(res, received, target, onProgress, onBytes);
        for (const chunk of part) {
          chunks.push(chunk);
          received += chunk.byteLength;
        }
      } finally {
        done();
      }
    }
    return concat(chunks, received);
  } catch (err) {
    throw classify(err, signal);
  }
}

/**
 * Descarga texto, decodificando según llega.
 *
 * `onChunk` recibe el texto de cada bloque, y SIEMPRE cortado en un límite de
 * carácter: de eso se encarga el modo `stream` de `TextDecoder`, sin el cual un
 * carácter multibyte partido entre dos bloques saldría como «».
 *
 * Es lo que permite poblar la tabla mientras el CSV baja en lugar de esperar a
 * tenerlo entero.
 */
export async function downloadText(
  url: string,
  options: DownloadOptions & { onChunk?: (text: string) => void; encoding?: string } = {}
): Promise<string> {
  const { onChunk, encoding } = options;
  // `fatal: false` a propósito: en datos abiertos hay ficheros con codificación
  // mal declarada, y enseñarlos con algún carácter roto es más útil que no
  // enseñarlos.
  const decoder = new TextDecoder(encoding || 'utf-8');
  let text = '';

  await downloadResource(url, {
    ...options,
    onBytes: (chunk) => {
      const part = decoder.decode(chunk, { stream: true });
      if (!part) return;
      text += part;
      onChunk?.(part);
    },
  });

  const tail = decoder.decode();
  if (tail) {
    text += tail;
    onChunk?.(tail);
  }
  return text;
}
