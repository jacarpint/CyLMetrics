import { NextRequest, NextResponse } from "next/server";
import { getQualityReport } from "@/lib/quality-report";
import { getCatalog } from "@/lib/rdf-catalog";
import { summarizeDelivery } from "@/lib/availability";
import { datasetSlug } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const datasetId = searchParams.get("dataset");
  const publisher = searchParams.get("publisher");

  const report = getQualityReport();
  if (!report) {
    return NextResponse.json({ error: "No quality report available" }, { status: 503 });
  }

  const cacheHeaders = {
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };

  if (datasetId) {
    const ds = report.datasets.find((d) => d.dataset_id === datasetId);
    if (!ds) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }
    return NextResponse.json({
      dataset_id: ds.dataset_id,
      title: ds.dataset_title,
      score: ds.score,
      issues_by_code: ds.issues_by_code,
      distributions: ds.distributions,
      analyzed: ds.analyzed,
      failed: ds.failed,
    }, { headers: cacheHeaders });
  }

  if (publisher) {
    // El informe de análisis no incluye el publicador; se cruza con el
    // catálogo RDF (que sí lo tiene) vía el slug numérico del dataset.
    const catalog = await getCatalog();
    const publisherBySlug = new Map<string, string>();
    for (const ds of catalog.datasets) {
      publisherBySlug.set(datasetSlug(ds.id), ds.publisher);
    }
    const needle = publisher.toLowerCase();
    const pds = report.datasets.filter((d) => {
      const pub = publisherBySlug.get(datasetSlug(d.dataset_id));
      return !!pub && pub.toLowerCase().includes(needle);
    });
    const scores = pds.map((d) => d.score).filter((s): s is number => s != null);
    return NextResponse.json({
      publisher,
      dataset_count: pds.length,
      avg_score: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      datasets: pds.map((d) => ({
        id: d.dataset_id,
        title: d.dataset_title,
        publisher: publisherBySlug.get(datasetSlug(d.dataset_id)) ?? null,
        score: d.score,
      })),
    }, { headers: cacheHeaders });
  }

  const delivery = summarizeDelivery(report);

  return NextResponse.json({
    generated_at: report.generated_at,
    totals: report.totals,
    dataset_count: report.datasets.length,
    // Disponibilidad aparte del score: son dos preguntas distintas y
    // promediarlas escondía que un tercio de los ficheros no abre.
    availability: {
      distributions: delivery.total,
      ok: delivery.ok,
      broken: delivery.roto,
      not_a_file: delivery.noEntrega,
      not_analyzed: delivery.omitida,
      broken_pct: delivery.brokenPct,
      affected_datasets: delivery.affectedDatasets,
    },
    score_distribution: {
      excellent: report.datasets.filter((d) => d.score != null && d.score >= 80).length,
      good: report.datasets.filter((d) => d.score != null && d.score >= 60 && d.score < 80).length,
      fair: report.datasets.filter((d) => d.score != null && d.score >= 40 && d.score < 60).length,
      poor: report.datasets.filter((d) => d.score != null && d.score < 40).length,
    },
  }, { headers: cacheHeaders });
}
