import type React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  Tag,
  FileText,
  Globe,
  Scale,
  ChevronRight,
  AlertTriangle,
  XCircle,
  BarChart3,
  ExternalLink,
  Layers,
  Hash,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getCatalog } from "@/lib/rdf-catalog";
import {
  getQualityReport,
  distributionVolume,
  formatBytes,
  matchDistributions,
  type DistributionResult,
} from "@/lib/quality-report";
import { classifyDelivery, deliveryCause } from "@/lib/availability";
import { spatialLabel } from "@/lib/vocabularies";
import { distributionSlugs } from "@/lib/distribution-slug";
import { categoryIcons } from "@/data/categories";
import { datasetSlug, cn } from "@/lib/utils";
import { scoreForDataset } from "@/lib/quality";
import { ScoreGauge } from "@/components/quality/score-gauge";
import { DatasetApi } from "@/components/quality/dataset-api";

export const revalidate = 3600;

/** Tailwind necesita las clases completas, no interpoladas. */
const KEYWORD_SPAN: Record<number, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-3",
};

export async function generateStaticParams() {
  const catalog = await getCatalog();
  return catalog.datasets.map((ds) => ({ datasetId: datasetSlug(ds.id) }));
}

/**
 * Metadatos por dataset.
 *
 * Las 825 fichas compartían el título y la descripción del portal, así que en un
 * buscador o al compartir un enlace eran indistinguibles entre sí.
 *
 * Si el dataset no aparece, NO se llama a `notFound()` aquí: quien decide es el
 * cuerpo de la página. Hacerlo en los metadatos horneaba un 404 permanente en la
 * salida estática cuando durante el build un worker se quedaba con la copia local
 * de respaldo —que tiene un dataset menos que el catálogo en vivo— y ese 404 se
 * seguía sirviendo para un slug que sí existe.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ datasetId: string }>;
}): Promise<Metadata> {
  const { datasetId } = await params;
  const catalog = await getCatalog();
  const ds = catalog.datasets.find((d) => datasetSlug(d.id) === datasetId);
  if (!ds) return { title: "Dataset no encontrado | JCyL Data Quality Portal" };

  const description = ds.description
    ? ds.description.slice(0, 200)
    : `Formatos, licencia y calidad de los archivos de «${ds.title}» en el catálogo de datos abiertos de Castilla y León.`;

  return {
    title: `${ds.title} | Datos Abiertos de Castilla y León`,
    description,
    keywords: ds.keywords,
    openGraph: { title: ds.title, description, type: "article", locale: "es_ES" },
  };
}

/** Fecha ISO del catálogo → «1 de marzo de 2022». */
function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

