import { describe, it, expect } from 'vitest';
import { buildQualityUrl, parseQualityFilters, resolveVista } from '@/lib/quality-filters';
import { rowMatchesCauses, type FileIssueRow } from '@/lib/availability';

describe('resolveVista', () => {
  it('acepta las tres vistas', () => {
    for (const v of ['prioridades', 'ficheros', 'metadatos'] as const) {
      expect(resolveVista(v)).toBe(v);
    }
  });

  /**
   * Estos alias están en las redirecciones de `next.config.ts` y en enlaces ya
   * publicados. Romperlos manda a la gente a la vista equivocada sin ningún error.
   */
  it('traduce las vistas heredadas', () => {
    expect(resolveVista('resumen')).toBe('prioridades');
    expect(resolveVista('organismos')).toBe('prioridades');
    expect(resolveVista('reparar')).toBe('ficheros');
    expect(resolveVista('incidencias')).toBe('ficheros');
  });

  /**
   * `evolucion` era la serie histórica, retirada del portal. Estaba enlazada desde
   * la portada y desde la redirección de `/tendencias`, así que tiene que seguir
   * resolviendo a algo útil en vez de dar un 404.
   */
  it('la vista de evolución retirada aterriza en prioridades', () => {
    expect(resolveVista('evolucion')).toBe('prioridades');
  });

  it('cae a prioridades ante lo desconocido o lo ausente', () => {
    expect(resolveVista(undefined)).toBe('prioridades');
    expect(resolveVista('inventada')).toBe('prioridades');
  });
});

describe('parseQualityFilters', () => {
  it('lee todas las claves', () => {
    expect(
      parseQualityFilters({
        vista: 'ficheros',
        familia: 'entrega',
        causa: 'descarga',
        formato: 'GML',
        tematica: 'Medio ambiente',
        q: '  agua  ',
        hueco: 'sin-licencia',
      })
    ).toEqual({
      vista: 'ficheros',
      familia: 'entrega',
      causas: ['descarga'],
      formato: 'GML',
      tematica: 'Medio ambiente',
      q: 'agua',
      hueco: 'sin-licencia',
    });
  });

  it('acepta varias causas separadas por comas, para los grupos de consecuencia', () => {
    expect(parseQualityFilters({ causa: 'encabezado-vacio,encabezado-duplicado' }).causas).toEqual([
      'encabezado-vacio',
      'encabezado-duplicado',
    ]);
  });

  it('ignora los huecos y los espacios de una lista mal formada', () => {
    expect(parseQualityFilters({ causa: ' a , ,b, ' }).causas).toEqual(['a', 'b']);
  });

  it('sin parámetros, la vista es prioridades y no hay filtros', () => {
    expect(parseQualityFilters({})).toEqual({
      vista: 'prioridades',
      familia: 'todas',
      causas: [],
      formato: undefined,
      tematica: undefined,
      q: undefined,
      hueco: undefined,
    });
  });

  it('una familia inventada no filtra, en vez de vaciar la tabla', () => {
    expect(parseQualityFilters({ familia: 'inventada' }).familia).toBe('todas');
  });

  /** El enlace heredado de la pestaña «Incidencias» solo enseñaba contenido. */
  it('la vista heredada «incidencias» preselecciona la familia de contenido', () => {
    expect(parseQualityFilters({ vista: 'incidencias' })).toMatchObject({
      vista: 'ficheros',
      familia: 'contenido',
    });
  });

  it('una familia explícita manda sobre la que implica la vista heredada', () => {
    expect(parseQualityFilters({ vista: 'incidencias', familia: 'entrega' }).familia).toBe('entrega');
  });

  it('acepta URLSearchParams, que es lo que da useSearchParams', () => {
    const params = new URLSearchParams('vista=ficheros&causa=descarga&formato=GML');
    expect(parseQualityFilters(params)).toMatchObject({
      vista: 'ficheros',
      causas: ['descarga'],
      formato: 'GML',
    });
  });
});

describe('buildQualityUrl', () => {
  it('omite lo que está vacío', () => {
    expect(buildQualityUrl({ vista: 'ficheros' })).toBe('/calidad?vista=ficheros');
    expect(buildQualityUrl({})).toBe('/calidad');
  });

  it('«todas» no ensucia la URL: es el valor por defecto', () => {
    expect(buildQualityUrl({ vista: 'ficheros', familia: 'todas' })).toBe('/calidad?vista=ficheros');
  });

  /** El enlace que fallaba: la tarjeta sabía el formato y el href lo tiraba. */
  it('lleva familia, causa y formato juntos', () => {
    expect(
      buildQualityUrl({ vista: 'ficheros', familia: 'entrega', causas: ['descarga'], formato: 'GML' })
    ).toBe('/calidad?vista=ficheros&familia=entrega&causa=descarga&formato=GML');
  });

  it('varias causas van en una sola clave', () => {
    expect(buildQualityUrl({ vista: 'ficheros', causas: ['a', 'b'] })).toContain('causa=a%2Cb');
  });

  it('ida y vuelta: lo que se construye se vuelve a leer igual', () => {
    const original = parseQualityFilters({
      vista: 'ficheros',
      familia: 'contenido',
      causa: 'error-tipo,celda-extra',
      formato: 'CSV',
      tematica: 'Salud',
      q: 'aguas',
    });
    const url = buildQualityUrl(original);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(parseQualityFilters(params)).toEqual(original);
  });
});

describe('rowMatchesCauses', () => {
  function row(causeCode: string, causeCodes?: string[]): FileIssueRow {
    return {
      datasetSlug: 'x', datasetTitle: 'X', category: 'C', format: 'CSV',
      url: 'https://example.org/a.csv', distSlug: 'csv',
      family: 'contenido', state: 'ok', causeCode, causeCodes,
    };
  }

  it('sin causas pedidas no filtra', () => {
    expect(rowMatchesCauses(row('error-tipo'), [])).toBe(true);
  });

  it('coincide por la causa principal', () => {
    expect(rowMatchesCauses(row('error-tipo'), ['error-tipo'])).toBe(true);
    expect(rowMatchesCauses(row('error-tipo'), ['fila-vacia'])).toBe(false);
  });

  /**
   * El descuadre entre la tarjeta y la tabla: las tarjetas cuentan un archivo si
   * el código aparece en cualquier posición, y la tabla solo miraba la primera.
   */
  it('coincide también por un código que no es el principal', () => {
    const r = row('error-tipo', ['error-tipo', 'fila-vacia']);
    expect(rowMatchesCauses(r, ['fila-vacia'])).toBe(true);
  });

  it('con varias causas basta con una', () => {
    const r = row('encabezado-vacio');
    expect(rowMatchesCauses(r, ['encabezado-vacio', 'encabezado-duplicado'])).toBe(true);
    expect(rowMatchesCauses(r, ['error-tipo', 'fila-vacia'])).toBe(false);
  });
});
