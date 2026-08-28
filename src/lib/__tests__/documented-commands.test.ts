import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Los comandos del análisis que publica la documentación existen y no destruyen
 * el informe.
 *
 * Mismo motivo que `pipeline-limits.test.ts` y `content-scoring.test.ts`, pero
 * para los comandos en lugar de las cifras: se reescriben a mano en cuatro
 * sitios —la página de Metodología, el README, `docs/ANALISIS.md` y el propio
 * docstring de `cli.py`— y nada impide que envejezcan cuando el CLI cambia.
 *
 * Ya pasó, y en el peor sitio posible. La comprobación previa que se documentaba
 * era `--limit 1 --strict-deps`, presentada como «no descarga nada». Con las
 * dependencias instaladas `--strict-deps` no aborta: sigue, analiza una
 * distribución y escribe el resultado en `--output`, que vale `reports/current`
 * por defecto. O sea que el comando que la página ofrecía a quien quisiera
 * comprobar la reproducibilidad **sobrescribía el informe publicado con una sola
 * distribución**, de 1.187 fragmentos a 1. Se arregló en `cli.py` y en el README
 * al añadir `--check-deps`, y la página de Metodología se quedó atrás.
 *
 * Los dos casos que cubre son las dos formas que tiene un comando publicado de
 * estar mal:
 *
 *  1. Usa una opción que el CLI ya no acepta → argparse muere con error 2.
 *  2. Es una ejecución PARCIAL sin `--output` → se lleva por delante el informe
 *     publicado, y en silencio, porque el análisis termina bien.
 *
 * El segundo no es hipotético: cuando se escribió este test lo incumplían cuatro
 * comandos más —dos en `docs/ANALISIS.md` y dos en los ejemplos de `cli.py`, tres
 * líneas por encima del aviso del propio docstring que dice que toda ejecución de
 * prueba tiene que pasar `--output` a otro sitio.
 */
const ROOT = process.cwd();

const CLI_PY_PATH = path.join('src', 'analysis', 'cli.py');
const CLI_PY = fs.readFileSync(path.join(ROOT, CLI_PY_PATH), 'utf-8');

/** Los sitios donde se publica un comando del análisis. */
const DOCUMENTED_IN = [
  path.join('src', 'app', 'metodologia', 'page.tsx'),
  'README.md',
  path.join('docs', 'ANALISIS.md'),
  CLI_PY_PATH,
] as const;

/**
 * Las opciones que declara argparse, más las que añade por su cuenta.
 *
 * Se leen del fuente y no de una lista escrita aquí: una lista propia es otra
 * copia que mantener, que es justo el problema que este test resuelve.
 */
function declaredFlags(): Set<string> {
  const flags = new Set(['--help']);
  for (const match of CLI_PY.matchAll(/add_argument\(\s*"(--[a-z0-9-]+)"/g)) {
    flags.add(match[1]);
  }
  return flags;
}

interface DocumentedCommand {
  /** Fichero y línea, para que el fallo diga dónde ir a arreglarlo. */
  where: string;
  /** El comando entero, con las continuaciones ya unidas. */
  command: string;
  /** Opción → su valor, o undefined si es un interruptor. */
  options: Map<string, string | undefined>;
}

/**
 * Une las continuaciones de línea antes de partir por líneas.
 *
 * `docs/ANALISIS.md` documenta el análisis reanudable en varias líneas con el `^`
 * de cmd.exe, y ahí viven precisamente el `--checkpoint` y el `--output` del
 * comando. Sin unirlas, el test las daría por comandos distintos y no
 * comprobaría ninguna de las dos opciones.
 */
function joinContinuations(source: string): string {
  return source.replace(/[\\^]\r?\n\s*/g, ' ');
}

/**
 * Los comandos `python -m src.analysis …` de un fichero.
 *
 * El backtick queda fuera de la captura porque en `page.tsx` el bloque es una
 * plantilla de JavaScript y el último comando acaba pegado a su cierre.
 */
function commandsIn(relPath: string): DocumentedCommand[] {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
  const found: DocumentedCommand[] = [];

  joinContinuations(source)
    .split('\n')
    .forEach((line, index) => {
      const match = /python -m src\.analysis([^\n`]*)/.exec(line);
      if (!match) return;

      // El comentario que sigue al comando no forma parte de él, y lleva texto
      // con guiones que se confundiría con opciones.
      const argv = match[1].split('#')[0].trim().split(/\s+/).filter(Boolean);

      const options = new Map<string, string | undefined>();
      argv.forEach((token, i) => {
        if (!token.startsWith('--')) return;
        // Admite las dos formas: `--output ruta` y `--output=ruta`.
        const [flag, inlineValue] = token.split('=');
        const next = argv[i + 1];
        options.set(flag, inlineValue ?? (next && !next.startsWith('-') ? next : undefined));
      });

      found.push({
        where: `${relPath}:${index + 1}`,
        command: `python -m src.analysis ${argv.join(' ')}`.trim(),
        options,
      });
    });

  return found;
}

const COMMANDS = DOCUMENTED_IN.flatMap(commandsIn);

describe('los comandos del análisis que publica la documentación', () => {
  it('se encuentran en los cuatro sitios que los publican', () => {
    // Si un cambio de formato deja de casar con el patrón, este test pasaría a
    // no comprobar nada y en verde. Mejor que falle.
    for (const relPath of DOCUMENTED_IN) {
      expect(
        COMMANDS.filter((c) => c.where.startsWith(relPath)).length,
        `${relPath} ya no documenta ningún comando del análisis: ¿cambió el formato del bloque?`
      ).toBeGreaterThan(0);
    }
  });

  it('solo usan opciones que cli.py declara', () => {
    const declared = declaredFlags();
    // Se recogen todos los incumplimientos antes de fallar: con un `expect` por
    // comando, arreglar el primero solo destapa el siguiente.
    const unknown = COMMANDS.flatMap((c) =>
      [...c.options.keys()]
        .filter((flag) => !declared.has(flag))
        .map((flag) => `${c.where} usa ${flag}, que ya no existe en ${CLI_PY_PATH}`)
    );
    expect(unknown, unknown.join('\n')).toEqual([]);
  });

  /**
   * `--check-deps` termina antes de tocar el catálogo, así que no escribe nada.
   * `--limit 0` es el análisis completo: ahí sobrescribir `reports/current` es
   * exactamente lo que se quiere. Cualquier otra ejecución analiza una parte del
   * catálogo, y sin `--output` propio reemplaza el informe entero con esa parte.
   */
  it('ninguna ejecución parcial se publica sin su propio --output', () => {
    const destructive = COMMANDS.filter((c) => {
      if (c.options.has('--check-deps')) return false;
      if (c.options.has('--output')) return false;
      return c.options.get('--limit') !== '0';
    }).map(
      (c) =>
        `${c.where}: «${c.command}» analiza solo una parte del catálogo y ` +
        'escribiría en reports/current, sustituyendo el informe publicado. ' +
        'Añádele --output reports/prueba.'
    );
    expect(destructive, destructive.join('\n')).toEqual([]);
  });
});
