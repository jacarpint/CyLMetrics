/**
 * Preparación de los tests que necesitan un DOM.
 *
 * Solo se carga cuando el fichero de test pide `@vitest-environment jsdom`; los
 * de lógica pura siguen en `node`, que es bastante más rápido y es donde están
 * los 487 que ya había.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import { configure } from '@testing-library/dom';

/**
 * Desmontar entre tests.
 *
 * Testing Library solo lo hace sola si `globals: true`, y aquí no lo está: los
 * tests importan `describe`/`it` explícitamente. Sin esto, cada `render` deja su
 * árbol en el documento y las consultas empiezan a encontrar nodos de tests
 * anteriores, con fallos que dependen del orden de ejecución.
 */
afterEach(cleanup);

/**
 * Los mensajes de error citan el rol y el nombre accesible, no el HTML entero.
 *
 * Con el volcado completo, un fallo en el explorador de tablas escupía cientos
 * de líneas de marcado y había que buscar el dato dentro.
 */
configure({ getElementError: (message) => new Error(message ?? 'elemento no encontrado') });

/**
 * `matchMedia` no existe en jsdom y varios componentes lo consultan (el tema, y
 * los que deciden si pintar la versión compacta). Devuelve siempre «no coincide»,
 * que es el caso de escritorio y el que los tests dan por supuesto.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

/** Tampoco existen, y los usan el explorador de tablas y los visores. */
for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
  if (!(name in window)) {
    // @ts-expect-error — sustituto mínimo: los tests no comprueban el redimensionado.
    window[name] = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

/** jsdom no implementa `scrollIntoView`, y la tabla lo llama al seleccionar fila. */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

export { expect };
