"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NewGuestForm } from "@/components/forms/guest/new-guest-form";
import type { Guest } from "@/lib/types/database";

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
      <DialogTrigger asChild>{children}</DialogTrigger>
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
