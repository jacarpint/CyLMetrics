import { getScoreColor, getScoreBorderColor, getScoreLabel } from "@/lib/quality";
import { cn } from "@/lib/utils";

/**
 * El índice de calidad de un conjunto de datos, en un círculo.
 *
 * Vivía dentro de `CatalogView` como componente local. Se saca aquí porque el
 * buscador de la cabecera enseña el mismo indicador: duplicarlo habría dejado
 * dos copias de la correspondencia entre nota y color, y basta con que una se
 * quede atrás para que la misma puntuación salga de un color en el catálogo y
 * de otro en las sugerencias.
 *
 * La nota tiene que llegar ya compuesta —`compositeScore` o `scoreForDataset`—,
 * no el eje de metadatos a secas: es la cifra que el portal llama «índice de
 * calidad» en todas partes.
 */
const SIZES = {
  /** Sugerencias del buscador, donde compite con dos líneas de texto. */
  sm: "h-8 w-8 border-2 text-[11px]",
  /** Tarjeta del catálogo. */
  md: "h-10 w-10 border-2 text-sm",
} as const;

export function ScoreCircle({
  score,
  size = "md",
  className,
}: {
  /** Índice compuesto 0-100, o `null` si el conjunto no tiene puntuación. */
  score: number | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      title="Índice de calidad: metadatos, disponibilidad de los archivos y calidad del contenido"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums",
        SIZES[size],
        score != null ? getScoreBorderColor(score) : "border-border",
        score != null ? getScoreColor(score) : "text-faint",
        className
      )}
    >
      {score ?? "—"}
      {/* El nivel también en texto: el color no puede ser lo único que lo diga
          (WCAG 1.4.1). */}
      <span className="sr-only">
        {score != null
          ? ` sobre 100 — índice de calidad ${getScoreLabel(score).toLowerCase()}`
          : "Sin puntuación"}
      </span>
    </div>
  );
}
