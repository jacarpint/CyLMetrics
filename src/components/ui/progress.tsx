"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  indicatorClassName?: string;
  /**
   * Descripción de lo que mide la barra. Sin esto la barra es decorativa y se
   * oculta a los lectores de pantalla, en lugar de anunciarse sin contexto.
   */
  label?: string;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, indicatorClassName, label, ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, value));
    const a11y = label
      ? {
          role: "progressbar" as const,
          "aria-valuenow": Math.round(pct),
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-label": label,
        }
      : { role: "presentation" as const, "aria-hidden": true };

    return (
      <div
        ref={ref}
        className={cn("relative h-2 w-full overflow-hidden rounded-full bg-fill", className)}
        {...a11y}
        {...props}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500 ease-out", indicatorClassName || "bg-ok-solid")}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";
export { Progress };
