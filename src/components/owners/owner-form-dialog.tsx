"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { createOwner, updateOwner, type OwnerInput } from "@/lib/actions/owners";
import type { Owner } from "@/lib/types/database";

interface OwnerFormDialogProps {
  children: React.ReactNode;
  owner?: Owner;
}

export function OwnerFormDialog({ children, owner }: OwnerFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!owner;

  const [form, setForm] = useState<OwnerInput>({
    full_name: owner?.full_name ?? "",
    document_type: owner?.document_type ?? "DNI",
    document_number: owner?.document_number ?? "",
    email: owner?.email ?? "",
    phone: owner?.phone ?? "",
    address: owner?.address ?? "",
    city: owner?.city ?? "Córdoba",
    cbu: owner?.cbu ?? "",
    alias_cbu: owner?.alias_cbu ?? "",
    bank_name: owner?.bank_name ?? "",
    preferred_currency: owner?.preferred_currency ?? "ARS",
    notes: owner?.notes ?? "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (isEdit && owner) {
          await updateOwner(owner.id, form);
          toast.success("Propietario actualizado");
        } else {
          await createOwner(form);
          toast.success("Propietario creado");
        }
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function set<K extends keyof OwnerInput>(key: K, value: OwnerInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar propietario" : "Nuevo propietario"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Actualizá los datos del propietario."
              : "Cargá los datos personales y bancarios para liquidaciones."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Nombre completo *</Label>
            <Input
              id="full_name"
              required
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="Juan Pérez"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="document_type">Tipo doc.</Label>
              <Select
                value={form.document_type ?? "DNI"}
                onValueChange={(v) => set("document_type", v)}
              >
                <SelectTrigger id="document_type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DNI">DNI</SelectItem>
                  <SelectItem value="CUIT">CUIT</SelectItem>
                  <SelectItem value="CUIL">CUIL</SelectItem>
                  <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="document_number">Número</Label>
              <Input
                id="document_number"
                value={form.document_number ?? ""}
                onChange={(e) => set("document_number", e.target.value)}
                placeholder="20-12345678-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                placeholder="juan@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+54 351 123 4567"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Dirección</Label>
              <Input
                id="address"
                value={form.address ?? ""}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Av. Colón 1234"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">Ciudad</Label>
              <Input
                id="city"
                value={form.city ?? ""}
                onChange={(e) => set("city", e.target.value)}
              />
            </div>
          </div>

          <div className="border-t pt-5 space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Datos bancarios para liquidación
            </Label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bank_name">Banco</Label>
                <Input
                  id="bank_name"
                  value={form.bank_name ?? ""}
                  onChange={(e) => set("bank_name", e.target.value)}
                  placeholder="Galicia, Macro, MP, etc"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="preferred_currency">Cobra en</Label>
                <Select
                  value={form.preferred_currency ?? "ARS"}
                  onValueChange={(v) => set("preferred_currency", v)}
                >
                  <SelectTrigger id="preferred_currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ARS">ARS — Pesos</SelectItem>
                    <SelectItem value="USD">USD — Dólares</SelectItem>
                    <SelectItem value="EUR">EUR — Euros</SelectItem>
                    <SelectItem value="USDT">USDT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cbu">CBU</Label>
                <Input
                  id="cbu"
                  value={form.cbu ?? ""}
                  onChange={(e) => set("cbu", e.target.value)}
                  placeholder="22 dígitos"
                  maxLength={22}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alias_cbu">Alias CBU</Label>
                <Input
                  id="alias_cbu"
                  value={form.alias_cbu ?? ""}
                  onChange={(e) => set("alias_cbu", e.target.value)}
                  placeholder="juan.perez.gal"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas</Label>
            <Textarea
              id="notes"
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Información adicional…"
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2 mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? "Guardar cambios" : "Crear propietario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
