"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScoreCircle } from "@/components/ui/score-circle";

/** Lo mínimo de cada sugerencia. Son las claves que devuelve `/api/catalog`. */
interface Suggestion {
  slug: string;
  title: string;
  category: string;
  formats: string[];
  /**
   * `overall` es el índice compuesto que la API calcula con `scoreForDataset`,
   * el mismo que pinta la tarjeta del catálogo. Se usa tal cual en vez de
   * recomponerlo aquí para que las dos vistas no puedan dar cifras distintas del
   * mismo conjunto de datos.
   *
   * Opcional: un conjunto sin analizar no trae nota, y el círculo pinta «—».
   */
  scores?: { overall: number | null };
}

/** Cuántas sugerencias se piden y se pintan. */
const MAX_SUGGESTIONS = 7;

/**
 * Espera antes de consultar, en ms.
 *
 * Sin esto se lanzaba una petición por tecla. Con 180 ms, escribir «padron» hace
 * una consulta en vez de seis y no se nota al teclear.
 */
const DEBOUNCE_MS = 180;

/** A partir de cuántos caracteres se empieza a sugerir. */
const MIN_CHARS = 2;

/**
 * Buscador del catálogo con sugerencias.
 *
 * Vive fuera de `Header` a propósito. El estado del texto estaba en el propio
 * `Header`, así que cada tecla volvía a renderizar la cabecera entera —logo,
 * navegación, botón de tema— para cambiar un `value`. Aquí el re-render se queda
 * dentro de este componente.
 *
 * Las sugerencias se piden a `/api/catalog`, que ya filtra por `q` con el mismo
 * matcher tolerante que usa el catálogo (`matchesQuery`): sin tildes y por
 * palabras sueltas. No se descarga el catálogo entero al navegador: son 836
 * conjuntos y solo hacen falta siete.
 */
