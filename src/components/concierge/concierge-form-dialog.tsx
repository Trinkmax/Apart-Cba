"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createConciergeRequest, type ConciergeInput } from "@/lib/actions/concierge";
import type { Unit } from "@/lib/types/database";

export function ConciergeFormDialog({ children, units }: { children: React.ReactNode; units: Pick<Unit, "id" | "code" | "name">[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [form, setForm] = useState<ConciergeInput>({
    unit_id: null,
    booking_id: null,
    guest_id: null,
    request_type: "",
    description: "",
    status: "pendiente",
    priority: "normal",
    cost: null,
    cost_currency: "ARS",
    charge_to_guest: false,
    scheduled_for: null,
    notes: "",
  });

  function set<K extends keyof ConciergeInput>(k: K, v: ConciergeInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createConciergeRequest(form);
        toast.success("Pedido creado");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nuevo pedido</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Descripción *</Label>
            <Textarea required autoFocus rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Late check-out hasta las 14, transfer al aeropuerto..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.request_type ?? ""} onValueChange={(v) => set("request_type", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="late_checkout">Late check-out</SelectItem>
                  <SelectItem value="early_checkin">Early check-in</SelectItem>
                  <SelectItem value="extra_towels">Toallas extra</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="tour">Tour / actividad</SelectItem>
                  <SelectItem value="restaurant_booking">Reserva resto</SelectItem>
                  <SelectItem value="grocery">Compras / mercado</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v as ConciergeInput["priority"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baja">Baja</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Unidad (opcional)</Label>
            <Select value={form.unit_id ?? ""} onValueChange={(v) => set("unit_id", v || null)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    <span className="font-mono mr-2 text-xs">{u.code}</span>{u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Costo</Label>
              <Input type="number" min="0" step="0.01" value={form.cost ?? ""} onChange={(e) => set("cost", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="charge" className="cursor-pointer text-xs">Cobrar al huésped</Label>
              <Switch id="charge" checked={form.charge_to_guest} onCheckedChange={(v) => set("charge_to_guest", v)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              Crear pedido
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
