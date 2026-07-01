"use client";

import { useState, useTransition } from "react";
import { Share, Heart } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toggleWishlist } from "@/lib/actions/wishlists";

type Props = {
  slug: string;
  title: string;
  unitId: string;
};

export function ListingShareActions({ slug, title, unitId }: Props) {
  const [favorited, setFavorited] = useState(false);
  const [, startTransition] = useTransition();

  async function handleShare() {
    const url = `${window.location.origin}/u/${slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // El usuario canceló el diálogo de compartir; no hacemos nada.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    } catch {
      toast.error("No se pudo copiar el link");
    }
  }

  function handleSave() {
    const next = !favorited;
    setFavorited(next);
    startTransition(async () => {
      const result = await toggleWishlist(unitId);
      if (!result.ok) {
        setFavorited(!next);
        if (result.error?.toLowerCase().includes("sesión") || result.error?.toLowerCase().includes("inicia")) {
          toast.info("Iniciá sesión para guardar favoritos");
        } else {
          toast.error(result.error ?? "No se pudo guardar");
        }
      } else {
        toast.success(result.added ? "Guardado en favoritos" : "Quitado de favoritos");
      }
    });
  }

  return (
    <div className="hidden md:flex items-center gap-1">
      <button
        onClick={handleShare}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 rounded-lg"
      >
        <Share size={14} />
        Compartir
      </button>
      <button
        onClick={handleSave}
        aria-label={favorited ? "Quitar de favoritos" : "Guardar"}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 rounded-lg"
      >
        <Heart
          size={14}
          className={cn("transition-all", favorited ? "fill-sage-500 stroke-sage-500" : "")}
        />
        Guardar
      </button>
    </div>
  );
}
