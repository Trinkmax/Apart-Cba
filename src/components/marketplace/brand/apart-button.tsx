import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Botón de la web de apart. Píldoras, como en el manual de marca.
 *
 * - cta:       coral, la acción principal de la pantalla (Buscar, Pedir
 *              reserva, Enviar pedido). Blanco sobre coral-700 da 4.57:1: AA a
 *              cualquier tamaño (coral-600 daba 4.02:1 y el lg, 17px bold, no
 *              llega a "texto grande").
 * - primary:   forest, acciones importantes en cualquier tamaño (7.7:1).
 * - secondary: contorno forest sobre crema (Ingresar, Ver fotos).
 * - soft:      salvia, acciones suaves (filtros activos, "Copiar").
 * - ghost:     sin fondo (íconos, menús).
 * - inverse:   crema sobre fondos forest.
 * - link:      texto forest subrayado.
 */
export const apartButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-apart font-semibold",
    "whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-200",
    "outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.15em]",
  ].join(" "),
  {
    variants: {
      variant: {
        cta: "bg-coral-700 text-white font-bold shadow-apart-md hover:bg-coral-800",
        primary: "bg-forest-700 text-cream hover:bg-forest-800 shadow-apart-sm",
        secondary: "border border-forest-700/25 bg-paper/60 text-forest-700 hover:border-forest-700/45 hover:bg-paper",
        soft: "bg-leaf-100 text-forest-700 hover:bg-leaf-200",
        ghost: "text-forest-700 hover:bg-forest-700/[0.06]",
        inverse: "bg-cream text-forest-700 hover:bg-white shadow-apart-sm",
        link: "rounded-none px-0 text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-5 text-[0.9375rem]",
        lg: "h-12 px-6 text-[1.0625rem]",
        xl: "h-14 px-8 text-[1.1875rem]",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    compoundVariants: [
      { variant: "link", size: ["sm", "md", "lg", "xl"], className: "h-auto px-0" },
    ],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ApartButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof apartButtonVariants> & { asChild?: boolean };

export function ApartButton({ className, variant, size, asChild = false, ...props }: ApartButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="apart-button" className={cn(apartButtonVariants({ variant, size }), className)} {...props} />;
}
