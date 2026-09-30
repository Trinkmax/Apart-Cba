"use client";

import { useEffect, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeartButton } from "@/components/marketplace/wishlist/heart-button";

/** Vidrio oscuro de los botones que van sobre la foto de la galería (celular). */
const PHOTO_GLASS =
  "bg-forest-950/40 shadow-[0_4px_14px_rgb(6_32_27/0.28)] ring-1 ring-inset ring-white/25 backdrop-blur-md " +
  "transition-[background-color,transform] duration-200 hover:bg-forest-950/55 active:scale-95";

/** Botón redondo sobre la foto (celular). El ancho lo pone quien lo usa: `w-11`, o padding si es píldora. */
export const PHOTO_BUTTON =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-full text-white outline-none " +
  "focus-visible:ring-[3px] focus-visible:ring-paper/90 " +
  PHOTO_GLASS;

/**
 * Compartir (Web Share API; si no hay, copia el link) y guardar en favoritos.
 * El link compartido es siempre la ficha limpia (sin fechas ni avisos).
 * - plain: píldoras con texto al lado del título (tablet y escritorio).
 * - overlay: botones redondos de vidrio sobre la foto (celular).
 */
export function ListingShareActions({
  url,
  title,
  unitId,
  className,
  variant = "plain",
}: {
  /** URL absoluta de la ficha. */
  url: string;
  title: string;
  unitId: string;
  className?: string;
  variant?: "plain" | "overlay";
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function handleShare() {
    // En la ficha abierta en otro dominio (preview) se comparte el de la página.
    const shareUrl = url || window.location.href.split("?")[0];
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${title} · apart`, url: shareUrl });
        return;
      } catch (err) {
        // Canceló el diálogo: no hacemos nada. Otro error: probamos copiar.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      window.prompt("Copiá el link de este lugar:", shareUrl);
    }
  }

  if (variant === "overlay") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <button type="button" onClick={handleShare} className={cn(PHOTO_BUTTON, copied ? "gap-1.5 px-3.5" : "w-11")}>
          {copied ? <Check className="size-[1.15rem]" aria-hidden /> : <Share2 className="size-5" aria-hidden />}
          {/* Sin copiar, el texto es sólo para lectores de pantalla; copiado, se ve en la píldora. */}
          <span aria-live="polite" className={copied ? "font-apart text-[0.8125rem] font-semibold" : "sr-only"}>
            {copied ? "Link copiado" : "Compartir"}
          </span>
        </button>
        <HeartButton unitId={unitId} variant="overlay" className={PHOTO_GLASS} />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={handleShare}
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-full border px-4 font-apart text-sm font-semibold transition-colors duration-200",
          "outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
          copied
            ? "border-leaf-300 bg-leaf-100 text-forest-700"
            : "border-cream-300 bg-paper text-forest-700 hover:border-cream-400 hover:bg-cream-50",
        )}
      >
        {copied ? <Check className="size-[1.15rem]" aria-hidden /> : <Share2 className="size-[1.15rem]" aria-hidden />}
        <span aria-live="polite">{copied ? "Link copiado" : "Compartir"}</span>
      </button>
      <HeartButton unitId={unitId} variant="plain" />
    </div>
  );
}
