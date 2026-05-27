"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Lightbox simple para la foto de un consejo. Click en cualquier lado para
 * cerrar. Sin zoom ni pan (el celular ya ofrece pinch-to-zoom nativo en la
 * vista de imagen).
 */
export function TipPhotoLightbox({
  open,
  onOpenChange,
  url,
  alt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  alt: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[100vw] sm:max-w-3xl p-0 bg-black/95 border-0"
        onClick={() => onOpenChange(false)}
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Cerrar"
          className="absolute top-3 right-3 z-10 size-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur transition-colors"
        >
          <X size={18} />
        </button>
        <div className="relative w-full h-[80vh] flex items-center justify-center">
          <Image
            src={url}
            alt={alt}
            fill
            sizes="100vw"
            unoptimized
            className="object-contain"
            priority
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
