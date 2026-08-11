import { NextRequest, NextResponse } from "next/server";
import { getQualityReport } from "@/lib/quality-report";
import { getCatalog } from "@/lib/rdf-catalog";
import { datasetSlug } from "@/lib/utils";
import { scoreForDataset } from "@/lib/quality";

const SCORE_COLORS: Record<string, string> = {
  excellent: "#10b981",
  good: "#22c55e",
  fair: "#f59e0b",
  poor: "#ef4444",
  unknown: "#94a3b8",
};

function scoreLevel(score: number | null): keyof typeof SCORE_COLORS {
  if (score == null) return "unknown";
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

function generateSVG(score: number | null): string {
  const level = scoreLevel(score);
  const color = SCORE_COLORS[level];
  const pct = score != null ? `${score}%` : "—";
  const width = 140;
  const height = 28;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${color}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0.06"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="6" fill="url(#bg)" stroke="${color}" stroke-opacity="0.3"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="5" fill="none" stroke="${color}" stroke-opacity="0.15"/>
  <text x="10" y="17" font-family="system-ui,-apple-system,sans-serif" font-size="10" font-weight="600" fill="${color}">Calidad</text>
  <text x="68" y="17" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="700" fill="${color}">${pct}</text>
</svg>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const datasetId = searchParams.get("dataset");

  const report = getQualityReport();
  const catalog = await getCatalog();

  let score: number | null = null;

  if (datasetId) {
    const slug = datasetSlug(datasetId);
    const ds = report?.datasets.find((d) => d.dataset_id === datasetId || datasetSlug(d.dataset_id) === slug);
    const catalogDs = catalog.datasets.find(
      (c) => c.id === datasetId || datasetSlug(c.id) === slug
    );
    score = scoreForDataset(catalogDs?.qualityScore ?? null, ds);
  } else {
    // Media de los compuestos, no compuesto de las medias: promediar primero
    // cada eje diluye a los datasets cuyos archivos no abren.
    const bySlug = new Map((report?.datasets ?? []).map((d) => [datasetSlug(d.dataset_id), d]));
    const composites = catalog.datasets
      .map((d) => scoreForDataset(d.qualityScore, bySlug.get(datasetSlug(d.id))))
      .filter((s): s is number => s != null);
    score = composites.length > 0
      ? Math.round(composites.reduce((a, b) => a + b, 0) / composites.length)
      : null;
  }

  const svg = generateSVG(score);
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
