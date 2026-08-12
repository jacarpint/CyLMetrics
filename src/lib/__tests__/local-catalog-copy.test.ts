import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseCatalog } from '@/lib/rdf-catalog';

/**
 * Salud de la copia local de respaldo (`src/data/rdf-catalog.rdf`).
 *
 * Esa copia se sirve cuando el RDF remoto no responde, y también es lo que usa un
 * worker del build al que le falla la descarga. Si se queda atrás respecto al
 * catálogo en vivo, el build deja de ser determinista: unas páginas se generan con
 * un catálogo y otras con otro, y un dataset presente en vivo pero ausente en la
 * copia termina con un 404 horneado en la salida estática para una URL válida.
 * Pasó de verdad con «Autorizaciones ambientales».
 *
 * Estos casos no comprueban que la copia esté al día —eso depende de cuándo se
 * refrescó— sino que sigue siendo utilizable como respaldo.
 */
const LOCAL_PATH = path.join(process.cwd(), 'src', 'data', 'rdf-catalog.rdf');
const exists = fs.existsSync(LOCAL_PATH);

describe.skipIf(!exists)('copia local del catálogo', () => {
  const xml = exists ? fs.readFileSync(LOCAL_PATH, 'utf-8') : '';
  const data = exists
    ? parseCatalog(xml, `file://${LOCAL_PATH}`, new Date().toISOString(), 'local')
    : null;

  it('se parsea y cubre el catálogo completo', () => {
    // Una copia truncada es peor que ninguna: el portal la serviría como si
    // fuera el catálogo entero.
    expect(data!.datasets.length).toBeGreaterThan(700);
    expect(data!.source.distributionCount).toBeGreaterThan(1000);
  });

  it('todos los datasets traen título e identificador', () => {
    expect(data!.datasets.filter((d) => !d.title)).toHaveLength(0);
    expect(data!.datasets.filter((d) => !d.id)).toHaveLength(0);
  });

  it('todas las licencias se reconocen', () => {
    // Un `Otro` aquí significa que `mapLicense` no cubre una URI que el catálogo
    // sí publica, y eso le resta completitud al dataset por un hueco inexistente.
    const unknown = data!.datasets.filter((d) => d.license === 'Otro');
    expect(
      unknown.map((d) => d.id).slice(0, 5),
      `${unknown.length} datasets con licencia sin identificar: revisa LICENSE_PATTERNS`
    ).toEqual([]);
  });

  it('el XML está completo', () => {
    expect(xml.trimStart().startsWith('<?xml')).toBe(true);
    expect(xml.trimEnd().endsWith('</rdf:RDF>')).toBe(true);
  });
});
