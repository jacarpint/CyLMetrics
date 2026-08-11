import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport, loadHistorySnapshots } from "@/lib/quality-report";
import { getHistoryIndex } from "@/lib/quality-history";
import { cn } from "@/lib/utils";
import { PanelSection } from "@/components/pages/calidad/PanelSection";
import { IncidenciasSection } from "@/components/pages/calidad/IncidenciasSection";
import { OrganismosSection } from "@/components/pages/calidad/OrganismosSection";
import { EvolucionSection } from "@/components/pages/calidad/EvolucionSection";

export const revalidate = 3600;

export const metadata = {
  title: "Calidad del Catálogo | JCyL Data Quality Portal",
  description:
    "Informe de calidad del catálogo de datos abiertos de Castilla y León: panel, incidencias, organismos y evolución.",
};

type Vista = "resumen" | "incidencias" | "organismos" | "evolucion";

const TABS: { id: Vista; label: string }[] = [
  { id: "resumen", label: "Panel" },
  { id: "incidencias", label: "Incidencias" },
  { id: "organismos", label: "Organismos" },
  { id: "evolucion", label: "Evolución" },
];

export default async function CalidadPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  const { vista: rawVista } = await searchParams;
  const vista: Vista =
    rawVista === "incidencias" || rawVista === "organismos" || rawVista === "evolucion"
      ? rawVista
      : "resumen";

  const catalog = await getCatalog();
  const report = getQualityReport();
  const { stats } = catalog;

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
