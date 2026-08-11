/**
 * Qué es realmente lo que ha devuelto el origen.
 *
 * Casi todos los recursos geográficos rotos del catálogo responden HTTP 200 con
 * algo que no es el archivo prometido, así que fiarse de la extensión o del
 * código de estado no sirve. Mirando los primeros bytes y, si es XML, su
 * contenido, se puede decir exactamente qué ha pasado en vez de un genérico
 * «no se pudo abrir».
 *
 * Los tres casos que aparecen de verdad en el catálogo:
 *
 *  - GeoServer contesta un `ExceptionReport` diciendo que la capa ya no existe
 *    (10 de los 16 SHP marcados como «ZIP inválido»).
 *  - La URL devuelve el listado HTML de un directorio FTP en lugar del archivo.
 *  - El ZIP es correcto pero llegó cortado, porque el analizador tiene un tope
 *    de descarga. Eso no es un archivo corrupto y no debe decirse que lo sea.
 */

export type ContentKind = 'zip' | 'gzip' | 'xml' | 'html' | 'json' | 'texto' | 'binario' | 'vacio';

const ascii = new TextDecoder('latin1');

/** Identifica el contenido por su firma, no por la extensión de la URL. */
export function sniff(buffer: ArrayBuffer): ContentKind {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength === 0) return 'vacio';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';

  const head = ascii.decode(bytes.subarray(0, 512)).trimStart();
  if (/^<!doctype html/i.test(head) || /^<html/i.test(head)) return 'html';
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    return /<html\b/i.test(head) ? 'html' : 'xml';
  }
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  // Si los primeros bytes son imprimibles, es texto; si no, binario.
  return /^[\x09\x0a\x0d\x20-\x7e -￿]*$/.test(head.slice(0, 64)) ? 'texto' : 'binario';
}

export interface OgcException {
  code: string | null;
  locator: string | null;
  text: string;
}

/**
 * Extrae la excepción de un `ows:ExceptionReport` o `ServiceExceptionReport`.
 * Se lee con expresiones regulares y no con DOMParser porque esto también corre
 * en el servidor, donde no hay DOM.
 */
export function ogcException(xml: string): OgcException | null {
  if (!/ExceptionReport|ServiceException/i.test(xml)) return null;
  const code = /exceptionCode\s*=\s*"([^"]*)"|code\s*=\s*"([^"]*)"/i.exec(xml);
  const locator = /locator\s*=\s*"([^"]*)"/i.exec(xml);
  const text =
    /<(?:ows:)?ExceptionText[^>]*>([\s\S]*?)<\/(?:ows:)?ExceptionText>/i.exec(xml) ??
    // El `(?![A-Za-z])` evita que `<ServiceExceptionReport>` haga de apertura.
    /<(?:\w+:)?ServiceException(?![A-Za-z])[^>]*>([\s\S]*?)<\/(?:\w+:)?ServiceException>/i.exec(xml);

  const message = (text?.[1] ?? '').replace(/\s+/g, ' ').trim();
  if (!message && !code) return null;
  return {
    code: code?.[1] || code?.[2] || null,
    locator: locator?.[1] || null,
    text: message || 'El servicio devolvió un error sin descripción.',
  };
}

/** ¿El ZIP está completo? El directorio central va al final del archivo. */
export function looksTruncatedZip(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  // Se busca la firma del End Of Central Directory en los últimos 64 KB.
  const from = Math.max(0, bytes.byteLength - 0xffff - 22);
  for (let i = bytes.byteLength - 22; i >= from; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return false;
  }
  return true;
}

export interface Diagnosis {
  /** Motivo en una frase, listo para enseñar. */
  reason: string;
  /** Detalle técnico secundario (texto de la excepción, tipo detectado…). */
  detail?: string;
  /** Distingue lo que falla en el origen de lo que falla aquí. */
  origin: 'publicador' | 'portal' | 'desconocido';
}

/** Motivo a partir del código de estado, cuando el origen sí llegó a contestar. */
function fromStatus(status: number): Diagnosis | null {
  if (status < 400) return null;
  if (status === 404 || status === 410) {
    return {
      reason: `El recurso ya no existe en el servidor (HTTP ${status}).`,
      detail: 'La URL sigue publicada en el catálogo, pero el servidor de origen ya no la sirve.',
      origin: 'publicador',
    };
  }
  if (status === 401 || status === 403) {
    return { reason: `El servidor de origen deniega el acceso al recurso (HTTP ${status}).`, origin: 'publicador' };
  }
  if (status >= 500) {
    return { reason: `El servidor de origen falló al entregar el recurso (HTTP ${status}).`, origin: 'publicador' };
  }
  return { reason: `El servidor de origen rechazó la petición (HTTP ${status}).`, origin: 'publicador' };
}

/**
 * Traduce una respuesta que no se pudo usar al motivo concreto por el que no
 * sirve, para poder decírselo al usuario en lugar de esconderlo.
 *
 * El orden importa: un `ExceptionReport` dice más que un código de estado, y un
 * código de estado dice más que el tipo de contenido. Sin esto, un 404 que
 * devuelve una página de error se anunciaba como «la URL apunta a un
 * directorio», que es otra cosa.
 */
export function diagnose(buffer: ArrayBuffer, expected: string, status = 200): Diagnosis {
  const kind = sniff(buffer);

  if (kind === 'xml' || kind === 'html') {
    const exception = ogcException(ascii.decode(new Uint8Array(buffer).subarray(0, 8192)));
    if (exception) {
      return {
        reason: 'El servicio cartográfico rechazó la petición en lugar de entregar el archivo.',
        detail:
          exception.text +
          (exception.code ? ` (${exception.code}${exception.locator ? `, parámetro ${exception.locator}` : ''})` : ''),
        origin: 'publicador',
      };
    }
  }

  const byStatus = fromStatus(status);
  if (byStatus) return byStatus;

  if (kind === 'vacio') {
    return { reason: 'El origen devolvió una respuesta vacía.', origin: 'publicador' };
  }

  if (kind === 'xml' || kind === 'html') {
    if (kind === 'html') {
      return {
        reason: 'La URL devuelve una página web, no el archivo: normalmente apunta a un directorio o a una ficha, no al recurso.',
        origin: 'publicador',
      };
    }
    return {
      reason: `El origen devolvió un documento XML donde se esperaba ${expected}.`,
      origin: 'publicador',
    };
  }

  if (kind === 'json') {
    return { reason: `El origen devolvió JSON donde se esperaba ${expected}.`, origin: 'publicador' };
  }

  if (kind === 'zip' && looksTruncatedZip(buffer)) {
    return {
      reason: 'El archivo comprimido llegó incompleto, así que no se puede abrir.',
      detail: 'La descarga se cortó antes de llegar al final del ZIP; el archivo original puede estar perfectamente.',
      origin: 'portal',
    };
  }

  return {
    reason: `El contenido descargado no es ${expected} (se detectó ${kind}).`,
    origin: 'desconocido',
  };
}
