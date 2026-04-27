"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  Pencil,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  changeTicketStatus,
  deleteTicket,
  updateTicket,
  type TicketInput,
} from "@/lib/actions/tickets";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { formatDate, formatMoney, formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MaintenanceTicket, Owner, TicketStatus, Unit } from "@/lib/types/database";

type TicketWithUnit = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

interface Props {
  ticket: TicketWithUnit | null;
  units: Pick<Unit, "id" | "code" | "name">[];
  owners: Owner[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (updated: MaintenanceTicket) => void;
  onDeleted?: (id: string) => void;
}

const STATUS_ICON: Record<TicketStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  abierto: AlertTriangle,
  en_progreso: Wrench,
  esperando_repuesto: Package,
  resuelto: CheckCircle2,
  cerrado: CheckCircle2,
};

export function TicketDetailDialog({
  ticket,
  units,
  owners,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState<TicketInput | null>(null);

  useEffect(() => {
    if (ticket) {
      setForm({
        unit_id: ticket.unit_id,
        title: ticket.title,
        description: ticket.description ?? "",
        category: ticket.category ?? "",
        priority: ticket.priority,
        status: ticket.status,
        assigned_to: ticket.assigned_to ?? null,
        estimated_cost: ticket.estimated_cost ?? null,
        actual_cost: ticket.actual_cost ?? null,
        cost_currency: ticket.cost_currency ?? "ARS",
        billable_to: ticket.billable_to,
        related_owner_id: ticket.related_owner_id ?? null,
        notes: ticket.notes ?? "",
      });
      setIsEditing(false);
      setConfirmDelete(false);
    }
  }, [ticket]);

  if (!ticket || !form) return null;

  const sm = TICKET_STATUS_META[ticket.status];
  const pm = TICKET_PRIORITY_META[ticket.priority];

  function set<K extends keyof TicketInput>(k: K, v: TicketInput[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function handleStatusChange(next: TicketStatus) {
    if (!ticket) return;
    startTransition(async () => {
      try {
        await changeTicketStatus(ticket.id, next);
        onUpdated?.({ ...ticket, status: next });
        toast.success("Estado actualizado");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleSave() {
    if (!ticket || !form) return;
    startTransition(async () => {
      try {
        const updated = await updateTicket(ticket.id, form);
        onUpdated?.(updated);
        toast.success("Ticket actualizado");
        setIsEditing(false);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleDelete() {
    if (!ticket) return;
    startTransition(async () => {
      try {
        await deleteTicket(ticket.id);
        onDeleted?.(ticket.id);
        toast.success("Ticket eliminado");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        {/* Header con barra de prioridad */}
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: pm.color }}
          aria-hidden
        />
        <DialogHeader className="px-6 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <span
              className="size-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: sm.color + "1a", color: sm.color }}
            >
              {(() => {
                const Icon = STATUS_ICON[ticket.status];
                return <Icon size={18} />;
              })()}
            </span>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg leading-tight">
                {isEditing ? (
                  <Input
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    className="text-lg font-semibold"
                  />
                ) : (
                  ticket.title
                )}
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge
                  variant="outline"
                  className="font-mono gap-1.5"
                  style={{ borderColor: sm.color + "40", color: sm.color }}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: sm.color }}
                  />
                  {sm.label}
                </Badge>
                <Badge
                  className="text-[10px] gap-1 border"
                  style={{
                    color: pm.color,
                    backgroundColor: pm.color + "15",
                    borderColor: pm.color + "40",
                  }}
                >
                  {pm.label}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock size={12} /> {formatTimeAgo(ticket.opened_at)}
                </span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        <div className="px-6 py-5 space-y-5">
          {/* Cambio rápido de estado (chips) */}
          {!isEditing && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Mover a:</span>
              {(Object.keys(TICKET_STATUS_META) as TicketStatus[]).map((s) => {
                const m = TICKET_STATUS_META[s];
                const isCurrent = ticket.status === s;
                return (
                  <button
                    key={s}
                    disabled={isCurrent || isPending}
                    onClick={() => handleStatusChange(s)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium transition-all border",
                      isCurrent
                        ? "opacity-50 cursor-default"
                        : "hover:scale-[1.03] active:scale-95"
                    )}
                    style={{
                      backgroundColor: isCurrent ? m.color + "20" : m.color + "0d",
                      color: m.color,
                      borderColor: m.color + (isCurrent ? "60" : "30"),
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Unidad */}
          <Field label="Unidad" icon={<Building2 size={13} />}>
            {isEditing ? (
              <Select value={form.unit_id} onValueChange={(v) => set("unit_id", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      <span className="font-mono text-xs mr-2">{u.code}</span>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono font-semibold">{ticket.unit.code}</span>
                <span className="text-muted-foreground">·</span>
                <span>{ticket.unit.name}</span>
              </div>
            )}
          </Field>

          {/* Descripción */}
          <Field label="Descripción">
            {isEditing ? (
              <Textarea
                value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                rows={3}
                placeholder="Detalles del problema..."
              />
            ) : ticket.description ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {ticket.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">Sin descripción</p>
            )}
          </Field>

          {/* Grid: prioridad / categoría */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Prioridad">
              {isEditing ? (
                <Select
                  value={form.priority}
                  onValueChange={(v) => set("priority", v as TicketInput["priority"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TICKET_PRIORITY_META).map(([k, m]) => (
                      <SelectItem key={k} value={k}>
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: m.color }}
                          />
                          {m.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm font-medium" style={{ color: pm.color }}>
                  {pm.label}
                </span>
              )}
            </Field>
            <Field label="Categoría">
              {isEditing ? (
                <Select
                  value={form.category ?? ""}
                  onValueChange={(v) => set("category", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plomeria">Plomería</SelectItem>
                    <SelectItem value="electricidad">Electricidad</SelectItem>
                    <SelectItem value="electrodomestico">Electrodoméstico</SelectItem>
                    <SelectItem value="pintura">Pintura</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm capitalize">{ticket.category ?? "—"}</span>
              )}
            </Field>
          </div>

          {/* Costos / billing */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Costos y facturación
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Costo estimado">
                {isEditing ? (
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.estimated_cost ?? ""}
                    onChange={(e) =>
                      set(
                        "estimated_cost",
                        e.target.value === "" ? null : Number(e.target.value)
                      )
                    }
                  />
                ) : (
                  <span className="text-sm tabular-nums">
                    {formatMoney(ticket.estimated_cost, ticket.cost_currency ?? "ARS")}
                  </span>
                )}
              </Field>
              <Field label="Costo real">
                {isEditing ? (
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.actual_cost ?? ""}
                    onChange={(e) =>
                      set(
                        "actual_cost",
                        e.target.value === "" ? null : Number(e.target.value)
                      )
                    }
                  />
                ) : (
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoney(ticket.actual_cost, ticket.cost_currency ?? "ARS")}
                  </span>
                )}
              </Field>
            </div>
            <Field label="Lo paga">
              {isEditing ? (
                <Select
                  value={form.billable_to}
                  onValueChange={(v) =>
                    set("billable_to", v as TicketInput["billable_to"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apartcba">Apart Cba (absorbe)</SelectItem>
                    <SelectItem value="owner">Propietario</SelectItem>
                    <SelectItem value="guest">Huésped</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline" className="text-xs">
                  {ticket.billable_to === "apartcba"
                    ? "Apart Cba"
                    : ticket.billable_to === "owner"
                    ? "Propietario"
                    : "Huésped"}
                </Badge>
              )}
            </Field>
            {form.billable_to === "owner" && isEditing && (
              <Field label="Propietario">
                <Select
                  value={form.related_owner_id ?? ""}
                  onValueChange={(v) => set("related_owner_id", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {owners.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          {/* Notas internas */}
          {(isEditing || ticket.notes) && (
            <Field label="Notas internas">
              {isEditing ? (
                <Textarea
                  value={form.notes ?? ""}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={2}
                />
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {ticket.notes}
                </p>
              )}
            </Field>
          )}

          {/* Meta */}
          <div className="text-[11px] text-muted-foreground flex items-center gap-3 pt-1">
            <span>Abierto: {formatDate(ticket.opened_at)}</span>
            {ticket.resolved_at && (
              <span>· Resuelto: {formatDate(ticket.resolved_at)}</span>
            )}
          </div>
        </div>

        <Separator />

        <DialogFooter className="px-6 py-4 gap-2 sm:justify-between">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive font-medium">¿Eliminar definitivamente?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={handleDelete}
              >
                {isPending && <Loader2 className="animate-spin" size={14} />}
                Sí, eliminar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} /> Eliminar
            </Button>
          )}

          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  <X size={14} /> Cancelar
                </Button>
                <Button onClick={handleSave} disabled={isPending}>
                  {isPending && <Loader2 className="animate-spin" size={14} />}
                  Guardar cambios
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Pencil size={14} /> Editar
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      {children}
    </div>
  );
}
