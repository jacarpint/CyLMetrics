import * as React from "react";
import { cn } from "@/lib/utils";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** `raised` añade sombra al pasar el cursor: solo para tarjetas navegables. */
  interactive?: boolean;
  /** Tinte de estado para tarjetas de aviso. */
  tone?: "default" | "muted" | "ok" | "warn" | "bad" | "info";
};

const TONES: Record<NonNullable<CardProps["tone"]>, string> = {
  default: "border-border bg-card",
  muted: "border-border bg-fill",
  ok: "border-ok-line bg-ok-surface",
  warn: "border-warn-line bg-warn-surface",
  bad: "border-bad-line bg-bad-surface",
  info: "border-info-line bg-info-surface",
};

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, tone = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border shadow-sm transition-all duration-200",
        TONES[tone],
        interactive && "hover:-translate-y-0.5 hover:shadow-md hover:border-border-strong",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-5", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-semibold text-strong leading-tight tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-faint", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

/**
 * Padding completo por defecto.
 *
 * El defecto era `p-5 pt-0`, que asume un `CardHeader` encima aunque el caso
 * habitual con diferencia es la tarjeta sin cabecera: 27 de 29 usos pasaban un
 * padding explícito solo para reponer el que faltaba arriba. Ahora el defecto
 * sirve al caso mayoritario y las pocas tarjetas con cabecera añaden `pt-0`.
 */
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-5 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
