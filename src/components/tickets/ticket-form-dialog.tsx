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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createTicket, updateTicket, type TicketInput } from "@/lib/actions/tickets";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import type { MaintenanceTicket, Unit, Owner } from "@/lib/types/database";

interface Props {
  children: React.ReactNode;
  ticket?: MaintenanceTicket;
  units: Pick<Unit, "id" | "code" | "name">[];
  owners: Owner[];
  defaultUnitId?: string;
}

export function TicketFormDialog({ children, ticket, units, owners, defaultUnitId }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!ticket;

  const [form, setForm] = useState<TicketInput>({
    unit_id: ticket?.unit_id ?? defaultUnitId ?? "",
    title: ticket?.title ?? "",
    description: ticket?.description ?? "",
    category: ticket?.category ?? "",
    priority: ticket?.priority ?? "media",
    status: ticket?.status ?? "abierto",
    assigned_to: ticket?.assigned_to ?? null,
    estimated_cost: ticket?.estimated_cost ?? null,
    actual_cost: ticket?.actual_cost ?? null,
    cost_currency: ticket?.cost_currency ?? "ARS",
    billable_to: ticket?.billable_to ?? "apartcba",
    related_owner_id: ticket?.related_owner_id ?? null,
    notes: ticket?.notes ?? "",
  });

  function set<K extends keyof TicketInput>(k: K, v: TicketInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (isEdit && ticket) {
          await updateTicket(ticket.id, form);
          toast.success("Ticket actualizado");
        } else {
          await createTicket(form);
          toast.success("Ticket creado");
        }
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
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar ticket" : "Nuevo ticket"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Unidad *</Label>
            <Select value={form.unit_id} onValueChange={(v) => set("unit_id", v)} required>
              <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
              <SelectContent className="max-h-72">
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    <span className="font-mono text-xs mr-2">{u.code}</span>{u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Título *</Label>
            <Input id="title" required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Termotanque sin agua caliente" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v as TicketInput["priority"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TICKET_PRIORITY_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <span className="status-dot" style={{ backgroundColor: m.color }} />
                        {m.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as TicketInput["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TICKET_STATUS_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={form.category ?? ""} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plomeria">Plomería</SelectItem>
                  <SelectItem value="electricidad">Electricidad</SelectItem>
                  <SelectItem value="electrodomestico">Electrodoméstico</SelectItem>
                  <SelectItem value="pintura">Pintura</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label>Costo estimado</Label>
              <Input type="number" min="0" step="0.01" value={form.estimated_cost ?? ""} onChange={(e) => set("estimated_cost", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Costo real</Label>
              <Input type="number" min="0" step="0.01" value={form.actual_cost ?? ""} onChange={(e) => set("actual_cost", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Lo paga</Label>
              <Select value={form.billable_to} onValueChange={(v) => set("billable_to", v as TicketInput["billable_to"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="apartcba">Apart Cba (absorbe)</SelectItem>
                  <SelectItem value="owner">Propietario (se descuenta de la liquidación)</SelectItem>
                  <SelectItem value="guest">Huésped (se cobra)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.billable_to === "owner" && (
              <div className="space-y-1.5">
                <Label>Propietario</Label>
                <Select value={form.related_owner_id ?? ""} onValueChange={(v) => set("related_owner_id", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {owners.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              {isEdit ? "Guardar" : "Crear ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
