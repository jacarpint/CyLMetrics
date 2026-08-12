import { describe, it, expect } from 'vitest';
import { matchDistributions, type DistributionResult } from '../quality-report';

/** Resultado mínimo del informe: solo lo que mira el emparejador. */
function result(format: string, url: string): DistributionResult {
  return {
    dataset_index: 0,
    dataset_id: 'x',
    dataset_title: 'x',
    format,
    mime: '',
    url,
    status: 'ok',
    fetch: null,
    analysis: null,
    duration_ms: 0,
  };
}

describe('matchDistributions', () => {
  it('empareja por URL, no por posición', () => {
    // El catálogo reordenó las distribuciones respecto al informe.
    const catalogo = [{ url: 'https://a/x.json' }, { url: 'https://a/x.csv' }];
    const informe = [result('CSV', 'https://a/x.csv'), result('JSON', 'https://a/x.json')];

    const matched = matchDistributions(catalogo, informe);

    expect(matched[0]?.format).toBe('JSON');
    expect(matched[1]?.format).toBe('CSV');
  });

  it('deja sin emparejar lo que el informe no vio', () => {
    const catalogo = [{ url: 'https://a/x.csv' }, { url: 'https://a/nuevo.csv' }];
    const informe = [result('CSV', 'https://a/x.csv')];

    const matched = matchDistributions(catalogo, informe);

    expect(matched[0]?.url).toBe('https://a/x.csv');
    // El respaldo por índice no puede reasignar un resultado ya emparejado.
    expect(matched[1]).toBeUndefined();
  });

  it('cae al índice cuando la URL cambió de forma pero la posición sigue libre', () => {
    const catalogo = [{ url: 'https://a/x.csv?v=2' }];
    const informe = [result('CSV', 'https://a/x.csv')];

    expect(matchDistributions(catalogo, informe)[0]?.format).toBe('CSV');
  });

  it('no asigna el mismo resultado a dos distribuciones', () => {
    const catalogo = [{ url: 'https://a/x.csv' }, { url: 'https://a/x.csv' }];
    const informe = [result('CSV', 'https://a/x.csv')];

    const matched = matchDistributions(catalogo, informe);

    expect(matched[0]).toBeDefined();
    expect(matched[1]).toBeUndefined();
  });

  it('reparte los duplicados en orden cuando el informe también los trae', () => {
    const catalogo = [{ url: 'https://a/x.csv' }, { url: 'https://a/x.csv' }];
    const informe = [result('CSV', 'https://a/x.csv'), result('TSV', 'https://a/x.csv')];

    const matched = matchDistributions(catalogo, informe);

    expect(matched[0]?.format).toBe('CSV');
    expect(matched[1]?.format).toBe('TSV');
  });

  it('sin informe devuelve un hueco por distribución', () => {
    const catalogo = [{ url: 'a' }, { url: 'b' }];
    expect(matchDistributions(catalogo, undefined)).toEqual([undefined, undefined]);
    expect(matchDistributions(catalogo, [])).toEqual([undefined, undefined]);
  });
});
