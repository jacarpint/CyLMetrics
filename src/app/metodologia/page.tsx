import Link from "next/link";
import {
  ArrowRight, Ban, Code2, Database, Download, FileSearch, Gauge, Layers, ListChecks,
  ScanSearch, ScrollText, Settings2, ShieldCheck, TriangleAlert,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import EmbedBlock from "@/components/ui/embed-block";
import { ApiReference } from "@/components/pages/metodologia/ApiReference";
import { PIPELINE, type PipelineStep } from "@/data/pipeline";
import { getCatalog } from "@/lib/rdf-catalog";
import { getQualityReport } from "@/lib/quality-report";
import { summarizeDelivery } from "@/lib/availability";
import { METADATA_WEIGHTS, SCORE_LEVELS, SCORE_WEIGHTS } from "@/lib/quality";

/** Un peso 0-1 del código, escrito como el porcentaje que se publica. */
const asPercent = (weight: number) => Math.round(weight * 100);

export const revalidate = 3600;

export const metadata = {
  title: "Metodología",
  description:
    "Cómo se comprueba cada archivo del catálogo de datos abiertos de Castilla y León, cómo se calculan las puntuaciones de calidad y cómo consultar todo por API.",
};

/**
 * Índice de la página, en tres niveles de profundidad: primero lo que cualquiera
 * necesita para juzgar si fiarse del portal, después las referencias para quien
 * va a construir algo, y el detalle de operación al final y plegado.
 */
const SECTIONS = [
  { id: "comprobacion", label: "Cómo se comprueba" },
  { id: "fallos", label: "Qué cuenta como fallo" },
  { id: "calculos", label: "Cómo se puntúa" },
  { id: "limites", label: "Qué no puede saber" },
  { id: "api", label: "API" },
  { id: "sello", label: "Sello" },
  { id: "detalle", label: "Detalle técnico" },
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
    headline: "La ficha está incompleta",
    text: "El archivo está perfecto, pero su ficha no permite encontrarlo, fecharlo o saber si se puede reutilizar. Es lo más barato de corregir y lo que más rinde.",
  },
  {
    name: "Disponibilidad",
    weight: asPercent(SCORE_WEIGHTS.availability),
    headline: "No se puede usar",
    text: "O la descarga falla, o el archivo llega y no se puede interpretar. Es bloqueante: no hay dato que reutilizar, por muy completa que esté la ficha.",
  },
  {
    name: "Contenido",
    weight: asPercent(SCORE_WEIGHTS.content),
    headline: "Abre, pero necesita limpieza",
    text: "Encabezados vacíos o repetidos, tipos mezclados en una columna, filas de más o de menos. Se puede reutilizar, pero obliga a limpiar antes.",
  },
];

/**
 * La fórmula tal como se muestra, alineada por el signo igual.
 *
 * Se compone a partir de `DIMENSIONS` para que los pesos publicados sean
 * literalmente los que usa el cálculo.
 */
const FORMULA_LABEL = "índice de calidad = ";
const FORMULA_LINES = DIMENSIONS.map((dimension, i) => {
  const term = `${dimension.weight}% · ${dimension.name.toLowerCase()}`;
  return i === 0
    ? `${FORMULA_LABEL}${term}`
    : `${" ".repeat(FORMULA_LABEL.length - 2)}+ ${term}`;
});

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

/** Los seis resultados posibles de una descarga. Salen de `fetch.status`. */
const FETCH_STATES = [
  { code: "downloaded", label: "El archivo llegó completo.", tone: "text-ok" },
  { code: "truncated", label: "Llegó hasta el tope de 25 MB. Se analiza lo que hay y queda marcado como parcial.", tone: "text-body" },
  { code: "http_error", label: "El servidor respondió con un error.", tone: "text-bad" },
  { code: "unreachable", label: "No se pudo contactar con el servidor.", tone: "text-bad" },
  { code: "service", label: "El servicio rechazó la petición.", tone: "text-bad" },
  { code: "too_large", label: "Declara más del tope, así que no se intentó. No se sabe si abre.", tone: "text-faint" },
];

