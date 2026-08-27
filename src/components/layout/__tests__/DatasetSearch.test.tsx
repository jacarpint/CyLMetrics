// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatasetSearch } from '@/components/layout/DatasetSearch';

/**
 * El buscador del catálogo, manejado sin ratón y leído por un lector de pantalla.
 *
 * Implementa el patrón combobox de ARIA: un campo de texto que gobierna una
 * lista y anuncia cuál de sus opciones está resaltada. El patrón solo funciona si
 * las relaciones que declara son ciertas, y tenía dos que no lo eran:
 *
 *   - los hijos de `listbox` han de ser `option`, y había un `<li>` por medio;
 *   - `aria-controls` apuntaba a la lista en cuanto se abría el desplegable, pero
 *     con cero resultados esa lista no se pinta y la referencia quedaba colgando
 *     de un id inexistente.
 *
 * Ninguna de las dos rompe nada visible, que es precisamente por lo que necesitan
 * un test: se arreglan una vez y se vuelven a colar en el siguiente rediseño.
 */

const SUGERENCIAS = [
  { slug: 'padron-municipal', title: 'Padrón municipal de habitantes', category: 'Demografía', formats: ['CSV', 'XLSX'], scores: { overall: 92 } },
  { slug: 'centros-educativos', title: 'Centros educativos', category: 'Educación', formats: ['CSV'], scores: { overall: 78 } },
];

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function responder(datasets: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ datasets }),
  } as unknown as Response);
}

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function escribir(texto: string, datasets: unknown[] = SUGERENCIAS) {
  vi.stubGlobal('fetch', responder(datasets));
  const user = userEvent.setup();
  render(<DatasetSearch variant="mobile" />);
  const campo = screen.getByRole('combobox', { name: 'Buscar conjuntos de datos' });
  await user.type(campo, texto);
  return { user, campo };
}

describe('DatasetSearch — el patrón combobox', () => {
  it('las sugerencias se exponen como opciones de la lista', async () => {
    await escribir('padron');

    const lista = await screen.findByRole('listbox', { name: 'Conjuntos de datos sugeridos' });
    const opciones = await screen.findAllByRole('option');

    expect(opciones).toHaveLength(2);
    for (const opcion of opciones) expect(lista).toContainElement(opcion);

    // La regresión que fija este test, comprobada sobre la ESTRUCTURA y no
    // buscando un `role="listitem"` explícito: el `<li>` no lo lleva escrito, lo
    // tiene implícito por ser un `<li>`, así que buscar el atributo pasaría
    // igual con el defecto puesto. Lo que hay que exigir es que cada hijo
    // directo de la lista sea una opción o esté neutralizado.
    const hijos = [...lista.children];
    expect(hijos).toHaveLength(2);
    for (const hijo of hijos) {
      const rol = hijo.getAttribute('role');
      expect(['option', 'presentation', 'none'], `<${hijo.tagName.toLowerCase()} role="${rol}">`)
        .toContain(rol);
    }
  });

  it('aria-controls solo apunta a la lista cuando la lista existe', async () => {
    const { campo } = await escribir('nada-de-esto', []);

    await waitFor(() => {
      expect(screen.getByText('Ningún conjunto de datos coincide.')).toBeInTheDocument();
    });

    const referencia = campo.getAttribute('aria-controls');
    expect(referencia, 'sin resultados no hay lista que controlar').toBeNull();
  });

  it('con resultados, aria-controls apunta a un id que está en el documento', async () => {
    const { campo } = await escribir('padron');
    await screen.findAllByRole('option');

    const referencia = campo.getAttribute('aria-controls');

    expect(referencia).toBeTruthy();
    expect(document.getElementById(referencia!), referencia!).not.toBeNull();
  });
});

describe('DatasetSearch — manejo con teclado', () => {
  it('las flechas mueven el resaltado y lo anuncian con aria-activedescendant', async () => {
    const { user, campo } = await escribir('padron');
    await screen.findAllByRole('option');

    await user.keyboard('{ArrowDown}');

    const primera = screen.getAllByRole('option')[0];
    expect(primera).toHaveAttribute('aria-selected', 'true');
    expect(campo).toHaveAttribute('aria-activedescendant', primera.id);
  });

  it('el recorrido es circular en los dos sentidos', async () => {
    const { user } = await escribir('padron');
    await screen.findAllByRole('option');

    // Flecha arriba desde ninguna posición entra por la última.
    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    // Y sigue girando.
    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter con una sugerencia resaltada abre ese conjunto de datos', async () => {
    const { user } = await escribir('padron');
    await screen.findAllByRole('option');

    await user.keyboard('{ArrowDown}{Enter}');

    expect(push).toHaveBeenCalledWith('/catalogo/padron-municipal');
  });

  it('Enter sin nada resaltado busca en el catálogo completo', async () => {
    const { user } = await escribir('padron');
    await screen.findAllByRole('option');

    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/catalogo?q=padron');
  });

  it('Escape cierra el desplegable sin navegar', async () => {
    const { user } = await escribir('padron');
    await screen.findAllByRole('option');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('option')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('DatasetSearch — cuando la red falla', () => {
  it('el formulario sigue llevando al catálogo', async () => {
    // Un fallo de red no puede dejar el buscador inservible: el catálogo filtra
    // en servidor y esa vía tiene que seguir abierta.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
    const user = userEvent.setup();
    render(<DatasetSearch variant="mobile" />);
    const campo = screen.getByRole('combobox', { name: 'Buscar conjuntos de datos' });

    await user.type(campo, 'padron');
    await waitFor(() => {
      expect(screen.getByText('Ningún conjunto de datos coincide.')).toBeInTheDocument();
    });
    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/catalogo?q=padron');
  });

  it('deja de parecer que carga', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
    const user = userEvent.setup();
    render(<DatasetSearch variant="mobile" />);

    await user.type(screen.getByRole('combobox', { name: 'Buscar conjuntos de datos' }), 'padron');

    await waitFor(() => {
      expect(screen.queryByText('Buscando…')).toBeNull();
    });
  });
});
