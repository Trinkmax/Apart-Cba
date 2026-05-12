"use client";

import { useState, useTransition } from "react";
import { CircleCheck, Loader2, MessageCircle, Phone, UserCheck } from "lucide-react";
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
import type { CurrentOccupancy } from "@/lib/actions/bookings";

interface Props {
  children: React.ReactNode;
  ticket?: MaintenanceTicket;
  units: Pick<Unit, "id" | "code" | "name">[];
  owners: Owner[];
  defaultUnitId?: string;
  occupancyByUnit?: Record<string, CurrentOccupancy>;
}

export function TicketFormDialog({ children, ticket, units, owners, defaultUnitId, occupancyByUnit }: Props) {
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
            {form.unit_id && occupancyByUnit && (
              <OccupancyPanel occupancy={occupancyByUnit[form.unit_id] ?? null} />
            )}
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
                  <SelectItem value="apartcba">rentOS (absorbe)</SelectItem>
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

function OccupancyPanel({ occupancy }: { occupancy: CurrentOccupancy | null }) {
  if (!occupancy) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <CircleCheck size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="font-medium text-emerald-900 dark:text-emerald-200">Disponible</span>
        <span className="text-emerald-700/70 dark:text-emerald-300/70">— sin huéspedes en el depto</span>
      </div>
    );
  }

  const isMonthly = occupancy.mode === "mensual";
  const label = isMonthly ? "Inquilino" : "Huésped";
  const statusLabel = occupancy.status === "check_in" ? "Ocupado" : "Reservado";

  const phone = occupancy.guest_phone?.trim() ?? "";
  const phoneDigits = phone.replace(/\D/g, "");
  const waHref = phoneDigits ? `https://wa.me/${phoneDigits}` : null;
  const telHref = phone ? `tel:${phone}` : null;

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
      <div className="flex items-center gap-2">
        <UserCheck size={14} className="text-amber-700 dark:text-amber-400 shrink-0" />
        <span className="font-semibold text-amber-900 dark:text-amber-200">{statusLabel}</span>
        <span className="text-amber-700/70 dark:text-amber-300/70">
          · {label} hasta {formatShortDate(occupancy.check_out_date)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 pl-6">
        <div className="min-w-0">
          <div className="font-medium text-foreground truncate">
            {occupancy.guest_name ?? "Sin nombre"}
          </div>
          {phone ? (
            <div className="text-muted-foreground tabular-nums">{phone}</div>
          ) : (
            <div className="italic text-muted-foreground">Sin teléfono cargado</div>
          )}
        </div>
        {phone && (
          <div className="flex items-center gap-1 shrink-0">
            {telHref && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-[11px]"
                title="Llamar"
              >
                <a href={telHref}>
                  <Phone size={12} /> Llamar
                </a>
              </Button>
            )}
            {waHref && (
              <Button
                asChild
                size="sm"
                className="h-7 gap-1 bg-[#25D366] px-2 text-[11px] text-white hover:bg-[#1fb955]"
                title="Coordinar por WhatsApp"
              >
                <a href={waHref} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={12} /> WhatsApp
                </a>
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 pl-6 text-[11px] leading-snug text-amber-800/70 dark:text-amber-300/70">
        Coordiná día y horario del arreglo directamente con {isMonthly ? "el inquilino" : "el huésped"}.
      </p>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}
