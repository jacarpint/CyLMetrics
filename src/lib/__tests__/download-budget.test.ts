import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLATFORM_MAX_DURATION_S,
  PROXY_MAX_BYTES,
  PROXY_TIMEOUT_MS,
  OGC_MAX_BYTES,
  OGC_TIMEOUT_MS,
  CLIENT_TIMEOUT_MS,
  RANGE_CHUNK_BYTES,
  TABLE_AUTOLOAD_CAP,
  MAP_AUTOLOAD_CAP,
  needsRangeDownload,
  rangeChunkCount,
} from '@/lib/download-budget';

/**
 * Los números estaban en cuatro ficheros distintos y no se sostenían entre sí.
 * Lo que se comprueba aquí no son los valores —esos se pueden ajustar— sino las
 * relaciones que los hacían mentir cuando se rompían.
 */
describe('presupuesto de descarga', () => {
  it('el plazo del proxy salta antes que el corte de la plataforma', () => {
    // El fallo de fondo: 25 s de plazo propio con un techo de plataforma de
    // 10 s. El plazo no podía dispararse nunca y el usuario recibía un 504 sin
    // cuerpo en lugar del error explicado. Si esto se rompe, vuelve a pasar.
    expect(PROXY_TIMEOUT_MS).toBeLessThan(PLATFORM_MAX_DURATION_S * 1000);
  });

  it('el plazo del cliente no puede quedar por debajo del del servidor', () => {
    // Era el fallo original: 30 s en el cliente contra 25 s en el proxy hacía
    // que el del cliente no llegara a dispararse nunca.
    expect(CLIENT_TIMEOUT_MS).toBeGreaterThan(PROXY_TIMEOUT_MS);
  });

  it('los dos intentos de la ruta OGC caben en el presupuesto de la función', () => {
    expect(OGC_TIMEOUT_MS * 2).toBeLessThanOrEqual(PLATFORM_MAX_DURATION_S * 1000);
  });

  it('el plazo del servicio de mapas no pasa del del proxy', () => {
    expect(OGC_TIMEOUT_MS).toBeLessThanOrEqual(PROXY_TIMEOUT_MS);
  });

  it('la ruta OGC tiene tope de bytes, y por debajo del del proxy', () => {
    // No tenía ninguno: leía el XML entero y se lo pasaba al parser.
    expect(OGC_MAX_BYTES).toBeGreaterThan(0);
    expect(OGC_MAX_BYTES).toBeLessThanOrEqual(PROXY_MAX_BYTES);
  });

  it('un tramo cabe holgadamente en una petición', () => {
    // Si el tramo rozara el tope, cualquier cabecera extra provocaría un 413 en
    // mitad de una descarga escalonada.
    expect(RANGE_CHUNK_BYTES * 2).toBeLessThanOrEqual(PROXY_MAX_BYTES);
  });

  it('los topes de cortesía quedan por debajo del techo por petición', () => {
    // Si un tope superara el techo del proxy, el aviso de «pesa mucho» no
    // llegaría a salir: el 413 se adelantaría.
    expect(TABLE_AUTOLOAD_CAP).toBeLessThan(PROXY_MAX_BYTES);
    expect(MAP_AUTOLOAD_CAP).toBeLessThan(PROXY_MAX_BYTES);
  });

  it('el mapa admite más que la tabla, porque un shapefile provincial pesa eso', () => {
    expect(MAP_AUTOLOAD_CAP).toBeGreaterThan(TABLE_AUTOLOAD_CAP);
  });
});

/**
 * Next extrae `maxDuration` leyendo el fichero de la ruta, sin ejecutarlo: si se
 * importa de aquí, el build falla con «Invalid segment configuration export».
 * Está escrito como literal en cada ruta, así que hace falta algo que impida
 * que los dos números se separen — que es justo el fallo que este módulo
 * existe para evitar.
 */
describe('maxDuration de las rutas coincide con el presupuesto', () => {
  const ROUTES = ['src/app/api/proxy/route.ts', 'src/app/api/ogc/route.ts'];

  for (const route of ROUTES) {
    it(`${route} declara maxDuration = PLATFORM_MAX_DURATION_S`, () => {
      const source = fs.readFileSync(path.join(process.cwd(), route), 'utf-8');
      const match = /export const maxDuration = (\d+)/.exec(source);
      expect(match, `${route} debe exportar maxDuration`).not.toBeNull();
      expect(Number(match![1])).toBe(PLATFORM_MAX_DURATION_S);
    });
  }
});

describe('needsRangeDownload', () => {
  it('lo que no cabe en una petición se pide por tramos', () => {
    expect(needsRangeDownload(PROXY_MAX_BYTES + 1)).toBe(true);
    expect(needsRangeDownload(512 * 1024 * 1024)).toBe(true);
  });

  it('lo que cabe justo se pide de una vez', () => {
    expect(needsRangeDownload(PROXY_MAX_BYTES)).toBe(false);
    expect(needsRangeDownload(TABLE_AUTOLOAD_CAP)).toBe(false);
  });

  it('sin tamaño declarado no se presume nada: se intenta la descarga', () => {
    // El catálogo no siempre declara el tamaño. Suponer que no cabe escondería
    // el visor de archivos que sí se pueden abrir.
    expect(needsRangeDownload(null)).toBe(false);
    expect(needsRangeDownload(undefined)).toBe(false);
  });
});

describe('rangeChunkCount', () => {
  it('un archivo pequeño es un solo tramo', () => {
    expect(rangeChunkCount(1024)).toBe(1);
    expect(rangeChunkCount(0)).toBe(1);
  });

  it('redondea hacia arriba: el último tramo también cuenta', () => {
    expect(rangeChunkCount(RANGE_CHUNK_BYTES)).toBe(1);
    expect(rangeChunkCount(RANGE_CHUNK_BYTES + 1)).toBe(2);
    expect(rangeChunkCount(RANGE_CHUNK_BYTES * 4)).toBe(4);
  });
});
