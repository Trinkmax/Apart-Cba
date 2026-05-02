"use client";

import { useState, useTransition, useMemo } from "react";
import { Loader2, Bell, BellOff } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { Unit } from "@/lib/types/database";

const ALERT_OFFSETS = [
  { value: 0, label: "Justo en el momento" },
  { value: 1, label: "1 hora antes" },
  { value: 3, label: "3 horas antes" },
  { value: 24, label: "1 día antes" },
  { value: 72, label: "3 días antes" },
  { value: 168, label: "1 semana antes" },
];

const SEVERITY_META = {
  info: { label: "Informativa", color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-500/10 border-sky-500/30" },
  warning: { label: "Atención", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
  critical: { label: "Crítica", color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10 border-rose-500/30" },
} as const;

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
    alert_enabled: false,
    alert_severity: "info",
    alert_offset_hours: 24,
  });
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  function set<K extends keyof ConciergeInput>(k: K, v: ConciergeInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Preview en tiempo real de cuándo va a saltar la alerta.
  const alertPreview = useMemo(() => {
    if (!form.alert_enabled || !scheduledDate) return null;
    const time = scheduledTime || "09:00";
    const sched = new Date(`${scheduledDate}T${time}:00`);
    if (Number.isNaN(sched.getTime())) return null;
    const fire = new Date(sched);
    fire.setHours(fire.getHours() - (form.alert_offset_hours ?? 0));
    return fire.toLocaleString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [form.alert_enabled, form.alert_offset_hours, scheduledDate, scheduledTime]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let scheduled_for: string | null = null;
    if (scheduledDate) {
      const time = scheduledTime || "09:00";
      // Local time → ISO. El timestamptz se almacena en UTC pero respetando tz local.
      const localIso = new Date(`${scheduledDate}T${time}:00`).toISOString();
      scheduled_for = localIso;
    }
    if (form.alert_enabled && !scheduled_for) {
      toast.error("Para usar la alerta necesitás definir día y hora", {
        description: "Cargá la fecha programada o desactivá la alerta.",
      });
      return;
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

          {/* Alerta vinculada a la tarea — se materializa como una notificación
              en el centro de alertas y la campanita. Al completar la tarea se
              auto-dismissea. */}
          <div
            className={cn(
              "rounded-lg border p-3 space-y-3 transition-colors",
              form.alert_enabled
                ? "border-primary/40 bg-primary/5"
                : "border-border"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <div
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md shrink-0 transition-colors",
                    form.alert_enabled
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {form.alert_enabled ? <Bell size={14} /> : <BellOff size={14} />}
                </div>
                <div className="min-w-0">
                  <Label
                    htmlFor="alert_enabled"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Generar alerta
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Aparece en el centro de alertas y la campanita.
                    {form.assigned_to && " Se manda al miembro asignado."}
                  </p>
                </div>
              </div>
              <Switch
                id="alert_enabled"
                checked={form.alert_enabled}
                onCheckedChange={(v) => set("alert_enabled", v)}
              />
            </div>

            {form.alert_enabled && (
              <div className="space-y-2 pl-9">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Cuándo avisar
                    </Label>
                    <Select
                      value={String(form.alert_offset_hours)}
                      onValueChange={(v) => set("alert_offset_hours", Number(v))}
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
                      value={form.alert_severity}
                      onValueChange={(v) =>
                        set("alert_severity", v as ConciergeInput["alert_severity"])
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(SEVERITY_META) as Array<keyof typeof SEVERITY_META>).map((k) => (
                          <SelectItem key={k} value={k}>
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "size-2 rounded-full",
                                  k === "info" && "bg-sky-500",
                                  k === "warning" && "bg-amber-500",
                                  k === "critical" && "bg-rose-500"
                                )}
                              />
                              {SEVERITY_META[k].label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {alertPreview ? (
                  <p className="text-[11px] text-primary tabular-nums">
                    Vas a recibir la alerta el{" "}
                    <span className="font-semibold">{alertPreview}</span>.
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Definí día y hora arriba para que la alerta tenga cuándo dispararse.
                  </p>
                )}
              </div>
            )}
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
