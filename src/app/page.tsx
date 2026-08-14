import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ClipboardCheck,
  Code2,
  Columns3,
  Database,
  Download,
  FileQuestion,
  FileWarning,
  Gauge,
  Newspaper,
  ScanSearch,
  Search,
  Sigma,
  Unplug,
  Wrench,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport, formatBytes, formatLongDate } from "@/lib/quality-report";
import {
  summarizeDelivery,
  summarizeContent,
  reuseConsequences,
  type ReuseConsequence,
} from "@/lib/availability";
import { buildQualityUrl } from "@/lib/quality-filters";
import { PIPELINE, type PipelineStep } from "@/data/pipeline";
import { cn } from "@/lib/utils";

export const revalidate = 3600;

export const metadata = {
  // Sin `title`: hereda el nombre del sitio de la plantilla del layout.
  description:
    "Auditoría independiente del catálogo de datos abiertos de Castilla y León: se descarga cada archivo publicado y se comprueba que se puede abrir y reutilizar.",
};

/** Iconos de los cuatro pasos; el texto vive en `@/data/pipeline`. */
const STEP_ICONS: Record<PipelineStep["icon"], typeof Database> = {
  catalogo: Database,
  descarga: Download,
  lectura: ScanSearch,
  registro: ClipboardCheck,
};

/** Iconos de las consecuencias; el texto y las cifras vienen del informe. */
const CONSEQUENCE_ICONS: Record<ReuseConsequence["icon"], typeof Database> = {
  enlace: Unplug,
  "no-archivo": FileQuestion,
  encabezado: Columns3,
  tipo: Sigma,
};

/**
 * Color de las dos cifras de cabecera, derivado del valor.
 *
 * Estaba cableado —rojo siempre para lo roto, verde siempre para el contenido—,
 * así que la cifra habría seguido en rojo con un catálogo casi perfecto y en
 * verde con uno suspenso. El color acompaña siempre a un texto que dice lo
 * mismo: nunca es el único que transmite el estado.
 */
function toneForBrokenPct(pct: number): "bad" | "warn" | "ok" {
  if (pct >= 15) return "bad";
  if (pct >= 5) return "warn";
  return "ok";
}

function toneForScore(score: number | null): "bad" | "warn" | "ok" {
  if (score == null) return "warn";
  if (score < 60) return "bad";
  if (score < 80) return "warn";
  return "ok";
}

const FIGURE_COLOR = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
} as const;

