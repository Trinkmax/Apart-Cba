"use client";

import { X } from "lucide-react";
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Contenido de diálogo con la piel de la web (papel, forest, esquinas de 24 px).
 * En el celular sale desde abajo como hoja (lo hace el Dialog base); el botón
 * de cerrar tiene 44 px y dice "Cerrar" a los lectores de pantalla.
 * Para anchos más grandes pasá `className="sm:max-w-2xl"` (forma sm:).
 */
export function BrandDialogContent({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogContent
      showCloseButton={false}
      {...(description ? {} : { "aria-describedby": undefined })}
      className={cn(
        "gap-5 rounded-t-3xl border-cream-300 bg-paper p-5 pt-7 font-apart text-ink-900 shadow-apart-lg sm:max-w-lg sm:rounded-3xl sm:p-7",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <DialogTitle className="font-apart text-xl font-extrabold leading-tight tracking-[-0.02em] text-forest-700 text-balance">
          {title}
        </DialogTitle>
        <DialogClose
          className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-500 outline-none transition-colors hover:bg-forest-700/[0.06] hover:text-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
          aria-label="Cerrar"
        >
          <X className="size-5" aria-hidden />
        </DialogClose>
      </div>
      {description ? (
        <DialogDescription className="-mt-2 text-[0.9375rem] leading-relaxed text-ink-700">{description}</DialogDescription>
      ) : null}
      {children}
    </DialogContent>
  );
}
