import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCatalog } from "@/lib/rdf-catalog";
import {
  getQualityReport,
  loadHistorySnapshots,
  matchDistributions,
  type FormatSummary,
  type QualityReport,
} from "@/lib/quality-report";
import { getHistoryIndex } from "@/lib/quality-history";
import {
  classifyDelivery,
  createNoteTable,
  deliveryCause,
  findSystemicCauses,
  formatContentScores,
  type FileIssueRow,
  type FileIssueRows,
} from "@/lib/availability";
import { buildQualityUrl, parseQualityFilters, VISTAS } from "@/lib/quality-filters";
import { isBlockingCode } from "@/lib/alerts";
import { METADATA_GAPS, type MetadataGapCode } from "@/lib/metadata-gaps";
import { distributionSlugs } from "@/lib/distribution-slug";
import { periodicityLabel } from "@/lib/vocabularies";
import { cn, datasetSlug } from "@/lib/utils";
import type { CatalogData, Dataset } from "@/lib/types";
import { PrioridadesSection } from "@/components/pages/calidad/PrioridadesSection";
import { FicherosSection } from "@/components/pages/calidad/FicherosSection";
import {
  MetadatosSection,
  type MetadataDatasetLite,
  type MetadataGapGroup,
} from "@/components/pages/calidad/MetadatosSection";
import { EvolucionSection } from "@/components/pages/calidad/EvolucionSection";

export const revalidate = 3600;

export const metadata = {
  title: "Calidad del catálogo",
  description:
    "Qué hay que corregir en el catálogo de datos abiertos de Castilla y León: archivos que no se pueden usar, contenido con errores y campos de metadatos pendientes, con la acción concreta para cada caso.",
};

/**
 * Un fichero con defecto por cada distribución con algo que corregir, en las dos
 * familias: la que no llega y la que llega sucia.
 *
 * Se recorre el catálogo y no el informe, emparejando los resultados por URL,
 * porque así el slug de cada fila —`/csv`, `/csv-2`— es el mismo que publica la
 * ficha del conjunto de datos. Recorrer el informe daría índices que no cuadran
 * con las URL navegables.
 */
function buildFileIssueRows(catalog: CatalogData, report: QualityReport | null): FileIssueRows {
  const rows: FileIssueRow[] = [];
  const formatTotals: Record<string, number> = {};
  const noteTable = createNoteTable();
  if (!report) return { rows, notes: noteTable.notes, formatTotals, totalDistributions: 0 };

  const reportBySlug = new Map(report.datasets.map((ds) => [datasetSlug(ds.dataset_id), ds]));

  for (const ds of catalog.datasets) {
    const slug = datasetSlug(ds.id);
    const reportDs = reportBySlug.get(slug);
    if (!reportDs) continue;

    const distSlugs = distributionSlugs(ds.distributionUrls.map((d) => d.format));
    const results = matchDistributions(ds.distributionUrls, reportDs.distribution_results);

    results.forEach((dist, distIdx) => {
      if (!dist) return;
      formatTotals[dist.format] = (formatTotals[dist.format] ?? 0) + 1;

      const state = classifyDelivery(dist);
      const base = {
        datasetSlug: slug,
        datasetTitle: ds.title || reportDs.dataset_title || slug,
        category: ds.category ?? "Sin clasificar",
        format: dist.format,
        url: dist.url,
        distSlug: distSlugs[distIdx],
        noteIdx: noteTable.add((dist.analysis?.summary || dist.fetch?.note || "").slice(0, 220) || undefined),
        httpStatus: dist.fetch?.http_status ?? null,
      };

      if (state !== "ok") {
        const cause = deliveryCause(dist);
        rows.push({
          ...base,
          family: "entrega",
          state,
          causeCode: cause?.code ?? "desconocido",
        });
        return;
      }

      // El fichero abre. Solo genera fila si trae errores de contenido: las
      // celdas vacías son advertencias y son el 98% de las incidencias del
      // catálogo, así que ahogarían la tabla sin señalar nada corregible.
      const errorIssues = (dist.analysis?.issues ?? []).filter(
        (i) => i.severity === "error" && !isBlockingCode(i.code)
      );
      if (errorIssues.length === 0) return;

      // Todos los códigos, no solo el primero: filtrar por `causeCode` a secas
      // escondía los archivos en los que el código buscado no era el primero, y
      // esos sí los contaba la tarjeta de la que viene el enlace.
      const codes = [...new Set(errorIssues.map((i) => i.code))];
      rows.push({
        ...base,
        family: "contenido",
        state: "ok",
        causeCode: codes[0],
        // Solo si aporta algo: con un único código sería repetir `causeCode` en
        // cada una de las ~1.000 filas que viajan al navegador.
        ...(codes.length > 1 ? { causeCodes: codes } : {}),
        errorIssues: errorIssues.length,
      });
    });
  }

  return {
    rows,
    notes: noteTable.notes,
    formatTotals,
    totalDistributions: Object.values(formatTotals).reduce((a, b) => a + b, 0),
  };
}

