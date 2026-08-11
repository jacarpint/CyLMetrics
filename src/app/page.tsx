import Link from "next/link";
import {
  ArrowRight,
  Database,
  FileWarning,
  Gauge,
  Download,
  ScanSearch,
  ClipboardCheck,
  Unplug,
  FileQuestion,
  Columns3,
  Sigma,
  Search,
  Wrench,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport, formatBytes } from "@/lib/quality-report";
import { summarizeDelivery, distributionsAffectedByIssue } from "@/lib/availability";
import { cn } from "@/lib/utils";

export const revalidate = 3600;

export const metadata = {
  title: "Portal de Calidad de Datos Abiertos | JCyL",
  description:
    "Auditoría independiente del catálogo de datos abiertos de Castilla y León: se descarga cada archivo publicado y se comprueba que se puede abrir y reutilizar.",
};

export default async function HomePage() {
  const catalog = await getCatalog();
  const report = getQualityReport();

  const delivery = summarizeDelivery(report);
  const contentScore = report?.totals.avg_score ?? null;

  const analyzedAt = report?.generated_at
    ? new Date(report.generated_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })
    : null;

  /* Cifras de contexto: viven en la cabecera, no en tarjetas propias. */
  const HERO_STATS = [
    { value: catalog.stats.totalDatasets.toLocaleString("es-ES"), label: "datasets" },
    { value: catalog.stats.totalDistributions.toLocaleString("es-ES"), label: "archivos y servicios" },
    { value: formatBytes(report?.totals.bytes ?? 0), label: "descargados y abiertos" },
  ];

  /* Cómo se comprueba. El diferencial del portal es el paso 2: no se queda
     en los metadatos, se descarga el archivo y se intenta abrir de verdad. */
  const STEPS = [
    {
      icon: Database,
      title: "Se lee el catálogo",
      text: "Del catálogo DCAT oficial se extraen los metadatos de cada dataset: título, licencia, organismo, temática y la URL de cada archivo.",
    },
    {
      icon: Download,
      title: "Se descarga cada archivo",
      text: "Uno a uno, siguiendo redirecciones y respetando límites de tamaño. Aquí ya se descubre lo que ningún inventario de metadatos ve: enlaces caídos y URLs que devuelven una página en vez del dato.",
    },
    {
      icon: ScanSearch,
      title: "Se abre con su analizador",
      text: "Cada formato con su lector: CSV, Excel, JSON, XML, KML, shapefiles y servicios cartográficos WMS y WFS. Si no abre, no es reutilizable, por muy completos que sean sus metadatos.",
    },
    {
      icon: ClipboardCheck,
      title: "Se registra y se puntúa",
      text: "Las incidencias se agrupan por tipo y gravedad, y quedan publicadas archivo por archivo para que cualquiera pueda comprobarlas o corregirlas.",
    },
  ];

  /* Por qué importa: cada consecuencia va con el número real de este catálogo.
     Se cuenta por recursos afectados (no por ocurrencias) y se lee del informe,
     para que la divulgación no sea abstracta ni se quede obsoleta. */
  const affected = distributionsAffectedByIssue(report);
  const CONSEQUENCES = [
    {
      icon: Unplug,
      tone: "bad" as const,
      count: affected["descarga"] ?? 0,
      title: "Un enlace roto es un dato que no existe",
      text: "Da igual lo bien documentado que esté: si el servidor no responde, quien lo necesita se encuentra un error. Es la diferencia entre publicar y estar disponible.",
    },
    {
      icon: FileQuestion,
      tone: "warn" as const,
      count: (affected["no-es-archivo"] ?? 0) + (affected["no-es-imagen"] ?? 0),
      title: "Un archivo que no es un archivo",
      text: "La URL responde, pero devuelve una página web en lugar del CSV o el shapefile. Una persona lo sortea a mano; un programa que actualiza datos cada noche, no.",
    },
    {
      icon: Columns3,
      tone: "warn" as const,
      count: (affected["encabezado-vacio"] ?? 0) + (affected["encabezado-duplicado"] ?? 0),
      title: "Encabezados vacíos o repetidos",
      text: "Las columnas sin nombre o con el nombre duplicado rompen la carga automática en hojas de cálculo y en cualquier script. Obligan a limpiar a mano antes de poder empezar.",
    },
    {
      icon: Sigma,
      tone: "warn" as const,
      count: affected["error-tipo"] ?? 0,
      title: "Tipos mezclados en una misma columna",
      text: "Un texto colado en una columna de números o fechas no da error: da un resultado equivocado. Son los fallos más caros porque nadie los ve venir.",
    },
  ].filter((c) => c.count > 0);

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
            <Link href="/catalogo?vista=ficheros">Ver los archivos con problemas</Link>
          </Button>
        </div>

        {/* Cifras de contexto, integradas en la cabecera */}
        <dl className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-border pt-5">
          {HERO_STATS.map((s) => (
            <div key={s.label} className="flex items-baseline gap-2">
              <dt className="sr-only">{s.label}</dt>
              <dd className="text-xl font-bold tabular-nums text-strong">{s.value}</dd>
              <span className="text-sm text-faint">{s.label}</span>
            </div>
          ))}
          {analyzedAt && (
            <p className="text-xs text-faint">
              Último análisis completo: <time dateTime={report?.generated_at}>{analyzedAt}</time>
            </p>
          )}
        </dl>
      </section>

      {/* ── Las dos preguntas ──────────────────────────────────────────────
          Se presentan al mismo peso a propósito. Promediarlas en un único
          número dejaba una media de aprobado alto que tapaba que un tercio de
          los ficheros no abre; y al revés, contar todo como "incidencias"
          hacía parecer catastrófico un CSV correcto con celdas opcionales
          vacías. Son preguntas distintas y se responden por separado. */}
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
            {/* Disponibilidad */}
            <Card tone={delivery.brokenPct >= 20 ? "bad" : "default"}>
              <CardContent className="flex h-full flex-col p-6">
                <p className="eyebrow mb-3 flex items-center gap-1.5">
                  <FileWarning className="h-3.5 w-3.5" aria-hidden />
                  ¿Se puede abrir el archivo?
                </p>
                <p className="text-5xl font-extrabold tabular-nums leading-none text-bad">
                  {delivery.brokenPct}%
                </p>
                <p className="mt-2 text-sm font-medium text-strong">
                  de los archivos no se puede descargar o abrir
                </p>
                <p className="mt-1 text-xs text-faint">
                  {delivery.roto.toLocaleString("es-ES")} de {delivery.total.toLocaleString("es-ES")} distribuciones
                  {delivery.noEntrega > 0 && (
                    <>
                      {" "}· otras {delivery.noEntrega.toLocaleString("es-ES")} devuelven una página web
                      en lugar del archivo
                    </>
                  )}
                </p>
                <p className="mt-3 text-xs text-faint">
                  Afecta a <strong className="text-body">{delivery.affectedDatasets.toLocaleString("es-ES")}</strong>{" "}
                  de {delivery.totalDatasets.toLocaleString("es-ES")} datasets.
                </p>
                <Link
                  href="/catalogo?vista=ficheros"
                  className="mt-auto inline-flex w-fit items-center gap-1.5 pt-4 text-sm font-medium text-link underline-offset-2 hover:underline"
                >
                  Ver los archivos con problemas <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </CardContent>
            </Card>

            {/* Calidad del contenido */}
            <Card>
              <CardContent className="flex h-full flex-col p-6">
                <p className="eyebrow mb-3 flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5" aria-hidden />
                  ¿Está limpio el contenido?
                </p>
                <p className="text-5xl font-extrabold tabular-nums leading-none text-ok">
                  {contentScore != null
                    ? `${contentScore.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%`
                    : "—"}
                </p>
                <p className="mt-2 text-sm font-medium text-strong">
                  calidad media del contenido legible
                </p>
                <p className="mt-1 text-xs text-faint">
                  Sobre las {delivery.ok.toLocaleString("es-ES")} distribuciones que sí se pudieron analizar:
                  encabezados, tipos de dato y celdas vacías.
                </p>
                <p className="mt-3 text-xs text-faint">
                  No incluye los archivos rotos: un fichero que no abre no tiene calidad de
                  contenido que medir.
                </p>
                <Link
                  href="/calidad?vista=incidencias"
                  className="mt-auto inline-flex w-fit items-center gap-1.5 pt-4 text-sm font-medium text-link underline-offset-2 hover:underline"
                >
                  Ver el informe de incidencias <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* ── Cómo se comprueba ── */}
      <section aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="text-lg font-bold tracking-tight text-strong">
          Cómo se comprueba
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-faint">
          Un catálogo puede tener fichas impecables y archivos que no abren. Por eso la
          comprobación no se queda en los metadatos.
        </p>
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fill">
                      <step.icon className="h-4 w-4 text-body" aria-hidden />
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-faint">
                      Paso {i + 1}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-strong">{step.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-body">{step.text}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
        <Link
          href="/metodologia"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Ver la metodología completa y los pesos del cálculo <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      {/* ── Por qué importa ── */}
      <section aria-labelledby="por-que-importa">
        <h2 id="por-que-importa" className="text-lg font-bold tracking-tight text-strong">
          Por qué importa la calidad, y no solo la cantidad
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
          Un dato abierto sirve cuando alguien puede usarlo sin pedir permiso ni pelearse con el
          archivo. Publicarlo es el primer paso; que se descargue, se abra y se procese sin trabajo
          manual es lo que lo convierte en reutilizable de verdad —para una aplicación, una
          investigación, un reportaje o un negocio—. Cada uno de estos problemas rompe esa cadena en
          un punto distinto, y todos son medibles:
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {CONSEQUENCES.map((c) => (
            <Card key={c.title} tone={c.tone}>
              <CardContent className="flex gap-4 p-5">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    c.tone === "bad" ? "text-bad" : "text-warn"
                  )}
                >
                  <c.icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={cn(
                        "text-lg font-bold tabular-nums",
                        c.tone === "bad" ? "text-bad" : "text-warn"
                      )}
                    >
                      {c.count}
                    </span>
                    <span className="text-xs text-faint">recursos afectados</span>
                  </div>
                  <h3 className="mt-0.5 text-sm font-semibold text-strong">{c.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-body">{c.text}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Dos caminos según quién eres ── */}
      <section aria-labelledby="para-quien">
        <h2 id="para-quien" className="text-lg font-bold tracking-tight text-strong">
          Por dónde empezar
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="flex h-full flex-col p-6">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-fill">
                <Search className="h-4 w-4 text-body" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-strong">Quiero reutilizar datos</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                Antes de invertir tiempo en un dataset, comprueba si sus archivos abren, qué
                estructura tienen y qué licencia los cubre. Cada ficha muestra la vista previa real
                del recurso: tabla, árbol JSON o mapa.
              </p>
              <div className="mt-auto flex flex-wrap gap-3 pt-5">
                <Button asChild size="sm">
                  <Link href="/catalogo">
                    Explorar el catálogo <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/catalogo?analisis=ok">Solo datasets sin fallos</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex h-full flex-col p-6">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-fill">
                <Wrench className="h-4 w-4 text-body" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-strong">Publico datos y quiero mejorarlos</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                La lista de archivos con problemas está agrupada por causa, no por incidencia
                suelta: cuando un fallo afecta a todo un formato, se señala como un único arreglo
                que recupera decenas de recursos. Descargable en CSV.
              </p>
              <div className="mt-auto flex flex-wrap gap-3 pt-5">
                <Button asChild size="sm">
                  <Link href="/catalogo?vista=ficheros">
                    Qué arreglar primero <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/metodologia">Cómo se puntúa</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="-mx-4 border-t border-border bg-fill px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-xs text-faint">
            Metadatos del{" "}
            <a
              href="https://datosabiertos.jcyl.es"
              className="text-link underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              catálogo DCAT de la Junta de Castilla y León
            </a>
            , actualizados cada hora. El análisis de contenido se ejecuta periódicamente y sus
            resultados están disponibles en abierto.
          </p>
          <Link
            href="/metodologia"
            className="flex items-center gap-1 text-xs text-faint transition-colors hover:text-body"
          >
            Metodología y API
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </footer>
    </div>
  );
}
