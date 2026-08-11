import type React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  Building2,
  Tag,
  FileText,
  Globe,
  Scale,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport, issueLabel, analyzedCells, type DistributionResult } from "@/lib/quality-report";
import { classifyDelivery, deliveryCause, DELIVERY_SHORT } from "@/lib/availability";
import { datasetSlug, cn } from "@/lib/utils";
import { getScoreColor, getScoreFill, combineScore } from "@/lib/quality";
import { ScoreGauge } from "@/components/quality/score-gauge";
import { IssueExplorer } from "@/components/quality/issue-explorer";
import { SchemaExplorer } from "@/components/quality/schema-explorer";
import { DistributionCard } from "@/components/quality/distribution-card";

export const revalidate = 3600;

export async function generateStaticParams() {
  const catalog = await getCatalog();
  return catalog.datasets.map((ds) => ({ datasetId: datasetSlug(ds.id) }));
}

export default async function DatasetPage({
  params,
}: {
  params: Promise<{ datasetId: string }>;
}) {
  const { datasetId } = await params;
  const catalog = await getCatalog();
  const report = getQualityReport();

  const ds = catalog.datasets.find((d) => datasetSlug(d.id) === datasetId);
  if (!ds) notFound();

  const reportDs = report?.datasets.find((r) => datasetSlug(r.dataset_id) === datasetId);
  const composite = combineScore(ds.qualityScore, reportDs?.score ?? null);

  const publisherSlug = ds.publisher.replace(/\/+$/, '').match(/(\d+)$/)?.[1]
    ?? encodeURIComponent(ds.publisher);
  const publisherDisplay = ds.publisherName ?? ds.publisher;

  const metaItems = [
    { icon: Building2, label: "Organización", value: publisherDisplay, href: `/calidad?vista=organismos#pub-${publisherSlug}` },
    { icon: Calendar, label: "Publicación", value: ds.lastUpdated },
    { icon: Scale, label: "Licencia", value: ds.license ?? "—" },
    { icon: Tag, label: "Cobertura espacial", value: ds.spatial ?? "—" },
    { icon: Globe, label: "Tema", value: ds.theme ?? "—" },
    { icon: BarChart3, label: "Periodicidad", value: ds.periodicityMonths != null ? `${ds.periodicityMonths} meses` : "—" },
  ] satisfies Array<{ icon: React.ElementType; label: string; value: string; href?: string }>;

  const keywords = ds.keywords ?? [];

  // Icono y contorno según el estado de entrega, no según `status`: así la
  // ficha, la lista y la vista de ficheros cuentan la misma historia.
  const statusIcon = (dist: DistributionResult) => {
    const state = classifyDelivery(dist);
    if (state === "ok") return <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden />;
    if (state === "roto") return <XCircle className="h-4 w-4 shrink-0 text-bad" aria-hidden />;
    return <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />;
  };

  const hasAnalysis = !!reportDs;
  const analysisScore = reportDs?.score ?? null;

  // Cada incidencia viaja con el formato de su distribución: la ficha agrega
  // varias a la vez y la tabla de muestras solo tiene sentido en las tabulares.
  const allIssues =
    reportDs?.distribution_results.flatMap((d) =>
      (d.analysis?.issues ?? []).map((issue) => ({ ...issue, format: d.format }))
    ) ?? [];
  const totalCells = reportDs?.distribution_results.reduce(
    (sum, d) => sum + analyzedCells(d.analysis?.metrics),
    0
  );

  const firstWithSchema = reportDs?.distribution_results.find(
    (d) => (d.analysis?.schema?.length ?? 0) > 0
  );

  return (
    <div className="space-y-6">
      {/* ── Breadcrumb ── */}
      <nav className="flex items-center gap-1 text-xs text-faint">
        <Link href="/catalogo" className="hover:text-body transition-colors">Catálogo</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-body truncate max-w-[30ch]">{ds.title}</span>
      </nav>

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-strong leading-snug">{ds.title}</h1>
          {ds.description && (
            <p className="text-sm text-body mt-2 leading-relaxed line-clamp-3">{ds.description}</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-center gap-1.5">
          {composite != null ? (
            <>
              <ScoreGauge score={composite} size="md" />
              <p className="text-[10px] text-faint text-center">Score compuesto</p>
            </>
          ) : ds.qualityScore != null ? (
            <>
              <ScoreGauge score={ds.qualityScore} size="md" />
              <p className="text-[10px] text-faint text-center">Score metadatos</p>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Metadatos ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-faint" />
            Metadatos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
            {metaItems.map(({ icon: Icon, label, value, href }) => (
              <div key={label} className="flex items-start gap-2">
                <Icon className="h-3.5 w-3.5 text-faint mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-faint uppercase tracking-wide">{label}</p>
                  {href ? (
                    <Link href={href} className="block truncate text-sm text-link underline-offset-2 hover:underline" title={value}>{value}</Link>
                  ) : (
                    <p className="text-sm text-body truncate" title={value}>{value}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {keywords.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-[10px] text-faint uppercase tracking-wide mb-1.5">Palabras clave</p>
              <div className="flex flex-wrap gap-1.5">
                {keywords.map((k) => (
                  <span key={k} className="rounded-full bg-fill px-2.5 py-0.5 text-xs text-faint">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {ds.qualityScore != null && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <p className="text-xs text-faint">Score de metadatos</p>
                <span className={cn("text-sm font-semibold", getScoreColor(ds.qualityScore))}>
                  {ds.qualityScore}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill">
                <div
                  className={cn("h-full rounded-full", getScoreFill(ds.qualityScore))}
                  style={{ width: `${ds.qualityScore}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Distribuciones ── */}
      {ds.distributionUrls.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-strong flex items-center gap-2">
              <Globe className="h-4 w-4 text-faint" />
              Distribuciones
              <span className="text-faint font-normal">({ds.distributionUrls.length})</span>
            </h2>
          </div>

          <div className="space-y-2">
            {ds.distributionUrls.map((dist, idx) => {
              const reportDist = reportDs?.distribution_results[idx];
              const state = reportDist ? classifyDelivery(reportDist) : null;
              const cause = reportDist ? deliveryCause(reportDist) : null;
              return (
                <Link
                  key={idx}
                  href={`/catalogo/${datasetId}/${idx}`}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-fill",
                    state === "roto"
                      ? "border-bad-line"
                      : state === "ok"
                      ? "border-ok-line"
                      : state
                      ? "border-warn-line"
                      : "border-border"
                  )}
                >
                  {reportDist && statusIcon(reportDist)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="format">{dist.format}</Badge>
                      {state && state !== "ok" && (
                        <span
                          className={cn(
                            "text-[10px] font-semibold uppercase tracking-wide",
                            state === "roto" ? "text-bad" : "text-warn"
                          )}
                          title={cause?.label}
                        >
                          {DELIVERY_SHORT[state]}
                        </span>
                      )}
                      <span className="text-xs text-faint truncate max-w-[30ch]">{dist.url}</span>
                    </div>
                    {reportDist?.analysis?.issues && reportDist.analysis.issues.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {reportDist.analysis.issues.slice(0, 2).map((issue) => (
                          <span key={issue.code} className="text-[10px] text-faint">
                            {issueLabel(issue.code)}{issue.count > 1 ? ` ×${issue.count}` : ""}
                          </span>
                        ))}
                        {reportDist.analysis.issues.length > 2 && (
                          <span className="text-[10px] text-faint">
                            +{reportDist.analysis.issues.length - 2} más
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {reportDist?.analysis?.score != null && (
                    <span className={cn("text-sm font-semibold tabular-nums shrink-0", getScoreColor(reportDist.analysis.score))}>
                      {reportDist.analysis.score}%
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-faint shrink-0" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Análisis de contenido ── */}
      {hasAnalysis && reportDs && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-strong flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-faint" />
            Análisis de contenido
            {analysisScore != null && (
              <span className={cn("font-bold", getScoreColor(analysisScore))}>
                {analysisScore}%
              </span>
            )}
          </h2>

          {reportDs.distribution_results.map((dist, idx) => (
            <DistributionCard
              key={idx}
              dist={dist}
              href={`/catalogo/${datasetId}/${idx}`}
            />
          ))}
        </section>
      )}

      {/* ── Explorador de issues ── */}
      {allIssues.length > 0 && (
        <IssueExplorer issues={allIssues} totalCells={totalCells} />
      )}

      {/* ── Schema explorer ── */}
      {firstWithSchema?.analysis?.schema && firstWithSchema.analysis.schema.length > 0 && (
        <SchemaExplorer
          schema={firstWithSchema.analysis.schema}
          sampleRows={firstWithSchema.analysis.sample_rows ?? []}
          unit={firstWithSchema.format === "JSON" || firstWithSchema.format === "GeoJSON" ? "record" : "row"}
        />
      )}
    </div>
  );
}
