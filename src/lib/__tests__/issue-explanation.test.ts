import { describe, it, expect } from 'vitest';
import { ISSUE_LABELS, issueExplanation, issueLabel } from '@/lib/quality-labels';

/**
 * La explicación vivía dentro del explorador de incidencias y cubría 18 de los
 * 54 códigos. Los 36 restantes se desplegaban sin explicación y el hueco no se
 * veía: el recuadro simplemente no se pintaba. Este fichero existe para que
 * añadir una etiqueta sin su explicación rompa el build en vez de dejar otro
 * hueco invisible.
 */
describe('issueExplanation', () => {
  it('cubre todos los códigos que tienen etiqueta', () => {
    const sinExplicacion = Object.keys(ISSUE_LABELS).filter((code) => issueExplanation(code) === null);
    expect(sinExplicacion).toEqual([]);
  });

  it('devuelve null para un código desconocido, para que no se pinte el recuadro', () => {
    expect(issueExplanation('codigo-que-no-existe')).toBeNull();
    expect(issueExplanation('')).toBeNull();
  });

  it('no repite la etiqueta: explica, no rotula', () => {
    for (const code of Object.keys(ISSUE_LABELS)) {
      expect(issueExplanation(code)).not.toBe(issueLabel(code));
    }
  });

  it('está escrita en llano, sin la jerga de la tabla anterior', () => {
    // Las palabras que tenía la versión que vivía en el componente.
    const jerga = /\bparser|\bjoin|timeout|\b404\b|indexar|Verifique|magic bytes/i;
    const conJerga = Object.keys(ISSUE_LABELS).filter((code) => jerga.test(issueExplanation(code) ?? ''));
    expect(conJerga).toEqual([]);
  });

  it('dice algo, no una frase de relleno', () => {
    for (const code of Object.keys(ISSUE_LABELS)) {
      expect((issueExplanation(code) ?? '').length).toBeGreaterThan(40);
    }
  });
});
