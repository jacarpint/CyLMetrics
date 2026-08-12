import { NextRequest, NextResponse } from "next/server";
import { getQualityReport } from "@/lib/quality-report";
import { getCatalog } from "@/lib/rdf-catalog";
import { summarizeDelivery } from "@/lib/availability";
import { getScoreLevel } from "@/lib/quality";
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
    // Acepta la URI completa y el identificador corto (`1285663381041`), que es
    // el que usan las URLs del portal. Antes solo casaba la URI exacta.
    const slug = datasetSlug(datasetId);
    const ds = report.datasets.find(
      (d) => d.dataset_id === datasetId || datasetSlug(d.dataset_id) === slug
    );
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

  /**
   * Reparto por niveles con los umbrales del portal (≥80 buena, 50–79
   * mejorable, <50 deficiente), no con una escala propia de 80/60/40 que no
   * coincidía con ninguna otra parte. Y los datasets sin puntuación se cuentan:
   * antes no caían en ningún cubo, así que la suma daba 436 de 824 sin decirlo.
   */
  const levels = { good: 0, fair: 0, poor: 0, unscored: 0 };
  for (const ds of report.datasets) {
    if (ds.score == null) levels.unscored++;
    else levels[getScoreLevel(ds.score) === 'ok' ? 'good' : getScoreLevel(ds.score) === 'warn' ? 'fair' : 'poor']++;
  }

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
    // Sobre la puntuación de CONTENIDO de cada dataset. Los cuatro valores
    // suman siempre `dataset_count`.
    content_score_distribution: {
      good: levels.good,
      fair: levels.fair,
      poor: levels.poor,
      unscored: levels.unscored,
      thresholds: { good: '>= 80', fair: '50-79', poor: '< 50', unscored: 'sin archivo legible' },
    },
  }, { headers: cacheHeaders });
}
