import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isAllowedHost, ALLOWED_DOMAINS } from '../proxy-allow';

describe('isAllowedHost', () => {
  it('admite los hosts reales del catálogo', () => {
    for (const url of [
      'https://datosabiertos.jcyl.es/web/jcyl/risp/es/x.csv',
      'https://idecyl.jcyl.es/geoserver/incendios/wfs',
      'https://www.jcyl.es/sie',
      'https://rmd.jcyl.es/algo',
      'https://ftp.itacyl.es/cartografia/04_SIOSE/',
      'https://www.geoportal.itacyl.es/x',
      'https://suelos.itacyl.es/x',
      'https://admin.sigecyl.es/servicios/x',
      'https://www.inforiego.org/x',
    ]) {
      expect(isAllowedHost(url), url).toBe(true);
    }
  });

  it('admite el dominio raíz además de sus subdominios', () => {
    expect(isAllowedHost('https://jcyl.es/x')).toBe(true);
    expect(isAllowedHost('https://itacyl.es/x')).toBe(true);
  });

  // Lo que separa una allowlist de un proxy abierto.
  it('rechaza los dominios que solo se le parecen', () => {
    for (const url of [
      'https://notjcyl.es/x',
      'https://jcyl.es.atacante.com/x',
      'https://evil-jcyl.es/x',
      'https://itacyl.es.evil.net/x',
      'https://example.com/x',
    ]) {
      expect(isAllowedHost(url), url).toBe(false);
    }
  });

  it('rechaza esquemas que no son web', () => {
    expect(isAllowedHost('file:///etc/passwd')).toBe(false);
    expect(isAllowedHost('ftp://ftp.itacyl.es/x')).toBe(false);
    expect(isAllowedHost('data:text/html,x')).toBe(false);
    expect(isAllowedHost('no es una url')).toBe(false);
  });

  it('no distingue mayúsculas en el host', () => {
    expect(isAllowedHost('https://DatosAbiertos.JCYL.es/x')).toBe(true);
  });
});

/**
 * Guardia contra el envejecimiento: si el catálogo publica un host que el proxy
 * no alcanza, la previsualización deja de funcionar en silencio. El test avisa
 * y obliga a decidir a mano si ese dominio debe entrar en la lista.
 */
describe('cobertura del catálogo', () => {
  const catalogPath = path.join(process.cwd(), 'src', 'data', 'rdf-catalog.rdf');

  it.skipIf(!fs.existsSync(catalogPath))('cubre todos los hosts de distribución del catálogo', () => {
    const xml = fs.readFileSync(catalogPath, 'utf-8');
    const urls = [
      ...xml.matchAll(/(?:accessURL|downloadURL)[^>]*>\s*([a-z]+:\/\/[^<\s"]+)/gi),
      ...xml.matchAll(/(?:accessURL|downloadURL)[^>]*rdf:resource="([^"]+)"/gi),
    ].map((m) => m[1]);

    expect(urls.length).toBeGreaterThan(0);

    const uncovered = new Set<string>();
    for (const url of urls) {
      if (isAllowedHost(url)) continue;
      try { uncovered.add(new URL(url).hostname.toLowerCase()); } catch { /* URL rota del catálogo */ }
    }

    expect(
      [...uncovered],
      `Hosts del catálogo fuera de la allowlist. Comprueba de quién son antes de añadirlos a ALLOWED_DOMAINS (${ALLOWED_DOMAINS.join(', ')}).`
    ).toEqual([]);
  });
});
