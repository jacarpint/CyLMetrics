import Link from "next/link";
import {
  ArrowRight, Ban, Database, Download, FileSearch, Gauge, Layers, ListChecks,
  ScanSearch, Target, Terminal, TriangleAlert,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PIPELINE, type PipelineStep } from "@/data/pipeline";
import { CONTENT_PENALTIES, CONTENT_START } from "@/data/content-scoring";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport, formatLongDate } from "@/lib/quality-report";
import { summarizeDelivery } from "@/lib/availability";
import { METADATA_WEIGHTS, SCORE_LEVELS, SCORE_WEIGHTS } from "@/lib/quality";

/** Un peso 0-1 del código, escrito como el porcentaje que se publica. */
const asPercent = (weight: number) => Math.round(weight * 100);

/** El mismo repositorio que enlaza el pie. */
const REPO_URL = "https://github.com/jacarpint/CyLMetrics";

export const revalidate = 3600;

export const metadata = {
  title: "Metodología",
  description:
    "Sobre qué se aplica, cómo se comprueba cada archivo del catálogo de datos abiertos de Castilla y León, cómo se calculan las puntuaciones de calidad y cómo volver a ejecutar el análisis.",
};

/**
 * Índice de la página, de lo general a lo verificable: primero sobre qué se
 * aplica el método, luego cómo se ejecuta y cómo puntúa, después dónde acaba su
 * alcance y, al final, cómo repetirlo.
 *
 * La API y el sello tenían aquí su sección y se fueron a `/api`: son otro
 * público —quien construye encima, no quien juzga si fiarse— y estaban
 * documentados dos veces. El «detalle técnico» era un acordeón con tres bloques;
 * los topes de cada paso están ahora junto a su paso, los ocho códigos de
 * descarga en la página de API —documentan un campo que la API devuelve— y la
 * guardia contra servidores lentos se dejó caer.
 */
const SECTIONS = [
  { id: "alcance", label: "Alcance" },
  { id: "comprobacion", label: "Cómo se comprueba" },
  { id: "fallos", label: "Qué cuenta como fallo" },
  { id: "calculos", label: "Cómo se puntúa" },
  { id: "limites", label: "Qué no puede saber" },
  { id: "reproducir", label: "Cómo reproducirlo" },
];

const PIPELINE_ICONS: Record<PipelineStep["icon"], typeof Database> = {
  catalogo: Database,
  descarga: Download,
  lectura: ScanSearch,
  registro: ListChecks,
};

/**
 * Las tres dimensiones del índice.
 *
 * El peso NO se escribe aquí: se lee de `SCORE_WEIGHTS`, que es el que aplica el
 * cálculo. Estaba copiado a mano en esta página, así que revisar un peso dejaba
 * la metodología documentando una fórmula que el código ya no usaba.
 */
const DIMENSIONS = [
  {
    name: "Metadatos",
    weight: asPercent(SCORE_WEIGHTS.metadata),
    /** La pregunta que responde el eje. Va en la tabla de la fórmula. */
    measures: "Si la ficha permite encontrar y entender el dato",
    headline: "La ficha está incompleta",
    text: "El archivo está perfecto, pero su ficha no permite encontrarlo, fecharlo o saber si se puede reutilizar. Es lo más barato de corregir y lo que más rinde.",
  },
  {
    name: "Disponibilidad",
    weight: asPercent(SCORE_WEIGHTS.availability),
    measures: "Si el archivo se puede descargar y abrir",
    headline: "No se puede usar",
    text: "O la descarga falla, o el archivo llega y no se puede interpretar. Es bloqueante: no hay dato que reutilizar, por muy completa que esté la ficha.",
  },
  {
    name: "Contenido",
    weight: asPercent(SCORE_WEIGHTS.content),
    measures: "Si lo que hay dentro está limpio",
    headline: "Abre, pero necesita limpieza",
    text: "Encabezados vacíos o repetidos, tipos mezclados en una columna, filas de más o de menos. Se puede reutilizar, pero obliga a limpiar antes.",
  },
];

