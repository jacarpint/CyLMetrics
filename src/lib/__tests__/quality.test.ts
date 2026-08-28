import { describe, it, expect } from 'vitest';
import {
  METADATA_WEIGHTS,
  SCORE_LEVELS,
  SCORE_THRESHOLDS,
  SCORE_WEIGHTS,
  compositeScore,
  getScoreBorderColor,
  getScoreColor,
  getScoreLabel,
  getScoreLevel,
  getScoreStroke,
  timeAgo,
} from '../quality';

/**
 * Los pesos y los umbrales los publica la página de Metodología leyéndolos de
 * aquí. Estas comprobaciones no verifican una fórmula concreta: verifican que la
 * tabla siga siendo coherente si alguien revisa la escala, que es justo lo que
 * antes podía romperse en silencio porque cada consumidor tenía su copia.
 */
describe('coherencia de pesos y umbrales', () => {
  it('los tres ejes del índice suman el 100%', () => {
    const total = SCORE_WEIGHTS.metadata + SCORE_WEIGHTS.availability + SCORE_WEIGHTS.content;
    expect(total).toBeCloseTo(1, 10);
  });

  it('los cuatro factores de metadatos suman el 100%', () => {
    const total =
      METADATA_WEIGHTS.completeness +
      METADATA_WEIGHTS.formats +
      METADATA_WEIGHTS.freshness +
      METADATA_WEIGHTS.license;
    expect(total).toBeCloseTo(1, 10);
  });

  it('los tres tramos cubren 0-100 sin huecos ni solapes', () => {
    expect(SCORE_LEVELS[0].min).toBe(0);
    expect(SCORE_LEVELS.at(-1)!.max).toBe(100);
    for (let i = 1; i < SCORE_LEVELS.length; i++) {
      expect(SCORE_LEVELS[i].min).toBe(SCORE_LEVELS[i - 1].max + 1);
    }
  });

  it('las anchuras de los tramos suman exactamente la barra, sin desbordarla', () => {
    expect(SCORE_LEVELS.reduce((sum, band) => sum + band.width, 0)).toBe(100);
  });

  it('cada tramo es tan ancho como la parte de la escala que abarca', () => {
    // «Deficiente» cubre media escala; «buena», una quinta parte.
    expect(SCORE_LEVELS.map((band) => band.width)).toEqual([50, 30, 20]);
  });

  it('cada tramo se clasifica en su propio nivel en los dos extremos', () => {
    for (const band of SCORE_LEVELS) {
      expect(getScoreLevel(band.min), `min de ${band.level}`).toBe(band.level);
      expect(getScoreLevel(band.max), `max de ${band.level}`).toBe(band.level);
    }
  });

  it('la etiqueta del tramo es la que devuelve getScoreLabel', () => {
    for (const band of SCORE_LEVELS) {
      expect(getScoreLabel(band.min)).toBe(band.label);
    }
  });

  /** Una clase compuesta en ejecución sale sin estilo: Tailwind no la genera. */
  it('las clases de relleno son literales de Tailwind, no plantillas', () => {
    expect(SCORE_LEVELS.map((band) => band.fill)).toEqual([
      'bg-bad-solid',
      'bg-warn-solid',
      'bg-ok-solid',
    ]);
  });

  it('los umbrales publicados son los que aplica la clasificación', () => {
    expect(getScoreLevel(SCORE_THRESHOLDS.ok)).toBe('ok');
    expect(getScoreLevel(SCORE_THRESHOLDS.ok - 1)).toBe('warn');
    expect(getScoreLevel(SCORE_THRESHOLDS.warn)).toBe('warn');
    expect(getScoreLevel(SCORE_THRESHOLDS.warn - 1)).toBe('bad');
  });
});

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

/**
 * La puerta de disponibilidad: para ser «Buena» hay que tener la disponibilidad
 * en «Buena».
 *
 * Sin ella la ponderación 40/30/30 dejaba pasar como «Buena» un conjunto con
 * archivos inservibles, porque un sumando del 30% lo compensan los otros dos. Es
 * el mismo defecto que el portal denuncia en los observatorios que solo miden
 * fichas, y por eso importa más que por los conjuntos a los que alcanza: en el
 * informe del 27 de agosto eran 11 de 831.
 *
 * Los umbrales salen de `SCORE_THRESHOLDS` y no escritos a mano: la regla es que
 * el mismo número gobierna los dos lados, así que fijarlo aquí en 80 dejaría el
 * test pasando si alguien mueve el umbral y la puerta se desalinea.
 */
describe('compositeScore — la disponibilidad como techo, no solo como sumando', () => {
  const { ok } = SCORE_THRESHOLDS;

  it('con la disponibilidad por debajo del umbral, la nota no llega a «Buena»', () => {
    // El caso que la aritmética permitía: la mitad del conjunto no abre y aun
    // así salía 85. Ahora tope en 79, que ya es «Mejorable».
    const score = compositeScore({ metadata: 100, availability: 50, content: 100 })!;
    expect(score).toBe(ok - 1);
    expect(getScoreLevel(score)).not.toBe('ok');
  });

  it('justo en el umbral la disponibilidad no estorba', () => {
    // 80% de disponibilidad ya es «Buena» por sí misma, así que no topa nada y
    // la nota sale íntegra de la ponderación.
    expect(compositeScore({ metadata: 100, availability: ok, content: 100 })).toBe(94);
  });

  it('un punto por debajo del umbral, sí topa', () => {
    expect(compositeScore({ metadata: 100, availability: ok - 1, content: 100 })).toBe(ok - 1);
  });

  it('la puerta topa, no penaliza: si la nota ya era baja, la deja donde estaba', () => {
    // Es un techo y no un descuento. Con la ponderación por debajo del tope, el
    // resultado tiene que ser idéntico al de antes de existir la puerta.
    expect(compositeScore({ metadata: 80, availability: 60, content: 40 })).toBe(62);
    expect(compositeScore({ metadata: 100, availability: 0, content: 0 })).toBe(40);
  });

  it('no se aplica cuando no hay disponibilidad medida', () => {
    // `null` es «no lo comprobamos», y de ahí no se puede deducir un tope: eso
    // convertiría el hueco de cobertura del análisis en una penalización.
    expect(compositeScore({ metadata: 100, availability: null, content: null })).toBe(100);
  });

  it('solo cierra el tramo alto: los otros dos niveles siguen alcanzables', () => {
    // «Deficiente» y «Mejorable» no afirman nada tranquilizador, así que la
    // puerta no tiene nada que impedir ahí.
    const warn = compositeScore({ metadata: 100, availability: 40, content: 60 })!;
    expect(getScoreLevel(warn)).toBe('warn');
    const bad = compositeScore({ metadata: 20, availability: 10, content: 10 })!;
    expect(getScoreLevel(bad)).toBe('bad');
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
