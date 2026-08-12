import { NextRequest, NextResponse } from "next/server";
import { getQualityReport } from "@/lib/quality-report";
import { getCatalog } from "@/lib/rdf-catalog";
import { buildAlerts, isBlockingCode } from "@/lib/alerts";
import { categoryLabel, issueCategory, issueLabel, type IssueCategory } from "@/lib/quality-labels";
import { datasetSlug } from "@/lib/utils";
import { scoreForDataset } from "@/lib/quality";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawLevel = searchParams.get("level");
  const level = rawLevel === "critical" || rawLevel === "warning" ? rawLevel : null;
  const rawCategory = searchParams.get("category") as IssueCategory | null;
  const category =
    rawCategory === "availability" || rawCategory === "format" || rawCategory === "content"
      ? rawCategory
      : null;
  const limitRaw = parseInt(searchParams.get("limit") || "100", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

  const report = getQualityReport();
  if (!report) {
    return NextResponse.json({ error: "No quality report available" }, { status: 503 });
  }

  const catalog = await getCatalog();
  const metadataBySlug = new Map(
    catalog.datasets.map((d) => [datasetSlug(d.id), d.qualityScore])
  );

  // El score expuesto es el compuesto (metadatos + disponibilidad + contenido),
  // el mismo que ve el usuario en el portal.
  const alerts = buildAlerts(report, (ds) =>
    scoreForDataset(metadataBySlug.get(datasetSlug(ds.dataset_id)) ?? null, ds)
  )
    .filter((a) => (level ? a.level === level : true))
    .filter((a) => (category ? a.causes.some((c) => issueCategory(c.code) === category) : true));

  const total = alerts.length;

  return NextResponse.json(
    {
      total,
      critical: alerts.filter((a) => a.level === "critical").length,
      warning: alerts.filter((a) => a.level === "warning").length,
      categories: {
        availability: alerts.filter((a) => a.causes.some((c) => isBlockingCode(c.code) && issueCategory(c.code) === "availability")).length,
        format: alerts.filter((a) => a.causes.some((c) => isBlockingCode(c.code) && issueCategory(c.code) === "format")).length,
        content: alerts.filter((a) => a.causes.some((c) => issueCategory(c.code) === "content")).length,
      },
      alerts: alerts.slice(0, limit).map((a) => ({
        dataset_id: a.datasetId,
        title: a.title,
        score: a.score,
        level: a.level,
        failed: a.failedDistributions,
        distributions: a.totalDistributions,
        causes: a.causes.map((c) => ({
          code: c.code,
          label: issueLabel(c.code),
          category: categoryLabel(issueCategory(c.code)),
          count: c.count,
        })),
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    }
  );
}
