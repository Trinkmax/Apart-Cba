"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { Guest } from "@/lib/types/database";

// El form arrastra la cadena country-state-city (~8,7 MB de JS parseado), así
// que se difiere: el chunk recién se descarga al abrir (o pre-cargar) el dialog.
const NewGuestForm = dynamic(
  () =>
    import("@/components/forms/guest/new-guest-form").then(
      (m) => m.NewGuestForm
    ),
  { ssr: false, loading: () => <GuestFormSkeleton /> }
);

/** Pre-descarga el chunk del form para que abrir el dialog se sienta instantáneo. */
function preloadGuestForm() {
  void import("@/components/forms/guest/new-guest-form");
}

/** Placeholder con la misma estructura del form para evitar saltos de layout. */
function GuestFormSkeleton() {
  return (
    <div className="space-y-4 mt-2" aria-busy="true">
      {/* Nombre completo */}
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-full" />
      </div>
      {/* Documento */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
      {/* Email + Teléfono */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
      {/* País / Provincia / Ciudad */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
      {/* Notas */}
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-16 w-full" />
      </div>
      {/* Botones */}
      <div className="flex justify-end gap-2 pt-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}

interface GuestFormDialogProps {
  children: React.ReactNode;
  /** Si se pasa, el dialog actúa como "Editar huésped". */
  guest?: Guest;
  onCreated?: (g: Guest) => void;
}

export function GuestFormDialog({ children, guest, onCreated }: GuestFormDialogProps) {
  const [open, setOpen] = useState(false);
  const isEdit = !!guest;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        asChild
        onMouseEnter={preloadGuestForm}
        onFocus={preloadGuestForm}
      >
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar huésped" : "Nuevo huésped"}</DialogTitle>
        </DialogHeader>

        <NewGuestForm
          guest={guest}
          onCancel={() => setOpen(false)}
          onSubmitted={(g) => {
            setOpen(false);
            onCreated?.(g);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
