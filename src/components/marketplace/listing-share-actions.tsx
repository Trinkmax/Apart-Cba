"use client";

import { useEffect, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeartButton } from "@/components/marketplace/wishlist/heart-button";

/**
 * Compartir (Web Share API; si no hay, copia el link) y guardar en favoritos.
 * El link compartido es siempre la ficha limpia (sin fechas ni avisos).
 */
export function ListingShareActions({
  url,
  title,
  unitId,
  className,
}: {
  /** URL absoluta de la ficha. */
  url: string;
  title: string;
  unitId: string;
  className?: string;
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
