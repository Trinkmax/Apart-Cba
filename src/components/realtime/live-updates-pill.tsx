"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Escape para el conflicto de fondo entre "quiero verlo al toque" y "no me
 * borres el formulario a medio llenar": cuando la compuerta bloquea el refresh
 * (diálogo abierto, drag en curso, pestaña de fondo), el cambio no se descarta
 * — se cuenta acá y el operador decide cuándo aplicarlo.
 */
export function LiveUpdatesPill({
  count,
  onApply,
  isRefreshing = false,
  className,
  label = "novedad",
  labelPlural = "novedades",
}: {
  count: number;
  onApply: () => void;
  isRefreshing?: boolean;
  className?: string;
  label?: string;
  labelPlural?: string;
}) {
  if (count <= 0) return null;
  return (
    <div
      className={cn(
        // El offset suma el inset superior: en la PWA instalada con notch, un
        // 4.5rem crudo caía justo encima del header de /m.
        "pointer-events-none fixed left-1/2 z-40 -translate-x-1/2 animate-live-pill",
        "top-[calc(4.5rem+env(safe-area-inset-top,0px))]",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onApply}
        disabled={isRefreshing}
        className={cn(
          "pointer-events-auto inline-flex items-center gap-2 rounded-full",
          "bg-foreground px-3.5 py-1.5 text-[12px] font-medium text-background",
          "shadow-lg shadow-black/15 ring-1 ring-black/5",
          "transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-70"
        )}
      >
        {isRefreshing ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <ArrowUp size={13} />
        )}
        <span>
          <strong className="font-semibold">{count}</strong>{" "}
          {count === 1 ? label : labelPlural}
        </span>
        <span className="opacity-60">·</span>
        <span className="opacity-80">actualizar</span>
      </button>
    </div>
  );
}
