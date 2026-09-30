"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsWishlisted, useWishlistToggle } from "./use-wishlist";

/**
 * Corazón de favoritos.
 * - overlay: sobre una foto (tarjetas, galería). Ícono blanco con sombra;
 *   guardado = relleno coral.
 * - plain:   píldora con texto ("Guardar" / "Guardado") para la ficha.
 * Nunca navega: frena el click para poder vivir dentro (o encima) de un link.
 */
export function HeartButton({
  unitId,
  className,
  variant = "overlay",
}: {
  unitId: string;
  className?: string;
  variant?: "overlay" | "plain";
}) {
  const saved = useIsWishlisted(unitId);
  const toggle = useWishlistToggle();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    void toggle(unitId);
  }

  if (variant === "plain") {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={saved}
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-full border px-4 font-apart text-sm font-semibold transition-colors duration-200",
          "outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
          saved
            ? "border-coral-200 bg-coral-50 text-coral-800 hover:bg-coral-100"
            : "border-cream-300 bg-paper text-forest-700 hover:border-cream-400 hover:bg-cream-50",
          className,
        )}
      >
        <Heart
          aria-hidden
          className={cn(
            "size-[1.15rem] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            saved ? "scale-110 fill-coral-500 stroke-coral-600" : "fill-transparent",
          )}
          strokeWidth={2}
        />
        {saved ? "Guardado" : "Guardar"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={saved}
      aria-label={saved ? "Quitar de favoritos" : "Guardar en favoritos"}
      title={saved ? "Quitar de favoritos" : "Guardar en favoritos"}
      className={cn(
        "group/heart grid size-11 place-items-center rounded-full outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-paper/90",
        className,
      )}
    >
      <Heart
        aria-hidden
        className={cn(
          "size-6 stroke-white drop-shadow-[0_1px_2px_rgb(6_32_27/0.45)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-active/heart:scale-90",
          saved ? "scale-110 fill-coral-500" : "fill-forest-950/30 group-hover/heart:scale-110",
        )}
        strokeWidth={2}
      />
    </button>
  );
}
