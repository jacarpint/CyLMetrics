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
  type FileIssueRow,
  type FileIssueRows,
  type IssueFamily,
} from "@/lib/availability";
import { isBlockingCode } from "@/lib/alerts";
import { METADATA_GAPS, type MetadataGapCode } from "@/lib/metadata-gaps";
import { distributionSlugs } from "@/lib/distribution-slug";
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
  title: "Calidad del Catálogo | JCyL Data Quality Portal",
  description:
    "Qué hay que corregir en el catálogo de datos abiertos de Castilla y León: ficheros que no se pueden usar, contenido con errores y huecos de metadatos, con la acción concreta para cada caso.",
};

/**
 * Un fichero con defecto por cada distribución con algo que corregir.
 *
 * Cubre las dos familias. Antes solo se construían las filas de entrega, así que
 * los ficheros que se abren con errores de contenido no aparecían en ninguna
 * tabla explorable.
 *
 * Se recorre el catálogo (no el informe) y se emparejan los resultados por URL:
 * así el slug de la URL de cada fila —`/csv`, `/csv-2`— es el que la ficha del
 * dataset publica de verdad.
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

      rows.push({
        ...base,
        family: "contenido",
        state: "ok",
        causeCode: errorIssues[0].code,
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

/** Texto de la periodicidad declarada, para las listas de actualidad. */
function periodicityText(months: number | undefined): string | undefined {
  if (!months || months <= 0) return undefined;
  if (months < 1) return "diaria";
  if (months === 1) return "mensual";
  if (months === 3) return "trimestral";
  if (months === 6) return "semestral";
  if (months === 12) return "anual";
  return `cada ${Math.round(months)} meses`;
}

function toLite(ds: Dataset): MetadataDatasetLite {
  return {
    slug: datasetSlug(ds.id),
    title: ds.title || datasetSlug(ds.id),
    periodsLate: ds.freshness.periodsLate,
    periodicity: periodicityText(ds.periodicityMonths),
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

type Vista = "prioridades" | "ficheros" | "metadatos" | "evolucion";

const TABS: { id: Vista; label: string }[] = [
  { id: "prioridades", label: "Prioridades" },
  { id: "ficheros", label: "Ficheros" },
  { id: "metadatos", label: "Metadatos" },
  { id: "evolucion", label: "Evolución" },
];

const VALID_VISTAS = new Set<string>(TABS.map((t) => t.id));

/**
 * Vistas anteriores a la reorganización. Se mantienen para que no se rompan los
 * enlaces publicados ni los `redirect()` de /transparencia, /alertas y
 * /tendencias.
 */
const LEGACY_VISTAS: Record<string, Vista> = {
  resumen: "prioridades",
  organismos: "prioridades",
  reparar: "ficheros",
  incidencias: "ficheros",
};

function resolveVista(raw: string | undefined): Vista {
  if (!raw) return "prioridades";
  if (VALID_VISTAS.has(raw)) return raw as Vista;
  return LEGACY_VISTAS[raw] ?? "prioridades";
}

export default async function CalidadPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; familia?: string; causa?: string; hueco?: string }>;
}) {
  const params = await searchParams;
  const vista = resolveVista(params.vista);
  // Al venir de «Incidencias» se preselecciona la familia de contenido, que es
  // lo que esa pestaña enseñaba.
  const familia: IssueFamily | "todas" =
    params.familia === "entrega" || params.familia === "contenido"
      ? params.familia
      : params.vista === "incidencias"
      ? "contenido"
      : "todas";

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
          <h1 className="text-2xl font-bold tracking-tight text-strong">Calidad del Catálogo</h1>
          <p className="mt-1 text-sm text-faint">
            Qué corregir en los {stats.totalDatasets.toLocaleString("es-ES")} datasets y{" "}
            {stats.totalDistributions.toLocaleString("es-ES")} distribuciones publicadas.
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
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/calidad?vista=${tab.id}`}
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
        <PrioridadesSection catalog={catalog} report={report} causes={causes} />
      )}
      {vista === "ficheros" && files && (
        <FicherosSection
          rows={files.rows}
          notes={files.notes}
          byFormat={byFormat}
          initialFamily={familia}
          initialCause={params.causa ?? ""}
        />
      )}
      {vista === "metadatos" && (
        <MetadatosSection
          totalDatasets={stats.totalDatasets}
          groups={metadataGroups}
          overdue={overdue}
          initialGap={params.hueco ?? ""}
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
