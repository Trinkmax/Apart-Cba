"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Building, PencilLine } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { RentalProperty } from "@/lib/types/database";
import { propertyAddress } from "@/lib/rentals/labels";
import { DiscardChangesDialog, FormDialogContent, FormDialogHeader } from "@/components/rentals/people/form-dialog-shell";
import { clearDraft, useDraftKey } from "@/components/rentals/people/use-form-draft";
import type { PropertyOwnerInput, SavedPropertyOwner } from "./property-types";
import { PropertyForm } from "./property-form";

export type { PropertyOwnerInput, SavedPropertyOwner } from "./property-types";

export interface PropertyFormDialogProps {
  property?: RentalProperty | null;
  /** Titulares actuales (al editar). Si no vienen, se traen del servidor al abrir. */
  owners?: PropertyOwnerInput[];
  /** El disparador (botón). Puede omitirse si se controla con `open`. */
  children?: ReactNode;
  /** Con los titulares tal como quedaron (nombre y %): quien abrió el diálogo no tiene que volver a pedirlos. */
  onSaved?: (property: RentalProperty, owners: SavedPropertyOwner[]) => void;
  /** Control externo opcional. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Alta / edición de una propiedad con sus dueños. Envuelve al disparador:
 * `<PropertyFormDialog onSaved={…}><Button>Nueva propiedad</Button></PropertyFormDialog>`.
 * Cerrar (X, Esc, tocar afuera, Cancelar) con algo tipeado pregunta antes; un
 * alta sin guardar queda como borrador de la pestaña hasta guardarla o descartarla.
 */
export function PropertyFormDialog({ property, owners, children, onSaved, open: openProp, onOpenChange }: PropertyFormDialogProps) {
  const router = useRouter();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const isEdit = Boolean(property);
  const Icon = isEdit ? PencilLine : Building;
  const draftKey = useDraftKey(isEdit ? null : "propiedad");
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

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : requestClose())}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
        <FormDialogContent className="sm:max-w-3xl">
          <FormDialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="size-8 rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
                <Icon size={16} />
              </span>
              {isEdit ? "Editar propiedad" : "Nueva propiedad"}
            </DialogTitle>
            <DialogDescription>
              {isEdit && property
                ? propertyAddress(property)
                : "Con la dirección y el dueño alcanza para empezar. Lo demás lo completás cuando quieras."}
            </DialogDescription>
          </FormDialogHeader>
          {open && (
            <PropertyForm
              property={property}
              owners={owners}
              draftKey={draftKey}
              onStatusChange={(dirty, busy) => setStatus((s) => (s.dirty === dirty && s.busy === busy ? s : { dirty, busy }))}
              onCancel={requestClose}
              onDone={(saved, savedOwners) => {
                clearDraft(draftKey);
                close();
                onSaved?.(saved, savedOwners);
                router.refresh();
              }}
            />
          )}
        </FormDialogContent>
      </Dialog>
      <DiscardChangesDialog
        open={askDiscard}
        title={isEdit ? "¿Descartar los cambios?" : "¿Descartar la propiedad que estabas cargando?"}
        description={
          isEdit ? "Lo que cambiaste en esta propiedad todavía no se guardó." : "Todavía no se guardó: si la descartás, se pierde lo que escribiste."
        }
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
