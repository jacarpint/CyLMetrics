/**
 * Precalcula la serie histórica de la pestaña Evolución.
 *
 * Antes, `loadHistorySnapshots` abría y parseaba hasta 20 informes completos
 * —16 MB cada uno— **en cada arranque en frío de la función**, para quedarse
 * con doce cifras por informe. Con las incidencias completas en el informe eso
 * pasó de caro a inviable. Aquí se calcula una vez, en local, y el portal lee
 * un fichero de unos pocos kilobytes.
 *
 * Las cifras salen de `summarizeReport`, que es la misma función que usaba la
 * lectura en caliente: los umbrales (`getScoreLevel`) y la clasificación de
 * entrega (`classifyDelivery`) siguen viviendo en un solo sitio, así que la
 * serie no puede contradecir a la portada.
 *
 *   npm run reports:snapshots
 *
 * Acumula: cada ejecución añade el punto del informe vigente y conserva los
 * anteriores, emparejando por fecha (una segunda ejecución el mismo día
 * reemplaza el punto de ese día en vez de duplicarlo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { summarizeReport, type HistorySnapshot, type QualityReport } from '../src/lib/quality-report';

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const BUNDLE_INDEX = path.join(REPORTS_DIR, 'current', 'index.json');
const SNAPSHOTS_PATH = path.join(REPORTS_DIR, 'current', 'snapshots.json');
const HISTORY_DIR = path.join(REPORTS_DIR, 'history');

/**
 * Informes con menos datasets que esto son ejecuciones parciales (`--limit N`)
 * y no representan al catálogo. Mismo umbral que `quality-report.ts`: si aquí
 * fuese otro, el índice y la página contarían un número distinto de informes.
 */
const MIN_DATASETS_FOR_FULL_RUN = 50;

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function isFullRun(report: QualityReport | null): report is QualityReport {
  return Boolean(
    report &&
      Array.isArray(report.datasets) &&
      report.datasets.length >= MIN_DATASETS_FOR_FULL_RUN &&
      typeof report.generated_at === 'string'
  );
}

/** Informes del formato antiguo, para no perder los puntos ya medidos. */
function legacyReports(): QualityReport[] {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson<QualityReport>(path.join(HISTORY_DIR, f)))
    .filter(isFullRun);
}

function main(): number {
  const snapshots = new Map<string, HistorySnapshot>();

  for (const report of legacyReports()) {
    const snapshot = summarizeReport(report);
    snapshots.set(snapshot.date, snapshot);
  }

  const current = readJson<QualityReport>(BUNDLE_INDEX);
  if (isFullRun(current)) {
    const snapshot = summarizeReport(current);
    // Por fecha, no añadiendo: dos ejecuciones el mismo día son la misma foto
    // corregida, y apilarlas convertía la serie en una escalera falsa.
    snapshots.set(snapshot.date, snapshot);
    console.log(`Informe vigente: ${snapshot.date} · ${snapshot.totalDatasets} conjuntos de datos`);
  } else if (fs.existsSync(BUNDLE_INDEX)) {
    console.warn(
      `Aviso: ${BUNDLE_INDEX} es una ejecución parcial (<${MIN_DATASETS_FOR_FULL_RUN} datasets) y no entra en la serie.`
    );
  } else {
    console.warn(`Aviso: no existe ${BUNDLE_INDEX}. Ejecuta antes: python -m src.analysis --limit 0`);
  }

  if (snapshots.size === 0) {
    console.error('No hay ningún informe completo del que sacar la serie.');
    return 1;
  }

  const ordered = [...snapshots.values()].sort((a, b) => a.date.localeCompare(b.date));
  fs.mkdirSync(path.dirname(SNAPSHOTS_PATH), { recursive: true });
  fs.writeFileSync(
    SNAPSHOTS_PATH,
    JSON.stringify({ generated_at: new Date().toISOString(), snapshots: ordered }, null, 2),
    'utf-8'
  );

  console.log(`Serie escrita en ${SNAPSHOTS_PATH} · ${ordered.length} puntos`);
  for (const snapshot of ordered) {
    console.log(
      `  ${snapshot.date}  ${snapshot.usable}/${snapshot.totalDistributions} archivos abren · ` +
        `calidad media ${snapshot.avgScore ?? '—'}`
    );
  }
  return 0;
}

process.exit(main());
