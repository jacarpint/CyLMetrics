import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * El anillo de foco usa `ring-ring` + `ring-offset-canvas`: el offset por
 * defecto de Tailwind es blanco fijo y en modo oscuro dibujaba un halo.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium",
    "transition-all duration-200 cursor-pointer select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        /** Acción principal. Relleno de marca con contraste AA sobre su texto. */
        default: "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover",
        secondary: "bg-card text-body border border-border shadow-sm hover:bg-fill hover:text-strong hover:border-border-strong",
        ghost: "text-body hover:bg-fill hover:text-strong",
        destructive: "bg-bad-solid text-bad-fg shadow-sm hover:brightness-110",
        outline: "border border-field bg-transparent text-body hover:bg-fill hover:text-strong",
        link: "text-link underline-offset-4 hover:underline hover:text-link-hover",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-6",
        /** 40×40: objetivo táctil mínimo cómodo en móvil. */
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";
export { Button, buttonVariants };
