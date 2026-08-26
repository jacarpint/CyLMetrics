import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { GLOSSARY, GLOSSARY_GROUPS } from "@/lib/glosario";

export const revalidate = 3600;

export const metadata = {
  title: "Glosario",
  description:
    "Qué significa cada término que usa el portal: conjunto de datos, distribución, metadatos, DCAT, disponibilidad, licencia abierta, formato abierto y servicios de mapas.",
};

/**
 * El vocabulario del portal, explicado.
 *
 * Un portal de calidad de datos abiertos no puede evitar hablar de conjuntos de
 * datos, DCAT o licencias: lo que sí puede es no dar por sabido nada. Cada
 * término tiene un ancla estable (`/glosario#disponibilidad`) para poder
 * enlazarlo desde su primera mención en cualquier vista.
 */
export default function GlosarioPage() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-strong">
          <BookOpen className="h-6 w-6 text-faint" aria-hidden />
          Glosario
        </h1>
        <p className="mt-2 max-w-4xl text-base leading-relaxed text-body">
          Hablar de calidad de datos obliga a usar unas cuantas palabras concretas. Aquí está lo que
          significa cada una en este portal, sin dar nada por sabido. Si has llegado desde un enlace,
          el término que buscabas está resaltado más abajo.
        </p>

        <nav aria-label="Bloques del glosario" className="mt-6 flex flex-wrap gap-2">
          {GLOSSARY_GROUPS.map((g) => (
            <a
              key={g.id}
              href={`#${g.id}`}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-body transition-colors hover:border-border-strong hover:bg-fill hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {g.label}
            </a>
          ))}
        </nav>
      </header>

      {GLOSSARY_GROUPS.map((group) => {
        const terms = GLOSSARY.filter((t) => t.group === group.id);
        if (terms.length === 0) return null;
        return (
          <section key={group.id} id={group.id} className="scroll-mt-24 space-y-4">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-strong">{group.label}</h2>
              <p className="mt-1 max-w-4xl text-sm text-faint">{group.intro}</p>
            </div>

            <dl className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {terms.map((t) => (
                <div key={t.id} id={t.id} className="scroll-mt-24">
                  {/* `target:` resalta el término al llegar desde un enlace con
                      ancla, para no dejar a nadie buscando cuál de los veinte
                      era el suyo. */}
                  <Card className="h-full target:border-ok-line target:bg-ok-surface">
                    <CardContent>
                      <dt className="flex flex-wrap items-baseline gap-2">
                        <span className="text-base font-semibold text-strong">{t.term}</span>
                        {t.aka && (
                          <span className="text-xs text-faint">
                            también «{t.aka}»
                          </span>
                        )}
                      </dt>
                      <dd className="mt-1.5 text-sm leading-relaxed text-body">
                        {t.definition}
                        {t.inPortal && (
                          <span className="mt-2 block text-xs leading-relaxed text-faint">
                            <strong className="font-semibold text-body">En este portal:</strong>{" "}
                            {t.inPortal}
                          </span>
                        )}
                      </dd>
                    </CardContent>
                  </Card>
                </div>
              ))}
            </dl>
          </section>
        );
      })}

      <div className="flex flex-wrap gap-4 border-t border-border pt-6">
        <Link
          href="/metodologia"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Cómo se comprueba y cómo se puntúa <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/catalogo"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-2 hover:underline"
        >
          Explorar el catálogo <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
