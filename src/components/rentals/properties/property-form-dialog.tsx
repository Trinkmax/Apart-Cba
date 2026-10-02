"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Building, PencilLine } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { RentalProperty } from "@/lib/types/database";
import { propertyAddress } from "@/lib/rentals/labels";
import type { PropertyOwnerInput } from "./property-types";
import { PropertyForm } from "./property-form";

export type { PropertyOwnerInput } from "./property-types";

export interface PropertyFormDialogProps {
  property?: RentalProperty | null;
  /** Titulares actuales (al editar). Si no vienen, se traen del servidor al abrir. */
  owners?: PropertyOwnerInput[];
  /** El disparador (botón). Puede omitirse si se controla con `open`. */
  children?: ReactNode;
  onSaved?: (property: RentalProperty) => void;
  /** Control externo opcional. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Alta / edición de una propiedad con sus dueños. Envuelve al disparador:
 * `<PropertyFormDialog onSaved={…}><Button>Nueva propiedad</Button></PropertyFormDialog>`.
 */
export function PropertyFormDialog({ property, owners, children, onSaved, open: openProp, onOpenChange }: PropertyFormDialogProps) {
  const router = useRouter();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setOpenState(v);
    onOpenChange?.(v);
  };
  const isEdit = Boolean(property);
  const Icon = isEdit ? PencilLine : Building;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
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
        </DialogHeader>
        {open && (
          <PropertyForm
            property={property}
            owners={owners}
            onCancel={() => setOpen(false)}
            onDone={(saved) => {
              setOpen(false);
              onSaved?.(saved);
              router.refresh();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
