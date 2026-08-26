import Link from "next/link";
import { ArrowRight, Code2, ShieldCheck, Terminal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import EmbedBlock from "@/components/ui/embed-block";
import { ApiReference } from "@/components/pages/api/ApiReference";

export const revalidate = 3600;

export const metadata = {
  title: "API",
  description:
    "Todos los resultados del análisis de calidad del catálogo de datos abiertos de Castilla y León en JSON, sin registro ni clave: informe, catálogo filtrable, alertas, posiciones de cada incidencia y sello incrustable.",
};

/**
 * Los ocho resultados posibles de una descarga. Salen de `fetch.status`.
 *
 * Vivían en el «detalle técnico» de Metodología, que era el sitio equivocado:
 * no son trivia de operación, son los valores que puede tomar un campo que la
 * API devuelve. Documentar `fetch.status` sin enumerarlos deja a quien consume
 * la API adivinando.
 *
 * Eran seis, y los dos que faltaban —`no_url` y `error`— no eran un detalle: al
 * no estar documentados aquí tampoco se les puso etiqueta en la interfaz, y
 * salían en la tabla de archivos con su nombre en inglés. La lista completa vive
 * en `FETCH_STATUSES` (`src/analysis/downloader.py`) y hay un test que comprueba
 * que los ocho tienen traducción.
 */
const FETCH_STATES = [
  { code: "downloaded", label: "El archivo llegó completo.", tone: "text-ok" },
  { code: "truncated", label: "Llegó hasta el tope de descarga. Se analiza lo que hay y queda marcado como parcial.", tone: "text-body" },
  { code: "http_error", label: "El servidor respondió con un error.", tone: "text-bad" },
  { code: "unreachable", label: "No se pudo contactar con el servidor.", tone: "text-bad" },
  { code: "service", label: "Es un WMS o un WFS: no hay archivo que descargar, se comprueba preguntándole por sus capas.", tone: "text-body" },
  { code: "too_large", label: "Declara más del tope, así que no se intentó. No se sabe si abre.", tone: "text-faint" },
  { code: "no_url", label: "El catálogo describe el recurso pero no publica ninguna URL de acceso.", tone: "text-faint" },
  { code: "error", label: "El análisis de este portal se interrumpió. Es un problema nuestro, no del archivo.", tone: "text-faint" },
];

/**
 * La API, en su propia página.
 *
 * Estaba dentro de Metodología, que ya cargaba con el método, el sello y un
 * acordeón de detalle técnico. Son dos públicos distintos —quien quiere juzgar
 * si fiarse del portal y quien va a construir encima— y cada uno merece su
 * página.
 */
export default function ApiPage() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-strong">
          <Code2 className="h-6 w-6 text-faint" aria-hidden />
          API
        </h1>
        <p className="mt-2 max-w-4xl text-base leading-relaxed text-body">
          Un observatorio de datos abiertos debería publicar también los suyos. Todo lo que se ve en
          el portal está disponible en JSON, sin registro ni clave y sin límite de peticiones.
          Además, las listas de trabajo de{" "}
          <Link href="/calidad" className="font-medium text-link underline-offset-2 hover:underline">
            Calidad
          </Link>{" "}
          se descargan en CSV respetando los filtros que tengas puestos.
        </p>
      </header>

      <section aria-labelledby="referencia" className="space-y-4">
        <h2 id="referencia" className="sr-only">
          Referencia de los endpoints
        </h2>
        <ApiReference />
      </section>

      {/* ── Los ocho resultados de una descarga ──────────────────────────────
          Va después de la referencia porque es el vocabulario de un campo que
          varios endpoints devuelven, no un endpoint más. */}
      <section aria-labelledby="fetch-status" className="space-y-3">
        <div>
          <h2
            id="fetch-status"
            className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong"
          >
            <Terminal className="h-5 w-5 text-faint" aria-hidden />
            Los ocho valores de <code className="font-mono text-base">fetch.status</code>
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-faint">
            Cada distribución del informe trae este campo con el resultado de intentar descargarla.
            Estos son todos los valores que puede tomar.
          </p>
        </div>
        <Card>
          <CardContent>
            <dl className="space-y-2">
              {FETCH_STATES.map((s) => (
                <div key={s.code} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className={`font-mono text-xs font-semibold ${s.tone}`}>{s.code}</dt>
                  <dd className="min-w-0 flex-1 text-xs leading-relaxed text-body">{s.label}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </section>

      {/* ── Sello ────────────────────────────────────────────────────────────
          Estaba como sección propia en Metodología además de como endpoint en
          la referencia, así que se documentaba dos veces. Aquí queda junto al
          endpoint que lo sirve. */}
      <section aria-labelledby="sello" className="space-y-4">
        <div>
          <h2
            id="sello"
            className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong"
          >
            <ShieldCheck className="h-5 w-5 text-faint" aria-hidden />
            Sello de calidad
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-body">
            Cualquiera puede incrustar la calidad de un conjunto de datos —o la del catálogo
            entero— como una imagen, que refleja siempre el último análisis publicado sin tener que
            volver a pegarla. El sello escribe siempre el nivel junto al porcentaje, con los{" "}
            <Link
              href="/metodologia#calculos"
              className="font-medium text-link underline-offset-2 hover:underline"
            >
              umbrales de la metodología
            </Link>
            : el color no puede ser lo único que informe, y menos en una imagen pegada en otra web.
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

      <div className="flex flex-wrap gap-4 border-t border-border pt-6">
        <Link
          href="/metodologia"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Cómo se calcula lo que devuelve la API <ArrowRight className="h-4 w-4" aria-hidden />
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
