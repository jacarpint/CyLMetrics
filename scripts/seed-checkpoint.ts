/**
 * Siembra el checkpoint del analizador con el informe ya publicado, para volver a
 * analizar SOLO lo que se quedó sin analizar por nuestra culpa.
 *
 * Uso:
 *   npm run reports:seed              # las limitaciones del portal (lo normal)
 *   npm run reports:seed -- --codes dependencia-faltante
 *   npm run reports:seed -- --dry-run
 *
 * El problema que resuelve. El informe del 13 de agosto se generó en un entorno sin
 * `openpyxl`, `pyshp` ni `icalendar`, así que 366 distribuciones —341 XLSX, 24 SHP y
 * 1 iCal— se archivaron como «no analizadas» sin que el archivo tuviera nada malo.
 * Para arreglarlo hay que volver a analizarlas, y las otras 1.292 no: repetir el
 * análisis completo son 23,5 GB de descargas y horas de ejecución para recalcular
 * lo que ya estaba bien.
 *
 * Cómo. `run_analysis` de `engine.py` ya sabe reanudar: lee un JSONL de resultados
 * previos y —esto es lo que lo hace posible— los indexa POR URL, no por posición
 * («los resultados se indexan por URL de distribución, por lo que reanudar es
 * seguro incluso si el catálogo de entrada cambia de orden»). Así que sembrando el
 * checkpoint con los 1.292 resultados buenos y lanzando un análisis normal del
 * catálogo completo, el motor reutiliza esos y solo descarga los 366 que faltan.
 * Después `aggregate()` recorre el conjunto entero y escribe un bundle coherente:
 * no hay que fusionar nada ni recalcular totales a mano, que es donde se cuelan las
 * cifras que no cuadran.
 *
 * Reconstrucción fiel. Un resultado no está entero en `index.json`: `bundle.py`
 * aparta en `d/<id>.json` lo pesado —el esquema, las filas de muestra y las
 * posiciones de cada incidencia—. Sembrar solo con el índice perdería ese detalle
 * para las 1.292 distribuciones reutilizadas, y la ficha de cada archivo se
 * quedaría sin sus casos. Aquí se vuelven a juntar las dos mitades, y el script
 * COMPRUEBA que la reconstrucción es exacta: vuelve a derivar la entrada del índice
 * a partir del resultado reconstruido y la compara con la original. Si algo no
 * cuadra, aborta en vez de sembrar un checkpoint que degradaría el informe.
 */

import fs from 'node:fs';
import path from 'node:path';

const BUNDLE_DIR = path.join(process.cwd(), 'reports', 'current');
const INDEX_PATH = path.join(BUNDLE_DIR, 'index.json');
const SHARD_DIR = path.join(BUNDLE_DIR, 'd');
/** El mismo nombre que compone `cli.py` cuando `--output` es el directorio por defecto. */
const CHECKPOINT_PATH = path.join(BUNDLE_DIR, 'analysis.checkpoint.jsonl');

/**
 * Códigos que significan «no lo analizamos nosotros», no «el archivo está mal».
 *
 * Tiene que decir lo mismo que `PORTAL_LIMITATION_CODES` en
 * `src/lib/quality-labels.ts` y en `src/analysis/checks.py`. No se importa de allí
 * a propósito: este script decide qué se vuelve a descargar, y conviene que ese
 * criterio se lea aquí mismo. El test de paridad cubre las otras dos copias.
 */
const DEFAULT_CODES = [
  'dependencia-faltante',
  'fallo-analizador',
  'error-validacion',
  'descarga-truncada',
  'too_large',
];

/** Claves de `analysis` que `bundle.py` guarda solo en el fragmento. */
const DETAIL_KEYS = ['schema', 'sample_rows'] as const;
/** Claves de una incidencia que llevan las posiciones y viven solo en el fragmento. */
const OCCURRENCE_KEYS = ['columns', 'rows'] as const;

type Json = Record<string, unknown>;

function omit(source: Json, keys: readonly string[]): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(source)) if (!keys.includes(k)) out[k] = v;
  return out;
}

/** Comparación estructural: el orden de las claves no importa, el contenido sí. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a as Json);
  const kb = Object.keys(b as Json);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in (b as Json) && deepEqual((a as Json)[k], (b as Json)[k]));
}

/** `_has_detail` de `bundle.py`: ¿hay algo que guardar en el fragmento? */
function hasDetail(analysis: Json | null): boolean {
  if (!analysis) return false;
  if (DETAIL_KEYS.some((k) => analysis[k])) return true;
  const issues = (analysis.issues as Json[] | undefined) ?? [];
  return issues.some((issue) => issue.stored);
}

/**
 * `_index_result` de `bundle.py`, en TypeScript.
 *
 * Está aquí para COMPROBAR la reconstrucción, no para escribir nada: si volver a
 * partir el resultado reconstruido no devuelve la entrada original del índice, es
 * que se ha perdido o inventado algo por el camino.
 */
