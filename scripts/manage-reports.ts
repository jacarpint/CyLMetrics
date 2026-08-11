/**
 * Script de gestión del pipeline de informes de análisis.
 *
 * Uso:
 *   npx tsx scripts/manage-reports.ts save     # Copiar informe actual al historial
 *   npx tsx scripts/manage-reports.ts list      # Listar informes del historial
 *   npx tsx scripts/manage-reports.ts rotate 30 # Eliminar informes > 30 días
 *   npx tsx scripts/manage-reports.ts latest    # Mostrar el último informe válido
 */

import fs from 'node:fs';
import path from 'node:path';

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const REPORT_PATH = path.join(REPORTS_DIR, 'data-analysis.json');
const HISTORY_DIR = path.join(REPORTS_DIR, 'history');

function ensureDirs() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function saveToHistory() {
  ensureDirs();
  if (!fs.existsSync(REPORT_PATH)) {
    console.error('No existe reports/data-analysis.json — ejecuta el análisis primero.');
    process.exit(1);
  }

  const raw = fs.readFileSync(REPORT_PATH, 'utf-8');
  const report = JSON.parse(raw);
  const ts = new Date(report.generated_at).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(HISTORY_DIR, `analysis-${ts}.json`);

  if (fs.existsSync(dest)) {
    console.log(`Ya existe: ${path.basename(dest)} — sin cambios.`);
    return;
  }

  fs.copyFileSync(REPORT_PATH, dest);
  console.log(`Guardado: ${path.basename(dest)} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

function listReports() {
  ensureDirs();
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  if (files.length === 0) {
    console.log('Sin informes en el historial.');
    return;
  }
  console.log(`Historial (${files.length} informes):\n`);
  for (const f of files) {
    const fp = path.join(HISTORY_DIR, f);
    try {
      const report = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const size = (fs.statSync(fp).size / 1e6).toFixed(1);
      console.log(`  ${f}  —  ${report.totals?.distributions ?? '?'} dists, score ${report.totals?.avg_score ?? '?'}  (${size} MB)`);
    } catch {
      console.log(`  ${f}  —  (corrupto)`);
    }
  }
}

function rotate(maxDays: number) {
  ensureDirs();
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
  let removed = 0;
  for (const f of files) {
    const fp = path.join(HISTORY_DIR, f);
    if (fs.statSync(fp).mtimeMs < cutoff) {
      fs.unlinkSync(fp);
      removed++;
    }
  }
  console.log(`Eliminados ${removed} informes > ${maxDays} días.`);
}

function showLatest() {
  ensureDirs();
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  for (const f of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8'));
      if (report.datasets && report.totals) {
        console.log(`Último informe válido: ${f}`);
        console.log(`  Generado: ${report.generated_at}`);
        console.log(`  Distribuciones: ${report.totals.distributions}`);
        console.log(`  Score medio: ${report.totals.avg_score ?? 'N/A'}`);
        return;
      }
    } catch { continue; }
  }
  console.log('No se encontró un informe válido en el historial.');
}

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'save': saveToHistory(); break;
  case 'list': listReports(); break;
  case 'rotate': rotate(parseInt(args[0] || '30', 10)); break;
  case 'latest': showLatest(); break;
  default:
    console.log('Uso: npx tsx scripts/manage-reports.ts <save|list|rotate|latest> [días]');
    process.exit(1);
}
