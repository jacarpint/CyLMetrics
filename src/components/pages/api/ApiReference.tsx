import { ExternalLink, Lock, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ApiParam {
  name: string;
  values?: string;
  desc: string;
}

interface ApiEndpoint {
  path: string;
  summary: string;
  /** Qué devuelve, en prosa. */
  returns: string;
  params: ApiParam[];
  /** Ejemplo de respuesta recortado, con las claves reales. */
  example: string;
  /** Enlace de prueba, relativo al portal. */
  tryIt: string;
  cache: string;
  errors?: string;
  contentType?: string;
}

/**
 * Referencia de la API.
 *
 * Antes la página listaba tres endpoints en una tabla de tres columnas, sin la
 * forma de la respuesta, sin ejemplos, sin códigos de error y sin mencionar el
 * sello. Quien quisiera consumirla tenía que probar a ciegas.
 *
 * Los ejemplos están recortados pero las claves son las que devuelve el código;
 * si se renombra un campo, hay que tocarlas aquí.
 *
 * COBERTURA. Aquí están los cinco endpoints de datos. Las otras dos rutas de
 * `src/app/api` quedan fuera a propósito, y no por olvido: `/api/proxy` y
 * `/api/ogc` son fontanería del navegador —esquivar el CORS al previsualizar un
 * archivo y leer las capas de un servicio de mapas—, están acotadas a
 * `*.jcyl.es` y no devuelven nada sobre la calidad del catálogo. Publicarlas
 * como API sería anunciar un proxy. Si algún día se añade una ruta de datos,
 * tiene que aparecer en esta lista.
 */
const ENDPOINTS: ApiEndpoint[] = [
  {
    path: "/api/quality",
    summary: "Resultado del análisis de los archivos",
    returns:
      "Totales del último análisis completo, disponibilidad de los archivos y reparto de los datasets por calidad de contenido. Con «dataset» devuelve la ficha de uno solo; añadiendo «distribucion», el resultado de un único archivo; con «publisher», la media de un organismo.",
    params: [
      { name: "dataset", values: "URI completa o identificador corto", desc: "Devuelve solo ese dataset. Acepta «https://…/1285663381041» o «1285663381041»." },
      {
        name: "distribucion",
        values: "csv, json, csv-2…",
        desc: "Junto a «dataset», devuelve el análisis de ese archivo: estado de entrega, descarga e incidencias. Es el mismo identificador que lleva la URL de su ficha, así que se deduce de la dirección del navegador. Si no existe, el 404 enumera los disponibles.",
      },
      { name: "publisher", values: "texto", desc: "Coincidencia parcial sobre la URI del organismo publicador." },
    ],
    // Respuesta real del informe del 13 de agosto de 2026, no cifras inventadas:
    // el ejemplo sirve para ver la FORMA de la respuesta, y las cifras concretas
    // cambian con cada análisis. `no_reader` es el desglose de `not_analyzed`:
    // cuántos archivos llegaron completos y no se analizaron porque este portal no
    // tiene lector para su formato. En este informe son los 366 de una ejecución
    // sin openpyxl ni pyshp instalados.
    example: `{
  "generated_at": "2026-08-13T20:47:16+00:00",
  "totals": {
    "distributions": 1658, "ok": 632, "error": 531,
    "skipped": 495, "downloaded": 1461,
    "avg_score": 56.6, "bytes": 23512470859
  },
  "dataset_count": 825,
  "availability": {
    "distributions": 1658, "ok": 926, "broken": 237,
    "not_a_file": 129, "not_analyzed": 366, "no_reader": 366,
    "broken_pct": 14, "affected_datasets": 271
  },
  "content_score_distribution": {
    "good": 386, "fair": 0, "poor": 0, "unscored": 439,
    "thresholds": { "good": ">= 80", "fair": "50-79",
                    "poor": "< 50", "unscored": "sin archivo legible" }
  }
}`,
    tryIt: "/api/quality",
    cache: "5 minutos",
    errors:
      "503 si todavía no se ha generado ningún informe · 404 si el dataset pedido no está en el informe, o si la distribución no existe (con la lista de las que sí)",
  },
  {
    path: "/api/catalog",
    summary: "Catálogo DCAT normalizado, con los tres ejes de calidad",
    returns:
      "El catálogo paginado con los mismos filtros que la interfaz. Cada dataset trae los tres ejes por separado y el compuesto, además del estado de su análisis y sus distribuciones.",
    params: [
      { name: "q", values: "texto", desc: "Busca en título, descripción, organismo y palabras clave." },
      { name: "categorias", values: "lista separada por comas", desc: "Temáticas, tal como aparecen en la interfaz." },
      { name: "formatos", values: "lista separada por comas", desc: "CSV, JSON, SHP, WMS…" },
      { name: "licencias", values: "lista separada por comas", desc: "CC-BY-4.0, IGCYL-NC, Otro." },
      { name: "desde · hasta", values: "YYYY-MM-DD", desc: "Rango de fecha de publicación (dct:issued)." },
      { name: "analisis", values: "ok · parcial · error · sin-datos", desc: "Estado del análisis de los archivos del dataset." },
      { name: "geo", values: "1", desc: "Solo datasets con alguna distribución geoespacial." },
      { name: "page · limit", values: "entero · 1-200", desc: "Paginación. El tope real viene en «max_limit»." },
      { name: "sort", values: "date-desc · date-asc · quality-desc · quality-asc · title-asc", desc: "Un valor desconocido cae al orden por defecto (date-desc)." },
    ],
    example: `{
  "total": 825, "page": 1, "limit": 24,
  "max_limit": 200, "totalPages": 35,
  "catalog_source": {
    "url": "https://datosabiertos.jcyl.es/…/1284166186527.rdf",
    "fetched_at": "2026-08-12T13:47:37.714Z",
    "origin": "remote"
  },
  "analysis_generated_at": "2026-08-10T13:18:40+00:00",
  "datasets": [
    {
      "id": "https://datosabiertos.jcyl.es/…/1285663381041",
      "slug": "1285663381041",
      "title": "Calificación semanal de las zonas de baño",
      "license": "CC-BY-4.0",
      "category": "Salud",
      "formats": ["CSV", "JSON", "XLSX"],
      "scores": { "metadata": 93, "availability": 100,
                  "content": 100, "overall": 97 },
      "analysis_status": "ok",
      "distributions": [{ "format": "CSV", "url": "https://…csv" }]
    }
  ]
}`,
    tryIt: "/api/catalog?limit=2",
    cache: "5 minutos",
  },
  {
    path: "/api/alerts",
    summary: "Datasets con problemas accionables",
    returns:
      "Los datasets con incidencias que merecen corrección, de peor a mejor calidad global. Las causas vienen con su código estable, su etiqueta y a cuántas ocurrencias afectan.",
    params: [
      { name: "level", values: "critical · warning", desc: "Crítico si algún recurso queda inutilizable; advertencia si el problema es de contenido." },
      { name: "category", values: "availability · format · content", desc: "Familia de la incidencia." },
      { name: "limit", values: "1-500", desc: "Número máximo de alertas. Por defecto 100." },
    ],
    example: `{
  "total": 555, "critical": 285, "warning": 270,
  "categories": { "availability": 227, "format": 61, "content": 301 },
  "alerts": [
    {
      "dataset_id": "https://datosabiertos.jcyl.es/…/1284207326052",
      "title": "Fotografía aérea ortorrectificada",
      "score": 21, "level": "critical",
      "failed": 1, "distributions": 1,
      "causes": [
        { "code": "descarga", "label": "Error de descarga",
          "category": "Disponibilidad", "count": 1 }
      ]
    }
  ]
}`,
    tryIt: "/api/alerts?limit=2",
    cache: "5 minutos",
    errors: "503 si todavía no se ha generado ningún informe",
  },
  {
    // Faltaba en la referencia y es un endpoint de datos como los demás: lo usa
    // el explorador de cada ficha para recorrer los casos de una incidencia sin
    // bajarse las posiciones enteras, que pueden ser cientos de miles.
    path: "/api/quality/issues",
    summary: "Dónde está cada caso de una incidencia, por páginas",
    returns:
      "Sin «code», el resumen de las incidencias de ese archivo con cuántas posiciones hay guardadas de cada una. Con «code», el tramo pedido de posiciones —fila y columna— de esa incidencia concreta. El fragmento se lee en el servidor y solo viaja el tramo pedido.",
    params: [
      { name: "dist", values: "identificador del recurso", desc: "Obligatorio. Es el campo «id» que trae cada distribución en /api/quality." },
      { name: "code", values: "código de incidencia", desc: "Si se omite, devuelve el resumen por código en lugar de las posiciones." },
      { name: "offset", values: "entero ≥ 0", desc: "Desde qué posición empezar. Por defecto 0." },
      { name: "limit", values: "1-500", desc: "Cuántas posiciones devolver. Por defecto 50, tope 500." },
    ],
    example: `{
  "code": "celda-faltante", "severity": "warning",
  "count": 135,    // ocurrencias detectadas
  "total": 135,    // posiciones guardadas (menor si se recortaron)
  "offset": 0,
  "positions": [
    { "row": 2676, "col": 6, "sheet": "Hoja1", "field": "DIRECCIÓN" }
  ]
}`,
    tryIt: "/api/quality/issues?dist=00570b5122d0e97d",
    // Un informe publicado ya no cambia, así que el fragmento es inmutable.
    cache: "1 hora en el navegador, 1 día en el CDN (inmutable)",
    errors:
      "400 si falta «dist» · 404 si no hay detalle para ese recurso, o si el recurso no tiene esa incidencia",
  },
  {
    path: "/api/sello",
    summary: "Imagen con la calidad, para incrustar",
    returns:
      "Un SVG con la calidad global y su nivel escrito. Sin el parámetro «dataset» devuelve la media del catálogo completo. Es la única ruta con CORS abierto, porque está pensada para incrustarse en otras webs.",
    params: [
      { name: "dataset", values: "URI completa o identificador corto", desc: "El sello de ese dataset. Si se omite, el del catálogo." },
    ],
    example: `<svg role="img" aria-label="Calidad 97% · Buena" …>
  <title>Calidad 97% · Buena</title>
  …
</svg>`,
    tryIt: "/api/sello",
    cache: "1 hora",
    contentType: "image/svg+xml",
  },
];

export function ApiReference() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-border bg-fill px-4 py-3 text-xs text-body">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-faint" aria-hidden />
          Sin autenticación ni clave de API
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5 text-faint" aria-hidden />
          Respuestas cacheadas, ver cada endpoint
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ExternalLink className="h-3.5 w-3.5 text-faint" aria-hidden />
          Solo lectura, únicamente <code className="font-mono">GET</code>
        </span>
      </div>

      {ENDPOINTS.map((ep) => (
        <Card key={ep.path}>
          <CardContent>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h3 className="flex flex-wrap items-baseline gap-2 font-mono text-sm font-semibold text-strong">
                <Badge variant="default" className="font-mono text-[11px]">GET</Badge>
                {ep.path}
              </h3>
              <a
                href={ep.tryIt}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-link underline-offset-2 hover:underline"
              >
                Probarlo <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>

            <p className="mt-1.5 text-sm font-medium text-body">{ep.summary}</p>
            <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-faint">{ep.returns}</p>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="min-w-0">
                <p className="eyebrow mb-2">Parámetros</p>
                {ep.params.length === 0 ? (
                  <p className="text-xs text-faint">Ninguno.</p>
                ) : (
                  <dl className="space-y-2.5">
                    {ep.params.map((p) => (
                      <div key={p.name}>
                        <dt className="flex flex-wrap items-baseline gap-x-2">
                          <code className="font-mono text-xs font-semibold text-strong">{p.name}</code>
                          {p.values && <span className="text-[11px] text-faint">{p.values}</span>}
                        </dt>
                        <dd className="mt-0.5 text-xs leading-relaxed text-body">{p.desc}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <dl className="mt-4 space-y-1 text-[11px] text-faint">
                  <div className="flex gap-1.5">
                    <dt className="font-medium">Caché:</dt>
                    <dd>{ep.cache}</dd>
                  </div>
                  {ep.contentType && (
                    <div className="flex gap-1.5">
                      <dt className="font-medium">Tipo:</dt>
                      <dd className="font-mono">{ep.contentType}</dd>
                    </div>
                  )}
                  {ep.errors && (
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 font-medium">Errores:</dt>
                      <dd>{ep.errors}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="min-w-0">
                <p className="eyebrow mb-2">Respuesta</p>
                <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-fill p-3 font-mono text-[11px] leading-relaxed text-body">
                  {ep.example}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