/** Los cuatro factores del eje de metadatos. Los pesos, de `METADATA_WEIGHTS`. */
const META_FACTORS = [
  {
    title: "Completitud",
    weight: asPercent(METADATA_WEIGHTS.completeness),
    desc: "Nueve campos de la ficha, cada uno con el mismo peso: título, descripción, licencia identificable, organismo, fecha de publicación, idioma, cobertura territorial, temática y palabras clave.",
  },
  {
    title: "Apertura de formato",
    weight: asPercent(METADATA_WEIGHTS.formats),
    desc: "El 80% lo pone el formato más abierto que publique el conjunto de datos: CSV, JSON y GeoJSON puntúan 100; los mapas en shapefile, 60; los de imagen comprimida ECW, 20, porque hacen falta programas especializados para abrirlos. El 20% restante lo pone la variedad, hasta tres formatos.",
  },
  {
    title: "Actualidad",
    weight: asPercent(METADATA_WEIGHTS.freshness),
    desc: "Tiempo transcurrido desde la última fecha conocida, medido en periodos de la periodicidad declarada: dentro de plazo 100, hasta dos periodos 75, hasta cuatro 50, más allá 25. Sin periodicidad declarada no se puede juzgar y se asume 80; sin ninguna fecha, 40.",
  },
  {
    title: "Apertura de licencia",
    weight: asPercent(METADATA_WEIGHTS.license),
    desc: "La licencia abierta CC-BY-4.0, que solo exige citar la fuente, puntúa 100. La licencia IGCYL de uso no comercial, 55, porque excluye la reutilización comercial. Una licencia que no se puede identificar, 60.",
  },
];

/**
 * Lo que el análisis ve pero decide no achacar a quien publica.
 *
 * Estaba en una tarjeta suelta al final de «Qué cuenta como fallo», con los tres
 * puntos en columnas dentro de la misma caja. Se junta con `LIMITES` porque son
 * la misma idea —dónde para la auditoría— vista por sus dos caras: aquí, lo que
 * el portal no imputa; allí, lo que directamente no alcanza a saber.
 */
const NO_IMPUTABLE = [
  {
    title: "Nuestras propias limitaciones",
    text: "Si un archivo supera el tope de descarga, o si a este portal le falta con qué leer un formato, queda «sin analizar». No es un fallo del dato.",
  },
  {
    title: "Los fallos de la plataforma",
    text: "Cuando la dirección devuelve una página web en vez del archivo, se cuenta aparte: suele ser un problema del gestor de publicación, no del dato, y no penaliza la puntuación.",
  },
  {
    title: "Lo que no se puede verificar",
    text: "Un conjunto de datos sin fecha de actualización no está probado que esté obsoleto: está probado que no se puede comprobar. Son dos cosas distintas y se presentan por separado.",
  },
];

const LIMITES = [
  {
    // Sin repetir la cifra: el tope se escribe una sola vez, en el `detail` del
    // paso de descarga, que es la copia que `pipeline-limits.test.ts` contrasta
    // contra el fuente de Python. Tenerlo también aquí a mano era la vía por la
    // que ya envejeció una vez.
    title: "Archivos grandes, a medias",
    text: "Por encima del tope de descarga solo se analiza la parte que llegó, y el archivo queda marcado como parcial. Las cifras de filas y columnas de esos archivos son del trozo leído, no del total. En la ficha de cada archivo, el explorador lo descarga entero en tu navegador y recalcula, así que ahí sí se ven las cifras reales.",
  },
  {
    title: "Un tope por si un archivo se desborda",
    text: "De cada tipo de incidencia se guarda la posición de todos los casos, hasta dos millones. Solo se recorta por encima de esa cifra, y cuando pasa la ficha del archivo lo dice en lugar de callarlo. Para recorrer los casos, el explorador de la ficha los recalcula sobre el archivo real.",
  },
  {
    title: "Validez formal, no veracidad",
    text: "El portal comprueba que el archivo abre y que su estructura es coherente. No puede decir si el dato es correcto: una población de 900.000 habitantes en un municipio pasa todas las comprobaciones.",
  },
  {
    title: "Un solo organismo declarado",
    text: "Todos los conjuntos de datos del catálogo declaran el mismo publicador, así que no se puede comparar el desempeño entre consejerías ni repartir el trabajo por organismo. Por eso las prioridades se agrupan por formato y por temática.",
  },
];

