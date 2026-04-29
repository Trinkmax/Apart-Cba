"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { renameGuest } from "@/lib/actions/guests";

interface RenameGuestButtonProps {
  guestId: string;
  currentName: string;
  /** Si true, el botón es solo un icono lápiz pequeño visible al hover. */
  iconOnly?: boolean;
}

/**
 * Botón para renombrar rápido a un huésped. Abre un Popover con un input,
 * Enter o ✓ guarda, Escape o ✕ cancela.
 */
export function RenameGuestButton({
  guestId,
  currentName,
  iconOnly = true,
}: RenameGuestButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function commit() {
    const trimmed = name.trim();
    if (trimmed === currentName) {
      setOpen(false);
      return;
    }
    if (trimmed.length < 2) {
      toast.error("Nombre demasiado corto");
      return;
    }
    startTransition(async () => {
      try {
        await renameGuest(guestId, trimmed);
        toast.success("Nombre actualizado");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo renombrar", { description: (e as Error).message });
      }
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) setName(currentName);
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={
            iconOnly
              ? "size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              : "h-7 gap-1.5 px-2 text-xs"
          }
          onClick={(e) => {
            // Evitar que abra el GuestProfileDialog padre
            e.stopPropagation();
          }}
          aria-label="Renombrar huésped"
        >
          <Pencil size={iconOnly ? 12 : 13} />
          {!iconOnly && <span>Renombrar</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <label
            htmlFor={`rename-${guestId}`}
            className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground"
          >
            Nombre del huésped
          </label>
          <Input
            id={`rename-${guestId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setName(currentName);
                setOpen(false);
              }
            }}
            placeholder="Nombre completo"
            className="h-9 text-sm"
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={pending}
              onClick={() => {
                setName(currentName);
                setOpen(false);
              }}
            >
              <X size={12} /> Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={pending || name.trim() === currentName || name.trim().length < 2}
              onClick={commit}
            >
              {pending ? (
                <Loader2 className="animate-spin" size={12} />
              ) : (
                <Check size={12} />
              )}
              Guardar
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            El cambio se refleja en reservas y calendarios automáticamente.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
