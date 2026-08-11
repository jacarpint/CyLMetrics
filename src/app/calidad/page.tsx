import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport, loadHistorySnapshots, type QualityReport } from "@/lib/quality-report";
import { getHistoryIndex } from "@/lib/quality-history";
import { classifyDelivery, deliveryCause, type BrokenFileRow } from "@/lib/availability";
import { distributionSlugs } from "@/lib/distribution-slug";
import { cn, datasetSlug } from "@/lib/utils";
import type { CatalogData } from "@/lib/types";
import { PanelSection } from "@/components/pages/calidad/PanelSection";
import { BrokenFilesView } from "@/components/pages/BrokenFilesView";
import { IncidenciasSection } from "@/components/pages/calidad/IncidenciasSection";
import { OrganismosSection } from "@/components/pages/calidad/OrganismosSection";
import { EvolucionSection } from "@/components/pages/calidad/EvolucionSection";

/** Una fila por distribución que no se puede usar, más totales por formato. */
function buildRepairRows(catalog: CatalogData, report: QualityReport | null) {
  const rows: BrokenFileRow[] = [];
  const formatTotals: Record<string, number> = {};
  if (!report) return { rows, formatTotals, totalDistributions: 0 };

  const bySlug = new Map(catalog.datasets.map((ds) => [datasetSlug(ds.id), ds]));

  for (const reportDs of report.datasets) {
    const slug = datasetSlug(reportDs.dataset_id);
    const catalogDs = bySlug.get(slug);
    const distSlugs = distributionSlugs(reportDs.distribution_results.map((d) => d.format));

    reportDs.distribution_results.forEach((dist, distIdx) => {
      formatTotals[dist.format] = (formatTotals[dist.format] ?? 0) + 1;
      if (classifyDelivery(dist) === "ok") return;
      const cause = deliveryCause(dist);
      rows.push({
        datasetSlug: slug,
        datasetTitle: reportDs.dataset_title || catalogDs?.title || slug,
        publisher: catalogDs?.publisherName ?? catalogDs?.publisher ?? "",
        category: catalogDs?.category ?? "Sin clasificar",
        format: dist.format,
        url: dist.url,
        distIdx,
        distSlug: distSlugs[distIdx],
        state: classifyDelivery(dist) as BrokenFileRow["state"],
        causeCode: cause?.code ?? "desconocido",
        causeLabel: cause?.label ?? "Motivo no registrado",
        note: (dist.analysis?.summary || dist.fetch?.note || "").slice(0, 220) || undefined,
        httpStatus: dist.fetch?.http_status ?? null,
      });
    });
  }

  return {
    rows,
    formatTotals,
    totalDistributions: Object.values(formatTotals).reduce((a, b) => a + b, 0),
  };
}

export const revalidate = 3600;

export const metadata = {
  title: "Calidad del Catálogo | JCyL Data Quality Portal",
  description:
    "Informe de calidad del catálogo de datos abiertos de Castilla y León: panel, incidencias, organismos y evolución.",
};

type Vista = "resumen" | "reparar" | "incidencias" | "organismos" | "evolucion";

const TABS: { id: Vista; label: string }[] = [
  { id: "resumen", label: "Panel" },
  { id: "reparar", label: "Qué arreglar" },
  { id: "incidencias", label: "Incidencias" },
  { id: "organismos", label: "Organismos" },
  { id: "evolucion", label: "Evolución" },
];

const VALID_VISTAS = new Set<string>(TABS.map((t) => t.id));

export default async function CalidadPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  const { vista: rawVista } = await searchParams;
  const vista: Vista = rawVista && VALID_VISTAS.has(rawVista) ? (rawVista as Vista) : "resumen";

  const catalog = await getCatalog();
  const report = getQualityReport();
  const { stats } = catalog;

  // Filas de la vista "Qué arreglar": una por distribución inutilizable, sobre
  // el catálogo completo. Solo se calculan si esa pestaña está activa.
  const repair = vista === "reparar" ? buildRepairRows(catalog, report) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-strong tracking-tight">Calidad del Catálogo</h1>
          <p className="text-sm text-faint mt-1">
            Diagnóstico del catálogo de datos abiertos de Castilla y León: {stats.totalDatasets} datasets y{" "}
            {stats.totalDistributions} distribuciones.
          </p>
        </div>
        <Link
          href="/metodologia"
          className="inline-flex items-center gap-1 text-xs text-link hover:text-link-hover hover:underline shrink-0"
        >
          Cómo se calcula la calidad <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-border p-1 w-fit overflow-x-auto">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/calidad?vista=${tab.id}`}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
              vista === tab.id ? "bg-primary text-primary-fg" : "text-body hover:bg-fill"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {vista === "resumen" && <PanelSection catalog={catalog} report={report} />}
      {vista === "reparar" && repair && (
        <BrokenFilesView
          rows={repair.rows}
          formatTotals={repair.formatTotals}
          totalDistributions={repair.totalDistributions}
        />
      )}
      {vista === "incidencias" && <IncidenciasSection catalog={catalog} report={report} />}
      {vista === "organismos" && <OrganismosSection catalog={catalog} report={report} />}
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
