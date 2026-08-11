/**
 * Lector de ZIP mínimo, para abrir XLSX en el navegador.
 *
 * Un XLSX es un ZIP con XML dentro. Descomprimir se hace con
 * `DecompressionStream('deflate-raw')`, que es API nativa del navegador y de
 * Node 18+, así que no hace falta traerse una librería de decenas de KB (ni
 * asumir su cadena de suministro) solo para previsualizar una hoja de cálculo.
 *
 * Cubre lo que produce cualquier generador de XLSX: entradas almacenadas
 * (método 0) o desinfladas (método 8). No cubre ZIP64 ni cifrado; para eso se
 * lanza un error con nombre propio en vez de devolver datos corruptos.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** El comentario final del ZIP puede ocupar hasta 64 KB. */
const MAX_COMMENT = 0xffff;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/** Posición del End Of Central Directory, buscando desde el final. */
function findEocd(view: DataView): number {
  const start = Math.max(0, view.byteLength - MAX_COMMENT - 22);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new ZipError('No parece un archivo ZIP: falta el directorio central.');
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Devuelve el contenido de cada entrada del ZIP, indexado por su ruta.
 * Se saltan los directorios y las entradas vacías.
 */
export async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) throw new ZipError('Archivo ZIP64: no soportado por el visor.');

  const decoder = new TextDecoder('utf-8');
  const out = new Map<string, Uint8Array>();

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break;

    const method = view.getUint16(offset + 10, true);
    const flags = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/') || compressedSize === 0) continue;
    // Bit 0 del flag general: la entrada está cifrada.
    if (flags & 0x1) throw new ZipError('El archivo está protegido con contraseña.');

    if (view.getUint32(localOffset, true) !== SIG_LOCAL) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new ZipError(`Compresión no soportada (método ${method}).`);
  }

  return out;
}
