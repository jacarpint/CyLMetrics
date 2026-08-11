import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileSearch,
  Globe,
  Hash,
  Layers,
  ChevronLeft,
  Braces,
  Table2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport, distributionVolume, analyzedCells, formatBytes } from "@/lib/quality-report";
import { classifyDelivery, deliveryCause, DELIVERY_EXPLANATIONS, DELIVERY_LABELS } from "@/lib/availability";
import { datasetSlug, cn } from "@/lib/utils";
import { ScoreGauge } from "@/components/quality/score-gauge";
import { IssueExplorer } from "@/components/quality/issue-explorer";
import { SchemaExplorer } from "@/components/quality/schema-explorer";
import { DistributionMap } from "@/components/quality/distribution-map";
import { JsonViewer } from "@/components/quality/json-viewer";
import { TableViewer } from "@/components/quality/table-viewer";
import { isGeoFormat } from "@/lib/geo";
import { distributionSlugs, resolveDistributionIndex } from "@/lib/distribution-slug";

export const revalidate = 3600;

export async function generateStaticParams() {
  const report = getQualityReport();
  if (!report) return [];

  // La URL usa el formato (/csv, /json, /csv-2) en vez de la posición.
  return report.datasets.flatMap((rDs) => {
    const slugs = distributionSlugs(rDs.distribution_results.map((d) => d.format));
    return slugs.map((slug) => ({ datasetId: datasetSlug(rDs.dataset_id), distIdx: slug }));
  });
}

