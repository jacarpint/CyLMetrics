import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Comportamiento de la caché del catálogo ante un refresco fallido, incompleto
 * o recortado.
 *
 * El portal tiene que enseñar siempre el dato más actualizado que tenga. Antes,
 * cualquier fallo puntual —red caída, jcyl sin responder, XML corrupto— guardaba
 * un catálogo VACÍO durante la hora de revalidación: un parpadeo en el momento
 * justo dejaba «0 datasets» y medias al 0% durante sesenta minutos, teniendo el
 * dato bueno un segundo antes.
 *
 * Más tarde se vio un fallo más sutil: un fetch que "funciona" (200, XML bien
 * formado) pero trae muchos menos datasets de los reales. El 15 de septiembre de
 * 2026 la Junta le sirvió a Vercel un RDF recortado a 235 de los ~840 datasets
 * reales, de forma persistente en cada redeploy —no un parpadeo puntual—, así
 * que no había ningún "último catálogo bueno" en memoria contra el que
 * compararlo. Los fixtures de aquí usan catálogos grandes (varios cientos de
 * datasets) a propósito, para quedar por encima de `MIN_PLAUSIBLE_DATASETS` en
 * `rdf-catalog.ts` cuando la prueba quiere representar un remoto sano.
 */

/**
 * La copia local (`src/data/rdf-catalog.rdf`) es el segundo respaldo: además de
 * cuando el remoto falla del todo, entra en juego cuando el remoto responde
 * pero por debajo del umbral mínimo. Para probar el último eslabón —qué pasa
 * cuando NO hay ni remoto ni copia local— hay que poder desactivarla.
 */
let localCopyAvailable = true;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: string) =>
        String(p).endsWith('rdf-catalog.rdf') && !localCopyAvailable ? false : actual.existsSync(p),
    },
  };
});

/** Carga el módulo con el estado de caché a cero en cada prueba. */
async function freshModule() {
  vi.resetModules();
  return import('../rdf-catalog');
}

