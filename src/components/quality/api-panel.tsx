import Link from "next/link";
import { Code2, ExternalLink } from "lucide-react";
import EmbedBlock from "@/components/ui/embed-block";

/**
 * La API de lo que se está mirando, al pie de la ficha.
 *
 * Un portal que audita la reutilización debería ser reutilizable justo donde se
 * ve el dato, no solo en una página de documentación aparte. Va en las dos
 * fichas —conjunto y archivo— con la dirección que corresponde a cada nivel.
 *
 * Plegado y en letra pequeña a propósito: interesa a una minoría y competía con
 * el explorador y las incidencias, que son el motivo por el que casi todo el
 * mundo entra. Quien la busca la encuentra; quien no, no la tropieza.
 */
export interface ApiEndpoint {
  /** Rótulo de qué devuelve, en lenguaje llano. */
  label: string;
  /** Ruta relativa, que es como se lee mejor. */
  url: string;
  /** Advertencia opcional (por ejemplo, que ahora mismo responde 404). */
  note?: string;
}

export function ApiPanel({
  endpoints,
  /** Sello incrustable. Solo existe a nivel de conjunto de datos. */
  sealUrl,
}: {
  endpoints: ApiEndpoint[];
  sealUrl?: string;
}) {
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-xs font-medium text-faint transition-colors hover:text-body">
        <Code2 className="h-3.5 w-3.5" aria-hidden />
        Estos datos, por API
        <span className="font-normal text-faint">· sin registro ni clave</span>
      </summary>

      <div className="space-y-4 border-t border-border px-4 py-3.5">
        <dl className="space-y-2.5">
          {endpoints.map((endpoint) => (
            <div key={endpoint.url}>
              <dt className="text-[11px] font-medium text-faint">{endpoint.label}</dt>
              <dd>
                <a
                  href={endpoint.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 break-all font-mono text-xs text-link underline-offset-2 hover:underline"
                >
                  {endpoint.url}
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                </a>
                {endpoint.note && (
                  <p className="mt-1 text-[11px] leading-relaxed text-faint">{endpoint.note}</p>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {sealUrl && (
          <div className="space-y-2 border-t border-border pt-3.5">
            <div className="flex flex-wrap items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG de una ruta propia, sin optimización que aplicar */}
              <img
                src={sealUrl}
                alt="Sello con la calidad global de este conjunto de datos"
                width={174}
                height={28}
              />
            </div>
            <EmbedBlock url={sealUrl} label="Código para incrustarlo" />
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-faint">
          La{" "}
          <Link href="/metodologia#api" className="text-link underline-offset-2 hover:underline">
            referencia completa
          </Link>{" "}
          está en la metodología.
        </p>
      </div>
    </details>
  );
}