/**
 * «N de cada diez» en palabras, indexado por la décima redondeada (0 a 10).
 * Cubre el rango completo, así que no necesita valor de reserva.
 */
const TENTHS = ["ninguno", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "todos"];

export default async function MetodologiaPage() {
  /* Las cifras de esta página se leen del catálogo y del informe, nunca se
     escriben a mano: si no, envejecen con cada publicación y acaban
     contradiciendo a Inicio, que sí las calcula. */
  const catalog = await getCatalog();
  const report = getQualityReport();
  const delivery = summarizeDelivery(report);

  const analyzedFiles = delivery.total;
  const catalogDatasets = catalog.stats.totalDatasets;
  const analyzedDatasets = delivery.totalDatasets;

  /* Cobertura, derivada del propio catálogo: es lo que respalda que el método
     se aplique al catálogo entero y no a una muestra. */
  const categoryCount = Object.keys(catalog.stats.byCategory).length;
  const formatCount = Object.keys(catalog.stats.formatsBreakdown).length;
  const analyzedAt = formatLongDate(report?.generated_at);
  /* Lo publicado después de la foto. Es la diferencia que explica por qué el
     universo y el análisis no dan la misma cifra. */
  const newSinceAnalysis = report ? catalogDatasets - analyzedDatasets : 0;

  const withoutModified = catalog.datasets.filter((ds) =>
    ds.metadataGaps.includes("sin-fecha-actualizacion")
  ).length;
  const withoutModifiedTenths =
    catalogDatasets > 0 ? Math.round((withoutModified / catalogDatasets) * 10) : 0;

  return (
    <div className="space-y-12">
      {/* ── Entrada ─────────────────────────────────────────────────────────
          Sin repetir el gancho de la portada. Este párrafo decía otra vez
          «descarga cada archivo publicado e intenta abrirlo, como haría quien
          quiere reutilizarlo», que es literalmente la frase del hero: quien
          llega aquí ya la ha leído y lo que viene a buscar es el método. */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-strong">Metodología</h1>
        <p className="mt-2 max-w-4xl text-base leading-relaxed text-body">
          Qué se mide exactamente, con qué criterios y con qué límites. Todo lo que publica el
          portal sale del procedimiento que se describe abajo, y todo él se puede volver a ejecutar:
          el código es público y el último apartado dice cómo.
        </p>

        {/* La fórmula, en tabla y no en un bloque de código monoespaciado.
            Era un `<pre>` con la suma alineada a mano por el signo igual: un
            formato de terminal para tres cifras que son, sencillamente, tres
            pesos con su descripción. Se pinta con el mismo patrón que «Metadatos,
            cuatro factores» más abajo, que es el que la página ya usa para
            repartos que suman 100.

            La tercera columna es la que antes iba en prosa debajo («tres
            preguntas distintas: si la ficha…»), así que la tabla no añade texto:
            lo reordena. */}
        <Card className="mt-6">
          <CardContent>
            <h2 className="text-base font-semibold text-strong">La fórmula, de entrada</h2>
            <p className="mt-1 max-w-4xl text-sm text-faint">
              Tres preguntas distintas, medidas por separado porque se corrigen de forma distinta.
              Suman el 100%. Los términos están en el{" "}
              <Link
                href="/glosario"
                className="font-medium text-link underline-offset-2 hover:underline"
              >
                glosario
              </Link>
              .
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Ejes del índice de calidad y su peso
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-faint">
                    <th scope="col" className="py-2 pr-4 font-medium">Eje</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Peso</th>
                    <th scope="col" className="py-2 font-medium">Qué responde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {DIMENSIONS.map((d) => (
                    <tr key={d.name}>
                      <th scope="row" className="py-3 pr-4 text-left align-top font-semibold text-strong">
                        {d.name}
                      </th>
                      {/* Los pesos salen de `SCORE_WEIGHTS`, que es lo que aplica
                          el cálculo: así la tabla no puede desmentir al código. */}
                      <td className="py-3 pr-4 text-right align-top font-semibold tabular-nums text-ok">
                        {d.weight}%
                      </td>
                      <td className="py-3 align-top leading-relaxed text-body">{d.measures}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* El aviso estaba al pie de la página, después de todo el detalle.
                Quien lea los pesos tiene que saber en el mismo golpe de vista
                que son criterio de esta plataforma y no una norma: leerlo seis
                secciones más tarde llega tarde. */}
            <p className="mt-4 max-w-4xl border-t border-border pt-3 text-sm leading-relaxed text-faint">
              <strong className="font-semibold text-body">Estos pesos son criterio de esta
              plataforma, no un estándar oficial.</strong>{" "}
              Están elegidos y razonados aquí, y pueden revisarse a medida que evoluciona el
              catálogo; cuando se toquen, se dirá en esta página. Lo mismo vale para los umbrales
              de más abajo.
            </p>
          </CardContent>
        </Card>

        <nav aria-label="Secciones de esta página" className="mt-6 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-body transition-colors hover:border-border-strong hover:bg-fill hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      {/* ── Alcance ──────────────────────────────────────────────────────────
          Sobre qué se aplica el método, de dónde sale y con qué fecha. Faltaba,
          y es lo primero que distingue una metodología de una explicación: sin
          declarar el universo, «se analizan los archivos» no dice cuántos ni
          cuáles. Las cifras se leen del catálogo y del informe, nunca a mano.

          Recupera lo aprovechable del bloque de cobertura que se quitó de la
          portada, donde estorbaba y aquí sí sostiene el argumento. */}
      <section id="alcance" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Target className="h-5 w-5 text-faint" aria-hidden />
            Alcance
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-body">
            El método se aplica al catálogo completo, no a una muestra ni a una selección temática.
          </p>
        </div>

        <Card>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="eyebrow">Universo</dt>
                <dd className="mt-1 text-sm leading-relaxed text-body">
                  Los <strong className="text-strong">{catalogDatasets.toLocaleString("es-ES")}</strong>{" "}
                  conjuntos de datos del catálogo y{" "}
                  <strong className="text-strong">
                    sus {catalog.stats.totalDistributions.toLocaleString("es-ES")}
                  </strong>{" "}
                  archivos y servicios, repartidos en {categoryCount} temáticas y {formatCount}{" "}
                  formatos distintos.
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Fuente</dt>
                <dd className="mt-1 text-sm leading-relaxed text-body">
                  El catálogo RDF que publica{" "}
                  <a
                    href="https://datosabiertos.jcyl.es"
                    target="_blank"
                    rel="noreferrer"
                    className="text-link underline-offset-2 hover:underline"
                  >
                    datosabiertos.jcyl.es
                  </a>{" "}
                  con el estándar europeo DCAT, leído en vivo.
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Foto vigente</dt>
                <dd className="mt-1 text-sm leading-relaxed text-body">
                  {analyzedAt ? (
                    <>
                      Análisis del{" "}
                      <time dateTime={report?.generated_at}>{analyzedAt}</time>, sobre{" "}
                      {analyzedDatasets.toLocaleString("es-ES")} conjuntos y{" "}
                      {analyzedFiles.toLocaleString("es-ES")} archivos.
                    </>
                  ) : (
                    "Todavía no hay ningún análisis publicado."
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Qué no entra</dt>
                <dd className="mt-1 text-sm leading-relaxed text-body">
                  Nada se excluye por temática, formato ni organismo. Las únicas ausencias son
                  técnicas y están{" "}
                  <a href="#limites" className="text-link underline-offset-2 hover:underline">
                    declaradas más abajo
                  </a>
                  .
                </dd>
              </div>
            </dl>

            {/* Los dos ritmos, explicados donde se notan.
                Esto vivía dos secciones más abajo en una tarjeta titulada «Dos
                cosas que no hay que confundir», que anunciaba una confusión sin
                decir cuál. El problema real es que «Universo» y «Foto vigente»
                dan aquí mismo dos cifras distintas de lo mismo, y sin una línea
                que lo explique parece un error de cuentas. */}
            {analyzedAt && (
              <p className="mt-5 max-w-4xl border-t border-border pt-4 text-sm leading-relaxed text-faint">
                Las dos cifras no coinciden, y es lo esperable: el catálogo se lee{" "}
                <strong className="font-semibold text-body">en vivo</strong> —un conjunto nuevo
                aparece en cuanto la Junta lo publica— mientras que el análisis es{" "}
                <strong className="font-semibold text-body">una foto fechada</strong>, porque
                descargar y abrir {analyzedFiles.toLocaleString("es-ES")} archivos lleva horas.
                {newSinceAnalysis > 0 ? (
                  <>
                    {" "}Ahora mismo hay {newSinceAnalysis.toLocaleString("es-ES")}{" "}
                    {newSinceAnalysis === 1 ? "conjunto publicado" : "conjuntos publicados"} después
                    de esa foto, que figuran como «sin analizar» hasta la siguiente.
                  </>
                ) : (
                  <> Lo publicado después de esa foto figura como «sin analizar».</>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Cómo se comprueba ────────────────────────────────────────────────
          Incorpora lo que era la sección «De dónde salen los datos»: decía en
          dos tarjetas lo mismo que el paso 1, y solo aportaba de nuevo la
          advertencia sobre los dos ritmos, que ahora va al pie. */}
      <section id="comprobacion" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <ScanSearch className="h-5 w-5 text-faint" aria-hidden />
            Cómo se comprueba cada archivo
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-body">
            {/* La frase de arranque era literalmente la misma que abre la
                sección equivalente de la portada. Aquí se entra directo al
                procedimiento, que es lo que esta página debe aportar. */}
            Cuatro pasos, en este orden. El segundo es el que separa a este portal de un inventario
            de metadatos: el archivo se descarga de verdad y se intenta abrir.
          </p>
        </div>

        <ol className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {PIPELINE.map((step, i) => {
            const Icon = PIPELINE_ICONS[step.icon];
            return (
              <li key={step.title}>
                <Card className="h-full">
                  <CardContent className="flex h-full gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                      <Icon className="h-4 w-4 text-body" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="eyebrow mb-1">Paso {i + 1}</p>
                      <h3 className="text-sm font-semibold text-strong">{step.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-body">{step.long}</p>
                      {/* Los topes, junto al paso que acotan. Estaban en un
                          acordeón de «detalle técnico» al final de la página,
                          lejos de lo que explican. */}
                      <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">
                        {step.detail}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>

        {/* Aquí había una tarjeta «Dos cosas que no hay que confundir» con los
            dos ritmos del portal —catálogo en vivo, análisis fechado—. El
            contenido no se pierde: está en «Alcance», que es donde las dos
            cifras aparecen juntas y donde, por tanto, hace falta la explicación.
            El título además prometía una confusión sin decir cuál. */}
      </section>

      {/* ── Qué cuenta como fallo ── */}
      <section id="fallos" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <TriangleAlert className="h-5 w-5 text-faint" aria-hidden />
            Qué cuenta como fallo
          </h2>
          {/* El ejemplo de las 9.000 celdas se cuenta una sola vez, en «Cómo se
              puntúa», donde justifica la fórmula. Aquí bastaba con enunciar la
              separación. */}
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-body">
            «No se puede abrir» y «necesita limpieza» son problemas de naturaleza distinta y se miden
            aparte. Mezclarlos engaña en las dos direcciones, porque por volumen la inmensa mayoría
            de las incidencias del catálogo son celdas opcionales vacías: contadas junto a lo que
            rompe la reutilización, la tapan.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {DIMENSIONS.map((d) => (
            <Card key={d.name}>
              <CardContent>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <p className="eyebrow">{d.name}</p>
                  <span className="text-xs font-semibold tabular-nums text-faint">
                    {d.weight}% del índice
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-strong">{d.headline}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-body">{d.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* «Lo que no se le imputa a quien publica» estaba aquí, en una tarjeta
            con tres columnas dentro. Se ha llevado a «Qué no puede saber el
            portal», que trata lo mismo desde el otro lado. */}
      </section>

      {/* ── Cálculos ── */}
      <section id="calculos" className="scroll-mt-24 space-y-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Gauge className="h-5 w-5 text-faint" aria-hidden />
            Cómo se calculan las puntuaciones
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-body">
            La fórmula está arriba. Aquí está lo que hay detrás de cada uno de sus tres sumandos.
          </p>
        </div>

        <Card>
          <CardContent>
            <h3 className="text-base font-semibold text-strong">Disponibilidad</h3>
            <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-body">
              El porcentaje de archivos del conjunto de datos que se descargan y abren. Los que no se
              llegaron a comprobar quedan fuera del cálculo: no cuentan como fallo. Si no se comprobó
              ninguno, se muestra solo el índice de metadatos y se indica. Si se comprobaron y no
              quedó nada legible, el contenido cuenta como cero —no es un dato ausente, es el peor
              resultado posible—.
            </p>
          </CardContent>
        </Card>

        {/* Contenido: la fórmula real, que penaliza TIPOS y no ocurrencias. */}
        <Card>
          <CardContent>
            <div className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-faint" aria-hidden />
              <h3 className="text-base font-semibold text-strong">Contenido, archivo por archivo</h3>
            </div>
            <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-body">
              Cada archivo legible parte de{" "}
              <strong className="text-strong">{CONTENT_START}</strong> y baja según los{" "}
              <strong className="text-strong">tipos</strong> de problema encontrados, no según cuántas
              veces aparece cada uno.
            </p>
            {/* En tabla, con el mismo formato que «Metadatos, cuatro factores».
                Era un bloque de código monoespaciado con la resta alineada a
                mano: un formato de terminal para tres descuentos con su tope.

                Las cifras vienen de `@/data/content-scoring`, no escritas aquí:
                son las que aplica `_score_from_issues` en el analizador y
                `content-scoring.test.ts` comprueba que sigan coincidiendo. */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Descuentos sobre la puntuación de contenido de un archivo
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-faint">
                    <th scope="col" className="py-2 pr-4 font-medium">Descuento</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Resta</th>
                    <th scope="col" className="py-2 font-medium">Tope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {CONTENT_PENALTIES.map((p) => (
                    <tr key={p.concept}>
                      <th scope="row" className="py-3 pr-4 text-left align-top font-semibold text-strong">
                        {p.concept}
                      </th>
                      <td className="py-3 pr-4 text-right align-top font-semibold tabular-nums text-bad">
                        −{p.points}
                      </td>
                      <td className="py-3 align-top leading-relaxed text-body">{p.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-faint">
              El resultado se acota entre 0 y {CONTENT_START}.
            </p>
            <p className="mt-3 max-w-4xl text-sm leading-relaxed text-faint">
              Penalizar tipos y no casos es deliberado: un CSV con 9.000 celdas vacías del mismo tipo
              tiene un problema, no nueve mil. Si contáramos casos, ese archivo se hundiría por debajo
              de uno que no existe. La puntuación del conjunto de datos es la media de las de sus
              archivos legibles; los formatos que no son tablas —mapas, calendarios, imágenes— tienen
              su propia escala, más simple.
            </p>
          </CardContent>
        </Card>

        {/* Metadatos: cuatro factores, en tabla. Eran cuatro tarjetas con barra
            de progreso para cuatro pesos que suman 100. */}
        <Card>
          <CardContent>
            <h3 className="text-base font-semibold text-strong">Metadatos, cuatro factores</h3>
            <p className="mt-1 max-w-4xl text-sm text-faint">
              Se calculan solo con lo que declara la ficha del catálogo, sin descargar nada. Suman el
              100%.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Factores del índice de metadatos y su peso
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-faint">
                    <th scope="col" className="py-2 pr-4 font-medium">Factor</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Peso</th>
                    <th scope="col" className="py-2 font-medium">Qué mide</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {META_FACTORS.map((f) => (
                    <tr key={f.title}>
                      <th scope="row" className="py-3 pr-4 text-left align-top font-semibold text-strong">
                        {f.title}
                      </th>
                      <td className="py-3 pr-4 text-right align-top font-semibold tabular-nums text-ok">
                        {f.weight}%
                      </td>
                      <td className="py-3 align-top leading-relaxed text-body">{f.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* La actualidad y su trampa. */}
        <Card tone="warn">
          <CardContent>
            <h3 className="text-sm font-semibold text-strong">
              La actualidad tiene una trampa, y conviene conocerla
            </h3>
            <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-body">
              Para medir si un conjunto de datos va al día hace falta saber cuándo se actualizó por
              última vez. Hoy {TENTHS[withoutModifiedTenths]} de cada diez
              conjuntos del catálogo no publican esa fecha (
              {withoutModified.toLocaleString("es-ES")} de {catalogDatasets.toLocaleString("es-ES")}),
              así que la única disponible es la de publicación y el cálculo mide desde ahí: un
              conjunto que se refresca cada día pero se publicó en 2011 sale con años de retraso
              aparente.
            </p>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-body">
              La puntuación no distingue el retraso demostrado del no verificable —mide con la fecha
              que tiene—, pero el portal sí lo distingue al presentarlo, porque son dos correcciones
              distintas: publicar el metadato, o actualizar el dato. El desglose está en{" "}
              <Link
                href="/calidad?vista=metadatos"
                className="font-medium text-link underline-offset-2 hover:underline"
              >
                Calidad › Fichas incompletas
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        {/* Umbrales, derivados de `SCORE_LEVELS`: los rangos, las etiquetas y la
            anchura de cada tramo salen de la misma tabla que usa el resto de la
            interfaz para colorear cualquier nota. */}
        <div>
          <h3 className="text-base font-semibold text-strong">Umbrales</h3>
          <p className="mt-1 max-w-4xl text-sm text-faint">
            Los mismos en toda la interfaz, en la API y en el sello. Cada tramo se dibuja con la
            anchura del rango que cubre, no con un tercio de la barra.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <div className="flex h-3" aria-hidden>
              {SCORE_LEVELS.map((band) => (
                <div key={band.level} className={band.fill} style={{ width: `${band.width}%` }} />
              ))}
            </div>
            {/* Las etiquetas comparten el ancho de su tramo, no un tercio cada
                una. Con `grid-cols-3` los separadores caían en el 33% y el 66%
                mientras el color cambiaba en el 50% y el 80%: la barra decía una
                cosa y las divisiones otra, que es justo lo que este bloque
                pretende enseñar. `min-w-0` para que el texto pueda encogerse en
                el tramo más estrecho en vez de desbordar. */}
            <div className="flex divide-x divide-border">
              {SCORE_LEVELS.map((band) => (
                <div key={band.level} className="min-w-0 p-3" style={{ width: `${band.width}%` }}>
                  <p className={`text-sm font-semibold ${band.color}`}>
                    {band.min === 0
                      ? `< ${band.max + 1}%`
                      : band.max === 100
                      ? `≥ ${band.min}%`
                      : `${band.min}–${band.max}%`}
                  </p>
                  <p className="text-xs text-faint">{band.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Límites, en dos grupos ───────────────────────────────────────────
          Antes esto eran dos bloques separados y lejanos: aquí, lo que el
          análisis no alcanza a saber; y al final de «Qué cuenta como fallo»,
          una tarjeta con «Lo que no se le imputa a quien publica» apretada en
          tres columnas. Son las dos caras de la misma pregunta —hasta dónde
          llega esta auditoría— y separarlas obligaba a reconstruir la respuesta
          leyendo dos sitios. Juntas, y las dos con el mismo formato de tarjeta.

          El `id` se mantiene: `#limites` está enlazado desde la portada y desde
          «Alcance». */}
      <section id="limites" className="scroll-mt-24 space-y-6">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Layers className="h-5 w-5 text-faint" aria-hidden />
            Qué no puede saber el portal
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-body">
            Una auditoría que no dice dónde acaba su alcance es una auditoría en la que no se puede
            confiar. Estos son los límites conocidos, y lo que el análisis ve pero decide no
            achacar a quien publica.
          </p>
        </div>

        <div>
          <h3 className="text-base font-semibold text-strong">Lo que el análisis no alcanza</h3>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            {LIMITES.map((l) => (
              <Card key={l.title}>
                <CardContent>
                  <h4 className="text-sm font-semibold text-strong">{l.title}</h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-body">{l.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Esto es lo que separa una auditoría de un señalamiento. */}
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-strong">
            <Ban className="h-4 w-4 text-faint" aria-hidden />
            Lo que no se le imputa a quien publica
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            {NO_IMPUTABLE.map((n) => (
              <Card key={n.title}>
                <CardContent>
                  <h4 className="text-sm font-semibold text-strong">{n.title}</h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-body">{n.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>


      {/* ── Cómo reproducirlo ────────────────────────────────────────────────
          La pieza que faltaba para que esto sea una metodología y no solo una
          explicación: un método que no se puede volver a ejecutar hay que
          creérselo. El repositorio es público, así que ya se puede ofrecer. */}
      <section id="reproducir" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Terminal className="h-5 w-5 text-faint" aria-hidden />
            Cómo reproducirlo
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-body">
            Nada de lo que hay aquí exige confiar en este portal. El código del análisis es público
            y se ejecuta contra el mismo catálogo, así que cualquiera puede rehacer la foto y
            comparar. Es un proceso largo —descargar y abrir todos los archivos lleva horas y
            varias decenas de gigas— y corre en local, sin infraestructura propia.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-3">
            <pre className="overflow-x-auto rounded-lg border border-border bg-fill px-4 py-3 font-mono text-xs leading-relaxed text-body">
{`git clone ${REPO_URL}
cd CyLMetrics

# El portal, con el informe del último análisis ya incluido
npm install
npm run dev

# Rehacer el análisis: primero, comprobar que están todos los lectores
pip install -r requirements-analysis.txt
python -m src.analysis --check-deps

# Una prueba corta, fuera del informe publicado
python -m src.analysis --limit 20 --output reports/prueba

# El análisis completo: horas y varias decenas de gigas
python -m src.analysis --limit 0`}
            </pre>
            <p className="max-w-4xl text-xs leading-relaxed text-faint">
              El portal arranca con el informe ya incluido en el repositorio, así que se puede
              explorar sin ejecutar el análisis. La comprobación de dependencias no descarga nada:
              solo verifica que el entorno sabe abrir todos los formatos del catálogo, porque un
              lector que falte no da error — archiva en silencio como «sin analizar» todo lo que no
              pudo leer. Y las pruebas conviene mandarlas a otro directorio de salida: el valor por
              defecto es el informe que publica este portal.
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
            >
              Ver el repositorio <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </CardContent>
        </Card>
      </section>

      {/* La nota del pie decía dos cosas y las dos están ya arriba: el aviso de
          que los pesos no son un estándar subió junto a la fórmula, que es donde
          se leen, y la fuente de los metadatos la declara «Alcance». */}
      <div className="flex flex-wrap gap-4 border-t border-border pt-6">
        <Link
          href="/catalogo"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Explorar el catálogo <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/calidad"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Ver qué hay que corregir <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        {/* La API tenía sección propia aquí y ahora vive en su página; sin este
            enlace, quien viene a por la referencia se queda sin salida. */}
        <Link
          href="/api"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Consultar todo esto por API <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/glosario"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Consultar el glosario <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
