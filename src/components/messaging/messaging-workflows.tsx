"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Workflow,
  Plus,
  Pencil,
  Trash2,
  Clock,
  CheckCircle2,
  PlayCircle,
  Power,
  CalendarCheck2,
  LogIn,
  LogOut,
  Star,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  upsertWorkflow,
  setWorkflowActive,
  deleteWorkflow,
} from "@/lib/actions/messaging";
import { SectionHeader } from "./section-header";
import { WhatsAppIcon, InstagramIcon } from "./channel-icons";
import { toast } from "sonner";
import type {
  MessagingChannelType,
  MessagingWorkflow,
  MessagingWorkflowTrigger,
} from "@/lib/types/database";

interface Props {
  initialWorkflows: MessagingWorkflow[];
}

const TRIGGER_META: Record<
  MessagingWorkflowTrigger,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
    color: string;
  }
> = {
  booking_confirmed: {
    label: "Reserva confirmada",
    description: "Al confirmarse una reserva nueva",
    icon: CalendarCheck2,
    color: "#10b981",
  },
  pre_check_in: {
    label: "Antes del check-in",
    description: "X minutos/horas antes del día de llegada",
    icon: Clock,
    color: "#3b82f6",
  },
  on_check_in: {
    label: "Al hacer check-in",
    description: "Cuando se marca check-in en el sistema",
    icon: LogIn,
    color: "#06b6d4",
  },
  during_stay: {
    label: "Durante la estadía",
    description: "X días/horas durante la estadía",
    icon: Star,
    color: "#a855f7",
  },
  pre_check_out: {
    label: "Antes del check-out",
    description: "X horas antes del día de salida",
    icon: Clock,
    color: "#f59e0b",
  },
  on_check_out: {
    label: "Al hacer check-out",
    description: "Cuando se marca check-out en el sistema",
    icon: LogOut,
    color: "#0ea5e9",
  },
  post_stay_review: {
    label: "Post-estadía / reseña",
    description: "X horas/días después del check-out",
    icon: Star,
    color: "#8b5cf6",
  },
  inbound_first_message: {
    label: "Primer mensaje del huésped",
    description: "Auto-respuesta al primer mensaje entrante",
    icon: MessageCircle,
    color: "#ec4899",
  },
};