export default async function DistributionPage({
  params,
}: {
  params: Promise<{ datasetId: string; distIdx: string }>;
}) {
  const { datasetId, distIdx } = await params;

  const catalog = await getCatalog();
  const report = getQualityReport();

  const ds = catalog.datasets.find((d) => datasetSlug(d.id) === datasetId);
  if (!ds) notFound();

  // Acepta el slug nuevo (/csv, /csv-2) y el índice numérico de los enlaces
  // publicados antes del cambio.
  const formats = ds.distributionUrls.map((d) => d.format);
  const slugs = distributionSlugs(formats);
  const idx = resolveDistributionIndex(formats, distIdx);
  if (idx < 0) notFound();

  const distMeta = ds.distributionUrls[idx];
  if (!distMeta) notFound();

  const reportDs = report?.datasets.find((r) => datasetSlug(r.dataset_id) === datasetId);
  const dist = reportDs?.distribution_results[idx];

  const score = dist?.analysis?.score ?? null;
  const status = dist?.status ?? null;
  const issues = dist?.analysis?.issues ?? [];
  const schema = dist?.analysis?.schema ?? null;

  const fmt = distMeta.format;
  const isGeo = isGeoFormat(fmt);
  const isJson = fmt === "JSON";
  const isRecordShaped = isJson || fmt === "GeoJSON";
  // Formatos separados por comas o tabulaciones que el navegador puede leer.
  const isTabular = ["CSV", "TSV", "TXT"].includes(fmt);
  const fetchSize = dist?.fetch?.size ?? null;

  const metrics = dist?.analysis?.metrics ?? {};
  // El analizador nombra estas métricas según el formato; el helper traduce.
  const { primary, secondary } = distributionVolume(fmt, metrics);
  const encoding = typeof metrics.encoding === "string" ? metrics.encoding : null;
  const totalCells = analyzedCells(metrics) || undefined;
  // Errores y avisos nunca se suman: el volumen de celdas vacías (82% de todas
  // las incidencias del catálogo) enmascaraba los fallos que sí bloquean.
  const errorTotal = issues.filter((i) => i.severity === "error").reduce((n, i) => n + i.count, 0);
  const warningTotal = issues.filter((i) => i.severity === "warning").reduce((n, i) => n + i.count, 0);

  const prevIdx = idx > 0 ? idx - 1 : null;
  const nextIdx = ds.distributionUrls[idx + 1] ? idx + 1 : null;
  const prevFmt = prevIdx != null ? ds.distributionUrls[prevIdx].format : null;
  const nextFmt = nextIdx != null ? ds.distributionUrls[nextIdx].format : null;

  // Estado de entrega: sustituye a la etiqueta gris «Omitida», que no decía
  // nada. 126 de las 129 omitidas del catálogo son URLs que devuelven una
  // página web en lugar del archivo, y eso sí se puede explicar.
  const delivery = dist ? classifyDelivery(dist) : null;
  const cause = dist ? deliveryCause(dist) : null;
  const StatusIcon = delivery === "ok" ? CheckCircle2 : delivery === "roto" ? XCircle : AlertTriangle;
  const statusColor =
    delivery === "ok" ? "text-ok" : delivery === "roto" ? "text-bad" : "text-warn";

  // Distribuciones de servicio (WMS/WFS) del mismo dataset, útiles cuando la
  // actual (p. ej. SHP) no es previsualizable en el navegador.
  const serviceSiblings = ds.distributionUrls
    .map((d, i) => ({ format: d.format, idx: i }))
    .filter((d) => d.idx !== idx && (d.format === "WMS" || d.format === "WFS"))
    .map((d) => ({ ...d, slug: slugs[d.idx] }));

  const stats = [
    primary && { icon: Hash, label: primary.label, value: primary.value.toLocaleString("es-ES") },
    secondary && { icon: Layers, label: secondary.label, value: secondary.value.toLocaleString("es-ES") },
    encoding && { icon: FileSearch, label: "Codificación", value: encoding },
    fetchSize ? { icon: Globe, label: "Tamaño", value: formatBytes(fetchSize) } : null,
  ].filter(Boolean) as { icon: typeof Hash; label: string; value: string }[];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* ── Breadcrumb ── */}
      <nav aria-label="Migas de pan" className="flex flex-wrap items-center gap-1 text-xs text-faint">
        <Link href="/catalogo" className="rounded transition-colors hover:text-body">Catálogo</Link>
        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
        <Link href={`/catalogo/${datasetId}`} className="max-w-[24ch] truncate rounded transition-colors hover:text-body">
          {ds.title}
        </Link>
        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-medium text-strong" aria-current="page">Distribución {idx + 1}</span>
      </nav>

      {/* ── Cabecera ── */}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="format">{distMeta.format}</Badge>
            {delivery && delivery !== "ok" && (
              <span className={cn("inline-flex items-center gap-1 text-xs font-medium", statusColor)}>
                <StatusIcon className="h-3.5 w-3.5" aria-hidden />
                {DELIVERY_LABELS[delivery]}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-strong">{ds.title}</h1>
          <p className="mt-1 text-sm text-faint">
            Distribución {idx + 1} de {ds.distributionUrls.length}
          </p>
        </div>
        {score != null && <ScoreGauge score={score} size="md" label="Score de contenido" className="shrink-0" />}
      </header>

      {/* ── Por qué este recurso no se pudo usar ── */}
      {delivery && delivery !== "ok" && (
        <Card tone={delivery === "roto" ? "bad" : "warn"}>
          <CardContent className="flex items-start gap-3 p-4">
            <StatusIcon className={cn("mt-0.5 h-4 w-4 shrink-0", statusColor)} aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-strong">
                {cause?.label ?? DELIVERY_LABELS[delivery]}
                {dist?.fetch?.http_status ? (
                  <span className="ml-2 font-mono text-xs font-normal text-faint">
                    HTTP {dist.fetch.http_status}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-body">{DELIVERY_EXPLANATIONS[delivery]}</p>
              {dist?.analysis?.summary && (
                <p className="mt-1.5 text-xs leading-relaxed text-faint">{dist.analysis.summary}</p>
              )}
              {delivery === "no-entrega" && (
                <p className="mt-2 text-xs text-faint">
                  Esta distribución no penaliza la puntuación del dataset, pero sí impide la
                  reutilización automatizada.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── URL ── */}
      <Card>
        <CardContent className="p-4">
          <p className="eyebrow mb-1.5">URL de acceso</p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-fill px-3 py-2 text-sm">
            <Globe className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            <span className="flex-1 truncate font-mono text-xs text-body">{distMeta.url}</span>
            <a
              href={distMeta.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-card hover:text-body"
              aria-label="Abrir la URL del recurso en una pestaña nueva"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        </CardContent>
      </Card>

      {/* ── Volumen analizado ── */}
      {(stats.length > 0 || issues.length > 0) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(({ icon: Icon, label, value }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="eyebrow mb-1 flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </p>
                <p className="text-xl font-bold tabular-nums text-strong">{value}</p>
              </CardContent>
            </Card>
          ))}
          <Card tone={errorTotal > 0 ? "bad" : warningTotal > 0 ? "warn" : "ok"}>
            <CardContent className="p-4">
              <p className="eyebrow mb-1 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Incidencias
              </p>
              {errorTotal === 0 && warningTotal === 0 ? (
                <p className="text-xl font-bold tabular-nums text-ok">0</p>
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  {errorTotal > 0 && (
                    <p className="text-xl font-bold tabular-nums text-bad">
                      {errorTotal.toLocaleString("es-ES")}
                      <span className="ml-1 text-[11px] font-medium">
                        {errorTotal === 1 ? "error" : "errores"}
                      </span>
                    </p>
                  )}
                  {warningTotal > 0 && (
                    <p className="text-sm font-semibold tabular-nums text-warn">
                      {warningTotal.toLocaleString("es-ES")}
                      <span className="ml-1 text-[11px] font-medium">
                        {warningTotal === 1 ? "aviso" : "avisos"}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Vista previa (mapa / JSON / tabla) ──────────────────────────────
          La tabla descarga el fichero real, no las 10 filas del informe: aquí
          se explora el archivo entero. Solo se ofrece si el recurso se pudo
          abrir; con un enlace roto no hay nada que enseñar. */}
      {(isGeo || isJson || (isTabular && delivery === "ok")) && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
            {isGeo ? (
              <Globe className="h-4 w-4 text-faint" aria-hidden />
            ) : isJson ? (
              <Braces className="h-4 w-4 text-faint" aria-hidden />
            ) : (
              <Table2 className="h-4 w-4 text-faint" aria-hidden />
            )}
            Vista previa {isGeo ? "geoespacial" : isJson ? "del JSON" : "de los datos"}
          </h2>
          {isGeo ? (
            <DistributionMap
              format={fmt}
              url={distMeta.url}
              datasetId={datasetId}
              spatial={ds.spatial}
              dead={status === "error"}
              serviceSiblings={serviceSiblings}
            />
          ) : isJson ? (
            <JsonViewer url={distMeta.url} sizeBytes={fetchSize} />
          ) : (
            <TableViewer
              url={distMeta.url}
              sizeBytes={fetchSize}
              reportedRows={typeof metrics.rows === "number" ? metrics.rows : null}
              reportTruncated={Boolean(dist?.analysis?.truncated)}
            />
          )}
        </section>
      )}

      {/* ── Incidencias ── */}
      {issues.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
            <AlertTriangle className="h-4 w-4 text-faint" aria-hidden />
            Incidencias detectadas
          </h2>
          {/* El formato decide la presentación: tabla solo para lo tabular. */}
          <IssueExplorer issues={issues} totalCells={totalCells} format={fmt} />
        </section>
      )}

      {/* ── Esquema ── */}
      {schema && schema.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
            <Layers className="h-4 w-4 text-faint" aria-hidden />
            {isRecordShaped ? "Campos detectados" : "Esquema de columnas"}
          </h2>
          <SchemaExplorer
            schema={schema}
            unit={isRecordShaped ? "record" : "row"}
            truncated={Boolean(dist?.analysis?.truncated)}
          />
        </section>
      )}

      {/* ── Navegación entre distribuciones ── */}
      {(prevIdx != null || nextIdx != null) && (
        <nav aria-label="Otras distribuciones" className="flex items-center justify-between gap-4 border-t border-border pt-4">
          {prevIdx != null ? (
            <Link
              href={`/catalogo/${datasetId}/${slugs[prevIdx]}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-body transition-colors hover:border-border-strong hover:bg-fill"
            >
              <ChevronLeft className="h-4 w-4 text-faint" aria-hidden />
              <span>
                <span className="block text-xs text-faint">Anterior</span>
                <Badge variant="format">{prevFmt}</Badge>
              </span>
            </Link>
          ) : (
            <div />
          )}
          {nextIdx != null ? (
            <Link
              href={`/catalogo/${datasetId}/${slugs[nextIdx]}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-body transition-colors hover:border-border-strong hover:bg-fill"
            >
              <span className="text-right">
                <span className="block text-xs text-faint">Siguiente</span>
                <Badge variant="format">{nextFmt}</Badge>
              </span>
              <ChevronRight className="h-4 w-4 text-faint" aria-hidden />
            </Link>
          ) : (
            <div />
          )}
        </nav>
      )}

      <Link
        href={`/catalogo/${datasetId}`}
        className="inline-flex items-center gap-1.5 text-sm text-faint transition-colors hover:text-body"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Volver a la ficha del dataset
      </Link>
    </div>
  );
}
