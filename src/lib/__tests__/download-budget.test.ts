import { describe, it, expect } from 'vitest';
import {
  PROXY_MAX_BYTES,
  PROXY_TIMEOUT_MS,
  OGC_TIMEOUT_MS,
  CLIENT_TIMEOUT_MS,
  TABLE_AUTOLOAD_CAP,
  MAP_AUTOLOAD_CAP,
  exceedsProxyLimit,
} from '@/lib/download-budget';

/**
 * Los números estaban en cuatro ficheros distintos y no se sostenían entre sí.
 * Lo que se comprueba aquí no son los valores —esos se pueden ajustar— sino las
 * relaciones que los hacían mentir cuando se rompían.
 */
describe('presupuesto de descarga', () => {
  it('el plazo del cliente no puede quedar por debajo del del servidor', () => {
    // Era el fallo original: 30 s en el cliente contra 25 s en el proxy hacía
    // que el del cliente no llegara a dispararse nunca.
    expect(CLIENT_TIMEOUT_MS).toBeGreaterThan(PROXY_TIMEOUT_MS);
  });

  it('el plazo del servicio de mapas no pasa del del proxy', () => {
    expect(OGC_TIMEOUT_MS).toBeLessThanOrEqual(PROXY_TIMEOUT_MS);
  });

  it('los topes de cortesía quedan por debajo del techo duro', () => {
    // Si un tope superara el techo del proxy, el aviso de «pesa mucho» no
    // llegaría a salir: el 413 se adelantaría.
    expect(TABLE_AUTOLOAD_CAP).toBeLessThan(PROXY_MAX_BYTES);
    expect(MAP_AUTOLOAD_CAP).toBeLessThan(PROXY_MAX_BYTES);
  });

  it('el mapa admite más que la tabla, porque un shapefile provincial pesa eso', () => {
    expect(MAP_AUTOLOAD_CAP).toBeGreaterThan(TABLE_AUTOLOAD_CAP);
  });

  it('el techo deja sitio al tope de descarga del analizador (25 MB)', () => {
    expect(PROXY_MAX_BYTES).toBeGreaterThan(25 * 1024 * 1024);
  });
});

describe('exceedsProxyLimit', () => {
  it('marca lo que el proxy va a rechazar', () => {
    expect(exceedsProxyLimit(PROXY_MAX_BYTES + 1)).toBe(true);
    expect(exceedsProxyLimit(64 * 1024 * 1024)).toBe(true);
  });

  it('no marca lo que cabe justo', () => {
    expect(exceedsProxyLimit(PROXY_MAX_BYTES)).toBe(false);
    expect(exceedsProxyLimit(TABLE_AUTOLOAD_CAP)).toBe(false);
  });

  it('sin tamaño declarado no se presume nada: se intenta la descarga', () => {
    // El catálogo no siempre declara el tamaño. Suponer que no cabe escondería
    // el visor de archivos que sí se pueden abrir.
    expect(exceedsProxyLimit(null)).toBe(false);
    expect(exceedsProxyLimit(undefined)).toBe(false);
  });
});