export function MessagingWorkflows({ initialWorkflows }: Props) {
  const [workflows, setWorkflows] = useState<MessagingWorkflow[]>(initialWorkflows);
  const [editing, setEditing] = useState<MessagingWorkflow | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <SectionHeader
        title="Workflows de automatización"
        description="Mensajes automáticos disparados por eventos del PMS"
        icon={Workflow}
        iconColor="text-purple-500"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            className="gap-2"
          >
            <Plus size={15} />
            Nuevo workflow
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {workflows.length === 0 ? (
          <EmptyState
            onCreate={() => {
              setEditing(null);
              setOpen(true);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 max-w-[1600px]">
            {workflows.map((w) => (
              <WorkflowCard
                key={w.id}
                workflow={w}
                onEdit={() => {
                  setEditing(w);
                  setOpen(true);
                }}
                onChange={(updated) => {
                  setWorkflows((prev) =>
                    updated
                      ? prev.map((x) => (x.id === updated.id ? updated : x))
                      : prev.filter((x) => x.id !== w.id)
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>

      <WorkflowFormDialog
        open={open}
        onOpenChange={setOpen}
        workflow={editing}
        onSaved={(w) =>
          setWorkflows((prev) => {
            const idx = prev.findIndex((x) => x.id === w.id);
            if (idx === -1) return [w, ...prev];
            const copy = [...prev];
            copy[idx] = w;
            return copy;
          })
        }
      />
    </>
  );
}

function WorkflowCard({
  workflow,
  onEdit,
  onChange,
}: {
  workflow: MessagingWorkflow;
  onEdit: () => void;
  onChange: (updated: MessagingWorkflow | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const meta = TRIGGER_META[workflow.trigger];
  const Icon = meta.icon;
  const ChIcon = workflow.channel_type === "whatsapp" ? WhatsAppIcon : InstagramIcon;
  const delayLabel = formatDelay(workflow.delay_minutes);

  return (
    <article
      className={cn(
        "rounded-2xl border bg-card p-4 space-y-3 transition-all",
        workflow.active ? "border-border" : "border-border/60 opacity-75"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="size-9 rounded-xl grid place-items-center shrink-0"
            style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
          >
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{workflow.name}</h3>
            <p className="text-[11px] text-muted-foreground truncate">
              {meta.label}
              {delayLabel && ` · ${delayLabel}`}
            </p>
          </div>
        </div>
        <Switch
          checked={workflow.active}
          onCheckedChange={(checked) =>
            startTransition(async () => {
              try {
                await setWorkflowActive(workflow.id, checked);
                onChange({ ...workflow, active: checked });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error");
              }
            })
          }
          disabled={pending}
        />
      </div>

      <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5">
        {workflow.message_body}
      </p>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border">
        <span className="inline-flex items-center gap-1.5">
          <ChIcon className="size-3.5" />
          {workflow.channel_type === "whatsapp" ? "WhatsApp" : "Instagram"}
        </span>
        <span className="inline-flex items-center gap-1">
          <PlayCircle size={11} />
          {workflow.runs_count} ejecuciones
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1.5" onClick={onEdit}>
          <Pencil size={12} /> Editar
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
          disabled={pending}
          onClick={() => {
            if (!confirm("¿Eliminar workflow?")) return;
            startTransition(async () => {
              try {
                await deleteWorkflow(workflow.id);
                onChange(null);
                toast.success("Workflow eliminado");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error");
              }
            });
          }}
        >
          <Trash2 size={13} />
        </Button>
      </div>
    </article>
  );
}

function formatDelay(min: number): string {
  if (min === 0) return "Inmediato";
  const abs = Math.abs(min);
  const sign = min < 0 ? "antes" : "después";
  if (abs < 60) return `${abs} min ${sign}`;
  if (abs < 60 * 24) return `${Math.round(abs / 60)} h ${sign}`;
  return `${Math.round(abs / 60 / 24)} días ${sign}`;
}

function WorkflowFormDialog({
  open,
  onOpenChange,
  workflow,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workflow: MessagingWorkflow | null;
  onSaved: (w: MessagingWorkflow) => void;
}) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<MessagingWorkflowTrigger>("booking_confirmed");
  const [delay, setDelay] = useState(0);
  const [channelType, setChannelType] = useState<MessagingChannelType>("whatsapp");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(workflow?.name ?? "");
    setTrigger(workflow?.trigger ?? "booking_confirmed");
    setDelay(workflow?.delay_minutes ?? 0);
    setChannelType(workflow?.channel_type ?? "whatsapp");
    setBody(workflow?.message_body ?? "");
  }, [open, workflow]);

  const submit = () => {
    if (!name.trim() || !body.trim()) return;
    startTransition(async () => {
      try {
        const r = await upsertWorkflow({
          id: workflow?.id,
          name: name.trim(),
          description: null,
          trigger,
          delay_minutes: delay,
          channel_type: channelType,
          message_body: body.trim(),
          filters: {},
          active: workflow?.active ?? true,
        });
        onSaved(r);
        toast.success(workflow ? "Workflow actualizado" : "Workflow creado");
        onOpenChange(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{workflow ? "Editar workflow" : "Nuevo workflow"}</DialogTitle>
          <DialogDescription>
            Mensaje automático disparado por un evento del PMS — útil para bienvenidas,
            recordatorios e instrucciones.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="wf-name">Nombre</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ej. Bienvenida automática"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label>Disparador</Label>
            <Select value={trigger} onValueChange={(v) => setTrigger(v as MessagingWorkflowTrigger)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TRIGGER_META) as MessagingWorkflowTrigger[]).map((k) => {
                  const Icon = TRIGGER_META[k].icon;
                  return (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <Icon size={13} />
                        {TRIGGER_META[k].label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              {TRIGGER_META[trigger].description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wf-delay">Retraso (minutos)</Label>
              <Input
                id="wf-delay"
                type="number"
                value={delay}
                onChange={(e) => setDelay(parseInt(e.target.value, 10) || 0)}
                min={-10080}
                max={20160}
                className="mt-1.5"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Negativo = antes. Positivo = después.
              </p>
            </div>
            <div>
              <Label>Canal</Label>
              <Select
                value={channelType}
                onValueChange={(v) => setChannelType(v as MessagingChannelType)}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="wf-body">Mensaje</Label>
            <Textarea
              id="wf-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="¡Hola {NOMBRE}! Bienvenido a Apart Cba…"
              className="mt-1.5 resize-none"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Variables: {"{NOMBRE}"}, {"{UNIDAD}"}, {"{CHECKIN}"}, {"{CHECKOUT}"}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!name.trim() || !body.trim() || pending}>
            {workflow ? "Guardar cambios" : "Crear workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const examples = (
    [
      "booking_confirmed",
      "pre_check_in",
      "post_stay_review",
      "inbound_first_message",
    ] as MessagingWorkflowTrigger[]
  ).map((k) => TRIGGER_META[k]);
  return (
    <div className="grid place-items-center py-20">
      <div className="text-center max-w-2xl space-y-4">
        <div className="size-14 mx-auto rounded-2xl bg-muted/60 grid place-items-center">
          <Workflow className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">Automatizá tus comunicaciones</h3>
        <p className="text-sm text-muted-foreground">
          Configurá mensajes automáticos disparados por eventos: bienvenidas al confirmar,
          instrucciones antes del check-in, pedido de reseña post-estadía y más.
        </p>
        <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
          {examples.map((meta, i) => {
            const Icon = meta.icon;
            return (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-2.5 text-left flex items-center gap-2 text-xs"
              >
                <Icon size={14} style={{ color: meta.color }} />
                <span className="font-medium truncate">{meta.label}</span>
              </div>
            );
          })}
        </div>
        <Button onClick={onCreate} className="gap-2">
          <Plus size={15} /> Crear primer workflow
        </Button>
      </div>
    </div>
  );
}

// silence unused import warning
void Power;
void CheckCircle2;
