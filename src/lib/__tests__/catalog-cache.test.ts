import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Comportamiento de la caché del catálogo ante un refresco fallido.
 *
 * El portal tiene que enseñar siempre el dato más actualizado que tenga. Antes,
 * cualquier fallo puntual —red caída, jcyl sin responder, XML corrupto— guardaba
 * un catálogo VACÍO durante la hora de revalidación: un parpadeo en el momento
 * justo dejaba «0 datasets» y medias al 0% durante sesenta minutos, teniendo el
 * dato bueno un segundo antes.
 */

const RDF_OK = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dcat="http://www.w3.org/ns/dcat#"
         xmlns:dct="http://purl.org/dc/terms/">
  <dcat:Catalog>
    <dcat:dataset>
      <dcat:Dataset rdf:about="https://datosabiertos.jcyl.es/set/es/x/111">
        <dct:title>Dataset de prueba</dct:title>
        <dct:description>Descripción</dct:description>
        <dct:issued>2024-01-01</dct:issued>
        <dcat:distribution>
          <dcat:Distribution>
            <dct:format><dct:IMT rdf:value="text/csv"/></dct:format>
            <dcat:accessURL>https://datosabiertos.jcyl.es/x/111.csv</dcat:accessURL>
          </dcat:Distribution>
        </dcat:distribution>
      </dcat:Dataset>
    </dcat:dataset>
  </dcat:Catalog>
</rdf:RDF>`;

/**
 * La copia local (`src/data/rdf-catalog.rdf`) es el primer respaldo cuando el
 * remoto falla, y trae el catálogo completo. Para probar el último eslabón —qué
 * pasa cuando NO hay ni remoto ni copia local— hay que poder desactivarla.
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
  it('sirve el catálogo remoto cuando responde', async () => {
    fetchMock.mockResolvedValue(new Response(RDF_OK, { status: 200 }));
    const { getCatalog } = await freshModule();

    const catalog = await getCatalog();

    expect(catalog.datasets).toHaveLength(1);
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

  it('mantiene el último catálogo bueno si no hay ninguna fuente disponible', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(RDF_OK, { status: 200 }));
    const { getCatalog } = await freshModule();

    const primero = await getCatalog();
    expect(primero.datasets).toHaveLength(1);

    // Pasa la hora de revalidación y se caen las dos fuentes.
    vi.advanceTimersByTime(61 * 60 * 1000);
    fetchMock.mockRejectedValue(new Error('sin red'));
    localCopyAvailable = false;

    const segundo = await getCatalog();

    // Se sigue enseñando el dato bueno, no un catálogo vacío.
    expect(segundo.datasets).toHaveLength(1);
    expect(segundo.datasets[0].title).toBe('Dataset de prueba');
  });

  it('reintenta al minuto tras un fallo, no a la hora', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(RDF_OK, { status: 200 }));
    const { getCatalog } = await freshModule();
    await getCatalog();

    vi.advanceTimersByTime(61 * 60 * 1000);
    fetchMock.mockRejectedValue(new Error('sin red'));
    localCopyAvailable = false;
    await getCatalog();
    const llamadasTrasFallo = fetchMock.mock.calls.length;

    // Un minuto después vuelve a intentarlo y recupera la fuente.
    vi.advanceTimersByTime(61 * 1000);
    fetchMock.mockResolvedValue(new Response(RDF_OK, { status: 200 }));
    const recuperado = await getCatalog();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(llamadasTrasFallo);
    expect(recuperado.datasets).toHaveLength(1);
  });

  it('sin ninguna fuente y sin caché previa, devuelve vacío pero no lo memoriza', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    localCopyAvailable = false;
    const { getCatalog } = await freshModule();

    const vacio = await getCatalog();
    expect(vacio.datasets).toHaveLength(0);
    expect(vacio.source.origin).toBe('none');

    // El siguiente request vuelve a intentarlo: nada de esperar una hora.
    fetchMock.mockResolvedValue(new Response(RDF_OK, { status: 200 }));
    const recuperado = await getCatalog();
    expect(recuperado.datasets).toHaveLength(1);
  });

  it('una respuesta 200 sin datasets no sustituye al catálogo bueno', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(RDF_OK, { status: 200 }));
    const { getCatalog } = await freshModule();
    await getCatalog();

    // Página de error servida con código 200: se parsea, pero no trae datasets.
    vi.advanceTimersByTime(61 * 60 * 1000);
    fetchMock.mockResolvedValue(new Response('<html><body>Error</body></html>', { status: 200 }));

    const segundo = await getCatalog();
    expect(segundo.datasets).toHaveLength(1);
  });
});
