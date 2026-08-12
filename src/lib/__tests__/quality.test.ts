import { describe, it, expect } from 'vitest';
import {
  compositeScore,
  getScoreBorderColor,
  getScoreColor,
  getScoreLabel,
  getScoreLevel,
  getScoreStroke,
  timeAgo,
} from '../quality';

describe('compositeScore', () => {
  it('sin análisis, no se puede afirmar nada de los archivos: manda el metadato', () => {
    expect(compositeScore({ metadata: 80, availability: null, content: null })).toBe(80);
    expect(compositeScore({ metadata: null, availability: null, content: null })).toBeNull();
  });

  it('pondera los tres ejes 40/30/30', () => {
    expect(compositeScore({ metadata: 100, availability: 100, content: 100 })).toBe(100);
    expect(compositeScore({ metadata: 80, availability: 60, content: 40 })).toBe(62);
  });

  /**
   * El fallo que motivó el cambio: con la fórmula anterior, un dataset con
   * metadatos perfectos y ningún archivo abrible puntuaba 100.
   */
  it('un dataset analizado sin ningún archivo utilizable no puede puntuar alto', () => {
    expect(compositeScore({ metadata: 100, availability: 0, content: null })).toBe(40);
    expect(compositeScore({ metadata: 100, availability: 0, content: 0 })).toBe(40);
  });

  it('contenido nulo con archivos que sí abren cuenta como cero, no se ignora', () => {
    expect(compositeScore({ metadata: 100, availability: 100, content: null })).toBe(70);
  });

  it('redondea a entero', () => {
    expect(compositeScore({ metadata: 75, availability: 80, content: 77 })).toBe(77);
  });
});

// Los helpers devuelven tokens semánticos (`text-ok`, `var(--bad-solid)`…) en
// lugar de tonos fijos de Tailwind, para que el color voltee con el tema. Lo
// que se comprueba aquí son los umbrales, no el tono concreto.
describe('getScoreLevel', () => {
  it('marca ok a partir de 80', () => {
    expect(getScoreLevel(80)).toBe('ok');
    expect(getScoreLevel(100)).toBe('ok');
  });

  it('marca warn entre 50 y 79', () => {
    expect(getScoreLevel(50)).toBe('warn');
    expect(getScoreLevel(79)).toBe('warn');
  });

  it('marca bad por debajo de 50', () => {
    expect(getScoreLevel(49)).toBe('bad');
    expect(getScoreLevel(0)).toBe('bad');
  });
});

describe('helpers de color del score', () => {
  it('usan el mismo umbral en texto, borde y trazo', () => {
    expect(getScoreColor(85)).toBe('text-ok');
    expect(getScoreBorderColor(85)).toBe('border-ok-solid');
    expect(getScoreStroke(85)).toBe('var(--ok-solid)');

    expect(getScoreColor(60)).toBe('text-warn');
    expect(getScoreBorderColor(60)).toBe('border-warn-solid');
    expect(getScoreStroke(60)).toBe('var(--warn-solid)');

    expect(getScoreColor(10)).toBe('text-bad');
    expect(getScoreBorderColor(10)).toBe('border-bad-solid');
    expect(getScoreStroke(10)).toBe('var(--bad-solid)');
  });

  it('acompaña el color con una etiqueta textual (WCAG 1.4.1)', () => {
    expect(getScoreLabel(90)).toBe('Buena');
    expect(getScoreLabel(65)).toBe('Mejorable');
    expect(getScoreLabel(20)).toBe('Deficiente');
  });
});

describe('timeAgo', () => {
  const ref = new Date('2025-01-01T12:00:00Z');

  it('handles invalid dates', () => {
    expect(timeAgo('not-a-date', ref)).toBe('desconocido');
  });

  it('returns "futuro" for future dates', () => {
    expect(timeAgo('2025-01-01T13:00:00Z', ref)).toBe('futuro');
  });

  it('returns minutes label', () => {
    const past = new Date(ref.getTime() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(past, ref)).toBe('hace 5 min');
  });

  it('returns days label', () => {
    const past = new Date(ref.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(past, ref)).toBe('hace 3 días');
  });

  it('uses singular for 1 day', () => {
    const past = new Date(ref.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(past, ref)).toBe('hace 1 día');
  });

  it('returns years label', () => {
    const past = new Date(ref.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(past, ref)).toContain('año');
  });
});
