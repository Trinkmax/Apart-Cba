"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Send, X, Trash2, Users, ChevronRight, CheckCircle2, AlertCircle, Clock, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  createBroadcast,
  startBroadcast,
  cancelBroadcast,
  deleteBroadcast,
  type BroadcastRow,
} from "@/lib/actions/crm-broadcasts";
import type { CrmChannel, CrmWhatsAppTemplate } from "@/lib/types/database";

interface Props {
  broadcasts: BroadcastRow[];
  channels: CrmChannel[];
  templates: CrmWhatsAppTemplate[];
}

const STATUS_LABEL: Record<BroadcastRow["status"], { label: string; cls: string }> = {
  draft: { label: "Borrador", cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30" },
  queued: { label: "Programada", cls: "bg-violet-500/10 text-violet-500 border-violet-500/30" },
  sending: { label: "Enviando", cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  sent: { label: "Enviada", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
  partial: { label: "Parcial", cls: "bg-orange-500/10 text-orange-500 border-orange-500/30" },
  cancelled: { label: "Cancelada", cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30" },
  failed: { label: "Fallida", cls: "bg-red-500/10 text-red-500 border-red-500/30" },
};

export function DifusionesClient({ broadcasts, channels, templates }: Props) {
  const [creating, setCreating] = useState(false);

  const approvedTemplates = templates.filter((t) => t.meta_status === "approved");
  const waChannels = channels.filter((c) => c.provider === "meta_cloud");
  const igChannels = channels.filter((c) => c.provider === "meta_instagram");
  const canCreate = (waChannels.length > 0 && approvedTemplates.length > 0) || igChannels.length > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="size-6 text-emerald-500" />
            Difusiones
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Mensajes masivos via WhatsApp templates aprobados o Instagram free-form (dentro de 24h window).
          </p>
        </div>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-white" disabled={!canCreate}>
              <Plus className="size-4 mr-1.5" /> Nueva difusión
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Nueva difusión</DialogTitle></DialogHeader>
            <BroadcastForm
              channels={channels}
              templates={approvedTemplates}
              onClose={() => setCreating(false)}
            />
          </DialogContent>
        </Dialog>
      </header>

      {!canCreate && (
        <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-700 dark:text-amber-400">
          Necesitás <strong>(a)</strong> un canal WhatsApp con al menos 1 template APPROVED, o <strong>(b)</strong> un canal Instagram conectado para enviar difusiones.
        </div>
      )}

      {broadcasts.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center">
          <Megaphone className="size-12 mx-auto mb-3 text-muted-foreground/40" />
          <h2 className="font-semibold mb-1">Sin difusiones todavía</h2>
          <p className="text-sm text-muted-foreground">
            Las difusiones permiten enviar mensajes proactivos a múltiples contactos a la vez.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {broadcasts.map((b) => (
            <BroadcastRowItem key={b.id} broadcast={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function BroadcastRowItem({ broadcast }: { broadcast: BroadcastRow }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const status = STATUS_LABEL[broadcast.status];
  const progress = broadcast.total_recipients > 0
    ? Math.round((broadcast.sent_count / broadcast.total_recipients) * 100)
    : 0;

  const handleStart = () => {
    if (!confirm(`¿Iniciar envío a ${broadcast.total_recipients} contactos?`)) return;
    startTransition(async () => {
      try {
        await startBroadcast(broadcast.id);
        toast.success("Difusión iniciada");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  const handleCancel = () => {
    if (!confirm("¿Cancelar la difusión?")) return;
    startTransition(async () => {
      await cancelBroadcast(broadcast.id);
      toast.info("Difusión cancelada");
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm("¿Eliminar permanentemente?")) return;
    startTransition(async () => {
      await deleteBroadcast(broadcast.id);
      router.refresh();
    });
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-start gap-4">
        <div className="size-10 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
          <Megaphone className="size-5 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold">{broadcast.name}</h3>
            <span className={cn("text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border", status.cls)}>
              {status.label}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
            <span className="inline-flex items-center gap-1"><Users className="size-3" /> {broadcast.total_recipients} destinatarios</span>
            {broadcast.scheduled_at && broadcast.status === "queued" && (
              <span className="inline-flex items-center gap-1"><Clock className="size-3" /> Programada {format(new Date(broadcast.scheduled_at), "PPP p", { locale: es })}</span>
            )}
            <span>Creada {format(new Date(broadcast.created_at), "PP p", { locale: es })}</span>
          </div>

          {(broadcast.status === "sending" || broadcast.status === "sent" || broadcast.status === "partial") && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{broadcast.sent_count}/{broadcast.total_recipients}</span>
                <span className="text-muted-foreground">{progress}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Send className="size-2.5" /> {broadcast.sent_count} enviados</span>
                <span className="inline-flex items-center gap-1"><CheckCircle2 className="size-2.5 text-emerald-500" /> {broadcast.delivered_count} entregados</span>
                <span className="inline-flex items-center gap-1"><BarChart3 className="size-2.5 text-blue-500" /> {broadcast.read_count} leídos</span>
                {broadcast.failed_count > 0 && (
                  <span className="inline-flex items-center gap-1"><AlertCircle className="size-2.5 text-red-500" /> {broadcast.failed_count} fallidos</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {(broadcast.status === "draft" || broadcast.status === "queued") && (
            <Button size="sm" onClick={handleStart} className="bg-emerald-500 hover:bg-emerald-600 text-white">
              <Send className="size-3.5 mr-1" /> Enviar ahora
            </Button>
          )}
          {(broadcast.status === "queued" || broadcast.status === "sending") && (
            <Button size="sm" variant="outline" onClick={handleCancel}>
              <X className="size-3.5 mr-1" /> Cancelar
            </Button>
          )}
          <Button size="sm" variant="ghost" className="hover:text-red-500" onClick={handleDelete}>
            <Trash2 className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function BroadcastForm({
  channels,
  templates,
  onClose,
}: {
  channels: CrmChannel[];
  templates: CrmWhatsAppTemplate[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [freeFormText, setFreeFormText] = useState("");
  const [audienceKind, setAudienceKind] = useState<"guests" | "owners" | "phones" | "crm_contacts">("guests");
  const [phonesText, setPhonesText] = useState("");
  const [hasActiveBooking, setHasActiveBooking] = useState(false);
  const [excludeBlacklisted, setExcludeBlacklisted] = useState(true);
  const [onlyWithin24h, setOnlyWithin24h] = useState(true);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [params, setParams] = useState<Record<string, string>>({});

  const selectedChannel = channels.find((c) => c.id === channelId);
  const isIg = selectedChannel?.provider === "meta_instagram";
  const channelTemplates = templates.filter((t) => t.channel_id === channelId);
  const selectedTemplate = channelTemplates.find((t) => t.id === templateId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        const audience: { kind: "guests" | "owners" | "phones" | "crm_contacts"; filters?: Record<string, unknown>; phones?: string[] } =
          audienceKind === "phones"
            ? {
                kind: "phones",
                phones: phonesText.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean),
              }
            : audienceKind === "guests"
            ? {
                kind: "guests",
                filters: { hasActiveBooking, blacklisted: !excludeBlacklisted },
              }
            : audienceKind === "crm_contacts"
            ? {
                kind: "crm_contacts",
                filters: { onlyWithin24h, onlyOpen: true },
              }
            : { kind: "owners" };

        const result = await createBroadcast({
          name,
          channelId,
          templateId: isIg ? null : templateId,
          freeFormText: isIg ? freeFormText : null,
          audience: audience as Parameters<typeof createBroadcast>[0]["audience"],
          templateParams: params,
          scheduledAt: scheduleEnabled && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        });
        toast.success(`Difusión creada · ${result.recipientsCount} destinatarios`);
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[75vh] overflow-y-auto">
      <Tabs defaultValue="basics">
        <TabsList className="w-full">
          <TabsTrigger value="basics" className="flex-1">1. Básico</TabsTrigger>
          <TabsTrigger value="audience" className="flex-1">2. Audiencia</TabsTrigger>
          <TabsTrigger value="content" className="flex-1">3. Contenido</TabsTrigger>
          <TabsTrigger value="schedule" className="flex-1">4. Envío</TabsTrigger>
        </TabsList>

        <TabsContent value="basics" className="space-y-3 pt-3">
          <div>
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recordatorio inicio temporada" required />
          </div>
          <div>
            <Label>Canal</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {channels.map((c) => <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="audience" className="space-y-3 pt-3">
          <div>
            <Label>Tipo de audiencia</Label>
            <Select value={audienceKind} onValueChange={(v) => setAudienceKind(v as typeof audienceKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {!isIg && <SelectItem value="guests">Huéspedes (registrados)</SelectItem>}
                {!isIg && <SelectItem value="owners">Propietarios</SelectItem>}
                {!isIg && <SelectItem value="phones">Lista custom de teléfonos</SelectItem>}
                {isIg && <SelectItem value="crm_contacts">Contactos IG con conversación abierta</SelectItem>}
              </SelectContent>
            </Select>
            {isIg && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Instagram solo permite enviar a contactos que ya conversaron con vos dentro de la ventana 24h. Listas externas no funcionan.
              </p>
            )}
          </div>

          {audienceKind === "guests" && !isIg && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={hasActiveBooking} onCheckedChange={setHasActiveBooking} />
                Solo con booking activo hoy
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={excludeBlacklisted} onCheckedChange={setExcludeBlacklisted} />
                Excluir blacklist
              </label>
            </div>
          )}

          {audienceKind === "phones" && !isIg && (
            <div>
              <Label>Teléfonos (uno por línea o separados por comas)</Label>
              <Textarea
                rows={6}
                value={phonesText}
                onChange={(e) => setPhonesText(e.target.value)}
                placeholder="+5493515551234&#10;+5493515559876"
                className="font-mono text-sm"
              />
            </div>
          )}

          {audienceKind === "crm_contacts" && isIg && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={onlyWithin24h} onCheckedChange={setOnlyWithin24h} />
                Solo dentro de la ventana 24h (Meta lo exige)
              </label>
              <p className="text-[10px] text-muted-foreground">
                Si desactivás, los mensajes fuera de 24h fallarán con código 2018108. Mantener encendido.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="content" className="space-y-3 pt-3">
          {isIg ? (
            <div>
              <Label>Texto del mensaje (free-form)</Label>
              <Textarea
                rows={6}
                value={freeFormText}
                onChange={(e) => setFreeFormText(e.target.value)}
                placeholder="¡Hola {{contact_name}}! Tenemos una promo especial para vos esta semana 🎉"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Soporta variables {"{{contact_name}}"}, {"{{instagram_username}}"}. Solo se envía a contactos dentro de ventana 24h.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Template aprobado</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar template..." /></SelectTrigger>
                  <SelectContent>
                    {channelTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} · {t.language}</SelectItem>)}
                  </SelectContent>
                </Select>
                {channelTemplates.length === 0 && (
                  <p className="text-[10px] text-amber-600 mt-1">Este canal no tiene templates APPROVED.</p>
                )}
              </div>
              {selectedTemplate && (
                <div className="space-y-3">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-sm whitespace-pre-wrap">
                    {selectedTemplate.body}
                  </div>
                  {selectedTemplate.variables_count > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Mapeá las variables del template a campos del contacto. Soporta plantillas como <code>{"{{guest_name}}"}</code>.
                      </p>
                      {Array.from({ length: selectedTemplate.variables_count }).map((_, i) => {
                        const idx = String(i + 1);
                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-sm font-mono shrink-0 w-12">{`{{${idx}}}`}</span>
                            <Input
                              value={params[idx] ?? ""}
                              onChange={(e) => setParams({ ...params, [idx]: e.target.value })}
                              placeholder="ej: {{guest_name}} o texto fijo"
                            />
                          </div>
                        );
                      })}
                      <p className="text-[10px] text-muted-foreground">
                        Variables disponibles: <code>{"{{guest_name}}"}</code>, <code>{"{{owner_name}}"}</code>, <code>{"{{total_bookings}}"}</code>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="schedule" className="space-y-3 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
            Programar para una fecha futura
          </label>
          {scheduleEnabled && (
            <div>
              <Label>Fecha y hora</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {scheduleEnabled
              ? "La difusión se enviará automáticamente en la fecha programada."
              : "La difusión quedará en borrador. Tendrás que iniciarla manualmente desde la lista."}
          </p>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 pt-3 border-t border-border">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white">Crear difusión</Button>
      </div>
    </form>
  );
}
