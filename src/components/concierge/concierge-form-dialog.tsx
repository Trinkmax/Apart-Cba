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

type Member = { user_id: string; full_name: string | null };

export function ConciergeFormDialog({
  children,
  units,
  members = [],
}: {
  children: React.ReactNode;
  units: Pick<Unit, "id" | "code" | "name">[];
  members?: Member[];
}) {
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
    assigned_to: null,
    cost: null,
    cost_currency: "ARS",
    charge_to_guest: false,
    scheduled_for: null,
    notes: "",
  });
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  function set<K extends keyof ConciergeInput>(k: K, v: ConciergeInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let scheduled_for: string | null = null;
    if (scheduledDate) {
      const time = scheduledTime || "09:00";
      // Local time → ISO. El timestamptz se almacena en UTC pero respetando tz local.
      const localIso = new Date(`${scheduledDate}T${time}:00`).toISOString();
      scheduled_for = localIso;
    }
    const payload = { ...form, scheduled_for };
    startTransition(async () => {
      try {
        await createConciergeRequest(payload);
        toast.success("Tarea creada");
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
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nueva tarea</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Descripción *</Label>
            <Textarea required autoFocus rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Hacer contrato Perón, transfer al aeropuerto..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.request_type ?? ""} onValueChange={(v) => set("request_type", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contrato">Contrato</SelectItem>
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
            <Label>Asignar a</Label>
            <Select value={form.assigned_to ?? ""} onValueChange={(v) => set("assigned_to", v || null)}>
              <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name ?? "Usuario sin nombre"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Día</Label>
              <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Hora</Label>
              <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} disabled={!scheduledDate} />
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
              Crear tarea
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
