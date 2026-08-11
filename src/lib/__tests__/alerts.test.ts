import { describe, it, expect } from 'vitest';
import { buildAlerts, classifyDataset, isBlockingCode } from '../alerts';
import type { QualityDatasetSummary, QualityReport } from '../quality-report';

function makeDatasetSummary(overrides: Partial<QualityDatasetSummary> = {}): QualityDatasetSummary {
  return {
    dataset_index: 0,
    dataset_id: 'https://example.org/1',
    dataset_title: 'Test',
    distributions: 1,
    analyzed: 1,
    failed: 0,
    skipped: 0,
    scores: [],
    distribution_results: [],
    issues_by_code: {},
    score: 80,
    coverage_pct: 100,
    ...overrides,
  };
}

describe('isBlockingCode', () => {
  it('recognizes blocking codes', () => {
    expect(isBlockingCode('descarga')).toBe(true);
    expect(isBlockingCode('json-invalido')).toBe(true);
    expect(isBlockingCode('xml-no-bien-formado')).toBe(true);
  });

  it('returns false for non-blocking codes', () => {
    expect(isBlockingCode('celda-faltante')).toBe(false);
    expect(isBlockingCode('error-tipo')).toBe(false);
  });
});

describe('classifyDataset', () => {
  it('returns null for dataset with no actionable issues', () => {
    const ds = makeDatasetSummary({ issues_by_code: {} });
    expect(classifyDataset(ds)).toBeNull();
  });

  it('returns null for dataset with only minor missing cells', () => {
    const ds = makeDatasetSummary({ issues_by_code: { 'celda-faltante': 5 } });
    expect(classifyDataset(ds)).toBeNull();
  });

  it('returns critical alert for blocking issue', () => {
    const ds = makeDatasetSummary({
      issues_by_code: { descarga: 1 },
      score: 20,
      failed: 1,
    });
    const alert = classifyDataset(ds);
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe('critical');
    expect(alert!.causes[0].code).toBe('descarga');
  });

  it('returns warning for high-impact content issue', () => {
    const ds = makeDatasetSummary({
      issues_by_code: { 'error-tipo': 50 },
      score: 65,
    });
    const alert = classifyDataset(ds);
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe('warning');
  });

  it('returns warning for celda-faltante above threshold (>=1000)', () => {
    const ds = makeDatasetSummary({ issues_by_code: { 'celda-faltante': 1000 }, score: 65 });
    const alert = classifyDataset(ds);
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe('warning');
  });

  it('promotes to critical when score < 50', () => {
    const ds = makeDatasetSummary({
      issues_by_code: { 'error-tipo': 10 },
      score: 40,
    });
    const alert = classifyDataset(ds);
    expect(alert!.level).toBe('critical');
  });
});

describe('buildAlerts', () => {
  it('returns empty array for null report', () => {
    expect(buildAlerts(null)).toEqual([]);
  });

  it('returns sorted alerts (worst score first)', () => {
    const report: QualityReport = {
      generated_at: '2025-01-01T00:00:00Z',
      totals: { distributions: 2, ok: 0, error: 2, skipped: 0, downloaded: 2, avg_score: null, bytes: 0 },
      by_format: {},
      datasets: [
        makeDatasetSummary({ dataset_id: 'a', score: 70, issues_by_code: { descarga: 1 } }),
        makeDatasetSummary({ dataset_id: 'b', score: 20, issues_by_code: { descarga: 1 } }),
      ],
    };
    const alerts = buildAlerts(report);
    expect(alerts).toHaveLength(2);
    expect(alerts[0].datasetId).toBe('b');
  });
});
