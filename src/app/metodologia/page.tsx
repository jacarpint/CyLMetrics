import Link from "next/link";
import {
  BarChart3, FileSearch, ArrowRight, ScrollText, ShieldCheck, WifiOff, FileWarning, SearchCode, Layers, Code2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export const revalidate = 3600;

export const metadata = {
  title: "Metodología | JCyL Data Quality Portal",
  description:
    "Cómo se calcula el índice de calidad de los datasets del catálogo de datos abiertos de Castilla y León.",
};

/** Endpoints públicos del portal. Existían pero no se mencionaban en ninguna página. */
const API_ENDPOINTS = [
  {
    path: "/api/quality",
    returns: "Totales del informe, disponibilidad y reparto de puntuaciones.",
    params: "?dataset= · ?publisher=",
  },
  {
    path: "/api/catalog",
    returns: "Catálogo DCAT normalizado y paginado: datasets, formatos, licencias y distribuciones.",
    // Acepta exactamente los mismos filtros que la URL del catálogo.
    params: "?q= · ?categorias= · ?formatos= · ?licencias= · ?desde= · ?hasta= · ?page= · ?limit= · ?sort=",
  },
  {
    path: "/api/alerts",
    returns: "Datasets con incidencias accionables, priorizados por impacto.",
    params: "?level=critical|warning · ?category=availability|format|content · ?limit=",
  },
] as const;

const META_FACTORS = [
  { title: "Completitud de metadatos", weight: 40, desc: "Presencia de título, descripción, licencia, organización, fecha de publicación, idioma, ámbito espacial, temas y palabras clave." },
  { title: "Apertura de formato", weight: 25, desc: "CSV y JSON obtienen puntuación máxima. Se bonifica la diversidad y el uso de estándares abiertos frente a formatos propietarios." },
  { title: "Actualidad", weight: 25, desc: "Frecuencia real de actualización comparada con la periodicidad declarada. Los datos desactualizados puntúan menos." },
  { title: "Apertura de licencia", weight: 10, desc: "CC-BY-4.0 obtiene la máxima. IGCYL-NC (uso no comercial) puntúa menos por sus restricciones de reutilización." },
];

const CONTENT_DIMENSIONS = [
  { icon: WifiOff, color: "text-bad", bg: "bg-bad-surface", title: "Disponibilidad", desc: "¿El recurso se descarga? URLs caídas, timeouts, errores 404 o servicios que no responden." },
  { icon: FileWarning, color: "text-warn", bg: "bg-warn-surface", title: "Formato", desc: "¿El archivo es válido? JSON/XML bien formados, ZIP de Shapefile íntegros, codificación correcta." },
  { icon: SearchCode, color: "text-info", bg: "bg-info-surface", title: "Contenido", desc: "¿Los datos son consistentes? Celdas vacías, tipos mezclados, encabezados ausentes o duplicados." },
];

// Los tres puntos son decorativos: imitan el metal del sello y por eso llevan
// color fijo. El nivel siempre va escrito al lado, así que el color no es el
// único portador de la información.
const SELLO = [
  { nivel: "Oro", rango: "≥ 85%", dot: "#c8951a" },
  { nivel: "Plata", rango: "70–84%", dot: "#9aa4b2" },
  { nivel: "Bronce", rango: "50–69%", dot: "#a4673a" },
];

export default function MetodologiaPage() {
  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-strong tracking-tight">Metodología de evaluación</h1>
        <p className="text-sm text-faint mt-1">
          Cómo asignamos el índice de calidad a cada dataset del catálogo de datos abiertos de Castilla y León.
        </p>
      </div>

      {/* Dos scores + fórmula */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-strong tracking-tight">Dos miradas a la calidad</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-5 w-5 text-ok" />
                <h3 className="text-base font-semibold text-strong">Calidad de metadatos</h3>
              </div>
              <p className="text-sm text-body leading-relaxed">
                Índice (0–100) calculado a partir de los metadatos DCAT del catálogo: completitud, formatos,
                actualidad y licencia. Se compone de cuatro factores ponderados (abajo).
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <FileSearch className="h-5 w-5 text-ok" />
                <h3 className="text-base font-semibold text-strong">Análisis de contenido</h3>
              </div>
              <p className="text-sm text-body leading-relaxed">
                Un motor descarga y valida el archivo real de cada distribución (estructura, codificación,
                tipos, celdas vacías e integridad) y le asigna otro índice (0–100) según las incidencias.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-ok-line bg-ok-surface">
          <CardContent className="p-5">
            <p className="text-sm text-body leading-relaxed">
              El <strong className="text-strong">score compuesto</strong> que ves en cada ficha combina ambas
              miradas a partes iguales cuando existen las dos. Si solo hay una, se usa esa.
            </p>
            <div className="mt-3 rounded-lg bg-card border border-border px-4 py-3 text-sm text-body font-mono">
              score compuesto = 50% · calidad_metadatos + 50% · análisis_contenido
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Factores del índice de metadatos */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-strong tracking-tight">Factores del índice de metadatos</h2>
          <p className="text-sm text-faint mt-0.5">Cuatro factores ponderados que suman el 100%.</p>
        </div>
        <div className="space-y-3">
          {META_FACTORS.map((f) => (
            <Card key={f.title}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <span className="text-sm font-semibold text-strong">{f.title}</span>
                  <Badge variant="success">{f.weight}%</Badge>
                </div>
                <Progress value={f.weight * 2.5} indicatorClassName="bg-ok-solid" className="mb-2" />
                <p className="text-xs text-faint leading-relaxed">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Dimensiones del análisis de contenido */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-strong tracking-tight">Dimensiones del análisis de contenido</h2>
          <p className="text-sm text-faint mt-0.5">Cada incidencia detectada al auditar un archivo se clasifica en una de estas tres.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {CONTENT_DIMENSIONS.map((d) => (
            <Card key={d.title}>
              <CardContent className="p-5">
                <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${d.bg} mb-3`}>
                  <d.icon className={`h-4.5 w-4.5 ${d.color}`} />
                </div>
                <h3 className="text-sm font-semibold text-strong">{d.title}</h3>
                <p className="text-xs text-faint leading-relaxed mt-1">{d.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Umbrales de salud */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-strong tracking-tight">Umbrales de salud</h2>
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex h-3">
            <div className="bg-bad-solid" style={{ width: "50%" }} />
            <div className="bg-warn-solid" style={{ width: "30%" }} />
            <div className="bg-ok-solid" style={{ width: "20%" }} />
          </div>
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="p-3">
              <p className="text-sm font-semibold text-bad">&lt; 50%</p>
              <p className="text-xs text-faint">Crítico</p>
            </div>
            <div className="p-3">
              <p className="text-sm font-semibold text-warn">50–79%</p>
              <p className="text-xs text-faint">Con advertencias</p>
            </div>
            <div className="p-3">
              <p className="text-sm font-semibold text-ok">≥ 80%</p>
              <p className="text-xs text-faint">Saludable</p>
            </div>
          </div>
        </div>
      </section>

      {/* Sello de calidad */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-strong tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-ok" /> Sello de calidad
        </h2>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-body leading-relaxed max-w-2xl">
              Los datasets que superan el umbral reciben un sello que refleja su nivel de excelencia en
              metadatos, apertura de formato y actualidad.
            </p>
            <div className="flex flex-wrap gap-x-8 gap-y-3 mt-4">
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
          </CardContent>
        </Card>
      </section>

      {/* Cómo leer una ficha */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-strong tracking-tight flex items-center gap-2">
          <Layers className="h-5 w-5 text-faint" /> Cómo leer una ficha
        </h2>
        <Card>
          <CardContent className="p-5 space-y-2 text-sm text-body leading-relaxed">
            <p><strong className="text-strong">Círculo de calidad:</strong> el score compuesto del dataset (0–100), con color por umbral.</p>
            <p><strong className="text-strong">Análisis:</strong> resultado de auditar el contenido de los archivos descargados.</p>
            <p><strong className="text-strong">Distribuciones:</strong> cada archivo o servicio del dataset. Al abrir uno verás su vista previa —tabla para datos tabulares, árbol para JSON, o mapa para recursos geoespaciales— junto a sus incidencias y esquema.</p>
            <Link href="/catalogo" className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:text-link-hover hover:underline pt-1">
              Explorar el catálogo <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* Los resultados, como datos abiertos */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
          <Code2 className="h-5 w-5 text-faint" aria-hidden /> Los resultados, como datos abiertos
        </h2>
        <Card>
          <CardContent className="space-y-4 p-5">
            <p className="max-w-2xl text-sm leading-relaxed text-body">
              Un observatorio de datos abiertos debería publicar también los suyos. Todo lo que se ve
              en el portal está disponible en JSON sin autenticación, y la lista de archivos con
              problemas se puede descargar en CSV desde{" "}
              <Link href="/catalogo?vista=ficheros" className="font-medium text-link underline-offset-2 hover:underline">
                la vista de ficheros del catálogo
              </Link>
              , respetando los filtros que tengas aplicados.
            </p>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-fill text-left">
                    <th scope="col" className="px-3 py-2 font-semibold text-faint">Endpoint</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-faint">Devuelve</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-faint">Parámetros</th>
                  </tr>
                </thead>
                <tbody>
                  {API_ENDPOINTS.map((e) => (
                    <tr key={e.path} className="border-b border-border last:border-0 align-top">
                      <td className="whitespace-nowrap px-3 py-2">
                        <a
                          href={e.path}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-link underline-offset-2 hover:underline"
                        >
                          {e.path}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-body">{e.returns}</td>
                      <td className="px-3 py-2 font-mono text-faint">{e.params}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs leading-relaxed text-faint">
              Las respuestas se cachean 5 minutos. El informe completo del análisis, con el detalle
              por distribución, vive en <code className="font-mono text-body">reports/data-analysis.json</code>{" "}
              dentro del repositorio del proyecto.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Nota */}
      <Card className="border-border bg-fill">
        <CardContent className="p-4 flex items-start gap-3">
          <ScrollText className="h-4 w-4 text-faint mt-0.5 shrink-0" />
          <p className="text-xs text-faint leading-relaxed">
            Los pesos y umbrales son criterios de evaluación de esta plataforma y pueden revisarse a medida que
            evoluciona el catálogo. La fuente de los metadatos es el catálogo RDF/DCAT de{" "}
            <a href="https://datosabiertos.jcyl.es" target="_blank" rel="noreferrer" className="text-link hover:underline">
              datosabiertos.jcyl.es
            </a>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
