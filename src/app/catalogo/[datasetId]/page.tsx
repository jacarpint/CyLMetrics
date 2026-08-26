import type React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  Tag,
  FileText,
  Globe,
  History,
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
  formatLongDate,
  matchDistributions,
  type DistributionResult,
} from "@/lib/quality-report";
import { classifyDelivery, deliveryCause } from "@/lib/availability";
import { periodicityLabel, spatialLabel } from "@/lib/vocabularies";
import { distributionSlugs } from "@/lib/distribution-slug";
import { categoryIcons } from "@/data/categories";
import { datasetSlug, cn } from "@/lib/utils";
import { scoreForDataset } from "@/lib/quality";
import { ScoreGauge } from "@/components/quality/score-gauge";
import { ApiPanel } from "@/components/quality/api-panel";

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
 * Metadatos propios de cada conjunto, para que las fichas no salgan
 * indistinguibles en un buscador ni al compartir el enlace.
 *
 * Si el conjunto no aparece, NO se llama a `notFound()` aquí: decide el cuerpo de
 * la página. Hacerlo en los metadatos hornea un 404 permanente en la salida
 * estática cuando un worker del build usa la copia local de respaldo —que puede
 * ir un conjunto por detrás del catálogo en vivo—, y ese 404 se sigue sirviendo
 * para un slug que sí existe.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ datasetId: string }>;
}): Promise<Metadata> {
  const { datasetId } = await params;
  const catalog = await getCatalog();
  const ds = catalog.datasets.find((d) => datasetSlug(d.id) === datasetId);
  if (!ds) return { title: "Conjunto de datos no encontrado" };

  const description = ds.description
    ? ds.description.slice(0, 200)
    : `Formatos, licencia y calidad de los archivos de «${ds.title}» en el catálogo de datos abiertos de Castilla y León.`;

  return {
    title: ds.title,
    description,
    keywords: ds.keywords,
    openGraph: { title: ds.title, description, type: "article", locale: "es_ES" },
  };
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
   * Metadatos de la ficha. Los campos sin valor no se pintan, en vez de dejar un
   * hueco rotulado: el `filter` de abajo los descarta y estrecha el tipo.
   *
   * La organización se omite a propósito: todos los conjuntos del catálogo
   * declaran el mismo organismo, así que repetirlo no informa de nada. Y
   * «Temática» reutiliza el valor, el nombre y el icono del filtro del catálogo,
   * para no tener dos etiquetas parecidas del mismo dato.
   */
  type MetaItem = { icon: React.ElementType; label: string; value: string | null; href?: string };
  const allMetaItems: MetaItem[] = [
    {
      icon: categoryIcons[ds.category] ?? Layers,
      label: "Temática",
      value: ds.category,
      href: `/catalogo?categorias=${encodeURIComponent(ds.category)}`,
    },
    { icon: Calendar, label: "Publicación", value: formatLongDate(ds.lastUpdated) },
    // La última actualización faltaba en la ficha, siendo el dato con el que el
    // portal juzga la actualidad y el que la tarjeta del catálogo rotula como
    // «Actualizado hace…». Solo se muestra si el conjunto la declara: el resto
    // del portal insiste en que ausencia de fecha no es lo mismo que dato viejo.
    { icon: History, label: "Última actualización", value: formatLongDate(ds.modified) },
    { icon: BarChart3, label: "Periodicidad", value: periodicityLabel(ds.periodicityMonths, { capitalized: true }) },
    { icon: Scale, label: "Licencia", value: ds.license ?? null },
    { icon: Tag, label: "Cobertura territorial", value: spatialLabel(ds.spatial) },
  ];
  const metaItems = allMetaItems.filter(
    (item): item is MetaItem & { value: string } => item.value != null
  );

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
          <ScoreGauge score={composite} label="Índice de calidad" className="shrink-0" />
        )}
      </header>

      {/* ── Metadatos ─────────────────────────────────────────────────────────
          Rejilla tipográfica sin cajas: un recuadro por dato, con el icono en
          otro recuadro dentro de la tarjeta, son tres marcos anidados para un
          puñado de datos cortos. Las palabras clave aprovechan el hueco que
          dejan los metadatos en la última fila. */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
          <FileText className="h-4 w-4 text-faint" aria-hidden />
          Metadatos
        </h2>
        <Card>
          <CardContent>
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

      {/* ── Archivos ─────────────────────────────────────────────────────────
          Una tarjeta por archivo, y toda ella es el enlace a su ficha. Formato,
          estado y cifras van juntos: separarlos en una lista de formatos y otra
          de análisis obliga a leer lo mismo dos veces. */}
      {ds.distributionUrls.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
            <Globe className="h-4 w-4 text-faint" aria-hidden />
            Archivos y servicios
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
              Los archivos marcados como «sin analizar» no estaban en el catálogo la última vez
              que se ejecutó el análisis completo (
              <time dateTime={analyzedAt}>{formatLongDate(analyzedAt)}</time>
              ). Entretanto puedes explorar el archivo desde su ficha.
            </p>
          )}
        </section>
      )}

      <ApiPanel
        endpoints={[
          {
            label: "Resultado del análisis de este conjunto de datos",
            url: `/api/quality?dataset=${datasetId}`,
            note:
              reportDs == null
                ? "Este conjunto todavía no está en el informe, así que ahora mismo responde 404."
                : undefined,
          },
          {
            label: "Su ficha completa en el catálogo",
            url: `/api/catalog?q=${encodeURIComponent(ds.title)}&limit=1`,
          },
        ]}
        sealUrl={`/api/sello?dataset=${datasetId}`}
      />
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
 * Un archivo del conjunto. La tarjeta entera es el enlace a su ficha: un botón
 * «Ver archivo» competiría con el enlace al recurso de origen, que está al lado.
 *
 * El cuadro del formato es el ancla visual, porque es lo único que distingue dos
 * archivos del mismo conjunto, y por eso no hay título de relleno tipo
 * «Distribución en CSV» que repita lo que el cuadro ya dice.
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
            <span className="sr-only">Ver el archivo en {format}</span>
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
              {/* Mismo arreglo que la portada (`app/page.tsx`): `dt` va antes que
                  `dd` en el marcado, como exige `dl`, y `order` se encarga de
                  pintar el valor delante de su etiqueta. El punto separador pasa
                  a ser un pseudoelemento porque dentro de un `dl` un `div` solo
                  puede contener `dt` y `dd`, no un `span` suelto. */}
              {facts.map((f, i) => (
                <div
                  key={`${f.label}-${i}`}
                  className={cn(
                    "flex items-baseline gap-1.5",
                    i > 0 && "before:text-border before:content-['·']"
                  )}
                >
                  {/* El tamaño se pinta sin etiqueta —«2,3 MB» se explica solo—,
                      pero un `dd` huérfano deja a un lector de pantalla leyendo
                      una cifra suelta, así que su `dt` existe y va oculto. */}
                  <dt className={cn("order-2 text-xs text-faint", !f.label && "sr-only")}>
                    {f.label || "tamaño"}
                  </dt>
                  <dd className={cn("order-1 font-semibold tabular-nums", f.tone)}>{f.value}</dd>
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
