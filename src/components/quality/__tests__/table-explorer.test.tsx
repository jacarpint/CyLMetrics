// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TableExplorer } from '@/components/quality/table-explorer';

/**
 * El explorador de tablas, manejado como lo maneja quien no usa ratón.
 *
 * Es el primer test de componente del proyecto. La lógica de calidad estaba
 * cubierta por los dos lados —TypeScript y Python— y la interfaz no tenía nada,
 * así que un control podía dejar de ser pulsable sin que fallara nada. Pasó: la
 * selección de fila era `onClick` sobre un `<tr>`, sin `tabIndex` ni manejador de
 * teclado, y es lo que empareja una entidad del mapa con sus datos. La otra vía
 * —pulsar en el mapa— tampoco vale, porque las capas vectoriales de Leaflet no
 * son enfocables.
 */

const HEADER = ['Municipio', 'Habitantes'];
const ROWS = [
  ['Ávila', '58245'],
  ['Burgos', '175821'],
  ['León', '122051'],
];

function renderExplorer(props: Partial<React.ComponentProps<typeof TableExplorer>> = {}) {
  return render(<TableExplorer header={HEADER} rows={ROWS} voice="table" {...props} />);
}

describe('TableExplorer — selección de fila', () => {
  it('cada fila ofrece un control con nombre y estado', () => {
    renderExplorer({ onSelectRow: () => {}, selectedRow: null });

    const boton = screen.getByRole('button', { name: 'Fila 2' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
  });

  it('se puede seleccionar con el teclado, sin tocar el ratón', async () => {
    // La regresión que fija este test. Antes solo respondía a un clic.
    const user = userEvent.setup();
    const onSelectRow = vi.fn();
    renderExplorer({ onSelectRow, selectedRow: null });

    const boton = screen.getByRole('button', { name: 'Fila 2' });
    boton.focus();
    expect(boton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onSelectRow).toHaveBeenCalledWith(1);

    await user.keyboard(' ');
    expect(onSelectRow).toHaveBeenCalledTimes(2);
  });

  it('el estado seleccionado se anuncia, no solo se colorea', () => {
    renderExplorer({ onSelectRow: () => {}, selectedRow: 1 });

    expect(screen.getByRole('button', { name: 'Fila 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fila 1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('al pulsar una fila ya seleccionada, se deselecciona', async () => {
    const user = userEvent.setup();
    const onSelectRow = vi.fn();
    renderExplorer({ onSelectRow, selectedRow: 1 });

    await user.click(screen.getByRole('button', { name: 'Fila 2' }));
    expect(onSelectRow).toHaveBeenCalledWith(null);
  });

  it('un clic en el control no alterna dos veces', async () => {
    // La fila entera responde al ratón además del botón. Sin cortar la
    // propagación, el clic llegaba a los dos y la selección se quedaba igual.
    const user = userEvent.setup();
    const onSelectRow = vi.fn();
    renderExplorer({ onSelectRow, selectedRow: null });

    await user.click(screen.getByRole('button', { name: 'Fila 3' }));
    expect(onSelectRow).toHaveBeenCalledTimes(1);
    expect(onSelectRow).toHaveBeenCalledWith(2);
  });

  it('sin `onSelectRow` no hay control que confunda', () => {
    // El explorador de archivos no pasa `onSelectRow`: ahí las filas no son
    // seleccionables y el número tiene que ser texto, no un botón muerto.
    renderExplorer();

    expect(screen.queryByRole('button', { name: 'Fila 1' })).toBeNull();
    expect(screen.getByRole('table')).toHaveTextContent('Ávila');
  });

  it('el vocabulario cambia con el tipo de recurso', () => {
    // Un JSON tiene registros, no filas. La etiqueta del control lo sigue.
    renderExplorer({ voice: 'record', onSelectRow: () => {} });

    expect(screen.getByRole('button', { name: 'Registro 1' })).toBeTruthy();
  });
});

describe('TableExplorer — pestañas', () => {
  it('las flechas mueven el foco entre pestañas', async () => {
    const user = userEvent.setup();
    renderExplorer();

    const tablist = screen.getByRole('tablist', { name: 'Vistas del recurso' });
    const [datos, columnas] = within(tablist).getAllByRole('tab');

    expect(datos).toHaveAttribute('aria-selected', 'true');
    datos.focus();
    await user.keyboard('{ArrowRight}');

    expect(columnas).toHaveFocus();
    expect(columnas).toHaveAttribute('aria-selected', 'true');
  });

  it('cada pestaña declara el panel que gobierna', () => {
    renderExplorer();

    const tab = within(screen.getByRole('tablist', { name: 'Vistas del recurso' })).getAllByRole('tab')[0];
    const panel = screen.getByRole('tabpanel');
    expect(tab.getAttribute('aria-controls')).toBe(panel.getAttribute('id'));
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.getAttribute('id'));
  });
});