const LIMITES = [
  {
    title: "Archivos grandes, a medias",
    text: "Por encima de 25 MB solo se analiza la parte descargada, y el archivo queda marcado como parcial. Las cifras de filas y columnas de esos archivos son del trozo leído, no del total. En la ficha de cada archivo, el explorador lo descarga entero en tu navegador y recalcula, así que ahí sí se ven las cifras reales.",
  },
  {
    title: "Cinco ejemplos por problema",
    text: "El informe guarda hasta cinco muestras de cada tipo de incidencia, con su fila y su columna, para no crecer sin control. Para recorrer todos los casos, el explorador de la ficha los recalcula sobre el archivo real.",
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

  const withoutModified = catalog.datasets.filter((ds) =>
    ds.metadataGaps.includes("sin-fecha-actualizacion")
  ).length;
  const withoutModifiedTenths =
    catalogDatasets > 0 ? Math.round((withoutModified / catalogDatasets) * 10) : 0;

  return (
    <div className="space-y-12">
      {/* ── Nivel 1: lo que necesita cualquiera ─────────────────────────────
          Antes había que leer siete secciones para saber qué hace el portal.
          Esto responde a eso en un párrafo y una fórmula. */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-strong">Metodología</h1>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-body">
          Casi todos los inventarios de calidad de datos abiertos revisan la ficha. Este{" "}
          <strong className="text-strong">descarga cada archivo publicado e intenta abrirlo</strong>,
          como haría quien quiere reutilizarlo, y publica el resultado archivo por archivo con el
          motivo de cada fallo. Lo que sigue explica el recorrido completo: qué se comprueba, cómo se
          convierte en una nota y dónde acaba el alcance.
        </p>

        <Card className="mt-6 border-ok-line bg-ok-surface">
          <CardContent>
            <p className="eyebrow mb-2">La fórmula, de entrada</p>
            {/* La fórmula se escribe desde los pesos que aplica el cálculo, no
                a mano: así no puede desmentir al código. */}
            <pre className="overflow-x-auto rounded-lg border border-border bg-card px-4 py-3 font-mono text-sm text-body">
              {FORMULA_LINES.join("\n")}
            </pre>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-body">
              Tres preguntas distintas: si la ficha permite encontrar y entender el dato, si el
              archivo se puede abrir, y si lo que hay dentro está limpio. Se miden por separado
              porque se corrigen de forma distinta. Los términos están en el{" "}
              <Link
                href="/glosario"
                className="font-medium text-link underline-offset-2 hover:underline"
              >
                glosario
              </Link>
              .
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
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            Un catálogo puede tener fichas impecables y archivos que no abren. Lo que distingue a
            este portal es el paso 2: no se queda en los metadatos.
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
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>

        <Card tone="muted">
          <CardContent>
            <h3 className="text-sm font-semibold text-strong">Dos ritmos que no hay que confundir</h3>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-body">
              El catálogo se lee <strong className="text-strong">en vivo</strong>, cada hora: un
              conjunto de datos nuevo aparece aquí el mismo día. El análisis, en cambio, es{" "}
              <strong className="text-strong">una foto</strong>: descargar y abrir los{" "}
              {analyzedFiles.toLocaleString("es-ES")} archivos tarda horas, así que se ejecuta
              periódicamente y lo publicado después figura como «sin analizar» hasta la siguiente
              vuelta.
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-faint">
              Por eso los totales no siempre cuadran al dígito: ahora mismo el catálogo tiene{" "}
              {catalogDatasets.toLocaleString("es-ES")} conjuntos de datos y el análisis vio{" "}
              {analyzedDatasets.toLocaleString("es-ES")}. No es un error de cuentas, y el portal lo
              indica donde las dos cifras aparecen juntas.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── Qué cuenta como fallo ── */}
      <section id="fallos" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <TriangleAlert className="h-5 w-5 text-faint" aria-hidden />
            Qué cuenta como fallo
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            «No se puede abrir» y «necesita limpieza» son problemas de naturaleza distinta y se miden
            aparte. Mezclarlos engaña en las dos direcciones: por volumen, la inmensa mayoría de las
            incidencias del catálogo son celdas opcionales vacías, así que un CSV correcto con 9.000
            huecos salía peor que un archivo que no existe.
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

        {/* Esto es lo que separa una auditoría de un señalamiento. */}
        <Card tone="ok">
          <CardContent>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-strong">
              <Ban className="h-4 w-4 text-ok" aria-hidden />
              Lo que no se le imputa a quien publica
            </h3>
            <ul className="mt-3 grid grid-cols-1 gap-2 text-sm leading-relaxed text-body md:grid-cols-3">
              <li>
                <strong className="text-strong">Nuestras propias limitaciones.</strong> Si un archivo
                supera el tope de descarga, o si a este portal le falta con qué leer un formato, queda
                «sin analizar». No es un fallo del dato.
              </li>
              <li>
                <strong className="text-strong">Los fallos de la plataforma.</strong> Cuando la
                dirección devuelve una página web en vez del archivo, se cuenta aparte: suele ser un
                problema del gestor de publicación, no del dato, y no penaliza la puntuación.
              </li>
              <li>
                <strong className="text-strong">Lo que no se puede verificar.</strong> Un conjunto de
                datos sin fecha de actualización no está probado que esté obsoleto: está probado que no
                se puede comprobar. Son dos cosas distintas y se presentan por separado.
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* ── Cálculos ── */}
      <section id="calculos" className="scroll-mt-24 space-y-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Gauge className="h-5 w-5 text-faint" aria-hidden />
            Cómo se calculan las puntuaciones
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            La fórmula está arriba. Aquí está lo que hay detrás de cada uno de sus tres sumandos.
          </p>
        </div>

        <Card>
          <CardContent>
            <h3 className="text-base font-semibold text-strong">Disponibilidad</h3>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-body">
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
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-body">
              Cada archivo legible parte de 100 y baja según los{" "}
              <strong className="text-strong">tipos</strong> de problema encontrados, no según cuántas
              veces aparece cada uno:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-fill px-4 py-3 font-mono text-xs leading-relaxed text-body">
{`100
 − 15 por cada tipo de incidencia grave   (máximo −60)
 −  5 por cada tipo de incidencia leve
 − 10 si el total de casos graves pasa de 1.000
 → acotado entre 0 y 100`}
            </pre>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-faint">
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
            <p className="mt-1 max-w-3xl text-sm text-faint">
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
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-body">
              Para medir si un conjunto de datos va al día hace falta saber cuándo se actualizó por
              última vez. Hoy {TENTHS[withoutModifiedTenths]} de cada diez
              conjuntos del catálogo no publican esa fecha (
              {withoutModified.toLocaleString("es-ES")} de {catalogDatasets.toLocaleString("es-ES")}),
              así que la única disponible es la de publicación y el cálculo mide desde ahí: un
              conjunto que se refresca cada día pero se publicó en 2011 sale con años de retraso
              aparente.
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-body">
              La puntuación no distingue el retraso demostrado del no verificable —mide con la fecha
              que tiene—, pero el portal sí lo distingue al presentarlo, porque son dos correcciones
              distintas: publicar el metadato, o actualizar el dato. El desglose está en{" "}
              <Link
                href="/calidad?vista=metadatos"
                className="font-medium text-link underline-offset-2 hover:underline"
              >
                Calidad › Metadatos
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
          <p className="mt-1 max-w-3xl text-sm text-faint">
            Los mismos en toda la interfaz, en la API y en el sello. Cada tramo se dibuja con la
            anchura del rango que cubre, no con un tercio de la barra.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <div className="flex h-3" aria-hidden>
              {SCORE_LEVELS.map((band) => (
                <div key={band.level} className={band.fill} style={{ width: `${band.width}%` }} />
              ))}
            </div>
            <div className="grid grid-cols-3 divide-x divide-border">
              {SCORE_LEVELS.map((band) => (
                <div key={band.level} className="p-3">
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

      {/* ── Límites ── */}
      <section id="limites" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Layers className="h-5 w-5 text-faint" aria-hidden />
            Qué no puede saber el portal
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            Una auditoría que no dice dónde acaba su alcance es una auditoría en la que no se puede
            confiar. Estos son los límites conocidos.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {LIMITES.map((l) => (
            <Card key={l.title}>
              <CardContent>
                <h3 className="text-sm font-semibold text-strong">{l.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-body">{l.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>


      {/* ── API ── */}
      <section id="api" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Code2 className="h-5 w-5 text-faint" aria-hidden />
            API
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            Un observatorio de datos abiertos debería publicar también los suyos. Todo lo que se ve en
            el portal está disponible en JSON, sin registro ni clave. Además, las listas de trabajo de{" "}
            <Link href="/calidad" className="font-medium text-link underline-offset-2 hover:underline">
              Calidad
            </Link>{" "}
            se descargan en CSV respetando los filtros que tengas puestos.
          </p>
        </div>

        <ApiReference />
      </section>

      {/* ── Sello ── */}
      <section id="sello" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <ShieldCheck className="h-5 w-5 text-faint" aria-hidden />
            Sello de calidad
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            Cualquiera puede incrustar la calidad de un conjunto de datos —o la del catálogo entero—
            como una imagen que se actualiza sola. El sello escribe siempre el nivel junto al
            porcentaje, con los umbrales de más arriba: el color no puede ser lo único que informe, y
            menos en una imagen pegada en otra web.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-fill p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG de una ruta propia, sin optimización que aplicar */}
              <img
                src="/api/sello"
                alt="Sello con el índice de calidad del catálogo de datos abiertos de Castilla y León"
                width={174}
                height={28}
              />
              <span className="text-xs text-faint">índice de calidad del catálogo completo</span>
            </div>

            <EmbedBlock url="/api/sello?dataset=IDENTIFICADOR" label="Código para incrustarlo" />

            <p className="text-xs leading-relaxed text-faint">
              Sustituye <code className="font-mono text-body">IDENTIFICADOR</code> por el número que
              aparece al final de la dirección de la ficha (por ejemplo{" "}
              <code className="font-mono text-body">1285663381041</code>). Cada ficha trae el suyo ya
              montado.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── Nivel 3: detalle técnico ─────────────────────────────────────────
          Topes, tiempos de espera, códigos internos y la guardia contra
          servidores lentos. Da confianza a quien la busca y estorba a quien no:
          va plegado. */}
      <section id="detalle" className="scroll-mt-24">
        <details className="rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-lg font-bold tracking-tight text-strong">
            <Settings2 className="h-5 w-5 text-faint" aria-hidden />
            Detalle técnico
            <span className="text-xs font-normal text-faint">
              topes, tiempos de espera y códigos internos
            </span>
          </summary>

          <div className="space-y-5 border-t border-border p-5">
            <div>
              <h3 className="text-sm font-semibold text-strong">Límites de cada paso</h3>
              <dl className="mt-2 space-y-1.5">
                {PIPELINE.map((step, i) => (
                  <div key={step.title} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <dt className="font-medium text-body">
                      {i + 1}. {step.title}
                    </dt>
                    <dd className="font-mono text-xs text-faint">{step.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-strong">Los seis resultados de una descarga</h3>
              <p className="mt-1 text-xs text-faint">
                Estos códigos son los que devuelve la API en el campo{" "}
                <code className="font-mono text-body">fetch.status</code>.
              </p>
              <dl className="mt-2 space-y-2">
                {FETCH_STATES.map((s) => (
                  <div key={s.code} className="flex flex-wrap items-baseline gap-x-2">
                    <dt className={`font-mono text-xs font-semibold ${s.tone}`}>{s.code}</dt>
                    <dd className="min-w-0 flex-1 text-xs leading-relaxed text-body">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-strong">
                Guardia contra servidores que gotean
              </h3>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-body">
                El tiempo de espera de lectura se mide por trozo recibido, así que un servidor que
                devuelve unos pocos bytes cada pocos segundos nunca lo agota y podría bloquear el
                análisis indefinidamente. Si en 30 segundos no han llegado 300 KB, la descarga se
                aborta y se reintenta.
              </p>
            </div>
          </div>
        </details>
      </section>

      {/* ── Nota ── */}
      <Card tone="muted">
        <CardContent className="flex items-start gap-3 p-4">
          <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
          <p className="max-w-3xl text-xs leading-relaxed text-faint">
            Los pesos y los umbrales son criterios de evaluación de esta plataforma, no un estándar
            oficial, y pueden revisarse a medida que evoluciona el catálogo. Cuando se toquen, se dirá
            aquí. La fuente de los metadatos es el catálogo de{" "}
            <a
              href="https://datosabiertos.jcyl.es"
              target="_blank"
              rel="noreferrer"
              className="text-link underline-offset-2 hover:underline"
            >
              datosabiertos.jcyl.es
            </a>
            .
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-4">
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