function toLite(ds: Dataset): MetadataDatasetLite {
  return {
    slug: datasetSlug(ds.id),
    title: ds.title || datasetSlug(ds.id),
    periodsLate: ds.freshness.periodsLate,
    // En minúscula: aquí va intercalada en una frase, no como valor de un campo.
    periodicity: periodicityLabel(ds.periodicityMonths) ?? undefined,
  };
}

/**
 * Agrupa los datasets por hueco de metadatos.
 *
 * Al cliente solo van el slug y el título de cada dataset, no el objeto entero:
 * el hueco mayoritario alcanza a 749 datasets y serializarlos completos
 * multiplicaría por veinte el peso de la página.
 */
function buildMetadataGroups(datasets: readonly Dataset[]): MetadataGapGroup[] {
  const byCode = new Map<MetadataGapCode, MetadataDatasetLite[]>();
  for (const ds of datasets) {
    for (const gap of ds.metadataGaps) {
      const list = byCode.get(gap);
      if (list) list.push(toLite(ds));
      else byCode.set(gap, [toLite(ds)]);
    }
  }
  // Las recomendaciones al final; dentro de cada eje, por volumen.
  const axisOrder = { actualidad: 0, completitud: 1, apertura: 2, recomendacion: 3 };
  return [...byCode.entries()]
    .map(([code, list]) => ({ code, datasets: list }))
    .sort(
      (a, b) =>
        axisOrder[METADATA_GAPS[a.code].axis] - axisOrder[METADATA_GAPS[b.code].axis] ||
        b.datasets.length - a.datasets.length
    );
}

export default async function CalidadPage({
  searchParams,
}: {
  // Todo el contrato de filtros está en `parseQualityFilters`, no aquí: cuando
  // esta firma enumeraba las claves a mano, una que no estuviera en la lista se
  // descartaba en silencio. Es lo que pasaba con `formato`.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseQualityFilters(params);
  const { vista } = filters;

  const catalog = await getCatalog();
  const report = getQualityReport();
  const { stats } = catalog;

  // Las filas se calculan para Prioridades y para Ficheros: la primera necesita
  // las causas sistémicas, que se agrupan a partir de ellas.
  const needsRows = vista === "prioridades" || vista === "ficheros";
  const files = needsRows ? buildFileIssueRows(catalog, report) : null;
  const causes = files
    ? findSystemicCauses(
        files.rows.filter((r) => r.family === "entrega"),
        files.formatTotals
      )
    : [];

  const byFormat: [string, FormatSummary][] = report
    ? Object.entries(report.by_format).sort((a, b) => b[1].total - a[1].total)
    : [];

  const metadataGroups = vista === "metadatos" ? buildMetadataGroups(catalog.datasets) : [];
  const overdue =
    vista === "metadatos"
      ? catalog.datasets
          .filter((ds) => ds.freshness.diagnosis === "vencido")
          .sort((a, b) => (b.freshness.periodsLate ?? 0) - (a.freshness.periodsLate ?? 0))
          .map(toLite)
      : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-strong">Calidad del catálogo</h1>
          <p className="mt-1 text-sm text-faint">
            Qué corregir en los {stats.totalDatasets.toLocaleString("es-ES")} conjuntos de datos y{" "}
            {stats.totalDistributions.toLocaleString("es-ES")} archivos publicados.
          </p>
        </div>
        <Link
          href="/metodologia"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-link hover:text-link-hover hover:underline"
        >
          Cómo se calcula la calidad <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex w-fit items-center gap-1 overflow-x-auto rounded-lg border border-border p-1">
        {VISTAS.map((tab) => (
          <Link
            key={tab.id}
            href={buildQualityUrl({ vista: tab.id })}
            aria-current={vista === tab.id ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              vista === tab.id ? "bg-primary text-primary-fg" : "text-body hover:bg-fill"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {vista === "prioridades" && (
        <PrioridadesSection
          catalog={catalog}
          report={report}
          causes={causes}
          // Del mismo recuento de filas que alimenta la pestaña Archivos, para
          // que las dos vistas no puedan dar cifras distintas del mismo hecho.
          contentAffected={files?.rows.filter((r) => r.family === "contenido").length ?? 0}
        />
      )}
      {vista === "ficheros" && files && (
        // `key` con los filtros de la URL: `FicherosSection` los mantiene en
        // estado local para que escribir en el buscador no navegue en cada tecla,
        // y sin esto llegar con `?causa=B` desde `?causa=A` con el componente ya
        // montado dejaba puesto el filtro anterior. Remontar es lo más simple que
        // no puede desincronizarse.
        <FicherosSection
          key={buildQualityUrl(filters)}
          rows={files.rows}
          notes={files.notes}
          byFormat={byFormat}
          formatScores={formatContentScores(report)}
          filters={filters}
        />
      )}
      {vista === "metadatos" && (
        <MetadatosSection
          key={filters.hueco ?? ""}
          totalDatasets={stats.totalDatasets}
          groups={metadataGroups}
          overdue={overdue}
          initialGap={filters.hueco ?? ""}
        />
      )}
      {vista === "evolucion" && (
        <EvolucionSection
          catalog={catalog}
          report={report}
          index={getHistoryIndex()}
          snapshots={loadHistorySnapshots(20)}
        />
      )}
    </div>
  );
}
