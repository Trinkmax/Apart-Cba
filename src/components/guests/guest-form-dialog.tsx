"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createGuest, updateGuest, type GuestInput } from "@/lib/actions/guests";
import type { Guest } from "@/lib/types/database";

interface GuestFormDialogProps {
  children: React.ReactNode;
  guest?: Guest;
  onCreated?: (g: Guest) => void;
}

export function GuestFormDialog({ children, guest, onCreated }: GuestFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!guest;

  const [form, setForm] = useState<GuestInput>({
    full_name: guest?.full_name ?? "",
    document_type: guest?.document_type ?? "DNI",
    document_number: guest?.document_number ?? "",
    email: guest?.email ?? "",
    phone: guest?.phone ?? "",
    country: guest?.country ?? "AR",
    city: guest?.city ?? "",
    birth_date: guest?.birth_date ?? "",
    notes: guest?.notes ?? "",
  });

  function set<K extends keyof GuestInput>(k: K, v: GuestInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Evita que el submit burbujee a un <form> padre en el árbol de React
    // (p. ej. cuando este diálogo se abre dentro de BookingFormDialog).
    e.stopPropagation();
    startTransition(async () => {
      try {
        const result = isEdit && guest ? await updateGuest(guest.id, form) : await createGuest(form);
        toast.success(isEdit ? "Huésped actualizado" : "Huésped creado");
        setOpen(false);
        onCreated?.(result);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar huésped" : "Nuevo huésped"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Nombre completo *</Label>
            <Input
              id="full_name"
              required autoFocus
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="María González"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo doc.</Label>
              <Select value={form.document_type ?? "DNI"} onValueChange={(v) => set("document_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DNI">DNI</SelectItem>
                  <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                  <SelectItem value="CUIT">CUIT</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Número</Label>
              <Input
                value={form.document_number ?? ""}
                onChange={(e) => set("document_number", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="+54..." />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>País</Label>
              <Input value={form.country ?? "AR"} onChange={(e) => set("country", e.target.value)} maxLength={3} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Ciudad</Label>
              <Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Preferencias, alergias, observaciones…"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              {isEdit ? "Guardar" : "Crear huésped"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
