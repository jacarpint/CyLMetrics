import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { unzip, ZipError } from '@/lib/zip-read';

/**
 * El lector de ZIP abre archivos que vienen del catálogo, o sea de terceros. Lo
 * que se fija aquí es que un archivo hostil o simplemente enorme no se lleve por
 * delante la pestaña de quien lo mira.
 */

/** Monta un ZIP de una entrada, desinflada, con su directorio central. */
function zipConUnaEntrada(nombre: string, contenido: Uint8Array): ArrayBuffer {
  const name = new TextEncoder().encode(nombre);
  const data = new Uint8Array(deflateRawSync(contenido, { level: 9 }));

  const local = new Uint8Array(30 + name.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);                 // método: deflate
  lv.setUint32(18, data.length, true);      // tamaño comprimido
  lv.setUint32(22, contenido.length, true); // tamaño sin comprimir
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(data, 30 + name.length);

  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, contenido.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true);                // offset de la cabecera local
  central.set(name, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(eocd, local.length + central.length);
  return out.buffer;
}

describe('unzip', () => {
  it('abre una entrada normal', async () => {
    const contenido = new TextEncoder().encode('municipio;habitantes\nÁvila;58245\n');
    const entradas = await unzip(zipConUnaEntrada('datos.csv', contenido));
    expect(new TextDecoder().decode(entradas.get('datos.csv'))).toContain('Ávila');
  });

  /**
   * `deflate` comprime lo repetitivo a casi nada, así que un ZIP que cabe de
   * sobra en el tope del proxy (48 MB) puede expandirse a decenas de gigas.
   * Antes se descomprimía con `arrayBuffer()`, que se lo traía todo a memoria: el
   * tope solo se podía comprobar cuando el daño ya estaba hecho.
   */
  it('corta una bomba de descompresión en vez de tragársela', async () => {
    // 300 MB de ceros ocupan ~300 KB comprimidos: ratio de mil a uno.
    const bomba = zipConUnaEntrada('bomba.bin', new Uint8Array(300 * 1024 * 1024));
    expect(bomba.byteLength).toBeLessThan(2 * 1024 * 1024);

    await expect(unzip(bomba)).rejects.toThrow(ZipError);
    await expect(unzip(bomba)).rejects.toThrow(/al descomprimirse/);
  }, 120_000);

  it('un archivo cifrado se rechaza con su nombre, no con datos corruptos', async () => {
    const zip = zipConUnaEntrada('secreto.csv', new TextEncoder().encode('x'));
    // Bit 0 del flag general, en la cabecera central.
    const bytes = new Uint8Array(zip);
    const inicioCentral = new DataView(zip).getUint32(zip.byteLength - 22 + 16, true);
    new DataView(bytes.buffer).setUint16(inicioCentral + 8, 0x1, true);
    await expect(unzip(bytes.buffer)).rejects.toThrow(/contraseña/);
  });

  it('lo que no es un ZIP se dice, no se adivina', async () => {
    const basura = new TextEncoder().encode('<!DOCTYPE html><html>no soy un zip</html>');
    await expect(unzip(basura.buffer as ArrayBuffer)).rejects.toThrow(/no parece un archivo zip/i);
  });
});
