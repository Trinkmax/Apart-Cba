"use client";

import { useRef, type ComponentProps, type ReactNode } from "react";
import { History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DialogContent, DialogHeader } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/format";

/**
 * Esqueleto de los diálogos de alta / edición de Alquileres (propiedad,
 * persona): encabezado fijo, cuerpo que scrollea y un pie con las acciones que
 * NUNCA tapa el formulario. El DialogContent de shadcn scrollea entero y su
 * pie es sticky y transparente en desktop: los campos pasaban por debajo de
 * los botones y, al abrir, el pie tapaba justo el buscador del propietario.
 * Se compone acá (no se toca el primitivo, que usan todos los diálogos).
 */

/** DialogContent sin padding ni scroll propios: los ponen el cuerpo y el pie. */
export function FormDialogContent({ className, children, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent className={cn("gap-0 p-0 sm:p-0 overflow-hidden", className)} {...props}>
      {children}
    </DialogContent>
  );
}

export function FormDialogHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <DialogHeader className={cn("shrink-0 border-b px-4 pt-6 pb-3 sm:px-6 sm:pb-4 sm:pr-12", className)}>{children}</DialogHeader>;
}

/**
 * Va adentro del <form>: el form es la columna que crece (para que el botón
 * de guardar siga siendo submit) y el cuerpo es lo único que scrollea.
 */
export const formDialogFormClass = "flex min-h-0 flex-1 flex-col";

export function FormDialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5", className)}>{children}</div>;
}

/**
 * Pie fijo con fondo sólido. `status` es una línea corta a la izquierda (en
 * celu arriba de los botones): qué se va a guardar o qué falta.
 */
export function FormDialogFooter({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div className="shrink-0 border-t bg-background px-4 py-3 sm:px-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      {status ? <div className="min-w-0 text-xs leading-snug text-muted-foreground sm:flex-1">{status}</div> : <div className="hidden sm:block sm:flex-1" />}
      <div className="flex items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

/**
 * "¿Descartar…?" antes de cerrar un formulario con datos. Lo preseleccionado
 * es seguir cargando: un Enter o un Esc de más no tira nada.
 */
export function DiscardChangesDialog({
  open,
  title,
  description,
  keepLabel = "Seguir cargando",
  discardLabel = "Descartar",
  onKeep,
  onDiscard,
}: {
  open: boolean;
  title: string;
  description: string;
  keepLabel?: string;
  discardLabel?: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onKeep()}>
      <AlertDialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          keepRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="leading-snug">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onDiscard} className="text-rose-700 hover:text-rose-800 dark:text-rose-300">
            {discardLabel}
          </Button>
          <Button ref={keepRef} type="button" onClick={onKeep}>
            {keepLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Aviso arriba del formulario cuando se recuperó un borrador. */
export function DraftRestoredNotice({ savedAt, onReset }: { savedAt: string; onReset: () => void }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-sky-500/30 bg-sky-500/[0.07] px-3 py-2.5" role="status">
      <History size={16} className="shrink-0 text-sky-600 dark:text-sky-400" />
      <p className="min-w-0 flex-1 text-sm">
        Recuperamos lo que estabas cargando <span className="text-muted-foreground">({formatTimeAgo(savedAt)})</span>.
      </p>
      <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground" onClick={onReset}>
        <RotateCcw size={13} /> Empezar de cero
      </Button>
    </div>
  );
}
