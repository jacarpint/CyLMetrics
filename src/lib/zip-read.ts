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

/**
 * Cuánto se permite que ocupe UNA entrada ya descomprimida.
 *
 * `deflate` comprime muy bien lo repetitivo: un mega de ceros ocupa unos pocos
 * kilobytes, así que un ZIP dentro del tope del proxy (48 MB) puede expandirse a
 * decenas de gigas. Sin tope, `new Response(stream).arrayBuffer()` se lo traía
 * todo a memoria y la pestaña se iba con él.
 *
 * No hace falta malicia para llegar aquí: en este catálogo hay shapefiles de
 * 618 MB, y abrir uno comprimido dentro de una pestaña acaba igual de mal que
 * una bomba de descompresión hecha a propósito.
 *
 * 256 MB deja pasar cualquier hoja de cálculo y cualquier shapefile razonable, y
 * corta antes de que el navegador empiece a sufrir.
 */
const MAX_INFLATED = 256 * 1024 * 1024;

/**
 * Descomprime contando lo que sale y cortando si se pasa.
 *
 * Se lee por trozos en vez de con `arrayBuffer()` precisamente para poder
 * pararlo: con `arrayBuffer()` el tope solo se podría comprobar cuando ya está
 * todo en memoria, que es justo lo que hay que evitar.
 */
async function inflateRaw(data: Uint8Array, name: string): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INFLATED) {
        throw new ZipError(
          `«${name}» supera los ${Math.round(MAX_INFLATED / 1048576)} MB al descomprimirse; ` +
            'el visor no lo abre para no bloquear el navegador.'
        );
      }
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
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
    else if (method === 8) out.set(name, await inflateRaw(raw, name));
    else throw new ZipError(`Compresión no soportada (método ${method}).`);
  }

  return out;
}
