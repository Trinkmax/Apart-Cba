"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, UserRound, UserRoundPen } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { RentalPerson } from "@/lib/types/database";
import { PersonForm } from "./person-form";

export interface PersonFormDialogProps {
  /** Si viene, edita; si no, crea. */
  person?: RentalPerson | null;
  /** Rol con el que se está cargando (cambia el copy y los campos destacados). */
  intent?: "inquilino" | "garante";
  /** Texto con el que se precarga el nombre (lo que se tipeó en el buscador). */
  defaultName?: string;
  /** El disparador (botón). Puede omitirse si se controla con `open`. */
  children?: ReactNode;
  /** Se llama con la fila guardada (o con la persona ya existente si se eligió "Usar esta persona"). */
  onSaved?: (person: RentalPerson) => void;
  /** Control externo opcional (p. ej. abrir desde un buscador). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Alta / edición de un inquilino o garante. Envuelve al disparador:
 * `<PersonFormDialog intent="garante" onSaved={…}><Button>…</Button></PersonFormDialog>`.
 * El formulario se monta al abrir, así cada apertura arranca limpia.
 */
export function PersonFormDialog({ person, intent, defaultName, children, onSaved, open: openProp, onOpenChange }: PersonFormDialogProps) {
  const router = useRouter();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setOpenState(v);
    onOpenChange?.(v);
  };

  const isEdit = Boolean(person);
  const title = isEdit
    ? "Editar datos"
    : intent === "garante"
      ? "Nuevo garante"
      : intent === "inquilino"
        ? "Nuevo inquilino"
        : "Nueva persona";
  const description = isEdit
    ? person?.full_name
    : intent === "garante"
      ? "Quién responde si el inquilino no paga. Cargá sus datos y, si es con recibo de sueldo, dónde trabaja y cuánto gana."
      : "Con DNI, teléfono y mail alcanza para empezar; el resto lo podés completar después.";
  const Icon = isEdit ? UserRoundPen : intent === "garante" ? ShieldCheck : UserRound;

  function done(saved: RentalPerson) {
    setOpen(false);
    onSaved?.(saved);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
              <Icon size={16} />
            </span>
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && (
          <PersonForm
            person={person}
            intent={intent}
            defaultName={defaultName}
            onDone={done}
            onCancel={() => setOpen(false)}
            onUseExisting={done}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