/** RDF con `count` datasets, para probar recortes por tamaño en vez de por vacío. */
function buildRdf(count: number): string {
  const datasets = Array.from(
    { length: count },
    (_, i) => `
    <dcat:dataset>
      <dcat:Dataset rdf:about="https://datosabiertos.jcyl.es/set/es/x/${i}">
        <dct:title>Dataset ${i}</dct:title>
        <dct:description>Descripción</dct:description>
        <dct:issued>2024-01-01</dct:issued>
        <dcat:distribution>
          <dcat:Distribution>
            <dct:format><dct:IMT rdf:value="text/csv"/></dct:format>
            <dcat:accessURL>https://datosabiertos.jcyl.es/x/${i}.csv</dcat:accessURL>
          </dcat:Distribution>
        </dcat:distribution>
      </dcat:Dataset>
    </dcat:dataset>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dcat="http://www.w3.org/ns/dcat#"
         xmlns:dct="http://purl.org/dc/terms/">
  <dcat:Catalog>${datasets}
  </dcat:Catalog>
</rdf:RDF>`;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  localCopyAvailable = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getCatalog: caché ante fallos', () => {
  it('sirve el catálogo remoto cuando responde por encima del umbral mínimo', async () => {
    fetchMock.mockResolvedValue(new Response(buildRdf(600), { status: 200 }));
    const { getCatalog } = await freshModule();

    const catalog = await getCatalog();

    expect(catalog.datasets).toHaveLength(600);
    expect(catalog.source.origin).toBe('remote');
  });

  // Primer respaldo: la copia local del repositorio, que es dato real.
  it('cae a la copia local cuando el remoto no responde', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    const { getCatalog } = await freshModule();

    const catalog = await getCatalog();

    expect(catalog.source.origin).toBe('local');
    expect(catalog.datasets.length).toBeGreaterThan(100);
  });

  it('un remoto que responde pero muy por debajo de lo real cae a la copia local, incluso sin caché previa', async () => {
    // El recorte real del 15-sep-2026: 235 de ~840, servido con 200 y XML válido.
    fetchMock.mockResolvedValue(new Response(buildRdf(235), { status: 200 }));
    const { getCatalog } = await freshModule();

    const catalog = await getCatalog();

    expect(catalog.source.origin).toBe('local');
    expect(catalog.datasets.length).toBeGreaterThan(100);
  });

  it('mantiene el último catálogo bueno si no hay ninguna fuente disponible', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(buildRdf(600), { status: 200 }));
    const { getCatalog } = await freshModule();

    const primero = await getCatalog();
    expect(primero.datasets).toHaveLength(600);

    // Pasa la hora de revalidación y se caen las dos fuentes.
    vi.advanceTimersByTime(61 * 60 * 1000);
    fetchMock.mockRejectedValue(new Error('sin red'));
    localCopyAvailable = false;

    const segundo = await getCatalog();

    // Se sigue enseñando el dato bueno, no un catálogo vacío.
    expect(segundo.datasets).toHaveLength(600);
  });

  it('reintenta al minuto tras un fallo, no a la hora', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(buildRdf(600), { status: 200 }));
    const { getCatalog } = await freshModule();
    await getCatalog();

    vi.advanceTimersByTime(61 * 60 * 1000);
    fetchMock.mockRejectedValue(new Error('sin red'));
    localCopyAvailable = false;
    await getCatalog();
    const llamadasTrasFallo = fetchMock.mock.calls.length;

    // Un minuto después vuelve a intentarlo y recupera la fuente.
    vi.advanceTimersByTime(61 * 1000);
    fetchMock.mockResolvedValue(new Response(buildRdf(600), { status: 200 }));
    const recuperado = await getCatalog();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(llamadasTrasFallo);
    expect(recuperado.datasets).toHaveLength(600);
  });

  it('sin ninguna fuente y sin caché previa, devuelve vacío pero no lo memoriza', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    localCopyAvailable = false;
    const { getCatalog } = await freshModule();

    const vacio = await getCatalog();
    expect(vacio.datasets).toHaveLength(0);
    expect(vacio.source.origin).toBe('none');

    // El siguiente request vuelve a intentarlo: nada de esperar una hora.
    fetchMock.mockResolvedValue(new Response(buildRdf(600), { status: 200 }));
    const recuperado = await getCatalog();
    expect(recuperado.datasets).toHaveLength(600);
  });

  it('una respuesta 200 sin datasets cae a la copia local en vez de vaciar el catálogo bueno', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(buildRdf(600), { status: 200 }));
    const { getCatalog } = await freshModule();
    await getCatalog();

    // Página de error servida con código 200: se parsea, pero no trae datasets.
    vi.advanceTimersByTime(61 * 60 * 1000);
    fetchMock.mockResolvedValue(new Response('<html><body>Error</body></html>', { status: 200 }));

    const segundo = await getCatalog();
    expect(segundo.source.origin).toBe('local');
    expect(segundo.datasets.length).toBeGreaterThan(100);
  });

  it('un recorte que aún supera el umbral mínimo, pero está muy por debajo de lo último bueno, no sustituye al catálogo bueno', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(buildRdf(1200), { status: 200 }));
    const { getCatalog } = await freshModule();
    const primero = await getCatalog();
    expect(primero.datasets).toHaveLength(1200);

    // 550 supera el suelo absoluto (500), pero es menos de la mitad de 1200: se
    // descarta por el criterio relativo, no por el absoluto.
    vi.advanceTimersByTime(61 * 60 * 1000);
    fetchMock.mockResolvedValue(new Response(buildRdf(550), { status: 200 }));
    const segundo = await getCatalog();

    expect(segundo.datasets).toHaveLength(1200);
  });

  it('un descenso moderado (por encima del umbral relativo) sí se acepta como catálogo nuevo', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(buildRdf(1200), { status: 200 }));
    const { getCatalog } = await freshModule();
    await getCatalog();

    vi.advanceTimersByTime(61 * 60 * 1000);
    fetchMock.mockResolvedValue(new Response(buildRdf(700), { status: 200 }));
    const segundo = await getCatalog();

    expect(segundo.datasets).toHaveLength(700);
  });

  it('sin catálogo previo, acepta el primero si ya supera el umbral mínimo', async () => {
    fetchMock.mockResolvedValue(new Response(buildRdf(550), { status: 200 }));
    const { getCatalog } = await freshModule();

    const primero = await getCatalog();
    expect(primero.datasets).toHaveLength(550);
    expect(primero.source.origin).toBe('remote');
  });
});