function toIndexEntry(result: Json, id: string): Json {
  const entry: Json = { ...result, id };
  const analysis = result.analysis as Json | null;
  if (analysis) {
    const slim = omit(analysis, DETAIL_KEYS);
    slim.issues = ((analysis.issues as Json[] | undefined) ?? []).map((i) => omit(i, OCCURRENCE_KEYS));
    entry.analysis = slim;
  }
  entry.has_detail = hasDetail(analysis);
  return entry;
}

/**
 * `_shard` de `bundle.py`, en TypeScript. La otra mitad de la comprobación.
 *
 * Hace falta porque comparar solo contra el índice no demuestra nada del detalle:
 * `toIndexEntry` descarta justo las claves que `rebuildResult` restaura, así que si
 * la reconstrucción se dejara el esquema o las posiciones de las incidencias, esa
 * comparación seguiría saliendo bien. Es lo pesado del informe —el esquema, las
 * filas de muestra y hasta dos millones de posiciones por incidencia— y es lo que
 * alimenta el recorrido caso por caso de la ficha de cada archivo, o sea
 * exactamente lo que no se puede perder al sembrar.
 */
function toShard(result: Json, id: string): Json {
  const analysis = result.analysis as Json;
  const metrics = (analysis.metrics as Json | undefined) ?? {};
  const shard: Json = {
    id,
    url: result.url,
    format: result.format,
    dataset_id: result.dataset_id,
    header: metrics.header ?? [],
    issues: ((analysis.issues as Json[] | undefined) ?? []).filter((i) => i.stored),
  };
  for (const key of DETAIL_KEYS) {
    if (analysis[key]) shard[key] = analysis[key];
  }
  return shard;
}

/** Vuelve a unir la entrada del índice con su fragmento. */
function rebuildResult(entry: Json): Json {
  const result = omit(entry, ['id', 'has_detail']);
  if (!entry.has_detail) return result;

  const shardPath = path.join(SHARD_DIR, `${entry.id}.json`);
  if (!fs.existsSync(shardPath)) {
    throw new Error(
      `Falta el fragmento ${entry.id}.json de ${entry.url}. El bundle está incompleto: ` +
        'sembrar con él perdería el detalle de esa distribución.'
    );
  }
  const shard = JSON.parse(fs.readFileSync(shardPath, 'utf-8')) as Json;
  const analysis = { ...(result.analysis as Json) };

  for (const key of DETAIL_KEYS) {
    if (shard[key] !== undefined) analysis[key] = shard[key];
  }

  // Las posiciones vuelven a su incidencia, emparejadas por código.
  const detailByCode = new Map<string, Json>();
  for (const issue of ((shard.issues as Json[] | undefined) ?? [])) {
    detailByCode.set(String(issue.code), issue);
  }
  analysis.issues = ((analysis.issues as Json[] | undefined) ?? []).map((issue) => {
    const detail = detailByCode.get(String(issue.code));
    if (!detail) return issue;
    const restored = { ...issue };
    for (const key of OCCURRENCE_KEYS) {
      if (detail[key] !== undefined) restored[key] = detail[key];
    }
    return restored;
  });

  result.analysis = analysis;
  return result;
}

