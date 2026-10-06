"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, UserRound, UserRoundPen } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { RentalPerson } from "@/lib/types/database";
import { DiscardChangesDialog, FormDialogContent, FormDialogHeader } from "./form-dialog-shell";
import { clearDraft, useDraftKey } from "./use-form-draft";
import { personDraftKind } from "./person-draft";
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
  /** Abierto desde otra pantalla con cosas cargadas: ver PersonForm. */
  onStaleDeploy?: (formKept: boolean) => string | null;
}

/**
 * Alta / edición de un inquilino o garante. Envuelve al disparador:
 * `<PersonFormDialog intent="garante" onSaved={…}><Button>…</Button></PersonFormDialog>`.
 * El formulario se monta al abrir. Cerrar con algo tipeado pregunta antes; un
 * alta sin guardar queda como borrador de la pestaña hasta guardarla o descartarla.
 */
export function PersonFormDialog({ person, intent, defaultName, children, onSaved, open: openProp, onOpenChange, onStaleDeploy }: PersonFormDialogProps) {
  const router = useRouter();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const isEdit = Boolean(person);
  const draftKey = useDraftKey(isEdit ? null : personDraftKind(intent));
  const [status, setStatus] = useState({ dirty: false, busy: false });
  const [askDiscard, setAskDiscard] = useState(false);

  const setOpen = (v: boolean) => {
    if (openProp === undefined) setOpenState(v);
    onOpenChange?.(v);
  };
  function close() {
    setAskDiscard(false);
    setStatus({ dirty: false, busy: false });
    setOpen(false);
  }
  // Todas las salidas pasan por acá: con algo tipeado se pregunta; mientras guarda, no se cierra.
  function requestClose() {
    if (status.busy) return;
    if (status.dirty) setAskDiscard(true);
    else close();
  }

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
  const who = intent === "garante" ? "el garante" : intent === "inquilino" ? "el inquilino" : "la persona";

  function done(saved: RentalPerson) {
    clearDraft(draftKey);
    close();
    onSaved?.(saved);
    router.refresh();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : requestClose())}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
        <FormDialogContent className="sm:max-w-2xl">
          <FormDialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="size-8 rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
                <Icon size={16} />
              </span>
              {title}
            </DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </FormDialogHeader>
          {open && (
            <PersonForm
              person={person}
              intent={intent}
              defaultName={defaultName}
              draftKey={draftKey}
              onStatusChange={(dirty, busy) => setStatus((s) => (s.dirty === dirty && s.busy === busy ? s : { dirty, busy }))}
              onDone={done}
              onCancel={requestClose}
              onUseExisting={done}
              onStaleDeploy={onStaleDeploy}
            />
          )}
        </FormDialogContent>
      </Dialog>
      <DiscardChangesDialog
        open={askDiscard}
        title={isEdit ? "¿Descartar los cambios?" : `¿Descartar ${who} que estabas cargando?`}
        description={isEdit ? "Lo que cambiaste todavía no se guardó." : "Todavía no se guardó: si lo descartás, se pierde lo que escribiste."}
        keepLabel={isEdit ? "Seguir editando" : "Seguir cargando"}
        onKeep={() => setAskDiscard(false)}
        onDiscard={() => {
          clearDraft(draftKey);
          close();
        }}
      />
    </>
  );
}
