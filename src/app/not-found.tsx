import Link from "next/link";
import { ArrowRight, Compass, Database, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildQualityUrl } from "@/lib/quality-filters";

export const metadata = {
  title: "Página no encontrada",
};

/**
 * 404 del portal.
 *
 * Sin este fichero, cualquier URL desconocida —`/catalogo/loquesea`, un enlace
 * antiguo a un dataset retirado— caía en la pantalla por defecto de Next: en
 * inglés, sin la cabecera del portal y sin ninguna salida.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-fill">
        <Compass className="h-7 w-7 text-faint" aria-hidden />
      </div>
      <p className="eyebrow">Error 404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-strong">
        Esta página no existe
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-body">
        La dirección no corresponde a ninguna página del portal. Si venías de un enlace a un
        dataset, puede que se haya retirado del catálogo o que su identificador haya cambiado.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/catalogo">
            <Search className="h-4 w-4" aria-hidden />
            Buscar en el catálogo
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">Volver al inicio</Link>
        </Button>
      </div>

      <div className="mt-10 border-t border-border pt-6 text-left">
        <h2 className="text-sm font-semibold text-strong">Puede que buscaras esto</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {[
            { href: "/catalogo", label: "Catálogo de datos", note: "explorar y filtrar los conjuntos de datos publicados" },
            // Con `familia=entrega`, que es lo que promete la nota: sin el filtro
            // la tabla abre en «Todos» y también enseña los que abren con errores
            // de contenido, que sí se pueden abrir.
            // El rótulo es el de la pestaña a la que lleva: «Qué arreglar» se
            // confundía ahora con «Qué arreglar primero», que es otra vista.
            { href: buildQualityUrl({ vista: "ficheros", familia: "entrega" }), label: "Archivo por archivo", note: "los archivos que no se pueden abrir" },
            { href: "/metodologia", label: "Metodología", note: "cómo se calcula la calidad y cómo consultar la API" },
          ].map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group inline-flex items-baseline gap-1.5 text-link underline-offset-2 hover:underline"
              >
                <Database className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-faint" aria-hidden />
                <span className="font-medium">{item.label}</span>
                <ArrowRight className="h-3 w-3 shrink-0 translate-y-0.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </Link>
              <span className="text-faint"> — {item.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
