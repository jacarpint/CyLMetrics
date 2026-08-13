import { describe, it, expect } from 'vitest';
import { periodicityLabel } from '../vocabularies';
import { formatLongDate } from '../quality-labels';

/**
 * Esta etiqueta estaba escrita dos veces, una por página, y las dos versiones no
 * coincidían: el mismo conjunto con periodicidad inferior al mes salía como
 * «Continua» en su ficha y «diaria» en el informe de calidad.
 */
describe('periodicityLabel', () => {
  it('traduce las periodicidades declaradas del catálogo', () => {
    expect(periodicityLabel(1)).toBe('mensual');
    expect(periodicityLabel(3)).toBe('trimestral');
    expect(periodicityLabel(6)).toBe('semestral');
    expect(periodicityLabel(12)).toBe('anual');
  });

  it('capitaliza cuando se pinta como valor de un campo', () => {
    expect(periodicityLabel(1, { capitalized: true })).toBe('Mensual');
    expect(periodicityLabel(12, { capitalized: true })).toBe('Anual');
  });

  /**
   * Por debajo del mes el catálogo no dice cada cuánto exactamente, así que no se
   * puede afirmar «diaria»: se dice solo lo que consta.
   */
  it('por debajo del mes no inventa el intervalo', () => {
    expect(periodicityLabel(0.5)).toBe('más de una vez al mes');
    expect(periodicityLabel(0.03)).toBe('más de una vez al mes');
  });

  it('una periodicidad sin nombre propio se redacta en meses', () => {
    expect(periodicityLabel(4)).toBe('cada 4 meses');
    expect(periodicityLabel(24)).toBe('cada 24 meses');
    // Redondeada: «cada 2,4 meses» no significa nada para quien lo lee.
    expect(periodicityLabel(2.4)).toBe('cada 2 meses');
  });

  it('sin periodicidad declarada devuelve null, no una cadena vacía', () => {
    expect(periodicityLabel(null)).toBeNull();
    expect(periodicityLabel(undefined)).toBeNull();
    expect(periodicityLabel(0)).toBeNull();
    expect(periodicityLabel(-3)).toBeNull();
  });

  it('las dos redacciones dicen lo mismo salvo la mayúscula', () => {
    for (const months of [1, 3, 6, 12, 0.5, 7]) {
      const plain = periodicityLabel(months)!;
      const capitalized = periodicityLabel(months, { capitalized: true })!;
      expect(capitalized.toLowerCase()).toBe(plain);
    }
  });
});

describe('formatLongDate', () => {
  it('escribe la fecha en castellano largo', () => {
    expect(formatLongDate('2022-03-01')).toBe('1 de marzo de 2022');
  });

  it('acepta una marca de tiempo completa', () => {
    expect(formatLongDate('2026-08-10T13:18:40+00:00')).toContain('de agosto de 2026');
  });

  /** Antes se pintaba la cadena ISO en crudo, que no es una fecha legible. */
  it('una fecha ilegible devuelve null en vez de volcarla tal cual', () => {
    expect(formatLongDate('no es una fecha')).toBeNull();
  });

  it('sin fecha devuelve null', () => {
    expect(formatLongDate(null)).toBeNull();
    expect(formatLongDate(undefined)).toBeNull();
    expect(formatLongDate('')).toBeNull();
  });
});
