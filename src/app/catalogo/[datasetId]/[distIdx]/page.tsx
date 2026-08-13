import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
  Layers,
  ChevronLeft,
  Table2,
  Clock3,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCatalog } from "@/lib/rdf-catalog";
import {
  getQualityReport,
  distributionVolume,
  analyzedCells,
  formatBytes,
  matchDistributions,
} from "@/lib/quality-report";
import { classifyDelivery, deliveryCause, DELIVERY_EXPLANATIONS, DELIVERY_LABELS } from "@/lib/availability";
import { datasetSlug, cn } from "@/lib/utils";
import { ScoreGauge } from "@/components/quality/score-gauge";
import { IssueExplorer } from "@/components/quality/issue-explorer";
import { SchemaExplorer } from "@/components/quality/schema-explorer";
import { DistributionMap } from "@/components/quality/distribution-map";
import { FileExplorer, type FileKind } from "@/components/quality/file-explorer";
import { ApiPanel } from "@/components/quality/api-panel";
import { isGeoFormat } from "@/lib/geo";
import { distributionSlugs, resolveDistributionIndex } from "@/lib/distribution-slug";

export const revalidate = 3600;

/**
 * Formatos que el explorador sabe abrir en el navegador y reducir a filas y
 * columnas. Los geoespaciales no entran: se quedan con su visor de mapa.
 */
const EXPLORABLE_FORMATS: Record<string, FileKind> = {
  CSV: "csv", TSV: "csv", TXT: "csv",
  XLSX: "xlsx", XLS: "xlsx",
  JSON: "json",
};

/**
 * Filas que registró el análisis, para que el explorador pueda avisar si el
 * archivo de hoy no cuadra con lo que se midió entonces.
 *
 * Devuelve `null` cuando no hay comparación posible, que no es lo mismo que
 * cero: en un XLSX de varias hojas `total_rows` las suma todas, así que
 * contrastarlo con lo que el explorador lee de UNA hoja daría una falsa alarma.
 */
function reportedRowCount(kind: FileKind | undefined, metrics: Record<string, unknown>): number | null {
  if (kind === "xlsx") {
    const sheets = typeof metrics.sheet_count === "number" ? metrics.sheet_count : 1;
    if (sheets !== 1) return null;
    return typeof metrics.total_rows === "number" ? metrics.total_rows : null;
  }
  return typeof metrics.rows === "number" ? metrics.rows : null;
}

/**
 * Las rutas salen del catálogo y no del informe, porque el catálogo es quien
 * decide qué archivos existen. Generarlas desde el informe deja sin prerenderizar
 * todo lo publicado después del último análisis.
 */
export async function generateStaticParams() {
  const catalog = await getCatalog();
  // La URL usa el formato (/csv, /json, /csv-2) en vez de la posición.
  return catalog.datasets.flatMap((ds) => {
    const slugs = distributionSlugs(ds.distributionUrls.map((d) => d.format));
    return slugs.map((slug) => ({ datasetId: datasetSlug(ds.id), distIdx: slug }));
  });
}

