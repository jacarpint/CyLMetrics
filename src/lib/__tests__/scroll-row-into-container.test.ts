import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrollRowIntoContainer } from '@/components/quality/table-explorer';

/**
 * El desplazamiento de la tabla al seleccionar una entidad en el mapa.
 *
 * Antes esto era `activeRowRef.current.scrollIntoView({block: 'center'})`, que
 * desplaza a TODOS los ancestros hasta el documento: al pulsar una entidad la
 * ventana daba un salto y, como el mapa mide 460 px y la tabla va justo debajo,
 * centrar la fila sacaba de la pantalla el mapa que se acababa de pulsar.
 *
 * Lo que se fija aquí es que el desplazamiento se queda en el contenedor. jsdom no
 * calcula diseño, así que los elementos se simulan: la función solo usa
 * `getBoundingClientRect`, `scrollTop`, `clientHeight` y `scrollTo`.
 */
function fakeContainer({ scrollTop = 0, clientHeight = 400, top = 0 } = {}) {
  const scrollTo = vi.fn();
  return {
    scrollTop,
    clientHeight,
    scrollTo,
    getBoundingClientRect: () => ({ top, height: clientHeight }),
  } as unknown as HTMLElement & { scrollTo: ReturnType<typeof vi.fn> };
}

/** `top` es la posición en pantalla, como la devuelve el navegador. */
function fakeRow({ top = 0, height = 24 } = {}) {
  return {
    getBoundingClientRect: () => ({ top, height }),
  } as unknown as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Simula la preferencia de movimiento del sistema.
 *
 * Se sustituye `window` entero, no solo `matchMedia`: estos tests corren con
 * `environment: 'node'`, donde no hay `window`, y la función comprueba primero que
 * exista. Sin esto la rama de movimiento reducido no se ejecutaba nunca y las
 * comprobaciones de `behavior: 'smooth'` pasaban por el motivo equivocado.
 */
function stubMotion(reduce: boolean) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
    }),
  });
}

describe('scrollRowIntoContainer', () => {
  it('no toca nada si falta el contenedor o la fila', () => {
    expect(() => scrollRowIntoContainer(null, fakeRow())).not.toThrow();
    const container = fakeContainer();
    scrollRowIntoContainer(container, null);
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  /** Lo importante: mover el contenedor, no la ventana. */
  it('desplaza el contenedor y nunca el documento', () => {
    stubMotion(false);
    const scrollIntoView = vi.fn();
    const container = fakeContainer({ clientHeight: 400 });
    const row = fakeRow({ top: 900 });
    Object.assign(row, { scrollIntoView });

    scrollRowIntoContainer(container, row);

    expect(container.scrollTo).toHaveBeenCalledTimes(1);
    // Si esto se llamara, arrastraría a la ventana con él.
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * Una fila que ya se ve no se mueve. Desplazar por desplazar es otra versión del
   * mismo problema: la tabla se movía sola con la fila ya delante.
   */
  it('no desplaza una fila que ya está visible', () => {
    stubMotion(false);
    const container = fakeContainer({ clientHeight: 400, scrollTop: 0, top: 0 });
    scrollRowIntoContainer(container, fakeRow({ top: 200, height: 24 }));
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('sí desplaza una fila que queda por debajo del contenedor', () => {
    stubMotion(false);
    const container = fakeContainer({ clientHeight: 400, scrollTop: 0, top: 0 });
    scrollRowIntoContainer(container, fakeRow({ top: 1200, height: 24 }));
    expect(container.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' })
    );
  });

  it('centra la fila descontando el encabezado fijo', () => {
    stubMotion(false);
    const container = fakeContainer({ clientHeight: 400, scrollTop: 0, top: 0 });
    // offsetTop = 1000. Alto útil = 400 - 40 = 360.
    // top = 1000 - 40 - (360 - 24) / 2 = 1000 - 40 - 168 = 792.
    scrollRowIntoContainer(container, fakeRow({ top: 1000, height: 24 }), 40);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 792, behavior: 'smooth' });
  });

  /**
   * Una fila tapada por el encabezado fijo cuenta como no visible: sin descontar
   * su alto, la fila quedaba «centrada» y debajo de los nombres de columna.
   */
  it('una fila escondida bajo el encabezado fijo se recoloca', () => {
    stubMotion(false);
    const container = fakeContainer({ clientHeight: 400, scrollTop: 100, top: 0 });
    // offsetTop = 120, que es menor que scrollTop + headerHeight = 140.
    scrollRowIntoContainer(container, fakeRow({ top: 20, height: 24 }), 40);
    expect(container.scrollTo).toHaveBeenCalled();
  });

  it('nunca pide un desplazamiento negativo', () => {
    stubMotion(false);
    const container = fakeContainer({ clientHeight: 400, scrollTop: 300, top: 0 });
    scrollRowIntoContainer(container, fakeRow({ top: -280, height: 24 }));
    const [{ top }] = container.scrollTo.mock.calls[0] as [{ top: number }];
    expect(top).toBeGreaterThanOrEqual(0);
  });

  /**
   * La regla CSS `scroll-behavior: auto` de `globals.css` no afecta a un
   * desplazamiento programático con `behavior: 'smooth'`, así que la preferencia
   * hay que consultarla aquí.
   */
  it('respeta «reducir movimiento»', () => {
    stubMotion(true);
    const container = fakeContainer({ clientHeight: 400 });
    scrollRowIntoContainer(container, fakeRow({ top: 1200 }));
    expect(container.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' })
    );
  });
});