function main(): void {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const codesArg = argv.find((a) => a.startsWith('--codes'));
  const codes = new Set(
    codesArg
      ? (codesArg.includes('=') ? codesArg.split('=')[1] : argv[argv.indexOf(codesArg) + 1] ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : DEFAULT_CODES
  );

  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`No existe ${INDEX_PATH} — no hay informe del que sembrar.`);
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8')) as {
    generated_at?: string;
    datasets: { distribution_results?: Json[] }[];
  };

  /**
   * URL que aparecen en más de una distribución del informe.
   *
   * El checkpoint del motor es un diccionario POR URL, así que dos distribuciones
   * con la misma URL colapsan en una sola entrada y las dos reciben el mismo
   * resultado sembrado —incluidos su `dataset_index` y su `dataset_id`—. Como
   * `aggregate()` agrupa justo por ese par, el efecto sería que un dataset se queda
   * la distribución varias veces y los otros la pierden. En este informe pasa con
   * 7 URL, y una de ellas (`https://www.jcyl.es/sie`) está en cinco datasets
   * distintos: es una página de aterrizaje publicada como si fuera el dato.
   *
   * No se siembran: se vuelven a analizar, que son cuatro descargas de nada y así
   * cada una recibe su atribución correcta.
   */
  const urlCounts = new Map<string, number>();
  for (const dataset of index.datasets ?? []) {
    for (const entry of dataset.distribution_results ?? []) {
      const url = String(entry.url ?? '');
      if (url) urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
    }
  }
  const duplicated = new Set([...urlCounts].filter(([, n]) => n > 1).map(([url]) => url));

  const lines: string[] = [];
  let seeded = 0;
  let verifiedShards = 0;
  let pending = 0;
  let pendingBytes = 0;
  let pendingDuplicates = 0;
  const pendingByFormat: Record<string, number> = {};
  const mismatches: string[] = [];

  for (const dataset of index.datasets ?? []) {
    for (const entry of dataset.distribution_results ?? []) {
      const url = String(entry.url ?? '');
      const analysis = entry.analysis as Json | null;
      const issueCodes = ((analysis?.issues as Json[] | undefined) ?? []).map((i) => String(i.code));
      const mine = issueCodes.some((code) => codes.has(code));

      const isDuplicate = duplicated.has(url);
      if (mine || !url || isDuplicate) {
        // Sin línea en el checkpoint: el motor lo volverá a descargar y analizar.
        // Una distribución sin URL tampoco se siembra, para que vuelva a pasar por
        // la rama que la marca como «sin URL de acceso» en vez de darla por hecha.
        pending++;
        if (isDuplicate && !mine) pendingDuplicates++;
        pendingBytes += Number((entry.fetch as Json | null)?.size ?? 0);
        const format = String(entry.format ?? 'OTRO');
        pendingByFormat[format] = (pendingByFormat[format] ?? 0) + 1;
        continue;
      }

      const result = rebuildResult(entry);

      // La red de seguridad, por las DOS mitades: volver a partir el resultado
      // reconstruido tiene que devolver la entrada del índice Y el fragmento tal y
      // como estaban. Comprobar solo el índice dejaba pasar cualquier pérdida del
      // detalle, que es justo lo caro.
      const id = String(entry.id);
      if (!deepEqual(toIndexEntry(result, id), entry)) {
        mismatches.push(`${url} (índice)`);
        continue;
      }
      if (entry.has_detail) {
        const original = JSON.parse(fs.readFileSync(path.join(SHARD_DIR, `${id}.json`), 'utf-8'));
        if (!deepEqual(toShard(result, id), original)) {
          mismatches.push(`${url} (fragmento)`);
          continue;
        }
        verifiedShards++;
      }

      lines.push(JSON.stringify({ url, result }));
      seeded++;
    }
  }

  if (mismatches.length > 0) {
    console.error(
      `\nLa reconstrucción no es fiel en ${mismatches.length} distribuciones. ` +
        'No se siembra nada: un checkpoint incompleto degradaría el informe.\n' +
        mismatches.slice(0, 5).map((u) => `  ${u}`).join('\n')
    );
    process.exit(1);
  }

  const gb = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;
  console.log(`Informe de partida: ${index.generated_at ?? 'sin fecha'}`);
  console.log(
    `  reutilizables      ${String(seeded).padStart(5)}  (no se vuelven a descargar)` +
      `\n      con detalle    ${String(verifiedShards).padStart(5)}  fragmentos reconstruidos y verificados`
  );
  console.log(`  a re-analizar      ${String(pending).padStart(5)}  ~${gb(pendingBytes)} de descarga`);
  for (const [format, n] of Object.entries(pendingByFormat).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${format.padEnd(8)} ${String(n).padStart(4)}`);
  }
  if (pendingDuplicates > 0) {
    console.log(
      `      de esas, ${pendingDuplicates} por compartir URL con otra distribución\n` +
        '      (el checkpoint va por URL, así que sembrarlas confundiría a qué dataset pertenecen)'
    );
  }
  console.log(`  criterio           ${[...codes].join(', ')}`);

  // Lo que el motor va a leer tiene que ser lo que hemos escrito: si una URL se
  // repitiera, el diccionario del motor tendría menos entradas que líneas el
  // fichero, y la diferencia se traduciría en distribuciones mal atribuidas.
  const uniqueUrls = new Set(lines.map((line) => JSON.parse(line).url as string));
  if (uniqueUrls.size !== lines.length) {
    console.error(
      `\n${lines.length - uniqueUrls.size} URL repetidas en el checkpoint. No se escribe: ` +
        'el motor las colapsaría y las distribuciones cambiarían de dataset.'
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n--dry-run: no se ha escrito el checkpoint.');
    return;
  }

  fs.writeFileSync(CHECKPOINT_PATH, lines.length ? `${lines.join('\n')}\n` : '', 'utf-8');
  const size = fs.statSync(CHECKPOINT_PATH).size;
  console.log(`\nCheckpoint escrito: ${CHECKPOINT_PATH}`);
  console.log(`  ${(size / 1e6).toFixed(0)} MB · ${lines.length} resultados reutilizables`);
  console.log(
    '\nSiguiente paso (el catálogo entero; solo descarga lo que falta):\n' +
      '  python -m src.analysis --limit 0\n' +
      'Si el repositorio está en OneDrive, pasa --checkpoint y --output a disco local.'
  );
}

main();
