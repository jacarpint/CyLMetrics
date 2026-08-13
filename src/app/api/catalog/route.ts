import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport, toDatasetLite } from "@/lib/quality-report";
import { parseActiveFilters, applyFilters, sortDatasets, MAX_PAGE_SIZE } from "@/lib/catalog-filters";
import { scoreForDataset } from "@/lib/quality";
import { datasetSlug } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = Object.fromEntries(searchParams.entries());
  // `strictPageSize: false`: aquí `?limit=` es un parámetro documentado y acepta
  // cualquier valor hasta MAX_PAGE_SIZE. Con la regla de la interfaz (solo
  // 12/24/48), `?limit=1` devolvía 24 elementos sin decir nada.
  const filters = parseActiveFilters(params, false);

  const catalog = await getCatalog();
  const report = getQualityReport();

  // El filtro `?analisis=` necesita el informe cruzado por slug, igual que la
  // página de catálogo. Sin esto el parámetro se aceptaba y no filtraba nada.
  const analysisBySlug = report
    ? Object.fromEntries(report.datasets.map((ds) => [datasetSlug(ds.dataset_id), toDatasetLite(ds)]))
    : undefined;
  const reportBySlug = new Map((report?.datasets ?? []).map((d) => [datasetSlug(d.dataset_id), d]));

  const filtered = applyFilters(catalog.datasets, filters, analysisBySlug);
  // Con el análisis, para que `?sort=quality-desc` ordene por el mismo número que
  // esta respuesta publica en `scores.overall`.
  const sorted = sortDatasets(filtered, filters.sort, analysisBySlug);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));

  // Clampear la página al rango válido (igual que la página de catálogo).
  const page = Math.min(Math.max(filters.page, 1), totalPages);
  const pageStart = (page - 1) * filters.limit;
  const paged = sorted.slice(pageStart, pageStart + filters.limit);

  return NextResponse.json({
    total,
    page,
    limit: filters.limit,
    max_limit: MAX_PAGE_SIZE,
    totalPages,
    catalog_source: {
      url: catalog.source.url,
      fetched_at: catalog.source.fetchedAt,
      origin: catalog.source.origin,
    },
    analysis_generated_at: report?.generated_at ?? null,
    datasets: paged.map((d) => {
      const slug = datasetSlug(d.id);
      const lite = analysisBySlug?.[slug];
      return {
        id: d.id,
        slug,
        title: d.title,
        description: d.description,
        publisher: d.publisher,
        license: d.license,
        lastUpdated: d.lastUpdated,
        modified: d.modified,
        category: d.category,
        formats: d.formats,
        // Los tres ejes por separado, además del compuesto: antes se exponía
        // `qualityScore` a secas y nada indicaba que no incluía si los archivos
        // se pueden abrir.
        scores: {
          metadata: d.qualityScore,
          availability: lite?.availability_pct ?? null,
          content: lite?.score ?? null,
          overall: scoreForDataset(d.qualityScore, reportBySlug.get(slug)),
        },
        analysis_status: lite?.status ?? "sin-datos",
        updatedAgo: d.updatedAgo,
        distributions: d.distributionUrls.map((dist) => ({
          format: dist.format,
          url: dist.url,
        })),
      };
    }),
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
