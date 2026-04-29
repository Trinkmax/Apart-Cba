"use client";

import { useState, useTransition } from "react";
import {
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  Trash2,
  User,
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  changeConciergeStatus,
  deleteConciergeRequest,
  updateConciergeRequest,
  type ConciergeInput,
} from "@/lib/actions/concierge";
import { formatMoney, formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ConciergePriority,
  ConciergeRequest,
  ConciergeStatus,
  Guest,
  Unit,
} from "@/lib/types/database";

type CR = ConciergeRequest & {
  unit: Pick<Unit, "id" | "code" | "name"> | null;
  guest: Pick<Guest, "id" | "full_name"> | null;
};

const STATUS_META: Record<
  ConciergeStatus,
  { label: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  pendiente: { label: "Pendiente", color: "#94a3b8", icon: Clock },
  en_progreso: { label: "En progreso", color: "#3b82f6", icon: Sparkles },
  completada: { label: "Completada", color: "#10b981", icon: CheckCircle2 },
  rechazada: { label: "Rechazada", color: "#ef4444", icon: X },
  cancelada: { label: "Cancelada", color: "#64748b", icon: X },
};

const PRIORITY_META: Record<ConciergePriority, { label: string; color: string }> = {
  baja: { label: "Baja", color: "#64748b" },
  normal: { label: "Normal", color: "#3b82f6" },
  alta: { label: "Alta", color: "#f59e0b" },
  urgente: { label: "Urgente", color: "#ef4444" },
};

interface Props {
  request: CR | null;
  units: Pick<Unit, "id" | "code" | "name">[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (req: CR) => void;
  onDeleted?: (id: string) => void;
}

export function ConciergeDetailDialog({
  request,
  units,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Inicialización derivada del prop `request` con el patrón "previous value".
  const buildForm = (r: typeof request): Partial<ConciergeInput> =>
    r
      ? {
          description: r.description,
          request_type: r.request_type ?? "",
          priority: r.priority,
          unit_id: r.unit_id,
          cost: r.cost,
          cost_currency: r.cost_currency ?? "ARS",
          charge_to_guest: r.charge_to_guest,
          notes: r.notes ?? "",
        }
      : {};
  const [prevRequestId, setPrevRequestId] = useState<string | null>(request?.id ?? null);
  const [form, setForm] = useState<Partial<ConciergeInput>>(() => buildForm(request));
  if (request && request.id !== prevRequestId) {
    setPrevRequestId(request.id);
    setForm(buildForm(request));
    setConfirmDelete(false);
  }

  if (!request) return null;

  const meta = STATUS_META[request.status];
  const Icon = meta.icon;
  const pm = PRIORITY_META[request.priority];

  function set<K extends keyof ConciergeInput>(k: K, v: ConciergeInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function changeStatus(s: ConciergeStatus) {
    startTransition(async () => {
      try {
        await changeConciergeStatus(request!.id, s);
        onUpdated?.({ ...request!, status: s });
        toast.success("Estado actualizado");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function saveDetails() {
    startTransition(async () => {
      try {
        const updated = await updateConciergeRequest(request!.id, form);
        onUpdated?.({ ...request!, ...updated });
        toast.success("Cambios guardados");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteConciergeRequest(request!.id);
        onDeleted?.(request!.id);
        toast.success("Pedido eliminado");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        <div className="h-1.5 w-full" style={{ backgroundColor: meta.color }} aria-hidden />
        <DialogHeader className="px-6 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <span
              className="size-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: meta.color + "1a", color: meta.color }}
            >
              <Icon size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base leading-tight">
                <Textarea
                  value={form.description ?? ""}
                  onChange={(e) => set("description", e.target.value)}
                  onBlur={saveDetails}
                  rows={2}
                  className="resize-none border-0 px-0 py-0 shadow-none focus-visible:ring-0 text-base font-semibold"
                />
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge
                  variant="outline"
                  className="font-mono gap-1.5"
                  style={{ borderColor: meta.color + "40", color: meta.color }}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                  {meta.label}
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
                  <Clock size={12} /> {formatTimeAgo(request.created_at)}
                </span>
                {request.guest && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <User size={12} /> {request.guest.full_name}
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        <div className="px-6 py-5 space-y-5">
          {/* Status pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Mover a:</span>
            {(Object.keys(STATUS_META) as ConciergeStatus[]).map((s) => {
              const m = STATUS_META[s];
              const isCur = request.status === s;
              return (
                <button
                  key={s}
                  disabled={isCur || isPending}
                  onClick={() => changeStatus(s)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-all border",
                    isCur ? "opacity-50 cursor-default" : "hover:scale-[1.03] active:scale-95"
                  )}
                  style={{
                    backgroundColor: isCur ? m.color + "20" : m.color + "0d",
                    color: m.color,
                    borderColor: m.color + (isCur ? "60" : "30"),
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Type & priority */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Tipo
              </Label>
              <Select
                value={form.request_type ?? ""}
                onValueChange={(v) => {
                  set("request_type", v);
                  setTimeout(saveDetails, 0);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
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
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Prioridad
              </Label>
              <Select
                value={form.priority ?? "normal"}
                onValueChange={(v) => {
                  set("priority", v as ConciergePriority);
                  setTimeout(saveDetails, 0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_META).map(([k, m]) => (
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
            </div>
          </div>

          {/* Unit */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Building2 size={12} /> Unidad
            </Label>
            <Select
              value={form.unit_id ?? ""}
              onValueChange={(v) => {
                set("unit_id", v || null);
                setTimeout(saveDetails, 0);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    <span className="font-mono mr-2 text-xs">{u.code}</span>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cost & charge */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Facturación
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Costo</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.cost ?? ""}
                  onChange={(e) =>
                    set("cost", e.target.value === "" ? null : Number(e.target.value))
                  }
                  onBlur={saveDetails}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 h-10 bg-background">
                <Label className="cursor-pointer text-xs">Cobrar al huésped</Label>
                <Switch
                  checked={form.charge_to_guest ?? false}
                  onCheckedChange={(v) => {
                    set("charge_to_guest", v);
                    setTimeout(saveDetails, 0);
                  }}
                />
              </div>
            </div>
            {request.cost !== null && request.cost !== undefined && (
              <div className="text-sm font-semibold tabular-nums text-right">
                {formatMoney(request.cost, request.cost_currency ?? "ARS")}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notas internas
            </Label>
            <Textarea
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              onBlur={saveDetails}
            />
          </div>
        </div>

        <Separator />

        <DialogFooter className="px-6 py-4 sm:justify-between">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive font-medium">¿Eliminar pedido?</span>
              <Button size="sm" variant="destructive" disabled={isPending} onClick={handleDelete}>
                {isPending && <Loader2 className="animate-spin" size={14} />}
                Sí
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                No
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
