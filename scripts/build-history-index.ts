/**
 * Construye un índice compacto del historial de análisis para alimentar la
 * página de Informe Ejecutivo y la evolución por dataset.
 *
 * Uso:
 *   npm run reports:index
 *
 * Lee `reports/history/analysis-*.json`, valida cada informe y escribe
 * `reports/history-index.json` con:
 *   - `snapshots`: métricas globales por informe (score medio, salud, etc.)
 *   - `datasets`:  evolución del score de análisis por dataset.
 *
 * Así las páginas no tienen que parsear los informes completos (decenas de MB)
 * en cada request.
 */

import fs from 'node:fs';
import path from 'node:path';
import { datasetSlug } from '../src/lib/utils';
import { reportContentScore } from '../src/lib/availability';
import type { QualityReport } from '../src/lib/quality-report';

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const HISTORY_DIR = path.join(REPORTS_DIR, 'history');
const INDEX_PATH = path.join(REPORTS_DIR, 'history-index.json');

interface Report {
  generated_at?: string;
  totals?: { distributions?: number; ok?: number; error?: number; skipped?: number; avg_score?: number | null };
  datasets?: {
    dataset_id: string;
    dataset_title: string;
    score: number | null;
  }[];
}

function isValid(report: Report): boolean {
  return (
    report != null &&
    typeof report.generated_at === 'string' &&
    report.totals != null &&
    Array.isArray(report.datasets)
  );
}

function build() {
  if (!fs.existsSync(HISTORY_DIR)) {
    console.error('No existe reports/history — ejecuta el análisis y el guardado primero.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const snapshots: {
    id: string;
    date: string;
    avg_score: number | null;
    distributions: number;
    ok: number;
    error: number;
    skipped: number;
    healthy: number;
    warning: number;
    critical: number;
    datasets: number;
  }[] = [];

  const datasetMap = new Map<string, { dataset_id: string; title: string; points: { date: string; score: number }[] }>();
  let skippedCount = 0;

  for (const file of files) {
    const filePath = path.join(HISTORY_DIR, file);
    let report: Report;
    try {
      report = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Report;
    } catch {
      console.warn(`  ! omitido (ilegible): ${file}`);
      skippedCount++;
      continue;
    }

    if (!isValid(report)) {
      console.warn(`  ! omitido (estructura inválida): ${file}`);
      skippedCount++;
      continue;
    }

    // Omitir informes parciales (ejecuciones con --limit) que no cubren el catálogo.
    if (report.datasets!.length < 50) {
      console.warn(`  ! omitido (parcial, ${report.datasets!.length} datasets): ${file}`);
      skippedCount++;
      continue;
    }

    const id = file.replace(/^analysis-/, '').replace(/\.json$/, '');
    const date = report.generated_at!.slice(0, 10);
    const totals = report.totals!;

    let healthy = 0;
    let warning = 0;
    let critical = 0;
    for (const ds of report.datasets!) {
      if (ds.score == null) continue;
      if (ds.score >= 80) healthy++;
      else if (ds.score >= 50) warning++;
      else critical++;

      const slug = datasetSlug(ds.dataset_id);
      let entry = datasetMap.get(slug);
      if (!entry) {
        entry = { dataset_id: ds.dataset_id, title: ds.dataset_title, points: [] };
        datasetMap.set(slug, entry);
      }
      entry.points.push({ date, score: ds.score });
    }

    /**
     * La media se recalcula, no se copia de `totals.avg_score`.
     *
     * `report.py` promedia la nota de TODO resultado que la tenga, y los
     * analizadores devuelven `score: 0` cuando les falta su lector. El informe
     * del 13 de agosto se generó sin openpyxl ni pyshp instalados, así que sus
     * `totals.avg_score` es 56,6: 364 ceros que no miden la calidad de ningún
     * archivo. Copiarlo aquí habría dibujado en Evolución una caída de 78,7 a
     * 56,6 que no ha ocurrido en el catálogo, y el gráfico de tendencia es
     * justamente donde una caída así se lee como un hecho.
     *
     * `reportContentScore` descuenta solo esos ceros y nada más, y se aplica a
     * todos los informes por igual: para una ejecución con sus dependencias
     * instaladas devuelve lo mismo que `totals.avg_score`, así que los puntos ya
     * publicados no se mueven y la serie sigue siendo comparable consigo misma.
     */
    const recalculated = reportContentScore(report as unknown as QualityReport);
    const avgScore = recalculated.avgScore ?? totals.avg_score ?? null;

    snapshots.push({
      id,
      date,
      avg_score: avgScore,
      distributions: totals.distributions ?? 0,
      ok: totals.ok ?? 0,
      error: totals.error ?? 0,
      skipped: totals.skipped ?? 0,
      healthy,
      warning,
      critical,
      datasets: report.datasets!.length,
    });

    // Las dos cifras siempre, sin umbral: cuando difieren mucho es que el informe
    // se generó sin las dependencias del analizador, y eso se quiere ver aquí y no
    // meses después. Un umbral solo decidía cuándo callarse.
    console.log(
      `  + ${file}  (${report.datasets!.length} ds, score ${avgScore ?? 'N/A'}` +
        `, el informe decía ${totals.avg_score ?? 'N/A'})`
    );
  }

  snapshots.sort((a, b) => a.id.localeCompare(b.id));

  const datasets: Record<string, { dataset_id: string; title: string; points: { date: string; score: number }[] }> = {};
  for (const entry of datasetMap.values()) {
    entry.points.sort((a, b) => a.date.localeCompare(b.date) || a.score - b.score);
    datasets[datasetSlug(entry.dataset_id)] = entry;
  }

  const output = {
    generated_at: new Date().toISOString(),
    snapshots,
    datasets,
  };

  fs.writeFileSync(INDEX_PATH, JSON.stringify(output));
  const sizeMb = (fs.statSync(INDEX_PATH).size / 1e6).toFixed(2);
  console.log(`\nÍndice guardado en: ${INDEX_PATH}`);
  console.log(`  ${snapshots.length} snapshots · ${Object.keys(datasets).length} datasets con evolución · ${sizeMb} MB`);
  if (skippedCount > 0) console.log(`  ${skippedCount} informes omitidos.`);
}

build();
