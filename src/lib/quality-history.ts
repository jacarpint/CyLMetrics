/**
 * Acceso server-side al índice del historial de análisis
 * (`reports/history-index.json`, generado por `scripts/build-history-index.ts`).
 *
 * Expone métricas globales por informe y la evolución del score por dataset
 * sin tener que parsear los informes completos en cada request.
 *
 * Módulo SOLO de servidor (usa node:fs). Caché en memoria de 5 minutos.
 */

import fs from 'node:fs';
import path from 'node:path';
import { datasetSlug } from './utils';

const INDEX_PATH = path.join(process.cwd(), 'reports', 'history-index.json');
const CACHE_MS = 5 * 60 * 1000;

export interface HistoryPoint {
  date: string;
  score: number;
}

export interface DatasetEvolution {
  dataset_id: string;
  title: string;
  points: HistoryPoint[];
}

export interface HistorySnapshotInfo {
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
}

export interface HistoryIndex {
  generated_at: string;
  snapshots: HistorySnapshotInfo[];
  datasets: Record<string, DatasetEvolution>;
}

let cached: { at: number; index: HistoryIndex | null } | null = null;

/** Devuelve el índice del historial, o null si no se ha generado aún. */
export function getHistoryIndex(): HistoryIndex | null {
  if (!fs.existsSync(INDEX_PATH)) return null;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.index;
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
    const index = JSON.parse(raw) as HistoryIndex;
    cached = { at: Date.now(), index };
    return index;
  } catch {
    cached = { at: Date.now(), index: null };
    return null;
  }
}

/** Evolución del score de análisis de un dataset por su slug. */
export function getDatasetEvolution(slug: string): DatasetEvolution | null {
  const index = getHistoryIndex();
  return index?.datasets[slug] ?? null;
}

/** Evolución del score de análisis de un dataset por su id completo. */
export function getDatasetEvolutionById(datasetId: string): DatasetEvolution | null {
  const index = getHistoryIndex();
  if (!index) return null;
  return index.datasets[datasetSlug(datasetId)] ?? null;
}
