"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Bell,
  BellOff,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  Trash2,
  User,
  User2,
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
  getTaskAlertSnapshot,
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

type Member = { user_id: string; full_name: string | null };

type CR = ConciergeRequest & {
  unit: Pick<Unit, "id" | "code" | "name"> | null;
  guest: Pick<Guest, "id" | "full_name"> | null;
  assignee?: Member | null;
};

function isoToLocalParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

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

const ALERT_OFFSETS = [
  { value: 0, label: "Justo en el momento" },
  { value: 1, label: "1 hora antes" },
  { value: 3, label: "3 horas antes" },
  { value: 24, label: "1 día antes" },
  { value: 72, label: "3 días antes" },
  { value: 168, label: "1 semana antes" },
];

interface Props {
  request: CR | null;
  units: Pick<Unit, "id" | "code" | "name">[];
  members?: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (req: CR) => void;
  onDeleted?: (id: string) => void;
}

export function ConciergeDetailDialog({
  request,
  units,
  members = [],
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
          assigned_to: r.assigned_to,
          unit_id: r.unit_id,
          cost: r.cost,
          cost_currency: r.cost_currency ?? "ARS",
          charge_to_guest: r.charge_to_guest,
          scheduled_for: r.scheduled_for,
          notes: r.notes ?? "",
        }
      : {};
  const [prevRequestId, setPrevRequestId] = useState<string | null>(request?.id ?? null);
  const [form, setForm] = useState<Partial<ConciergeInput>>(() => buildForm(request));
  const initialParts = isoToLocalParts(request?.scheduled_for ?? null);
  const [scheduledDate, setScheduledDate] = useState(initialParts.date);
  const [scheduledTime, setScheduledTime] = useState(initialParts.time);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertSeverity, setAlertSeverity] = useState<
    "info" | "warning" | "critical"
  >("info");
  const [alertOffsetHours, setAlertOffsetHours] = useState(24);
  const [alertLoaded, setAlertLoaded] = useState(false);
  if (request && request.id !== prevRequestId) {
    setPrevRequestId(request.id);
    setForm(buildForm(request));
    const p = isoToLocalParts(request.scheduled_for ?? null);
    setScheduledDate(p.date);
    setScheduledTime(p.time);
    setConfirmDelete(false);
    setAlertLoaded(false);
    setAlertEnabled(false);
  }

  // Hidratar el estado de la alerta al abrir esta tarea (snapshot del notification).
  useEffect(() => {
    if (!request || alertLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getTaskAlertSnapshot(request.id);
        if (cancelled) return;
        if (snap) {
          setAlertEnabled(snap.enabled);
          setAlertSeverity(snap.severity);
          setAlertOffsetHours(snap.offsetHours);
        } else {
          setAlertEnabled(false);
        }
      } catch {
        if (!cancelled) setAlertEnabled(false);
      } finally {
        if (!cancelled) setAlertLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, alertLoaded]);

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

  function saveDetails(extra?: Partial<ConciergeInput>) {
    const payload = { ...form, ...(extra ?? {}) };
    startTransition(async () => {
      try {
        const updated = await updateConciergeRequest(request!.id, payload);
        onUpdated?.({ ...request!, ...updated });
        toast.success("Cambios guardados");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function commitSchedule(date: string, time: string) {
    let scheduled_for: string | null = null;
    if (date) {
      const t = time || "09:00";
      scheduled_for = new Date(`${date}T${t}:00`).toISOString();
    }
    set("scheduled_for", scheduled_for);
    saveDetails({
      scheduled_for,
      alert_enabled: alertEnabled,
      alert_severity: alertSeverity,
      alert_offset_hours: alertOffsetHours,
    });
  }

  function commitAlert(next: {
    enabled?: boolean;
    severity?: "info" | "warning" | "critical";
    offsetHours?: number;
  }) {
    const enabled = next.enabled ?? alertEnabled;
    const severity = next.severity ?? alertSeverity;
    const offsetHours = next.offsetHours ?? alertOffsetHours;
    if (enabled && !form.scheduled_for) {
      toast.error("Cargá día y hora antes de activar la alerta");
      return;
    }
    setAlertEnabled(enabled);
    setAlertSeverity(severity);
    setAlertOffsetHours(offsetHours);
    saveDetails({
      alert_enabled: enabled,
      alert_severity: severity,
      alert_offset_hours: offsetHours,
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
                  onBlur={() => saveDetails()}
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

          {/* Asignación */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <User2 size={12} /> Asignada a
            </Label>
            <Select
              value={form.assigned_to ?? ""}
              onValueChange={(v) => {
                const next = v || null;
                set("assigned_to", next);
                saveDetails({ assigned_to: next });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin asignar" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name ?? "Usuario sin nombre"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Schedule */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <CalendarClock size={12} /> Programada para
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setScheduledDate(v);
                  commitSchedule(v, scheduledTime);
                }}
              />
              <Input
                type="time"
                value={scheduledTime}
                disabled={!scheduledDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setScheduledTime(v);
                  commitSchedule(scheduledDate, v);
                }}
              />
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
                  onBlur={() => saveDetails()}
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

          {/* Alerta */}
          <div
            className={cn(
              "rounded-lg border p-3 space-y-3 transition-colors",
              alertEnabled
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-muted/20"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <div
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md shrink-0",
                    alertEnabled
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {alertEnabled ? <Bell size={14} /> : <BellOff size={14} />}
                </div>
                <div className="min-w-0">
                  <Label className="cursor-pointer text-sm font-medium">
                    Alerta vinculada
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {alertEnabled
                      ? "Aparece en el centro de alertas y la campanita."
                      : "Activala para recibir un recordatorio antes de que la tarea ocurra."}
                  </p>
                </div>
              </div>
              <Switch
                checked={alertEnabled}
                disabled={!alertLoaded || isPending}
                onCheckedChange={(v) => commitAlert({ enabled: v })}
              />
            </div>

            {alertEnabled && (
              <div className="space-y-2 pl-9">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Cuándo avisar
                    </Label>
                    <Select
                      value={String(alertOffsetHours)}
                      onValueChange={(v) =>
                        commitAlert({ offsetHours: Number(v) })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALERT_OFFSETS.map((o) => (
                          <SelectItem key={o.value} value={String(o.value)}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Severidad
                    </Label>
                    <Select
                      value={alertSeverity}
                      onValueChange={(v) =>
                        commitAlert({
                          severity: v as "info" | "warning" | "critical",
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">
                          <span className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-sky-500" />
                            Informativa
                          </span>
                        </SelectItem>
                        <SelectItem value="warning">
                          <span className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-amber-500" />
                            Atención
                          </span>
                        </SelectItem>
                        <SelectItem value="critical">
                          <span className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-rose-500" />
                            Crítica
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {!form.scheduled_for && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    La alerta queda silenciada hasta que cargues día y hora.
                  </p>
                )}
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
              onBlur={() => saveDetails()}
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
