import { CatalogView, type CatalogCardData } from "@/components/pages/CatalogView";
import { getCatalog } from "@/lib/rdf-catalog";
import { applyFilters, parseActiveFilters, sortDatasets } from "@/lib/catalog-filters";
import { getQualityReport, toDatasetLite } from "@/lib/quality-report";
import { datasetSlug } from "@/lib/utils";

export const revalidate = 3600;

/**
 * Es la página más enlazada del portal —los dos botones de la portada, el 404,
 * el glosario y la metodología llevan aquí— y era la única sin metadatos
 * propios: heredaba el nombre del sitio a secas y la descripción genérica del
 * layout, así que en una pestaña o en un buscador no se distinguía de la
 * portada.
 */
export const metadata = {
  title: "Catálogo de datos",
  description:
    "Los conjuntos de datos abiertos de Castilla y León, con el estado real de sus archivos: qué formatos publica cada uno, cuáles se pueden abrir y qué licencia los cubre.",
};

/** Descripción recortada en servidor: la tarjeta solo muestra 2 líneas. */
const CARD_DESCRIPTION_CHARS = 180;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CatalogoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const catalog = await getCatalog();
  const filters = parseActiveFilters(params);

  // Resultados del análisis por dataset (unidos por slug) para filtrado y badges.
  const report = getQualityReport();
  const analysisBySlug = report
    ? Object.fromEntries(report.datasets.map((ds) => [datasetSlug(ds.dataset_id), toDatasetLite(ds)]))
    : undefined;

  // Filtrar y ordenar en servidor.
  const filtered = applyFilters(catalog.datasets, filters, analysisBySlug);
  // El análisis va también al ordenar: los criterios de calidad usan el índice
  // compuesto, que es el que pinta la tarjeta.
  const sorted = sortDatasets(filtered, filters.sort, analysisBySlug);
  const totalFiltered = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / filters.limit));

  // Clampear la página al rango válido (p. ej. ?page=9 de 3 páginas).
  const page = Math.min(Math.max(filters.page, 1), totalPages);

  // Paginar en servidor y quedarse solo con los campos que pinta la tarjeta.
  // La descripción se recorta aquí porque la tarjeta la limita a 2 líneas.
  const datasets: CatalogCardData[] = sorted
    .slice((page - 1) * filters.limit, (page - 1) * filters.limit + filters.limit)
    .map((ds) => ({
      id: ds.id,
      title: ds.title,
      description:
        ds.description && ds.description.length > CARD_DESCRIPTION_CHARS
          ? `${ds.description.slice(0, CARD_DESCRIPTION_CHARS).trimEnd()}…`
          : ds.description ?? '',
      formats: ds.formats,
      updatedAgo: ds.updatedAgo,
      qualityScore: ds.qualityScore,
    }));

  // El análisis completo (824 datasets) se usa para filtrar en servidor, pero
  // al cliente solo van los de la página visible: la tarjeta es el único sitio
  // que lo consulta, y mandarlo entero engordaba mucho el HTML.
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
      totalStats={catalog.stats}
      filters={{ ...filters, page }}
      analysisBySlug={analysisForPage}
      totalFiltered={totalFiltered}
      totalPages={totalPages}
    />
  );
}
