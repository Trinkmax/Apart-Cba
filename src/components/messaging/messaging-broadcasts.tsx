"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Megaphone,
  Plus,
  Send,
  Trash2,
  Pencil,
  Calendar,
  Users,
  CheckCheck,
  XCircle,
  Clock3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import {
  upsertBroadcast,
  sendBroadcastNow,
  cancelBroadcast,
  deleteBroadcast,
  previewBroadcastAudience,
} from "@/lib/actions/messaging";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import { SectionHeader } from "./section-header";
import { WhatsAppIcon, InstagramIcon } from "./channel-icons";
import type {
  MessagingBroadcast,
  MessagingBroadcastAudience,
  MessagingBroadcastStatus,
  MessagingChannel,
} from "@/lib/types/database";

interface Props {
  initialBroadcasts: MessagingBroadcast[];
  channels: MessagingChannel[];
}

const STATUS_META: Record<MessagingBroadcastStatus, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "#94a3b8" },
  scheduled: { label: "Programada", color: "#3b82f6" },
  sending: { label: "Enviando", color: "#f59e0b" },
  sent: { label: "Enviada", color: "#10b981" },
  failed: { label: "Falló", color: "#ef4444" },
  cancelled: { label: "Cancelada", color: "#64748b" },
};

const AUDIENCE_LABEL: Record<MessagingBroadcastAudience, string> = {
  all: "Todos los huéspedes",
  active_guests: "Huéspedes activos",
  past_guests: "Huéspedes pasados",
  upcoming_arrivals: "Próximas llegadas (14 días)",
  custom_tag: "Por etiqueta custom",
};

export function MessagingBroadcasts({ initialBroadcasts, channels }: Props) {
  const [broadcasts, setBroadcasts] = useState<MessagingBroadcast[]>(initialBroadcasts);
  const [editing, setEditing] = useState<MessagingBroadcast | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <>
      <SectionHeader
        title="Difusiones"
        description="Campañas masivas a tus huéspedes vía WhatsApp o Instagram"
        icon={Megaphone}
        iconColor="text-amber-500"
        actions={
          <Button onClick={openNew} className="gap-2" disabled={channels.length === 0}>
            <Plus size={15} />
            Nueva difusión
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {channels.length === 0 ? (
          <EmptyState
            title="Conectá un canal primero"
            body="Necesitás al menos WhatsApp o Instagram conectados para enviar difusiones."
          />
        ) : broadcasts.length === 0 ? (
          <EmptyState
            title="Todavía no creaste difusiones"
            body='Las difusiones te permiten enviar el mismo mensaje a una audiencia segmentada — ej. "Todos los huéspedes que se van mañana" → recordatorio de check-out.'
            cta={
              <Button onClick={openNew} className="gap-2">
                <Plus size={15} /> Crear primera difusión
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 max-w-[1600px]">
            {broadcasts.map((b) => {
              const channel = channels.find((c) => c.id === b.channel_id);
              const sent = b.status === "sent";
              return (
                <article
                  key={b.id}
                  className="rounded-2xl border border-border bg-card p-4 space-y-3 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm truncate">{b.name}</h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <StatusBadge status={b.status} />
                        {channel && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            {channel.channel_type === "whatsapp" ? (
                              <WhatsAppIcon className="size-3.5" />
                            ) : (
                              <InstagramIcon className="size-3.5" />
                            )}
                            {channel.display_name ?? channel.channel_type}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                    {b.message_body}
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-muted/40 p-2">
                      <div className="text-muted-foreground flex items-center gap-1">
                        <Users size={11} /> Audiencia
                      </div>
                      <div className="font-medium mt-0.5">
                        {AUDIENCE_LABEL[b.audience]}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <div className="text-muted-foreground flex items-center gap-1">
                        <Calendar size={11} />
                        {b.scheduled_for ? "Programada" : "Estado"}
                      </div>
                      <div className="font-medium mt-0.5 truncate">
                        {b.scheduled_for ? formatDateTime(b.scheduled_for) : STATUS_META[b.status].label}
                      </div>
                    </div>
                  </div>

                  {sent && (
                    <div className="grid grid-cols-3 gap-2 text-[11px] pt-2 border-t border-border">
                      <Stat
                        label="Destinatarios"
                        value={b.recipients_count}
                      />
                      <Stat
                        label="Entregados"
                        value={b.delivered_count}
                        color="text-emerald-600"
                      />
                      <Stat
                        label="Fallos"
                        value={b.failed_count}
                        color={b.failed_count > 0 ? "text-red-500" : "text-muted-foreground"}
                      />
                    </div>
                  )}

                  <BroadcastActions
                    broadcast={b}
                    onEdit={() => {
                      setEditing(b);
                      setFormOpen(true);
                    }}
                    onChange={(updated) =>
                      setBroadcasts((prev) =>
                        updated ? prev.map((x) => (x.id === updated.id ? updated : x)) : prev.filter((x) => x.id !== b.id)
                      )
                    }
                  />
                </article>
              );
            })}
          </div>
        )}
      </div>

      <BroadcastFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        broadcast={editing}
        channels={channels}
        onSaved={(b) =>
          setBroadcasts((prev) => {
            const idx = prev.findIndex((x) => x.id === b.id);
            if (idx === -1) return [b, ...prev];
            const copy = [...prev];
            copy[idx] = b;
            return copy;
          })
        }
      />
    </>
  );
}

function StatusBadge({ status }: { status: MessagingBroadcastStatus }) {
  const meta = STATUS_META[status];
  const Icon = status === "sent" ? CheckCheck : status === "failed" ? XCircle : Clock3;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
    >
      <Icon size={10} />
      {meta.label}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={cn("text-sm font-semibold tabular-nums", color)}>{value}</div>
    </div>
  );
}

function BroadcastActions({
  broadcast,
  onEdit,
  onChange,
}: {
  broadcast: MessagingBroadcast;
  onEdit: () => void;
  onChange: (updated: MessagingBroadcast | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const isEditable = ["draft", "scheduled", "failed", "cancelled"].includes(
    broadcast.status as string
  );
  const isSendable = ["draft", "scheduled", "failed"].includes(broadcast.status as string);
  const isCancellable = ["scheduled", "draft"].includes(broadcast.status as string);
  const isDeletable = ["draft", "cancelled", "failed"].includes(broadcast.status as string);

  return (
    <div className="flex items-center gap-1.5 pt-1">
      {isSendable && (
        <Button
          size="sm"
          className="flex-1 h-8 text-xs gap-1.5"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                const r = await sendBroadcastNow(broadcast.id);
                onChange(r);
                toast.success(`Difusión enviada a ${r.delivered_count} destinatarios`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error al enviar");
              }
            })
          }
        >
          <Send size={12} /> Enviar
        </Button>
      )}
      {isEditable && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onEdit}
          title="Editar"
          disabled={pending}
        >
          <Pencil size={13} />
        </Button>
      )}
      {isCancellable && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-amber-600"
          disabled={pending}
          title="Cancelar"
          onClick={() =>
            startTransition(async () => {
              try {
                await cancelBroadcast(broadcast.id);
                onChange({ ...broadcast, status: "cancelled" });
                toast.success("Difusión cancelada");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error");
              }
            })
          }
        >
          <XCircle size={13} />
        </Button>
      )}
      {isDeletable && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
          disabled={pending}
          title="Eliminar"
          onClick={() => {
            if (!confirm("¿Eliminar esta difusión?")) return;
            startTransition(async () => {
              try {
                await deleteBroadcast(broadcast.id);
                onChange(null);
                toast.success("Eliminada");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error");
              }
            });
          }}
        >
          <Trash2 size={13} />
        </Button>
      )}
    </div>
  );
}

