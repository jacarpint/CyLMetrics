/**
 * Construye un índice compacto del historial de análisis para alimentar la
 * página de Informe Ejecutivo y la evolución por dataset.
 *
 * Uso:
 *   npx tsx scripts/build-history-index.ts
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

    snapshots.push({
      id,
      date,
      avg_score: totals.avg_score ?? null,
      distributions: totals.distributions ?? 0,
      ok: totals.ok ?? 0,
      error: totals.error ?? 0,
      skipped: totals.skipped ?? 0,
      healthy,
      warning,
      critical,
      datasets: report.datasets!.length,
    });

    console.log(`  + ${file}  (${report.datasets!.length} ds, score ${totals.avg_score ?? 'N/A'})`);
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