export function DatasetSearch({
  variant = "desktop",
  onNavigate,
}: {
  /** `mobile` ocupa todo el ancho y va dentro del menú desplegable. */
  variant?: "desktop" | "mobile";
  /** Para que el menú móvil se cierre al saltar a un resultado. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  /**
   * Lo último que respondió la API, junto al texto que se pidió.
   *
   * Se guarda el término y no solo la lista para poder derivar todo lo demás:
   * si `result.term` no es el texto actual, lo que hay en pantalla es viejo, así
   * que no se pinta y se sabe que hay una consulta en curso. Con una lista y un
   * booleano de «cargando» por separado hacía falta limpiarlos a mano desde el
   * efecto, y aparecían un instante las sugerencias de la búsqueda anterior.
   */
  const [result, setResult] = useState<{ term: string; items: Suggestion[] }>({
    term: "",
    items: [],
  });
  const [open, setOpen] = useState(false);
  /**
   * El resaltado se guarda por `slug`, no por índice.
   *
   * Con un índice había que reiniciarlo cada vez que llegaban sugerencias
   * nuevas: si no, «la segunda de la lista» pasaba a ser otro conjunto de datos
   * y Enter abría el que no era. Por slug se invalida solo —si ya no está en la
   * lista, no hay resaltado— y no hace falta ningún efecto para limpiarlo.
   */
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const term = query.trim();
  const enabled = term.length >= MIN_CHARS;
  /** Solo se pintan las sugerencias que corresponden a lo que está escrito. */
  const items = enabled && result.term === term ? result.items : [];
  const loading = enabled && result.term !== term;
  /** −1 = ninguna resaltada, y entonces Enter busca en el catálogo. */
  const active = activeSlug ? items.findIndex((item) => item.slug === activeSlug) : -1;

  /* Consulta con espera y cancelación.
     El `AbortController` no es un adorno: al teclear rápido salen varias
     peticiones y no llegan en orden, así que sin cancelarlas una respuesta vieja
     podía pisar a la buena. */
  useEffect(() => {
    if (term.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/catalog?q=${encodeURIComponent(term)}&limit=${MAX_SUGGESTIONS}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setResult({
          term,
          items: Array.isArray(data.datasets) ? data.datasets.slice(0, MAX_SUGGESTIONS) : [],
        });
      } catch {
        // Un fallo de red no debe romper el buscador: se queda sin sugerencias y
        // el formulario sigue llevando al catálogo, que filtra en servidor. Se
        // apunta el término igualmente para que deje de parecer que carga.
        if (!controller.signal.aborted) setResult({ term, items: [] });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  /* Cerrar al pulsar fuera. `mousedown` y no `click`: con `click`, pulsar sobre
     una sugerencia cerraba la lista antes de que el enlace recibiera el evento. */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setActiveSlug(null);
  };

  /* Al vaciar el texto, `items` se queda sin sugerencias por derivación: no hay
     que limpiar ninguna lista a mano. */
  const goTo = (slug: string) => {
    router.push(`/catalogo/${slug}`);
    setQuery("");
    close();
    onNavigate?.();
  };

  /** Enter sin nada resaltado: búsqueda completa en el catálogo. */
  const submit = () => {
    if (!term) return;
    router.push(`/catalogo?q=${encodeURIComponent(term)}`);
    setQuery("");
    close();
    onNavigate?.();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (items.length === 0) return;
      // `preventDefault` para que las flechas muevan el resaltado y no el cursor
      // dentro del texto ni la página.
      event.preventDefault();
      setOpen(true);
      // Se recorre en círculo desde la posición actual; sin resaltado, la flecha
      // abajo entra por el primero y la de arriba por el último.
      const step = event.key === "ArrowDown" ? 1 : -1;
      const from = active >= 0 ? active : step === 1 ? -1 : 0;
      const next = (from + step + items.length) % items.length;
      setActiveSlug(items[next].slug);
    }
  };

  const showList = open && term.length >= MIN_CHARS;
  const activeId = active >= 0 ? `${listId}-opt-${active}` : undefined;

  return (
    <div ref={rootRef} className={cn("relative", variant === "desktop" ? "hidden lg:block" : "w-full")}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (active >= 0 && items[active]) goTo(items[active].slug);
          else submit();
        }}
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveSlug(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar conjuntos de datos…"
          aria-label="Buscar conjuntos de datos"
          // Patrón combobox: el input controla una lista y anuncia qué opción
          // está resaltada. Sin esto, un lector de pantalla no se entera de que
          // al teclear han aparecido sugerencias.
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          className={cn(
            "rounded-lg border border-field bg-fill pl-9 pr-9 text-sm text-body placeholder:text-faint",
            "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            variant === "desktop" ? "h-10 w-56" : "h-11 w-full"
          )}
        />
        {loading && (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-faint"
            aria-hidden
          />
        )}
      </form>

      {/* El desplegable: en móvil ocupa el ancho del menú; en escritorio se
          ancla al borde DERECHO del input y crece hacia la izquierda. El
          buscador vive al final de la cabecera, así que uno más ancho que el
          input anclado a la izquierda se saldría de la pantalla. Y necesita más
          ancho que el input (224 px) para que el círculo y dos líneas de título
          no se peleen. */}
      {showList && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg lg:left-auto lg:right-0 lg:w-96">
          {items.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-faint" role="status">
              {loading ? "Buscando…" : "Ningún conjunto de datos coincide."}
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Conjuntos de datos sugeridos">
              {items.map((item, index) => (
                <li key={item.slug}>
                  <button
                    id={`${listId}-opt-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActiveSlug(item.slug)}
                    onClick={() => goTo(item.slug)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                      index === active ? "bg-fill" : "hover:bg-fill"
                    )}
                  >
                    {/* El mismo indicador que la tarjeta del catálogo, en su
                        tamaño pequeño: quien reconoce el círculo allí lo lee
                        aquí sin aprender nada nuevo. */}
                    <ScoreCircle score={item.scores?.overall ?? null} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-xs font-medium text-strong">
                        {item.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-faint">
                        <span className="truncate">{item.category}</span>
                        {item.formats.length > 0 && (
                          <span className="font-mono">· {item.formats.slice(0, 3).join(" ")}</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {term.length >= MIN_CHARS && (
            <button
              type="button"
              onClick={submit}
              className="block w-full border-t border-border bg-fill px-3 py-2 text-left text-[11px] font-medium text-link hover:underline"
            >
              Ver todos los resultados de «{term}»
            </button>
          )}
        </div>
      )}
    </div>
  );
}
