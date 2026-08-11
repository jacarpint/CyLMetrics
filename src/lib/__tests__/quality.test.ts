import { describe, it, expect } from 'vitest';
import {
  combineScore,
  getScoreColor,
  getScoreFill,
  getScoreLabel,
  getScoreLevel,
  getScoreStroke,
  timeAgo,
} from '../quality';

describe('combineScore', () => {
  it('returns null when both are null', () => {
    expect(combineScore(null, null)).toBeNull();
  });

  it('returns metadata score when content is null', () => {
    expect(combineScore(80, null)).toBe(80);
  });

  it('returns content score when metadata is null', () => {
    expect(combineScore(null, 70)).toBe(70);
  });

  it('returns 50/50 weighted average when both are present', () => {
    expect(combineScore(80, 60)).toBe(70);
    expect(combineScore(100, 0)).toBe(50);
  });

  it('rounds to integer', () => {
    expect(combineScore(75, 80)).toBe(78);
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
  it('usan el mismo umbral en clase, relleno y trazo', () => {
    expect(getScoreColor(85)).toBe('text-ok');
    expect(getScoreFill(85)).toBe('bg-ok-solid');
    expect(getScoreStroke(85)).toBe('var(--ok-solid)');

    expect(getScoreColor(60)).toBe('text-warn');
    expect(getScoreFill(60)).toBe('bg-warn-solid');
    expect(getScoreStroke(60)).toBe('var(--warn-solid)');

    expect(getScoreColor(10)).toBe('text-bad');
    expect(getScoreFill(10)).toBe('bg-bad-solid');
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
