import { CatalogView } from "@/components/pages/CatalogView";
import { computeStats, getCatalog } from "@/lib/rdf-catalog";
import { applyFilters, parseActiveFilters, parseVista, sortDatasets } from "@/lib/catalog-filters";
import { getQualityReport, toDatasetLite } from "@/lib/quality-report";
import { datasetSlug } from "@/lib/utils";
import { getSpatialCoords, isGeoFormat } from "@/lib/geo";
import { classifyDelivery, deliveryCause, type BrokenFileRow } from "@/lib/availability";
import type { GeoDataset } from "@/lib/types";

export const revalidate = 3600;

/** Descripción recortada en servidor: la tarjeta solo muestra 2 líneas. */
const CARD_DESCRIPTION_CHARS = 180;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CatalogoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const catalog = await getCatalog();
  const filters = parseActiveFilters(params);
  const vista = parseVista(Array.isArray(params.vista) ? params.vista[0] : params.vista);

  // Resultados del análisis por dataset (unidos por slug) para filtrado y badges.
  const report = getQualityReport();
  const analysisBySlug = report
    ? Object.fromEntries(report.datasets.map((ds) => [datasetSlug(ds.dataset_id), toDatasetLite(ds)]))
    : undefined;

  // Datasets con algún fallo geoespacial en el análisis (para pintar el marcador en rojo).
  const failedGeoIds = new Set<string>();
  if (report) {
    for (const ds of report.datasets) {
      if (ds.distribution_results.some((d) => isGeoFormat(d.format) && d.status === "error")) {
        failedGeoIds.add(ds.dataset_id);
      }
    }
  }

  // Filtrar y ordenar en servidor.
  const filtered = applyFilters(catalog.datasets, filters, analysisBySlug);
  const sorted = sortDatasets(filtered, filters.sort);
  const totalFiltered = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / filters.limit));

  // Clampear la página al rango válido (p. ej. ?page=9 de 3 páginas).
  const page = Math.min(Math.max(filters.page, 1), totalPages);

  // Paginar en servidor (solo relevante en vista de tarjetas). La descripción
  // se recorta aquí: la tarjeta la limita a 2 líneas, así que enviar el texto
  // completo solo engordaba el HTML.
  const datasets = sorted.slice((page - 1) * filters.limit, (page - 1) * filters.limit + filters.limit).map((ds) =>
    ds.description && ds.description.length > CARD_DESCRIPTION_CHARS
      ? { ...ds, description: `${ds.description.slice(0, CARD_DESCRIPTION_CHARS).trimEnd()}…` }
      : ds
  );

  // Para la vista de mapa: todo el subconjunto filtrado con coordenadas conocidas.
  const geoDatasetsForMap: GeoDataset[] =
    vista === "mapa"
      ? sorted
          .map((ds) => {
            const coords = getSpatialCoords(ds.spatial);
            return {
              id: ds.id,
              title: ds.title,
              publisher: ds.publisherName ?? ds.publisher,
              formats: ds.formats,
              latitude: coords?.[0] ?? null,
              longitude: coords?.[1] ?? null,
              hasError: failedGeoIds.has(ds.id),
            };
          })
          .filter((d) => d.latitude != null)
      : [];

  // Para la vista de ficheros: una fila por distribución que no se puede usar,
  // sobre el mismo subconjunto filtrado. Solo se calcula si se va a mostrar.
  let brokenRows: BrokenFileRow[] = [];
  let formatTotals: Record<string, number> = {};
  if (vista === "ficheros" && report) {
    const bySlug = new Map(sorted.map((ds) => [datasetSlug(ds.id), ds]));
    for (const reportDs of report.datasets) {
      const slug = datasetSlug(reportDs.dataset_id);
      const catalogDs = bySlug.get(slug);
      if (!catalogDs) continue; // fuera del filtro activo

      reportDs.distribution_results.forEach((dist, distIdx) => {
        formatTotals[dist.format] = (formatTotals[dist.format] ?? 0) + 1;
        const state = classifyDelivery(dist);
        if (state === "ok") return;
        const cause = deliveryCause(dist);
        brokenRows.push({
          datasetSlug: slug,
          datasetTitle: reportDs.dataset_title || catalogDs.title,
          publisher: catalogDs.publisherName ?? catalogDs.publisher,
          category: catalogDs.category,
          format: dist.format,
          url: dist.url,
          distIdx,
          state,
          causeCode: cause?.code ?? "desconocido",
          causeLabel: cause?.label ?? "Motivo no registrado",
          note: (dist.analysis?.summary || dist.fetch?.note || '').slice(0, 220) || undefined,
          httpStatus: dist.fetch?.http_status ?? null,
        });
      });
    }
  } else {
    formatTotals = {};
    brokenRows = [];
  }

  // Estadísticas del subconjunto filtrado.
  const stats = computeStats(filtered);

  // El análisis completo (824 datasets) se usa para filtrar en servidor, pero
  // al cliente solo van los de la página visible: la tarjeta es el único sitio
  // que lo consulta, y mandarlo entero engordaba el HTML de las tres vistas.
  const analysisForPage = analysisBySlug
    ? Object.fromEntries(
        datasets
          .map((ds) => [datasetSlug(ds.id), analysisBySlug[datasetSlug(ds.id)]] as const)
          .filter(([, lite]) => lite != null)
      )
    : undefined;

  return (
    <CatalogView
      datasets={datasets}
      stats={stats}
      totalStats={catalog.stats}
      filters={{ ...filters, page }}
      analysisBySlug={analysisForPage}
      totalFiltered={totalFiltered}
      totalPages={totalPages}
      vista={vista}
      geoDatasets={geoDatasetsForMap}
      brokenRows={brokenRows}
      formatTotals={formatTotals}
    />
  );
}
