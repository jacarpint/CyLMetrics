import Link from "next/link";
import { Code2, ExternalLink } from "lucide-react";
import EmbedBlock from "@/components/ui/embed-block";

/**
 * Los datos de este dataset, por API.
 *
 * Un portal que audita la reutilización debería ser reutilizable justo donde se
 * está mirando el dato, no solo en una página de documentación que hay que ir a
 * buscar. Aquí van los dos endpoints que tienen sentido a nivel de dataset y el
 * sello ya montado con su identificador.
 *
 * No se ofrece nada a nivel de distribución porque la API no tiene esa
 * granularidad: inventar una URL que no existe sería peor que no ofrecer nada.
 */
export function DatasetApi({ slug, analyzed }: { slug: string; analyzed: boolean }) {
  const qualityUrl = `/api/quality?dataset=${slug}`;
  const selloUrl = `/api/sello?dataset=${slug}`;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
        <Code2 className="h-4 w-4 text-faint" aria-hidden />
        Estos datos, por API
      </h2>
      <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-faint">
        Sin registro ni clave. La{" "}
        <Link href="/metodologia#api" className="text-link underline-offset-2 hover:underline">
          referencia completa
        </Link>{" "}
        está en la metodología.
      </p>

      <dl className="mt-4 space-y-3">
        <div>
          <dt className="eyebrow mb-1">Resultado del análisis</dt>
          <dd>
            <a
              href={qualityUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 break-all font-mono text-xs text-link underline-offset-2 hover:underline"
            >
              {qualityUrl}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
            {!analyzed && (
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                Este dataset todavía no está en el informe, así que ahora mismo responde 404. Volverá
                a estar disponible tras la siguiente ejecución del análisis.
              </p>
            )}
          </dd>
        </div>

        <div>
          <dt className="eyebrow mb-1">Sello de calidad</dt>
          <dd className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG de una ruta propia, sin optimización que aplicar */}
              <img
                src={selloUrl}
                alt="Sello con la calidad global de este dataset"
                width={174}
                height={28}
              />
            </div>
            <EmbedBlock url={selloUrl} label="Código para incrustarlo" />
          </dd>
        </div>
      </dl>
    </section>
  );
}
