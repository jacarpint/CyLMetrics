import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTENT_BULK_THRESHOLD,
  CONTENT_ERROR_CAP,
  CONTENT_PENALTIES,
  CONTENT_START,
} from '@/data/content-scoring';

/**
 * La fórmula de contenido que publica Metodología es la que aplica el análisis.
 *
 * Mismo motivo que `pipeline-limits.test.ts`: las cifras viven en Python y hay
 * que reescribirlas para publicarlas, así que nada impide que envejezcan en
 * silencio. Ya pasó con el tope de descarga, que estuvo publicándose como 25 MB
 * cuando el análisis usaba 512.
 *
 * Se contrasta contra `_score_from_issues`, que es la única función que puntúa
 * contenido tabular.
 */
const TABULAR_PY = fs.readFileSync(
  path.join(process.cwd(), 'src', 'analysis', 'formats', 'tabular.py'),
  'utf-8'
);

/** El cuerpo de `_score_from_issues`, para no buscar cifras por todo el fichero. */
function scoreFunctionBody(): string {
  const match = /def _score_from_issues\([\s\S]*?\n(?=\S|def )/.exec(TABULAR_PY);
  if (!match) throw new Error('No se encuentra _score_from_issues en tabular.py');
  return match[0];
}

const BODY = scoreFunctionBody();

describe('la fórmula de contenido publicada es la que aplica el analizador', () => {
  it('parte de 100 y queda acotada entre 0 y 100', () => {
    expect(BODY).toContain(`score = ${CONTENT_START} -`);
    expect(BODY).toMatch(/return max\(0, min\(100, score\)\)/);
  });

  it('el descuento por tipo grave y su tope son los publicados', () => {
    const grave = CONTENT_PENALTIES[0];
    // score = 100 - min(60, 15 * len([...error...]))
    const re = new RegExp(
      `min\\(\\s*${CONTENT_ERROR_CAP}\\s*,\\s*${grave.points}\\s*\\*\\s*len\\(`
    );
    expect(BODY).toMatch(re);
  });

  it('el descuento por tipo leve es el publicado', () => {
    const leve = CONTENT_PENALTIES[1];
    const re = new RegExp(`score -= ${leve.points} \\* len\\(`);
    expect(BODY).toMatch(re);
  });

  it('el descuento por volumen y su umbral son los publicados', () => {
    const bulk = CONTENT_PENALTIES[2];
    expect(BODY).toMatch(new RegExp(`errors > ${CONTENT_BULK_THRESHOLD}`));
    expect(BODY).toMatch(new RegExp(`score -= ${bulk.points}`));
  });

  /**
   * Que el descuento se cuente por TIPOS y no por casos es la decisión que la
   * página defiende en prosa, así que conviene que el test también la sujete:
   * `len([...])` cuenta incidencias distintas; `sum(i["count"])` contaría casos.
   */
  it('los descuentos se cuentan por tipos de incidencia, no por ocurrencias', () => {
    expect(BODY).toMatch(/len\(\[i for i in issues if i\["severity"\] == "error"\]\)/);
    expect(BODY).toMatch(/len\(\[i for i in issues if i\["severity"\] == "warning"\]\)/);
  });
});
