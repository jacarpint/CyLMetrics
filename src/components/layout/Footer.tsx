import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Pie del portal, en el layout y no en la portada.
 *
 * Aquí vive el aviso de que esto es un proyecto independiente, y ese aviso hace
 * falta en cualquier página que enseñe una nota de calidad, no solo en Inicio.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-fill px-4 py-6 sm:px-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p className="max-w-3xl text-xs leading-relaxed text-faint">
          Metadatos del{" "}
          <a
            href="https://datosabiertos.jcyl.es"
            className="text-link underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            catálogo de datos abiertos de la Junta de Castilla y León
          </a>
          , actualizados cada hora. El análisis de los archivos se ejecuta periódicamente y su
          resultado se publica en{" "}
          <a href="/api/quality" className="text-link underline-offset-2 hover:underline">
            JSON
          </a>{" "}
          y en CSV, sin registro ni clave. Este portal es un proyecto independiente: no lo edita ni
          lo revisa la Junta de Castilla y León.
        </p>
        <nav className="flex shrink-0 flex-wrap items-center gap-4" aria-label="Enlaces del pie">
          {[
            { href: "/glosario", label: "Glosario" },
            { href: "/metodologia", label: "Metodología y API" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-1 text-xs text-faint transition-colors hover:text-body"
            >
              {link.label}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
