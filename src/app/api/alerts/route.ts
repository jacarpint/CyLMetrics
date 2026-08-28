import { NextRequest, NextResponse } from "next/server";
import { getQualityReport } from "@/lib/quality-report";
import { getCatalog } from "@/lib/rdf-catalog";
import { buildAlerts, isBlockingCode } from "@/lib/alerts";
import { datasetContentScore } from "@/lib/availability";
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
  // el mismo que ve el usuario en el portal. El nivel, en cambio, lo decide la
  // calidad de contenido, derivada con `classifyDelivery` y no leída del
  // informe: la del informe nunca baja de 95, así que «contenido por debajo de
  // 50» jamás marcaba una alerta como crítica.
  const alerts = buildAlerts(report, {
    contentScore: datasetContentScore,
    resolveScore: (ds) =>
      scoreForDataset(metadataBySlug.get(datasetSlug(ds.dataset_id)) ?? null, ds),
  })
    .filter((a) => (level ? a.level === level : true))
    .filter((a) => (category ? a.causes.some((c) => issueCategory(c.code) === category) : true));

  const total = alerts.length;

  return NextResponse.json(
    {
      /*
       * La fecha del análisis del que sale esta lista.
       *
       * Era el único endpoint sin fechar: `/api/quality` devuelve `generated_at`
       * y `/api/catalog` devuelve `analysis_generated_at`, pero las incidencias
       * viajaban sueltas. Y son justo las que más lo necesitan, porque una lista
       * de cosas que arreglar sin fecha no se puede saber si ya está corregida —el
       * defecto que este portal le señala a las fichas sin `dct:modified`.
       *
       * Se llama igual que en `/api/catalog` y no `generated_at` a secas por lo
       * mismo que allí: la respuesta mezcla el informe con los metadatos del
       * catálogo, así que el nombre tiene que decir a cuál de los dos pertenece la
       * fecha. En `/api/quality` no hace falta porque la respuesta ES el informe.
       */
      analysis_generated_at: report.generated_at,
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
