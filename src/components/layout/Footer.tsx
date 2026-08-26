import { Code2 } from "lucide-react";

/**
 * Pie del portal, en el layout y no en la portada.
 *
 * Aquí vive el aviso de que esto es un proyecto independiente, y ese aviso hace
 * falta en cualquier página que enseñe una nota de calidad, no solo en Inicio.
 *
 * Se queda con lo que no puede vivir en otro sitio: de dónde salen los datos,
 * que el portal no es de la Junta, dónde está el código y a qué convocatoria se
 * presenta. Los enlaces al glosario y a la metodología estaban aquí duplicando
 * la navegación de la cabecera, que ya los lleva.
 */
const REPO_URL = "https://github.com/jacarpint/CyLMetrics";
const CONCURSO_URL =
  "https://datosabiertos.jcyl.es/web/es/concurso-datos-abiertos/concurso-datos-abiertos.html";

export function Footer() {
  return (
    <footer className="border-t border-border bg-fill px-6 py-6 sm:px-8 lg:px-12">
      {/* Mismo contenedor que el contenido de `main`: el borde superior sigue
          yendo a sangre, pero el texto arranca a la altura de lo que hay encima
          en vez de pegado al margen izquierdo. */}
      <div className="mx-auto w-full max-w-page">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="max-w-3xl text-xs leading-relaxed text-faint">
            Este portal es un proyecto independiente basado en el{" "}
            <a
              href="https://datosabiertos.jcyl.es"
              className="text-link underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              catálogo de datos de la Junta de Castilla y León
            </a>
            .
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1.5 text-xs text-faint transition-colors hover:text-body"
          >
            <Code2 className="h-3.5 w-3.5" aria-hidden />
            Código en GitHub
          </a>
        </div>

        {/* La mención a la convocatoria va aquí, en una línea aparte y en el tono
            más bajo del pie: tiene que constar, pero no compite con la fuente de
            los datos ni con el aviso de independencia. */}
        <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
          Propuesta presentada al{" "}
          <a
            href={CONCURSO_URL}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:text-body hover:underline"
          >
            X Concurso de Datos Abiertos de Castilla y León
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