function periodicityLabel(months: number | null | undefined): string | null {
  if (months == null) return null;
  if (months === 1) return "Mensual";
  if (months === 3) return "Trimestral";
  if (months === 6) return "Semestral";
  if (months === 12) return "Anual";
  if (months < 1) return "Continua";
  return `Cada ${months} meses`;
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
  const composite = scoreForDataset(ds.qualityScore, reportDs);

  /**
   * La organización se omite: los 825 datasets del catálogo declaran el mismo
   * organismo, así que repetirlo en cada ficha no informa de nada.
   *
   * «Temática» usa el mismo valor, nombre e icono que el filtro del catálogo.
   * Antes había un campo «Tema» con el sector NTI-RISP en crudo, que es de
   * donde sale la categoría: dos etiquetas parecidas para el mismo dato.
   */
  const metaItems: { icon: React.ElementType; label: string; value: string; href?: string }[] = [
    {
      icon: categoryIcons[ds.category] ?? Layers,
      label: "Temática",
      value: ds.category,
      href: `/catalogo?categorias=${encodeURIComponent(ds.category)}`,
    },
    { icon: Calendar, label: "Publicación", value: formatDate(ds.lastUpdated) },
    { icon: BarChart3, label: "Periodicidad", value: periodicityLabel(ds.periodicityMonths) },
    { icon: Scale, label: "Licencia", value: ds.license ?? null },
    { icon: Tag, label: "Cobertura espacial", value: spatialLabel(ds.spatial) },
  ].flatMap((item) => (item.value ? [{ ...item, value: item.value }] : []));

  const keywords = ds.keywords ?? [];
  const slugs = distributionSlugs(ds.distributionUrls.map((d) => d.format));
  // Emparejado por URL: el catálogo es una fuente en vivo y el informe una foto.
  const results = matchDistributions(ds.distributionUrls, reportDs?.distribution_results);
  const analyzedAt = report?.generated_at ?? null;

  /**
   * Columnas que le quedan libres a la última fila de metadatos: ahí van las
   * palabras clave. Si la fila está completa, ocupan una fila entera.
   */
  const freeColumns = (3 - (metaItems.length % 3)) % 3;
  const keywordSpan = freeColumns === 0 ? 3 : freeColumns;


  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* ── Breadcrumb ── */}
      <nav aria-label="Migas de pan" className="flex items-center gap-1 text-xs text-faint">
        <Link href="/catalogo" className="rounded transition-colors hover:text-body">Catálogo</Link>
        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
        <span className="max-w-[40ch] truncate text-strong" aria-current="page">{ds.title}</span>
      </nav>

      {/* ── Cabecera ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-strong">{ds.title}</h1>
          {ds.description && (
            <p className="mt-2 text-sm leading-relaxed text-body">{ds.description}</p>
          )}
        </div>
        {composite != null && (
          <ScoreGauge score={composite} size="md" label="Calidad global" className="shrink-0" />
        )}
      </header>

      {/* ── Metadatos ─────────────────────────────────────────────────────────
          Rejilla tipográfica sin cajas: antes cada dato iba en un recuadro con
          el icono en otro recuadro, dentro de la tarjeta. Tres marcos anidados
          para cinco datos cortos era más ruido que información.
          Las palabras clave ocupan el hueco que dejan los metadatos en la
          última fila, en lugar de un bloque aparte debajo. */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
          <FileText className="h-4 w-4 text-faint" aria-hidden />
          Metadatos
        </h2>
        <Card>
          <CardContent className="p-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              {metaItems.map(({ icon: Icon, label, value, href }) => (
                <div key={label} className="min-w-0">
                  <dt className="eyebrow flex items-center gap-1.5">
                    <Icon className="h-3 w-3 shrink-0" aria-hidden />
                    {label}
                  </dt>
                  <dd className="mt-1 truncate text-sm font-medium text-strong" title={value}>
                    {href ? (
                      <Link href={href} className="underline-offset-2 hover:text-link hover:underline">
                        {value}
                      </Link>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}

              {keywords.length > 0 && (
                <div className={cn("col-span-2 min-w-0", KEYWORD_SPAN[keywordSpan])}>
                  <dt className="eyebrow flex items-center gap-1.5">
                    <Hash className="h-3 w-3 shrink-0" aria-hidden />
                    Palabras clave
                  </dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {keywords.map((k) => (
                      <Link
                        key={k}
                        href={`/catalogo?q=${encodeURIComponent(k)}`}
                        className="rounded-md border border-border bg-fill px-2 py-0.5 text-xs text-body transition-colors hover:border-border-strong hover:bg-fill-strong hover:text-strong"
                      >
                        {k}
                      </Link>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </section>

      {/* ── Distribuciones ───────────────────────────────────────────────────
          Antes había dos secciones: "Distribuciones" listaba formato y nota, y
          "Análisis de contenido" repetía debajo lo mismo con más detalle. Aquí
          van unificadas: una tarjeta por distribución, y toda ella es el enlace
          a su ficha. */}
      {ds.distributionUrls.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
            <Globe className="h-4 w-4 text-faint" aria-hidden />
            Distribuciones
            <span className="font-normal text-faint">({ds.distributionUrls.length})</span>
          </h2>

          <div className="space-y-2.5">
            {ds.distributionUrls.map((dist, idx) => (
              <DistributionRow
                key={idx}
                href={`/catalogo/${datasetId}/${slugs[idx]}`}
                format={dist.format}
                url={dist.url}
                result={results[idx]}
              />
            ))}
          </div>

          {/* El informe es una foto: si el catálogo ha publicado una
              distribución después, aquí se ve como «sin analizar» y conviene
              decir por qué en lugar de dejar el hueco. */}
          {analyzedAt && results.some((r) => r == null) && (
            <p className="text-xs leading-relaxed text-faint">
              Las distribuciones marcadas como «sin analizar» no estaban en el catálogo la última vez
              que se ejecutó el análisis completo (
              <time dateTime={analyzedAt}>
                {new Date(analyzedAt).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
              </time>
              ). Se comprobarán en la siguiente ejecución; entretanto puedes explorar el archivo
              desde su ficha.
            </p>
          )}
        </section>
      )}

      <DatasetApi slug={datasetId} analyzed={reportDs != null} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Tono del cuadro de formato según el estado de entrega. */
const FORMAT_TILE: Record<string, string> = {
  ok: "border-border bg-fill text-strong",
  roto: "border-bad-line bg-bad-surface text-bad",
  warn: "border-warn-line bg-warn-surface text-warn",
};

/**
 * Una distribución. La tarjeta entera es el enlace a su ficha, en lugar del
 * botón «Ver archivo» que competía con el enlace al recurso de origen.
 *
 * El formato es el ancla visual —es lo único que distingue dos distribuciones
 * del mismo dataset—, y las cifras van en una sola línea. No hay título de
 * relleno tipo «Distribución en CSV»: repetía lo que ya dice el cuadro.
 */
function DistributionRow({
  href, format, url, result,
}: {
  href: string;
  format: string;
  url: string;
  result?: DistributionResult;
}) {
  const state = result ? classifyDelivery(result) : null;
  const cause = result ? deliveryCause(result) : null;
  const issues = result?.analysis?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error").reduce((n, i) => n + i.count, 0);
  const warnings = issues.filter((i) => i.severity === "warning").reduce((n, i) => n + i.count, 0);

  const metrics = result?.analysis?.metrics ?? {};
  const { primary, secondary } = distributionVolume(format, metrics);

  const broken = state === "roto";
  const degraded = Boolean(state && state !== "ok");
  const StateIcon = broken ? XCircle : AlertTriangle;
  const stateColor = broken ? "text-bad" : "text-warn";
  const tile = FORMAT_TILE[broken ? "roto" : degraded ? "warn" : "ok"];

  const facts = [
    primary && { label: primary.label, value: primary.value.toLocaleString("es-ES"), tone: "text-strong" },
    secondary && { label: secondary.label, value: secondary.value.toLocaleString("es-ES"), tone: "text-strong" },
    errors > 0 && { label: errors === 1 ? "error" : "errores", value: errors.toLocaleString("es-ES"), tone: "text-bad" },
    warnings > 0 && { label: warnings === 1 ? "aviso" : "avisos", value: warnings.toLocaleString("es-ES"), tone: "text-warn" },
    result?.fetch?.size ? { label: "", value: formatBytes(result.fetch.size), tone: "text-body" } : null,
  ].filter(Boolean) as { label: string; value: string; tone: string }[];

  return (
    <Card
      tone={broken ? "bad" : degraded ? "warn" : "default"}
      className="group relative transition-all hover:-translate-y-px hover:border-border-strong hover:shadow-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-canvas"
    >
      <CardContent className="flex items-center gap-4 p-3.5">
        {/* Cuadro de formato: el ancla visual de la tarjeta. */}
        <span
          className={cn(
            "flex h-12 w-16 shrink-0 flex-col items-center justify-center rounded-lg border font-mono text-sm font-bold uppercase tracking-tight",
            tile
          )}
          aria-hidden
        >
          {format}
        </span>

        <div className="min-w-0 flex-1">
          {/* Enlace sin texto visible: la tarjeta entera es el destino y el
              cuadro de formato ya identifica de qué distribución se trata. */}
          <Link href={href} className="outline-none">
            <span className="absolute inset-0" aria-hidden />
            <span className="sr-only">Ver la distribución en {format}</span>
          </Link>

          {degraded && cause ? (
            <p className={cn("flex items-center gap-1.5 text-sm font-medium", stateColor)}>
              <StateIcon className="h-4 w-4 shrink-0" aria-hidden />
              {cause.label}
              {result?.fetch?.http_status ? (
                <span className="font-normal text-faint">· HTTP {result.fetch.http_status}</span>
              ) : null}
            </p>
          ) : facts.length > 0 ? (
            <dl className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
              {facts.map((f, i) => (
                <div key={`${f.label}-${i}`} className="flex items-baseline gap-1.5">
                  {i > 0 && <span className="text-border" aria-hidden>·</span>}
                  <dd className={cn("font-semibold tabular-nums", f.tone)}>{f.value}</dd>
                  {f.label && <dt className="text-xs text-faint">{f.label}</dt>}
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-faint">Sin análisis todavía</p>
          )}

          <p className="mt-0.5 truncate font-mono text-[11px] text-faint" title={url}>
            {url}
          </p>
        </div>

        {/* Enlace al recurso de origen. Va con `relative z-10`, por encima del
            overlay que cubre la tarjeta, así que se pulsa sin necesidad de
            interceptar el evento (esto es un Server Component: no hay JS). */}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Descargar el archivo original"
          className="relative z-10 hidden shrink-0 items-center gap-1.5 rounded-lg border border-field px-2.5 py-1.5 text-xs text-body transition-colors hover:bg-card sm:inline-flex"
          aria-label={`Descargar el archivo original en ${format}`}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Original
        </a>

        <ChevronRight className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </CardContent>
    </Card>
  );
}
