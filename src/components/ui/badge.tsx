import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Las variantes usan tokens semánticos, así que voltean de tema solas: no hay
 * (ni debe haber) variantes `dark:` aquí. Todos los pares texto/fondo están
 * medidos ≥ 4.5:1 en claro y oscuro.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-5 transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-fill text-body",
        success: "border-ok-line bg-ok-surface text-ok",
        warning: "border-warn-line bg-warn-surface text-warn",
        destructive: "border-bad-line bg-bad-surface text-bad",
        info: "border-info-line bg-info-surface text-info",
        format: "border-border bg-card text-body font-mono tracking-tight",
        solid: "border-transparent bg-primary text-primary-fg",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
