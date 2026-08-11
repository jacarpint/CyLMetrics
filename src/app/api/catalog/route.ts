import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/rdf-catalog";
import { parseActiveFilters, applyFilters, sortDatasets } from "@/lib/catalog-filters";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = Object.fromEntries(searchParams.entries());
  const filters = parseActiveFilters(params);

  const catalog = await getCatalog();
  const filtered = applyFilters(catalog.datasets, filters);
  const sorted = sortDatasets(filtered, filters.sort);
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
    totalPages,
    datasets: paged.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      publisher: d.publisher,
      license: d.license,
      lastUpdated: d.lastUpdated,
      modified: d.modified,
      category: d.category,
      formats: d.formats,
      qualityScore: d.qualityScore,
      status: d.status,
      updatedAgo: d.updatedAgo,
      distributions: d.distributionUrls.map((dist) => ({
        format: dist.format,
        url: dist.url,
      })),
    })),
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
