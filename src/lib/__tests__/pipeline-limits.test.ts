import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PIPELINE } from '@/data/pipeline';

/**
 * Los topes que el portal publica sobre sí mismo tienen que ser los que aplica.
 *
 * `PIPELINE[].detail` es telemetría de operación —tope de descarga, tiempos de
 * espera, reintentos— y se muestra en Metodología › Detalle técnico. Estaba
 * escrita a mano, y envejeció: publicaba «tope 25 MB · … · 60 s de lectura»
 * cuando el análisis ya descargaba hasta 512 MB con 120 s de espera. El tope
 * había subido en `cli.py` (su propio comentario dice «Eran 25 MB») y el texto
 * se quedó atrás, hasta el punto de contradecir a la misma página, que unas
 * secciones más arriba habla de 512 MB.
 *
 * Es el fallo más caro que puede tener este portal: audita catálogos ajenos
 * comprobando que lo publicado se sostiene, así que un dato propio desmentido
 * por su código le quita la autoridad para hacerlo.
 *
 * El resto de la página ya se defiende sola —los pesos del índice salen de
 * `SCORE_WEIGHTS`, no de una copia—. Estas cifras no se pueden importar: viven
 * en Python. Así que se leen del fuente, como ya hace
 * `portal-limitation-parity.test.ts`.
 */
const ANALYSIS_DIR = path.join(process.cwd(), 'src', 'analysis');
const CLI_PY = fs.readFileSync(path.join(ANALYSIS_DIR, 'cli.py'), 'utf-8');
const DOWNLOADER_PY = fs.readFileSync(path.join(ANALYSIS_DIR, 'downloader.py'), 'utf-8');

/** `NOMBRE = 512 * 1024 * 1024`, ya multiplicado. */
function pythonProduct(source: string, name: string): number {
  const match = new RegExp(`^${name}\\s*=\\s*([\\d_]+(?:\\s*\\*\\s*[\\d_]+)*)`, 'm').exec(source);
  if (!match) throw new Error(`No se encuentra ${name} en el fuente de Python`);
  return match[1]
    .split('*')
    .reduce((product, factor) => product * Number(factor.trim().replace(/_/g, '')), 1);
}

/** El `default=` de un `add_argument("--nombre", …)` de argparse. */
function argparseDefault(source: string, flag: string): number {
  const match = new RegExp(`add_argument\\("${flag}"[^)]*?default=([A-Za-z_0-9]+)`, 's').exec(source);
  if (!match) throw new Error(`No se encuentra el default de ${flag} en cli.py`);

  // Un literal, como `default=2`.
  if (/^\d+$/.test(match[1])) return Number(match[1]);

  /*
   * O una constante del módulo, como `default=DEFAULT_TIMEOUT`.
   *
   * Antes solo se aceptaba el número escrito ahí mismo, así que sacar un valor a
   * una constante con su explicación —que es mejor código— rompía este test sin
   * que nada estuviera mal. Y el arreglo cómodo habría sido devolver el literal
   * al `add_argument` y perder la explicación, o sea empeorar el fuente para
   * contentar a su guardián.
   */
  const constante = new RegExp(`^${match[1]}\\s*=\\s*(\\d+)`, 'm').exec(source);
  if (!constante) throw new Error(`El default de ${flag} es ${match[1]}, que no se resuelve en cli.py`);
  return Number(constante[1]);
}

/**
 * El paso cuyo `detail` lleva las cifras. Se busca por la clave de icono y no
 * por posición: reordenar los pasos no debe romper el test ni, peor, dejarlo
 * comprobando el paso equivocado en silencio.
 */
const descarga = PIPELINE.find((step) => step.icon === 'descarga');

describe('los topes publicados en Metodología son los que aplica el análisis', () => {
  it('el paso de descarga existe y publica su detalle', () => {
    expect(descarga, 'PIPELINE ya no tiene un paso con icono «descarga»').toBeDefined();
    expect(descarga!.detail).toBeTruthy();
  });

  it('el tope de descarga es el de cli.py, en MB', () => {
    // Se publica en MB porque es la unidad en la que se entiende un tope de
    // descarga; el fuente lo declara en bytes.
    const capMb = pythonProduct(CLI_PY, 'DEFAULT_SIZE_CAP') / (1024 * 1024);
    expect(descarga!.detail).toContain(`tope ${capMb} MB`);
  });

  it('el tiempo de conexión es la constante de downloader.py', () => {
    const connect = pythonProduct(DOWNLOADER_PY, 'TIMEOUT_CONNECT');
    expect(descarga!.detail).toContain(`${connect} s para conectar`);
  });

  /**
   * A propósito contra `--timeout` y no contra `TIMEOUT_READ`.
   *
   * `TIMEOUT_READ = 60` es solo el valor por defecto de la firma de `fetch`, y
   * el pipeline real nunca lo usa: `cli.py` pasa siempre `--timeout` (120) por
   * `run_analysis` hasta `fetch`. Comprobar la constante daría verde publicando
   * un número que no se aplica, que es exactamente el error que hubo.
   */
  it('el tiempo de lectura es el que cli.py pasa de verdad, no el default de fetch()', () => {
    const read = argparseDefault(CLI_PY, '--timeout');
    expect(descarga!.detail).toContain(`${read} s de lectura`);
  });

  it('los reintentos son los de cli.py', () => {
    const retries = argparseDefault(CLI_PY, '--retries');
    expect(descarga!.detail).toContain(`${retries} reintentos`);
  });
});