function BroadcastFormDialog({
  open,
  onOpenChange,
  broadcast,
  channels,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  broadcast: MessagingBroadcast | null;
  channels: MessagingChannel[];
  onSaved: (b: MessagingBroadcast) => void;
}) {
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [audience, setAudience] = useState<MessagingBroadcastAudience>("active_guests");
  const [body, setBody] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  // sincronizar estado al abrir / cambiar broadcast
  useEffect(() => {
    if (!open) return;
    setName(broadcast?.name ?? "");
    setChannelId(broadcast?.channel_id ?? channels[0]?.id ?? "");
    setAudience(broadcast?.audience ?? "active_guests");
    setBody(broadcast?.message_body ?? "");
    setScheduledFor(broadcast?.scheduled_for ?? "");
    setAudienceCount(null);
  }, [open, broadcast, channels]);

  const previewAudience = () => {
    startTransition(async () => {
      try {
        const r = await previewBroadcastAudience(audience);
        setAudienceCount(r.count);
      } catch {
        setAudienceCount(null);
      }
    });
  };

  const submit = () => {
    if (!name.trim() || !body.trim() || !channelId) return;
    startTransition(async () => {
      try {
        const r = await upsertBroadcast({
          id: broadcast?.id,
          name: name.trim(),
          channel_id: channelId,
          audience,
          audience_filter: {},
          message_body: body.trim(),
          attachments: [],
          scheduled_for: scheduledFor || null,
        });
        onSaved(r);
        toast.success(broadcast ? "Difusión actualizada" : "Difusión creada");
        onOpenChange(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{broadcast ? "Editar difusión" : "Nueva difusión"}</DialogTitle>
          <DialogDescription>
            Mensaje masivo a una audiencia de huéspedes vía WhatsApp o Instagram.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="bc-name">Nombre interno</Label>
            <Input
              id="bc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ej. Recordatorio check-out enero"
              className="mt-1.5"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Canal</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Elegí canal" />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.channel_type === "whatsapp" ? "WhatsApp" : "Instagram"} —{" "}
                      {c.display_name ?? "Canal"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Audiencia</Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as MessagingBroadcastAudience)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AUDIENCE_LABEL) as MessagingBroadcastAudience[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {AUDIENCE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="bc-body">Mensaje</Label>
              <button
                type="button"
                onClick={previewAudience}
                className="text-[11px] text-primary hover:underline"
                disabled={pending}
              >
                Calcular destinatarios
              </button>
            </div>
            <Textarea
              id="bc-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Hola {NOMBRE}, te recordamos que mañana es el check-out a las 11:00…"
              className="mt-1.5 resize-none"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
              <span>{body.length}/4096 caracteres</span>
              {audienceCount !== null && (
                <span className="font-medium text-foreground">
                  ≈ {audienceCount} destinatarios
                </span>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="bc-when">Programar (opcional)</Label>
            <Input
              id="bc-when"
              type="datetime-local"
              value={scheduledFor.slice(0, 16)}
              onChange={(e) =>
                setScheduledFor(e.target.value ? new Date(e.target.value).toISOString() : "")
              }
              className="mt-1.5"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Si dejás vacío, queda como borrador y la podés enviar cuando quieras.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || !body.trim() || !channelId || pending}
          >
            {broadcast ? "Guardar cambios" : "Crear difusión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="grid place-items-center py-20">
      <div className="text-center max-w-md space-y-3">
        <div className="size-14 mx-auto rounded-2xl bg-muted/60 grid place-items-center">
          <Megaphone className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
        {cta}
      </div>
    </div>
  );
}
