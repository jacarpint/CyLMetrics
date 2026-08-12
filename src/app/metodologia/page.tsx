import Link from "next/link";
import {
  ArrowRight, Code2, Download, FileSearch, Gauge, Layers, ListChecks, ScanSearch,
  ScrollText, ShieldCheck, Timer, TriangleAlert, Database, Ban,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import EmbedBlock from "@/components/ui/embed-block";
import { ApiReference } from "@/components/pages/metodologia/ApiReference";

export const revalidate = 3600;

export const metadata = {
  title: "Metodología | JCyL Data Quality Portal",
  description:
    "Cómo se comprueba cada archivo del catálogo de datos abiertos de Castilla y León, cómo se calculan las puntuaciones de calidad y cómo consultar todo por API.",
};

/** Índice de la página: es larga y conviene poder saltar. */
const SECTIONS = [
  { id: "fuentes", label: "De dónde salen los datos" },
  { id: "comprobacion", label: "Cómo se comprueba cada archivo" },
  { id: "fallos", label: "Qué cuenta como fallo" },
  { id: "calculos", label: "Cómo se calculan las puntuaciones" },
  { id: "limites", label: "Qué no puede saber el portal" },
  { id: "api", label: "API" },
  { id: "sello", label: "Sello de calidad" },
];

/** Los cuatro pasos del motor, con los límites reales del código. */
const PIPELINE = [
  {
    icon: Database,
    title: "Se lee el catálogo",
    text: "Del RDF/DCAT oficial se extrae cada dataset con su título, licencia, organismo, temática, fechas, periodicidad y la URL de cada distribución. El portal lo revalida cada hora; si el servicio no responde, sigue sirviendo la última copia buena.",
    detail: "1 petición · revalidación horaria",
  },
  {
    icon: Download,
    title: "Se descarga cada archivo",
    text: "Primero una petición HEAD para saber cuánto pesa. Si declara más del tope, se anota y no se descarga. Si no, se descarga en streaming hasta el tope, siguiendo redirecciones y conservando la extensión original, porque los lectores de CSV y Excel deducen el formato de ella.",
    detail: "tope 25 MB · 15 s de conexión · 60 s de lectura · 2 reintentos",
  },
  {
    icon: ScanSearch,
    title: "Se identifica y se abre",
    text: "Antes de abrirlo se mira lo que hay dentro: si empieza por «<!doctype html» es una página web disfrazada de dato; si trae un ExceptionReport, es un servicio cartográfico contestando que la capa ya no existe. En los CSV se detecta la codificación y el delimitador. Después, cada formato con su lector: CSV, Excel, JSON, XML, KML, GeoJSON, shapefiles, iCal, imágenes y servicios WMS y WFS.",
    detail: "detección por contenido, no por extensión",
  },
  {
    icon: ListChecks,
    title: "Se registra y se puntúa",
    text: "Cada problema se anota con un código estable, su gravedad, cuántas veces ocurre y hasta cinco ejemplos con su fila y columna. De ahí sale la puntuación de contenido del archivo, y de la media de sus archivos, la del dataset.",
    detail: "hasta 5 muestras por tipo de incidencia",
  },
];

/** Estados de descarga que distingue el motor. Salen de `fetch.status`. */
const FETCH_STATES = [
  { code: "downloaded", label: "El archivo llegó completo.", tone: "text-ok" },
  { code: "truncated", label: "Llegó hasta el tope de 25 MB. Se analiza lo que hay, y queda marcado como parcial.", tone: "text-body" },
  { code: "http_error", label: "El servidor respondió con un error HTTP.", tone: "text-bad" },
  { code: "unreachable", label: "No se pudo contactar con el servidor.", tone: "text-bad" },
  { code: "service", label: "El servicio rechazó la petición.", tone: "text-bad" },
  { code: "too_large", label: "Declara más del tope, así que no se intentó. No se sabe si abre.", tone: "text-faint" },
];

const META_FACTORS = [
  {
    title: "Completitud",
    weight: 40,
    desc: "Nueve campos del registro DCAT, cada uno con el mismo peso: título, descripción, licencia identificable, organismo, fecha de publicación, idioma, cobertura territorial, temática y palabras clave.",
  },
  {
    title: "Apertura de formato",
    weight: 25,
    desc: "El 80% lo pone el formato más abierto que publique el dataset (CSV, JSON y GeoJSON puntúan 100; SHP 60; ECW 20) y el 20% restante la variedad, hasta tres formatos.",
  },
  {
    title: "Actualidad",
    weight: 25,
    desc: "Tiempo transcurrido desde la última fecha conocida, medido en periodos de la periodicidad declarada: dentro de plazo 100, hasta dos periodos 75, hasta cuatro 50, más allá 25. Sin periodicidad declarada no se puede juzgar y se asume 80.",
  },
  {
    title: "Apertura de licencia",
    weight: 10,
    desc: "CC-BY-4.0 puntúa 100. La licencia IGCYL de uso no comercial, 55, porque excluye la reutilización comercial. Una licencia que no se puede identificar, 60.",
  },
];

const SELLO = [
  { nivel: "Buena", rango: "≥ 80%", dot: "var(--ok-solid)" },
  { nivel: "Mejorable", rango: "50–79%", dot: "var(--warn-solid)" },
  { nivel: "Deficiente", rango: "< 50%", dot: "var(--bad-solid)" },
];

export default function MetodologiaPage() {
  return (
    // A ancho completo, como Inicio, Catálogo y Calidad. La prosa se acota por
    // bloque con `max-w-3xl`: antes toda la página vivía en un `max-w-4xl`
    // pegado a la izquierda, así que se veía más estrecha y descuadrada
    // respecto al resto del portal.
    <div className="space-y-12">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-strong">Metodología</h1>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-body">
          Este portal no se fía de lo que dice el catálogo: descarga cada archivo publicado e intenta
          abrirlo. Aquí está explicado todo el recorrido —de dónde salen los datos, qué se comprueba,
          cómo se convierte en una puntuación y qué queda fuera del alcance— y la API para consultarlo
          sin pasar por la interfaz.
        </p>

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

      {/* ── Fuentes ── */}
      <section id="fuentes" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Database className="h-5 w-5 text-faint" aria-hidden />
            De dónde salen los datos
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            Todo lo que se ve en el portal viene de dos sitios, y conviene no confundirlos porque
            tienen ritmos distintos.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-2">Fuente 1 · en vivo</p>
              <h3 className="text-base font-semibold text-strong">El catálogo DCAT</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                El registro oficial de{" "}
                <a
                  href="https://datosabiertos.jcyl.es"
                  target="_blank"
                  rel="noreferrer"
                  className="text-link underline-offset-2 hover:underline"
                >
                  datosabiertos.jcyl.es
                </a>{" "}
                en RDF/XML. Se lee cada hora, así que un dataset nuevo aparece en el portal el mismo
                día. De aquí salen los metadatos y las URLs de descarga.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-2">Fuente 2 · una foto</p>
              <h3 className="text-base font-semibold text-strong">El informe del análisis</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                El resultado de descargar y abrir los 1.655 archivos, que tarda horas y se ejecuta
                periódicamente. No es en vivo: es la foto del día que se ejecutó, y su fecha aparece
                en la portada. Lo publicado después figura como «sin analizar» hasta la siguiente
                ejecución.
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="max-w-3xl text-sm leading-relaxed text-faint">
          Por eso los totales no siempre cuadran al dígito: el catálogo puede tener 825 datasets y el
          análisis haber visto 824. No es un error de cuentas, es la diferencia entre las dos fuentes,
          y el portal la indica donde aparecen juntas.
        </p>
      </section>

      {/* ── Pipeline ── */}
      <section id="comprobacion" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <ScanSearch className="h-5 w-5 text-faint" aria-hidden />
            Cómo se comprueba cada archivo
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            Un catálogo puede tener fichas impecables y archivos que no abren. El diferencial de este
            portal es el paso 2: no se queda en los metadatos.
          </p>
        </div>

        <ol className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {PIPELINE.map((step, i) => (
            <li key={step.title}>
              <Card className="h-full">
                <CardContent className="flex h-full gap-4 p-5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                    <step.icon className="h-4 w-4 text-body" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="eyebrow mb-1">Paso {i + 1}</p>
                    <h3 className="text-sm font-semibold text-strong">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-body">{step.text}</p>
                    <p className="mt-2 font-mono text-[11px] text-faint">{step.detail}</p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>

        <Card tone="muted">
          <CardContent className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-strong">
              <Timer className="h-4 w-4 text-faint" aria-hidden />
              Una guardia contra los servidores que gotean
            </h3>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-body">
              El tiempo de espera de lectura se mide por trozo recibido, así que un servidor que
              devuelve unos pocos bytes cada pocos segundos nunca lo agota y podría bloquear el
              análisis indefinidamente. Si en 30 segundos no han llegado 300 KB, la descarga se
              aborta y se reintenta.
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
            «No se puede abrir» y «está sucio» son problemas de naturaleza distinta y se miden
            aparte. Mezclarlos engaña en las dos direcciones: por volumen, la inmensa mayoría de las
            incidencias del catálogo son celdas opcionales vacías, así que un CSV correcto con
            9.000 huecos salía peor que un archivo que no existe.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-2">Familia 1</p>
              <h3 className="text-sm font-semibold text-strong">No se puede usar</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                O la descarga falla, o el archivo llega y no se puede interpretar: un JSON que no
                parsea, un ZIP corrupto, un shapefile al que le faltan piezas. Es bloqueante: no hay
                dato que reutilizar.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-2">Familia 2</p>
              <h3 className="text-sm font-semibold text-strong">Abre, pero viene sucio</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                Encabezados vacíos o repetidos, tipos mezclados en una columna, filas de más o de
                menos. Se puede reutilizar, pero obliga a limpiar antes. Esto lo mide el eje de
                contenido, no el de disponibilidad.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-2">Familia 3</p>
              <h3 className="text-sm font-semibold text-strong">La ficha está incompleta</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                El archivo está perfecto pero el registro DCAT no permite encontrarlo, fecharlo o
                saber si se puede reutilizar. Es lo más barato de corregir y lo que más rinde.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-strong">Los seis resultados de una descarga</h3>
              <dl className="mt-3 space-y-2">
                {FETCH_STATES.map((s) => (
                  <div key={s.code} className="flex flex-wrap items-baseline gap-x-2">
                    <dt className={`font-mono text-xs font-semibold ${s.tone}`}>{s.code}</dt>
                    <dd className="min-w-0 flex-1 text-xs leading-relaxed text-body">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          {/* Esto es lo que separa una auditoría de un señalamiento. */}
          <Card tone="ok">
            <CardContent className="p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-strong">
                <Ban className="h-4 w-4 text-ok" aria-hidden />
                Lo que no se le imputa a quien publica
              </h3>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-body">
                <li>
                  <strong className="text-strong">Nuestras propias limitaciones.</strong> Si un
                  archivo supera el tope de descarga o si a este portal le falta una dependencia para
                  leer un formato, el recurso queda «no analizado». No es un fallo del dato.
                </li>
                <li>
                  <strong className="text-strong">Los fallos de la plataforma.</strong> Cuando la URL
                  devuelve una página web en vez del archivo, se cuenta aparte: suele ser un problema
                  del gestor de publicación, no del dataset, y no penaliza la puntuación.
                </li>
                <li>
                  <strong className="text-strong">Lo que no se puede verificar.</strong> Un dataset
                  sin fecha de actualización no está probado que esté obsoleto: está probado que no se
                  puede comprobar. Son dos cosas distintas y se presentan por separado.
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Cálculos ── */}
      <section id="calculos" className="scroll-mt-24 space-y-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <Gauge className="h-5 w-5 text-faint" aria-hidden />
            Cómo se calculan las puntuaciones
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-body">
            Hay tres puntuaciones y cada una responde a una pregunta distinta. La que aparece en cada
            ficha es la combinación de las tres.
          </p>
        </div>

        <Card className="border-ok-line bg-ok-surface">
          <CardContent className="p-5">
            <h3 className="text-base font-semibold text-strong">Calidad global</h3>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-card px-4 py-3 font-mono text-sm text-body">
{`calidad global = 40% · metadatos
               + 30% · disponibilidad
               + 30% · contenido`}
            </pre>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-body">
              <strong className="text-strong">Disponibilidad</strong> es el porcentaje de archivos del
              dataset que se descargan y abren; los que no se llegaron a comprobar quedan fuera del
              cálculo, no cuentan como fallo. Si no se evaluó ninguno, se muestra solo el índice de
              metadatos y se indica. Si se evaluaron y no quedó nada legible, el contenido cuenta como
              cero: no es un dato ausente, es el peor resultado posible.
            </p>
          </CardContent>
        </Card>

        {/* Contenido: la fórmula real, que penaliza TIPOS y no ocurrencias. */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-faint" aria-hidden />
              <h3 className="text-base font-semibold text-strong">Contenido, archivo por archivo</h3>
            </div>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-body">
              Cada archivo legible parte de 100 y baja según los <strong className="text-strong">tipos</strong>{" "}
              de problema encontrados, no según cuántas veces aparece cada uno:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-fill px-4 py-3 font-mono text-xs leading-relaxed text-body">
{`100
 − 15 por cada tipo de incidencia grave   (máximo −60)
 −  5 por cada tipo de incidencia leve
 − 10 si el total de ocurrencias graves pasa de 1.000
 → acotado entre 0 y 100`}
            </pre>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-faint">
              Penalizar tipos y no ocurrencias es deliberado: un CSV con 9.000 celdas vacías del mismo
              tipo tiene un problema, no nueve mil. Si contáramos ocurrencias, ese archivo se hundiría
              por debajo de uno que no existe. La puntuación del dataset es la media de las de sus
              archivos legibles; los formatos que no son tablas —geográficos, iCal, imágenes— tienen
              su propia escala, más simple.
            </p>
          </CardContent>
        </Card>

        {/* Metadatos: los cuatro factores. */}
        <div>
          <h3 className="text-base font-semibold text-strong">Metadatos, cuatro factores</h3>
          <p className="mt-1 max-w-3xl text-sm text-faint">
            Se calculan solo con lo que declara el registro DCAT, sin descargar nada. Suman el 100%.
          </p>
          <div className="mt-3 space-y-3">
            {META_FACTORS.map((f) => (
              <Card key={f.title}>
                <CardContent className="p-5">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <span className="text-sm font-semibold text-strong">{f.title}</span>
                    <Badge variant="success">{f.weight}%</Badge>
                  </div>
                  <Progress
                    value={f.weight}
                    indicatorClassName="bg-ok-solid"
                    className="mb-2"
                    label={`Peso de ${f.title.toLowerCase()} en el índice de metadatos`}
                  />
                  <p className="max-w-3xl text-sm leading-relaxed text-body">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* La actualidad y su trampa. */}
        <Card tone="warn">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-strong">
              La actualidad tiene una trampa, y conviene conocerla
            </h3>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-body">
              Para medir si un dataset va al día hace falta saber cuándo se actualizó por última vez, y
              eso se declara en <code className="font-mono text-xs">dct:modified</code>. Nueve de cada
              diez datasets del catálogo no lo publican, así que la única fecha disponible es la de
              publicación y el cálculo mide desde ahí: un dataset que se refresca cada día pero se
              publicó en 2011 sale con años de retraso aparente.
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

        {/* Umbrales. */}
        <div>
          <h3 className="text-base font-semibold text-strong">Umbrales</h3>
          <p className="mt-1 max-w-3xl text-sm text-faint">
            Los mismos en toda la interfaz, en la API y en el sello.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <div className="flex h-3" aria-hidden>
              <div className="bg-bad-solid" style={{ width: "50%" }} />
              <div className="bg-warn-solid" style={{ width: "30%" }} />
              <div className="bg-ok-solid" style={{ width: "20%" }} />
            </div>
            <div className="grid grid-cols-3 divide-x divide-border">
              <div className="p-3">
                <p className="text-sm font-semibold text-bad">&lt; 50%</p>
                <p className="text-xs text-faint">Deficiente</p>
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-warn">50–79%</p>
                <p className="text-xs text-faint">Mejorable</p>
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-ok">≥ 80%</p>
                <p className="text-xs text-faint">Buena</p>
              </div>
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
          {[
            {
              title: "Archivos grandes, a medias",
              text: "Por encima de 25 MB solo se analiza la parte descargada, y el recurso queda marcado como parcial. Las cifras de filas y columnas de esos archivos son del trozo leído, no del total. En la ficha de cada distribución el explorador descarga el archivo completo en tu navegador y recalcula, así que ahí sí se ven las cifras reales.",
            },
            {
              title: "Cinco ejemplos por problema",
              text: "El informe guarda hasta cinco muestras de cada tipo de incidencia, con su fila y columna, para no crecer sin control. Para recorrer todos los casos, el explorador de la ficha los recalcula sobre el archivo real.",
            },
            {
              title: "Validez formal, no veracidad",
              text: "El portal comprueba que el archivo abre y que su estructura es coherente. No puede decir si el dato es correcto: una población de 900.000 habitantes en un municipio pasa todas las comprobaciones.",
            },
            {
              title: "Un solo organismo declarado",
              text: "Todos los datasets del catálogo declaran el mismo publicador, así que no se puede comparar el desempeño entre consejerías ni repartir el trabajo por organismo. Por eso las prioridades se agrupan por formato y por temática.",
            },
          ].map((l) => (
            <Card key={l.title}>
              <CardContent className="p-5">
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
            Cualquiera puede incrustar la calidad de un dataset —o la del catálogo— como una imagen
            que se actualiza sola. El sello escribe siempre el nivel junto al porcentaje: el color no
            puede ser lo único que informe, y menos en una imagen pegada en otra web.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {SELLO.map((s) => (
                <div key={s.nivel} className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full ring-1 ring-inset ring-black/10"
                    style={{ background: s.dot }}
                    aria-hidden
                  />
                  <span className="text-sm font-semibold text-strong">{s.nivel}</span>
                  <span className="text-xs text-faint">{s.rango}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-fill p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG de una ruta propia, sin optimización que aplicar */}
              <img
                src="/api/sello"
                alt="Sello con la calidad global del catálogo de datos abiertos de Castilla y León"
                width={174}
                height={28}
              />
              <span className="text-xs text-faint">calidad global del catálogo completo</span>
            </div>

            <EmbedBlock url="/api/sello?dataset=IDENTIFICADOR" label="Código para incrustarlo" />

            <p className="text-xs leading-relaxed text-faint">
              Sustituye <code className="font-mono text-body">IDENTIFICADOR</code> por el número que
              aparece al final de la URL de la ficha del dataset (por ejemplo{" "}
              <code className="font-mono text-body">1285663381041</code>). Cada ficha trae el suyo ya
              montado.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── Nota ── */}
      <Card tone="muted">
        <CardContent className="flex items-start gap-3 p-4">
          <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
          <p className="max-w-3xl text-xs leading-relaxed text-faint">
            Los pesos y los umbrales son criterios de evaluación de esta plataforma, no un estándar
            oficial, y pueden revisarse a medida que evoluciona el catálogo. Cuando se toquen, se dirá
            aquí. La fuente de los metadatos es el catálogo RDF/DCAT de{" "}
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
      </div>
    </div>
  );
}