/**
 * Metadatos del archivo.
 *
 * Igual que en la ficha del conjunto: si no se encuentra, aquí NO se llama a
 * `notFound()` —eso hornea un 404 estático para rutas válidas cuando el build usa
 * la copia local de respaldo— y decide el cuerpo de la página.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ datasetId: string; distIdx: string }>;
}): Promise<Metadata> {
  const { datasetId, distIdx } = await params;
  const catalog = await getCatalog();
  const ds = catalog.datasets.find((d) => datasetSlug(d.id) === datasetId);
  if (!ds) return { title: "Archivo no encontrado" };

  const formats = ds.distributionUrls.map((d) => d.format);
  const idx = resolveDistributionIndex(formats, distIdx);
  if (idx < 0 || !ds.distributionUrls[idx]) {
    return { title: "Archivo no encontrado" };
  }

  const format = ds.distributionUrls[idx].format;
  const description = `Vista previa, esquema e incidencias del archivo ${format} de «${ds.title}» en el catálogo de datos abiertos de Castilla y León.`;

  return {
    title: `${ds.title} · ${format} | Datos Abiertos de Castilla y León`,
    description,
    openGraph: { title: `${ds.title} · ${format}`, description, type: "article", locale: "es_ES" },
  };
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
  // Emparejado por URL, no por posición: ver `matchDistributions`.
  const dist = matchDistributions(ds.distributionUrls, reportDs?.distribution_results)[idx];
  /** El análisis todavía no ha visto este recurso (dataset o archivo nuevo). */
  const notAnalyzed = dist == null;

  const score = dist?.analysis?.score ?? null;
  const status = dist?.status ?? null;
  const issues = dist?.analysis?.issues ?? [];
  const schema = dist?.analysis?.schema ?? null;

  const fmt = distMeta.format;
  // «OTRO» pasa también por el visor geográfico: las 7 distribuciones que hay
  // son paquetes comprimidos con cartografía dentro, y el visor sabe abrirlos
  // o, como mínimo, decir qué contienen.
  const isGeo = isGeoFormat(fmt) || fmt === "OTRO";
  const isRecordShaped = fmt === "JSON" || fmt === "GeoJSON";
  const fetchSize = dist?.fetch?.size ?? null;

  const explorerKind = isGeo ? undefined : EXPLORABLE_FORMATS[fmt];

  const metrics = dist?.analysis?.metrics ?? {};
  // El analizador nombra estas métricas según el formato; el helper traduce.
  const { primary, secondary } = distributionVolume(fmt, metrics);
  const encoding = typeof metrics.encoding === "string" ? metrics.encoding : null;
  const totalCells = analyzedCells(metrics) || undefined;
  // Errores y avisos nunca se suman: el volumen de celdas vacías (82% de todas
  // las incidencias del catálogo) enmascaraba los fallos que sí bloquean.
  const errorTotal = issues.filter((i) => i.severity === "error").reduce((n, i) => n + i.count, 0);
  const warningTotal = issues.filter((i) => i.severity === "warning").reduce((n, i) => n + i.count, 0);

  const reportedRows = reportedRowCount(explorerKind, metrics);

  const prevIdx = idx > 0 ? idx - 1 : null;
  const nextIdx = ds.distributionUrls[idx + 1] ? idx + 1 : null;
  const prevFmt = prevIdx != null ? ds.distributionUrls[prevIdx].format : null;
  const nextFmt = nextIdx != null ? ds.distributionUrls[nextIdx].format : null;

  // Estado de entrega, con su causa. Casi todo lo que el analizador marca como
  // «omitido» son URLs que devuelven una página web en lugar del archivo, y eso
  // se puede explicar; una etiqueta gris genérica, no.
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

  /** Todo lo que hay dentro del archivo, condensado en una sola línea. */
  const facts = [
    primary && { label: primary.label.toLowerCase(), value: primary.value.toLocaleString("es-ES"), tone: "text-strong" },
    secondary && { label: secondary.label.toLowerCase(), value: secondary.value.toLocaleString("es-ES"), tone: "text-strong" },
    encoding && { label: "codificación", value: encoding, tone: "text-strong" },
    fetchSize ? { label: "descargados", value: formatBytes(fetchSize), tone: "text-strong" } : null,
    errorTotal > 0 && { label: errorTotal === 1 ? "error" : "errores", value: errorTotal.toLocaleString("es-ES"), tone: "text-bad" },
    warningTotal > 0 && { label: warningTotal === 1 ? "aviso" : "avisos", value: warningTotal.toLocaleString("es-ES"), tone: "text-warn" },
  ].filter(Boolean) as { label: string; value: string; tone: string }[];

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
        {/* La URL es `/csv`, `/csv-2`: la miga dice lo mismo que la ruta en vez
            de un número de posición que no aparece en ningún sitio. */}
        <span className="font-medium text-strong" aria-current="page">{slugs[idx] ?? distMeta.format}</span>
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
            Archivo {idx + 1} de {ds.distributionUrls.length}
          </p>
        </div>
        {score != null && (
          <ScoreGauge score={score} label="Calidad del contenido" className="shrink-0" />
        )}
      </header>

      {/* ── Este archivo todavía no se ha analizado ───────────────────────────
          Pasa con lo que se publica entre dos ejecuciones. El explorador sí
          funciona, porque lee el archivo en el navegador sin depender del informe,
          así que la página dice qué falta en lugar de quedarse en blanco. Ojo con
          la guarda del explorador: sin informe `delivery` es nulo, no "ok". */}
      {notAnalyzed && (
        <Card tone="muted">
          <CardContent className="flex items-start gap-3 p-4">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
            <div className="min-w-0 text-sm leading-relaxed text-body">
              <p className="font-semibold text-strong">Sin analizar todavía</p>
              <p className="mt-1">
                Este recurso no estaba en el catálogo la última vez que se ejecutó el análisis
                completo
                {report?.generated_at ? (
                  <>
                    {" "}
                    (
                    <time dateTime={report.generated_at}>
                      {new Date(report.generated_at).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </time>
                    )
                  </>
                ) : null}
                , así que no hay incidencias ni puntuación que mostrar. Se comprobará en la próxima
                ejecución.
                {explorerKind
                  ? " Mientras tanto, el explorador de abajo descarga el archivo y lo analiza en tu navegador."
                  : ""}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

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
                  Este archivo no penaliza la puntuación del conjunto de datos, pero sí impide la
                  reutilización automatizada.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Una sola línea con lo que hay dentro del archivo ──────────────
          Cinco cifras cortas no justifican cinco tarjetas: costaría media
          pantalla de alto y dejaría el explorador por debajo del pliegue. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        {facts.length === 0 && (
          <span className="text-xs text-faint">
            {notAnalyzed ? "Sin cifras del análisis todavía" : "El análisis no registró cifras de este recurso"}
          </span>
        )}
        {facts.map((f, i) => (
          <span key={`${f.label}-${i}`} className="inline-flex items-baseline gap-1.5">
            {i > 0 && <span className="mr-1 text-border" aria-hidden>·</span>}
            <span className={cn("font-semibold tabular-nums", f.tone)}>{f.value}</span>
            <span className="text-xs text-faint">{f.label}</span>
          </span>
        ))}
        <a
          href={distMeta.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-xs text-faint transition-colors hover:text-body"
          title={distMeta.url}
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="max-w-[24rem] truncate font-mono">{distMeta.url}</span>
        </a>
      </div>

      {/* ── Explorador del archivo ───────────────────────────────────────────
          Un único explorador que descarga el archivo y recalcula sobre él, en vez
          de tres secciones apiladas hablando del mismo fichero. Recalcular es lo
          que permite recorrer las incidencias caso por caso: el informe solo
          guarda cinco muestras de cada tipo. CSV, XLSX y JSON lo comparten y solo
          aportan cómo se lee cada uno. */}
      {explorerKind && (delivery === "ok" || notAnalyzed) ? (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
            <Table2 className="h-4 w-4 text-faint" aria-hidden />
            Explorador del archivo
          </h2>
          <FileExplorer
            url={distMeta.url}
            kind={explorerKind}
            sizeBytes={fetchSize}
            reportedRows={reportedRows}
            reportTruncated={Boolean(dist?.analysis?.truncated)}
          />
        </section>
      ) : (
        <>
          {isGeo && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
                <Globe className="h-4 w-4 text-faint" aria-hidden />
                Vista previa geoespacial
              </h2>
              <DistributionMap
                format={fmt}
                url={distMeta.url}
                datasetId={datasetId}
                spatial={ds.spatial}
                dead={status === "error"}
                sizeBytes={fetchSize}
                serviceSiblings={serviceSiblings}
              />
            </section>
          )}

          {issues.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
                <AlertTriangle className="h-4 w-4 text-faint" aria-hidden />
                Incidencias detectadas
              </h2>
              <IssueExplorer issues={issues} totalCells={totalCells} format={fmt} />
            </section>
          )}

          {schema && schema.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
                <Layers className="h-4 w-4 text-faint" aria-hidden />
                {isRecordShaped ? "Campos detectados" : "Esquema de columnas"}
              </h2>
              <SchemaExplorer
                schema={schema}
                unit={isRecordShaped ? "record" : "table"}
                truncated={Boolean(dist?.analysis?.truncated)}
              />
            </section>
          )}
        </>
      )}

      {/* La API de ESTE archivo. El slug de la dirección es el mismo que lleva
          la URL de la página, así que se deduce sin consultar nada. */}
      <ApiPanel
        endpoints={[
          {
            label: "Resultado del análisis de este archivo",
            url: `/api/quality?dataset=${datasetId}&distribucion=${slugs[idx]}`,
            note: notAnalyzed
              ? "Este archivo todavía no está en el informe: la respuesta llega con `analyzed: false` y sin incidencias."
              : undefined,
          },
          {
            label: "El archivo original, servido con permiso de origen cruzado",
            url: `/api/proxy?url=${encodeURIComponent(distMeta.url)}`,
            note: "La vía que usa el explorador de esta página para poder leerlo desde el navegador.",
          },
        ]}
      />

      {/* ── Navegación entre distribuciones ── */}
      {(prevIdx != null || nextIdx != null) && (
        <nav aria-label="Otros archivos de este conjunto de datos" className="flex items-center justify-between gap-4 border-t border-border pt-4">
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
        Volver a la ficha del conjunto de datos
      </Link>
    </div>
  );
}