export default async function HomePage() {
  const catalog = await getCatalog();
  const report = getQualityReport();

  const delivery = summarizeDelivery(report);
  // Media sobre lo que abre, no sobre todo lo que dejó métricas: es lo que dice
  // la tarjeta y lo que hace comparable este número con el de disponibilidad.
  const content = summarizeContent(report);
  const consequences = reuseConsequences(report);

  const deliveryTone = toneForBrokenPct(delivery.brokenPct);
  const contentTone = toneForScore(content.avgScore);

  const analyzedAt = formatLongDate(report?.generated_at);

  /* El catálogo se lee en vivo y el análisis es una foto, así que los totales no
     coinciden. La diferencia se explica donde se ven las dos cifras juntas, en
     vez de dejar que parezca un error de cuentas del portal. */
  const newSinceAnalysis = report ? catalog.stats.totalDatasets - delivery.totalDatasets : 0;

  /* Cobertura del análisis, derivada del propio catálogo: es lo que respalda
     que esto no sea una muestra ni una selección temática. */
  const formatsUsed = Object.entries(catalog.stats.formatsBreakdown)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([format]) => format);
  const categoryCount = Object.keys(catalog.stats.byCategory).length;

  /* Cifras de contexto: viven en la cabecera, no en tarjetas propias. */
  const heroStats = [
    { value: catalog.stats.totalDatasets.toLocaleString("es-ES"), label: "conjuntos de datos" },
    { value: catalog.stats.totalDistributions.toLocaleString("es-ES"), label: "archivos y servicios" },
    { value: formatBytes(report?.totals.bytes ?? 0), label: "descargados y abiertos" },
  ];

  return (
    <div className="space-y-12">
      {/* ── Cabecera ── */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card px-6 py-9 shadow-sm md:px-10 md:py-11">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ok-line bg-ok-surface px-3 py-1 text-xs font-medium text-ok">
          <Database className="h-3.5 w-3.5" aria-hidden />
          Datos Abiertos de Castilla y León
        </div>
        <h1 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-strong md:text-[2.6rem]">
          ¿Se pueden usar de verdad los datos abiertos de Castilla y León?
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-body">
          Este portal no se limita a revisar fichas: <strong className="text-strong">descarga cada archivo
          publicado e intenta abrirlo</strong>, como haría quien quiere reutilizarlo. El resultado se
          publica aquí, archivo por archivo, con el motivo de cada fallo.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/catalogo">
              Explorar el catálogo <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/calidad?vista=prioridades">Qué arreglar primero</Link>
          </Button>
        </div>

        {/* Cifras de contexto. Cada `div` lleva su `dt` visible y su `dd`: la
            etiqueta se leía dos veces, con un `dt` oculto y un `span` con el
            mismo texto al lado. El `dt` va antes en el marcado, como exige
            `dl`, y `flex-row-reverse` pinta el número primero. La fecha queda
            fuera de la lista porque un `<p>` no es contenido válido en un `dl`. */}
        <dl className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-border pt-5">
          {heroStats.map((stat) => (
            <div key={stat.label} className="flex flex-row-reverse items-baseline gap-2">
              <dt className="text-sm text-faint">{stat.label}</dt>
              <dd className="text-xl font-bold tabular-nums text-strong">{stat.value}</dd>
            </div>
          ))}
        </dl>
        {analyzedAt && (
          <p className="mt-3 text-xs text-faint">
            Último análisis completo: <time dateTime={report?.generated_at}>{analyzedAt}</time>
            {newSinceAnalysis > 0 && (
              <>
                {" "}· {newSinceAnalysis.toLocaleString("es-ES")}{" "}
                {newSinceAnalysis === 1
                  ? "conjunto de datos publicado"
                  : "conjuntos de datos publicados"}{" "}
                después, aún sin comprobar
              </>
            )}
          </p>
        )}
      </section>

      {/* ── Las dos preguntas ──────────────────────────────────────────────
          Se presentan al mismo peso a propósito. Promediarlas en un único
          número deja una media de aprobado alto que tapa que un tercio de los
          archivos no abre; y al revés, contar todo como «incidencias» hace
          parecer catastrófico un CSV correcto con celdas opcionales vacías.
          Son preguntas distintas y se responden por separado. */}
      {delivery.total > 0 && (
        <section aria-labelledby="dos-preguntas">
          <h2 id="dos-preguntas" className="text-lg font-bold tracking-tight text-strong">
            El catálogo responde a dos preguntas distintas
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-faint">
            Un archivo que no se puede abrir y un archivo con celdas vacías son problemas de
            naturaleza distinta. Mezclarlos en una sola nota esconde el primero.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* ¿Llega el archivo? */}
            <Card tone={deliveryTone === "bad" ? "bad" : "default"}>
              <CardContent className="flex h-full flex-col">
                <p className="eyebrow mb-3 flex items-center gap-1.5">
                  <FileWarning className="h-3.5 w-3.5" aria-hidden />
                  ¿Se puede abrir el archivo?
                </p>
                <p className={cn("text-5xl font-extrabold tabular-nums leading-none", FIGURE_COLOR[deliveryTone])}>
                  {delivery.brokenPct}%
                </p>
                <p className="mt-2 text-sm font-medium text-strong">
                  de los archivos no se puede descargar o abrir
                </p>
                <p className="mt-1 text-xs text-faint">
                  {delivery.roto.toLocaleString("es-ES")} de {delivery.total.toLocaleString("es-ES")} archivos
                  {delivery.noEntrega > 0 && (
                    <>
                      {" "}· otros {delivery.noEntrega.toLocaleString("es-ES")} devuelven una página web
                      en lugar del archivo
                    </>
                  )}
                </p>
                <p className="mt-3 text-xs text-faint">
                  Afecta a <strong className="text-body">{delivery.affectedDatasets.toLocaleString("es-ES")}</strong>{" "}
                  de {delivery.totalDatasets.toLocaleString("es-ES")} conjuntos de datos.
                </p>
                <Link
                  // La cifra de esta tarjeta es la de disponibilidad, así que el
                  // enlace filtra por esa familia: sin el filtro la tabla abría en
                  // «Todos» y enseñaba más archivos de los que dice la tarjeta.
                  href={buildQualityUrl({ vista: "ficheros", familia: "entrega" })}
                  className="mt-auto inline-flex w-fit items-center gap-1.5 pt-4 text-sm font-medium text-link underline-offset-2 hover:underline"
                >
                  Ver los archivos con problemas <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </CardContent>
            </Card>

            {/* ¿Está limpio lo que llega? */}
            <Card>
              <CardContent className="flex h-full flex-col">
                <p className="eyebrow mb-3 flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5" aria-hidden />
                  ¿Está limpio el contenido?
                </p>
                <p className={cn("text-5xl font-extrabold tabular-nums leading-none", FIGURE_COLOR[contentTone])}>
                  {content.avgScore != null
                    ? `${content.avgScore.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%`
                    : "—"}
                </p>
                <p className="mt-2 text-sm font-medium text-strong">
                  calidad media del contenido legible
                </p>
                <p className="mt-1 text-xs text-faint">
                  Sobre los {content.scored.toLocaleString("es-ES")} archivos que se abren y tienen
                  contenido que medir: encabezados, tipos de dato y celdas vacías.
                </p>
                <p className="mt-3 text-xs text-faint">
                  No incluye los archivos que no abren: sin contenido legible no hay calidad de
                  contenido que medir.
                </p>
                <Link
                  href={buildQualityUrl({ vista: "ficheros", familia: "contenido" })}
                  className="mt-auto inline-flex w-fit items-center gap-1.5 pt-4 text-sm font-medium text-link underline-offset-2 hover:underline"
                >
                  Ver los archivos que necesitan limpieza <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* ── Cómo se comprueba, y sobre qué ── */}
      <section aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="text-lg font-bold tracking-tight text-strong">
          Cómo se comprueba
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-faint">
          Un catálogo puede tener fichas impecables y archivos que no abren. Por eso la comprobación
          no se queda en la ficha: se descarga el archivo y se abre con el lector que le corresponde.
        </p>
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map((step, index) => {
            const Icon = STEP_ICONS[step.icon];
            return (
              <li key={step.title}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fill">
                        <Icon className="h-4 w-4 text-body" aria-hidden />
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-faint">
                        Paso {index + 1}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-strong">{step.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-body">{step.short}</p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>

        {/* La cobertura es el respaldo de los cuatro pasos, no una sección
            aparte: sin ella, «se comprueba cada archivo» no dice sobre cuántos. */}
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-body">
          Y no sobre una muestra: se analizan{" "}
          <strong className="text-strong">
            los {catalog.stats.totalDatasets.toLocaleString("es-ES")} conjuntos de datos
          </strong>{" "}
          del portal de la Junta de Castilla y León y{" "}
          <strong className="text-strong">
            sus {catalog.stats.totalDistributions.toLocaleString("es-ES")} archivos y servicios
          </strong>
          , repartidos en {categoryCount} temáticas y {formatsUsed.length} formatos distintos.
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Formatos analizados">
          {formatsUsed.map((format) => (
            <li
              key={format}
              className="rounded-md border border-border bg-fill px-2 py-0.5 font-mono text-[11px] text-body"
            >
              {format}
            </li>
          ))}
        </ul>
        <Link
          href="/metodologia"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Ver la metodología completa y cómo se puntúa <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      {/* ── Por qué importa ──────────────────────────────────────────────────
          Cada consecuencia va con el número real de este catálogo, contado por
          archivos afectados y no por ocurrencias, para que la explicación no sea
          abstracta ni se quede obsoleta. */}
      <section aria-labelledby="por-que-importa">
        <h2 id="por-que-importa" className="text-lg font-bold tracking-tight text-strong">
          Por qué importa la calidad, y no solo la cantidad
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
          Publicar un dato abierto cuesta dinero público: recogerlo, prepararlo, documentarlo y
          mantenerlo. Ese gasto solo se convierte en retorno cuando alguien lo reutiliza sin pedir
          permiso ni pelearse con el archivo. Un archivo que no abre consume el coste entero y
          devuelve cero; uno que abre sucio traslada la limpieza a cada persona que lo use, y ese
          mismo trabajo se repite y se paga tantas veces como reutilizadores tenga.
        </p>

        {consequences.length > 0 && (
          <>
            <p className="mt-4 text-sm font-medium text-strong">
              Dónde se rompe la cadena, hoy, en este catálogo:
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              {consequences.map((consequence) => {
                const Icon = CONSEQUENCE_ICONS[consequence.icon];
                return (
                  <Card key={consequence.title} tone={consequence.severity}>
                    <CardContent className="flex gap-4">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          FIGURE_COLOR[consequence.severity]
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span
                            className={cn(
                              "text-lg font-bold tabular-nums",
                              FIGURE_COLOR[consequence.severity]
                            )}
                          >
                            {consequence.count.toLocaleString("es-ES")}
                          </span>
                          <span className="text-xs text-faint">archivos afectados</span>
                        </div>
                        <h3 className="mt-0.5 text-sm font-semibold text-strong">
                          {consequence.title}
                        </h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-body">{consequence.text}</p>
                        {/* Estas tarjetas daban una cifra concreta de archivos y no
                            tenían ningún enlace: eran las únicas del portal que
                            decían «hay 179» sin dejar ver cuáles. El grupo puede
                            reunir varios códigos —un encabezado vacío y uno
                            duplicado rompen la carga por lo mismo—, y por eso el
                            filtro de causa acepta una lista. */}
                        <Link
                          href={buildQualityUrl({
                            vista: "ficheros",
                            causas: consequence.codes,
                          })}
                          className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-link underline-offset-2 hover:underline"
                        >
                          Ver los archivos afectados <ArrowRight className="h-3 w-3" aria-hidden />
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-body">
          Recuperar casi ninguno de estos archivos exige rehacer el dato: la mayoría se arreglan
          corrigiendo un enlace o un proceso de exportación. Por eso la lista de trabajo está
          agrupada por causa y no por incidencia suelta —cuando un fallo afecta a todo un formato,
          se señala como un único arreglo que recupera decenas de archivos—.
        </p>
      </section>

      {/* ── Por dónde empezar ── */}
      <section aria-labelledby="para-quien">
        <h2 id="para-quien" className="text-lg font-bold tracking-tight text-strong">
          Por dónde empezar
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="flex h-full flex-col">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-fill">
                <Search className="h-4 w-4 text-body" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-strong">Quiero reutilizar datos</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                Antes de invertir tiempo en un conjunto de datos, comprueba si sus archivos abren,
                qué estructura tienen y qué licencia los cubre. Cada ficha descarga el archivo real
                en tu navegador y lo muestra como tabla, como lista de campos o como mapa, así que
                puedes contrastar las cifras sin fiarte de este portal.
              </p>
              <div className="mt-auto flex flex-wrap gap-3 pt-5">
                <Button asChild size="sm">
                  <Link href="/catalogo">
                    Explorar el catálogo <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  {/* Mismo texto que la etiqueta del filtro al que lleva. */}
                  <Link href="/catalogo?analisis=ok">Solo los que abren todos sus archivos</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex h-full flex-col">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-fill">
                <Wrench className="h-4 w-4 text-body" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-strong">Publico datos y quiero mejorarlos</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                Las prioridades se ordenan por lo que se recupera al corregir, no por volumen de
                avisos, y la lista se descarga en CSV con los filtros que tengas puestos. Los pesos,
                los umbrales y lo que el portal decide <em>no</em> imputar a quien publica están
                escritos y acotados.
              </p>
              <div className="mt-auto flex flex-wrap gap-3 pt-5">
                <Button asChild size="sm">
                  <Link href="/calidad?vista=prioridades">
                    Qué arreglar primero <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/metodologia#limites">Qué no puede saber el portal</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              icon: Newspaper,
              title: "Investigo o informo",
              text: "El estado del catálogo es en sí mismo una historia y un objeto de estudio: qué se publica, qué se mantiene y qué se abandona. El análisis llega al archivo concreto, con su causa y su cifra.",
              href: "/calidad?vista=prioridades",
              cta: "Ver el diagnóstico",
            },
            {
              icon: Building2,
              title: "Trabajo en otra administración",
              text: "El método —descargar, abrir, separar disponibilidad de contenido y agrupar por causa— es reproducible sobre cualquier catálogo publicado con el estándar europeo DCAT. La metodología está al detalle.",
              href: "/metodologia",
              cta: "Ver la metodología",
            },
            {
              icon: Code2,
              title: "Quiero construir algo encima",
              text: "Todo lo que se ve aquí está también en JSON, sin registro ni clave. Y hay un distintivo de calidad que se pega en cualquier web como una imagen y refleja siempre el último análisis publicado.",
              href: "/metodologia#api",
              cta: "Ver la API",
            },
          ].map((profile) => (
            <Card key={profile.title}>
              <CardContent className="flex h-full flex-col">
                <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-fill">
                  <profile.icon className="h-4 w-4 text-body" aria-hidden />
                </span>
                <h3 className="text-sm font-semibold text-strong">{profile.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-body">{profile.text}</p>
                <Link
                  href={profile.href}
                  className="mt-auto inline-flex w-fit items-center gap-1.5 pt-4 text-xs font-medium text-link underline-offset-2 hover:underline"
                >
                  {profile.cta} <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Transparencia ────────────────────────────────────────────────────
          Un observatorio de datos abiertos tiene que publicar los suyos. Va como
          banda de enlaces y no como tres tarjetas de texto: lo que aporta son
          las fuentes, y el argumento ya está dicho arriba. */}
      <section aria-labelledby="transparencia" className="rounded-xl border border-border bg-fill p-6">
        <h2 id="transparencia" className="text-base font-bold tracking-tight text-strong">
          Datos abiertos sobre los datos abiertos
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-body">
          Una auditoría que no se puede comprobar no vale de mucho. El resultado de cada archivo y el
          método están publicados y son verificables por cualquiera.
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {[
            { href: "/api/quality", label: "El informe completo en JSON", external: true },
            { href: "/metodologia#limites", label: "Qué no puede saber el portal", external: false },
            { href: "/metodologia#comprobacion", label: "Cómo se comprueba cada archivo", external: false },
          ].map((source) => (
            <li key={source.href}>
              {source.external ? (
                <a
                  href={source.href}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
                >
                  {source.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : (
                <Link
                  href={source.href}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
                >
                  {source.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
