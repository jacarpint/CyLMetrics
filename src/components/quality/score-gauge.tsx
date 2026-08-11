import { cn } from "@/lib/utils";
import { getScoreColor, getScoreStroke, getScoreLabel } from "@/lib/quality";

interface ScoreGaugeProps {
  score: number | null;
  size?: "xs" | "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

const SIZE_MAP = {
  xs: { ring: "w-10 h-10", text: "text-sm",  label: "text-[9px]",  stroke: 3, radius: 20 },
  sm: { ring: "w-16 h-16", text: "text-lg",  label: "text-[10px]", stroke: 4, radius: 28 },
  md: { ring: "w-24 h-24", text: "text-2xl", label: "text-[11px]", stroke: 5, radius: 42 },
  lg: { ring: "w-32 h-32", text: "text-3xl", label: "text-xs",     stroke: 6, radius: 56 },
};

export function ScoreGauge({ score, size = "md", label, className }: ScoreGaugeProps) {
  const s = SIZE_MAP[size];

  if (score == null) {
    return (
      <div className={cn("flex flex-col items-center gap-1", className)}>
        <div
          className={cn(s.ring, "rounded-full border-2 border-border flex items-center justify-center bg-fill")}
          role="img"
          aria-label={label ? `${label}: sin puntuación` : "Sin puntuación"}
        >
          <span className={cn(s.text, "font-bold text-faint")} aria-hidden>—</span>
        </div>
        {label && <span className={cn(s.label, "text-faint font-medium")}>{label}</span>}
      </div>
    );
  }

  const textColor = getScoreColor(score);
  const circ = 2 * Math.PI * (s.radius - s.stroke / 2);
  const dashOffset = circ * (1 - score / 100);

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      {/* Un solo nodo accesible: el anillo es decorativo y el valor se anuncia
          con su nivel, no solo con el color (WCAG 1.4.1). */}
      <div
        className={cn(s.ring, "relative")}
        role="img"
        aria-label={`${label ? `${label}: ` : ""}${score} sobre 100 — calidad ${getScoreLabel(score).toLowerCase()}`}
      >
        <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${s.radius * 2} ${s.radius * 2}`} aria-hidden focusable="false">
          <circle
            cx={s.radius} cy={s.radius} r={s.radius - s.stroke / 2}
            fill="none" strokeWidth={s.stroke}
            className="stroke-fill-strong"
          />
          <circle
            cx={s.radius} cy={s.radius} r={s.radius - s.stroke / 2}
            fill="none" strokeWidth={s.stroke}
            strokeDasharray={circ} strokeDashoffset={dashOffset}
            strokeLinecap="round" className="transition-all duration-700 ease-out"
            // Variable CSS vía `style` (no como atributo) para que el anillo
            // cambie de tono al alternar de tema sin volver a renderizar.
            style={{ stroke: getScoreStroke(score) }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn(s.text, "font-bold tabular-nums", textColor)} aria-hidden>{score}</span>
        </div>
      </div>
      {label && <span className={cn(s.label, "text-faint font-medium")}>{label}</span>}
    </div>
  );
}
