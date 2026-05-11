"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Sparkles, FileText, Tag, Plus, ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { TagChip } from "@/components/crm/shared/tag-chip";
import { upsertChannel, setChannelStatus, testChannelHealth, verifyChannelSubscription } from "@/lib/actions/crm-channels";
import { updateAISettings } from "@/lib/actions/crm-ai-settings";
import { AIUsageChart } from "./ai-usage-chart";
import { createTemplate, submitTemplate, refreshTemplateStatus, deleteTemplate } from "@/lib/actions/crm-templates";
import { upsertTag, deleteTag } from "@/lib/actions/crm-tags";
import type {
  CrmAiSettings,
  CrmChannel,
  CrmTag,
  CrmWhatsAppTemplate,
  CrmTemplateCategory,
} from "@/lib/types/database";

interface Props {
  channels: CrmChannel[];
  aiSettings: CrmAiSettings | null;
  templates: CrmWhatsAppTemplate[];
  tags: CrmTag[];
  /** URL pública del deployment — calculada server-side desde headers. */
  appUrl: string;
}

function ProviderBadge({ provider }: { provider: string }) {
  if (provider === "meta_instagram") {
    return (
      <div className="size-9 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ background: "linear-gradient(135deg, #fdcc80 0%, #e1306c 50%, #833ab4 100%)" }}
      >
        <span className="text-xs font-bold">IG</span>
      </div>
    );
  }
  return (
    <div className="size-9 rounded-md bg-emerald-500 flex items-center justify-center text-white shrink-0">
      <span className="text-xs font-bold">WA</span>
    </div>
  );
}

export function CrmConfigClient({ channels, aiSettings, templates, tags, appUrl }: Props) {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Configuración CRM</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Canales de mensajería, IA, templates aprobados por Meta y etiquetas.
        </p>
      </header>

      <Tabs defaultValue="channels" className="w-full">
        <TabsList>
          <TabsTrigger value="channels"><MessageSquare className="size-4 mr-1.5" /> Canales</TabsTrigger>
          <TabsTrigger value="ai"><Sparkles className="size-4 mr-1.5" /> IA</TabsTrigger>
          <TabsTrigger value="templates"><FileText className="size-4 mr-1.5" /> Templates</TabsTrigger>
          <TabsTrigger value="tags"><Tag className="size-4 mr-1.5" /> Tags</TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="mt-4">
          <ChannelsSection channels={channels} appUrl={appUrl} />
        </TabsContent>
        <TabsContent value="ai" className="mt-4">
          <AISection aiSettings={aiSettings} />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesSection templates={templates} channels={channels} />
        </TabsContent>
        <TabsContent value="tags" className="mt-4">
          <TagsSection tags={tags} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Channels ───────────────────────────────────────────────────────────────

function ChannelsSection({ channels, appUrl }: { channels: CrmChannel[]; appUrl: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CrmChannel | null>(null);

  // Construye URL absoluta del webhook con fallback runtime cuando appUrl viene vacío
  // (p.ej. dev sin NEXT_PUBLIC_APP_URL). El endpoint es compartido WA + IG.
  const webhookUrl =
    (appUrl || (typeof window !== "undefined" ? window.location.origin : "")) +
    "/api/webhooks/whatsapp";

  const hasInstagram = channels.some((c) => c.provider === "meta_instagram");
  const hasWhatsApp = channels.some((c) => c.provider === "meta_cloud");

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Canales de mensajería</h2>
        <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => setEditing(null)}>
              <Plus className="size-4 mr-1.5" /> Conectar canal
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>{editing ? "Editar canal" : "Conectar nuevo canal"}</DialogTitle></DialogHeader>
            <ChannelForm initial={editing} onClose={() => setShowForm(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {channels.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center">
          <MessageSquare className="size-10 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground mb-3">Sin canales conectados</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Conectá WhatsApp Business y/o Instagram. Ver guías en
            <code className="ml-1 px-1 py-0.5 bg-muted rounded">docs/CRM-SETUP-META.md</code> y
            <code className="ml-1 px-1 py-0.5 bg-muted rounded">docs/CRM-SETUP-INSTAGRAM.md</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => (
            <div key={ch.id} className="border border-border rounded-lg p-3 flex items-center gap-3">
              <ProviderBadge provider={ch.provider} />
              <div className={`size-2 rounded-full ${
                ch.status === "active" ? "bg-emerald-500" :
                ch.status === "error" ? "bg-red-500" : "bg-amber-500"
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{ch.display_name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{ch.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {ch.provider === "meta_cloud"
                    ? <>{ch.phone_number} · phone_number_id: <code>{ch.phone_number_id}</code></>
                    : <>@{ch.instagram_username ?? "?"} · IG account: <code>{ch.instagram_business_account_id}</code></>
                  }
                </div>
                {ch.last_error && (
                  <div className="text-xs text-red-500 mt-1 inline-flex items-center gap-1">
                    <AlertTriangle className="size-3" /> {ch.last_error}
                  </div>
                )}
              </div>
              <Switch
                checked={ch.status === "active"}
                onCheckedChange={(on) => {
                  startTransition(async () => {
                    await setChannelStatus(ch.id, on ? "active" : "disabled");
                    router.refresh();
                  });
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => startTransition(async () => {
                  const result = await testChannelHealth(ch.id);
                  if (result.ok) toast.success(result.message);
                  else toast.error(result.message);
                  router.refresh();
                })}
              >
                Probar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => startTransition(async () => {
                  const result = await verifyChannelSubscription(ch.id);
                  if (result.ok) {
                    toast.success(result.message, {
                      description: result.details?.fields.length
                        ? `Fields: ${result.details.fields.join(", ")}`
                        : undefined,
                      duration: 7000,
                    });
                  } else {
                    toast.error(result.message, {
                      description: result.details?.hint ?? undefined,
                      duration: 12000,
                    });
                  }
                  router.refresh();
                })}
              >
                Verificar webhook
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(ch); setShowForm(true); }}>Editar</Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 p-4 rounded-lg bg-muted/40 border border-border space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-emerald-500" /> URL del webhook (compartida WhatsApp + Instagram)
        </h3>
        <code className="text-xs px-2 py-1 bg-background border border-border rounded block break-all">
          {webhookUrl}
        </code>
        <p className="text-[11px] text-muted-foreground">
          El handler diferencia automáticamente por el campo <code>object</code> del payload, así que la misma URL sirve para ambos productos.
        </p>

        {hasWhatsApp && (
          <div className="border-t border-border pt-3 text-xs space-y-1">
            <p className="font-semibold text-emerald-600 dark:text-emerald-500">WhatsApp Business</p>
            <p className="text-muted-foreground">
              En Meta App Dashboard → <strong>WhatsApp</strong> → <strong>Configuration</strong> → Callback URL = la URL de arriba. Verify Token = el que cargaste en el canal. Subscribed fields: <code>messages</code>.
            </p>
          </div>
        )}

        {hasInstagram && (
          <div className="border-t border-border pt-3 text-xs space-y-1">
            <p className="font-semibold bg-gradient-to-r from-amber-500 via-pink-500 to-purple-600 bg-clip-text text-transparent">Instagram DM</p>
            <p className="text-muted-foreground">
              En Meta App Dashboard → <strong>Webhooks</strong> → <strong>Instagram</strong> → Callback URL = la URL de arriba. Verify Token = el que cargaste en el canal. Subscribed fields: <code>messages</code>, <code>messaging_postbacks</code>, <code>messaging_seen</code>.
            </p>
            <p className="text-muted-foreground">
              Después, en <strong>Instagram</strong> → <strong>Webhooks</strong> tenés que <strong>suscribir la Page</strong> donde vive la cuenta — sin esto los DMs no se entregan acá aunque la app esté en producción.
            </p>
            <p className="text-muted-foreground">
              Cuando termines, click <strong>Verificar webhook</strong> arriba para confirmar que la Page tiene la app suscripta con los fields correctos.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function ChannelForm({ initial, onClose }: { initial: CrmChannel | null; onClose: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [provider, setProvider] = useState<"meta_cloud" | "meta_instagram">(initial?.provider ?? "meta_cloud");
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [phoneNumber, setPhoneNumber] = useState(initial?.phone_number ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(initial?.phone_number_id ?? "");
  const [wabaId, setWabaId] = useState(initial?.waba_id ?? "");
  const [igAccountId, setIgAccountId] = useState(initial?.instagram_business_account_id ?? "");
  const [pageId, setPageId] = useState(initial?.page_id ?? "");
  const [igUsername, setIgUsername] = useState(initial?.instagram_username ?? "");
  const [appId, setAppId] = useState(initial?.app_id ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await upsertChannel({
          id: initial?.id,
          provider,
          displayName,
          phoneNumber: phoneNumber || undefined,
          phoneNumberId: phoneNumberId || undefined,
          wabaId: wabaId || undefined,
          instagramBusinessAccountId: igAccountId || undefined,
          pageId: pageId || undefined,
          instagramUsername: igUsername || undefined,
          appId: appId || undefined,
          accessToken: accessToken || undefined,
          appSecret: appSecret || undefined,
          webhookVerifyToken: verifyToken || undefined,
        });
        toast.success("Canal guardado");
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 max-h-[70vh] overflow-y-auto">
      <div>
        <Label>Plataforma</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            type="button"
            onClick={() => setProvider("meta_cloud")}
            className={`p-3 border rounded-lg text-left transition-all ${provider === "meta_cloud" ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:border-foreground/30"}`}
            disabled={!!initial}
          >
            <div className="font-semibold flex items-center gap-2">
              <span className="text-emerald-500">●</span> WhatsApp Business
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Phone Number ID + WABA + System User Token</div>
          </button>
          <button
            type="button"
            onClick={() => setProvider("meta_instagram")}
            className={`p-3 border rounded-lg text-left transition-all ${provider === "meta_instagram" ? "border-pink-500 bg-pink-500/10" : "border-border hover:border-foreground/30"}`}
            disabled={!!initial}
          >
            <div className="font-semibold flex items-center gap-2">
              <span className="text-pink-500">●</span> Instagram DM
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">IG Business Account + Page Access Token</div>
          </button>
        </div>
        {initial && <p className="text-[10px] text-muted-foreground mt-1">El proveedor no se puede cambiar después de crear el canal.</p>}
      </div>

      <div>
        <Label>Nombre interno</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={provider === "meta_cloud" ? "WhatsApp Recepción" : "Instagram @apartcba"}
          required
        />
      </div>

      {provider === "meta_cloud" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Número (E.164)</Label>
              <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+5493515551234" required />
            </div>
            <div>
              <Label>Phone Number ID</Label>
              <Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label>WABA ID</Label>
            <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} required />
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>Instagram Business Account ID</Label>
            <Input value={igAccountId} onChange={(e) => setIgAccountId(e.target.value)} placeholder="17841405822304914" required />
            <p className="text-[10px] text-muted-foreground mt-1">
              Sale en Meta Business → Instagram → Configuración. También se obtiene con GET /me/accounts → instagram_business_account.id
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Page ID (FB)</Label>
              <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="123456789" required />
            </div>
            <div>
              <Label>Username IG</Label>
              <Input value={igUsername} onChange={(e) => setIgUsername(e.target.value)} placeholder="apartcba" />
            </div>
          </div>
        </>
      )}

      <div>
        <Label>App ID (opcional)</Label>
        <Input value={appId} onChange={(e) => setAppId(e.target.value)} />
      </div>

      <div className="border-t border-border pt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Las credenciales se guardan encriptadas con Supabase Vault. {initial ? "Dejá vacío para mantener el valor actual." : ""}
        </p>
        <div>
          <Label>{provider === "meta_cloud" ? "Permanent Access Token (System User)" : "Page Access Token (long-lived)"}</Label>
          <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder={initial ? "•••••••• (existente)" : ""} />
          {provider === "meta_instagram" && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Generalo desde Meta Graph API Explorer con la Page seleccionada y permisos: instagram_basic, instagram_manage_messages, pages_messaging.
            </p>
          )}
        </div>
        <div>
          <Label>App Secret</Label>
          <Input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder={initial ? "•••••••• (existente)" : ""} />
        </div>
        <div>
          <Label>Webhook Verify Token (lo elegís vos)</Label>
          <Input type="password" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} placeholder={initial ? "•••••••• (existente)" : "ej: apartcba-webhook-token-abc123"} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white">Guardar</Button>
      </div>
    </form>
  );
}

// ─── AI Settings ────────────────────────────────────────────────────────────

function AISection({ aiSettings }: { aiSettings: CrmAiSettings | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [chatProvider, setChatProvider] = useState(aiSettings?.chat_provider ?? "anthropic");
  const [chatDefaultModel, setChatDefaultModel] = useState(aiSettings?.chat_default_model ?? "");
  const [chatApiKey, setChatApiKey] = useState("");
  const [transcriptionApiKey, setTranscriptionApiKey] = useState("");
  const [budget, setBudget] = useState<string>(aiSettings?.monthly_token_budget?.toString() ?? "");

  const usagePct = aiSettings?.monthly_token_budget
    ? Math.round((aiSettings.tokens_used_this_month / aiSettings.monthly_token_budget) * 100)
    : null;

  const handleSave = () => {
    startTransition(async () => {
      try {
        await updateAISettings({
          chatProvider,
          chatDefaultModel: chatDefaultModel || undefined,
          chatApiKey: chatApiKey || undefined,
          transcriptionApiKey: transcriptionApiKey || undefined,
          monthlyTokenBudget: budget === "" ? null : parseInt(budget, 10),
        });
        toast.success("IA configurada");
        setChatApiKey("");
        setTranscriptionApiKey("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Inteligencia Artificial</h2>
      <p className="text-sm text-muted-foreground">
        Cargá tu propia API key. Cada org paga su consumo.
        Para transcripción de audios <strong>siempre se usa OpenAI Whisper</strong> (Anthropic no transcribe audio).
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Proveedor de chat</Label>
          <Select value={chatProvider} onValueChange={(v) => setChatProvider(v as typeof chatProvider)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
              <SelectItem value="openai">OpenAI (GPT)</SelectItem>
              <SelectItem value="vercel_gateway">Vercel AI Gateway</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Modelo default</Label>
          <Input value={chatDefaultModel} onChange={(e) => setChatDefaultModel(e.target.value)} placeholder={aiSettings?.chat_default_model ?? "claude-sonnet-4-6"} />
        </div>
      </div>

      <div>
        <Label>API Key del chat ({chatProvider})</Label>
        <Input type="password" value={chatApiKey} onChange={(e) => setChatApiKey(e.target.value)} placeholder={aiSettings?.chat_api_key_secret_id ? "•••••••• (configurada)" : "sk-..."} />
        <p className="text-[10px] text-muted-foreground mt-1">
          {chatProvider === "anthropic" && <>Obtenela en <a href="https://console.anthropic.com/" target="_blank" rel="noopener" className="underline">console.anthropic.com</a></>}
          {chatProvider === "openai" && <>Obtenela en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="underline">platform.openai.com/api-keys</a></>}
          {chatProvider === "vercel_gateway" && <>Configurá VERCEL_AI_GATEWAY_API_KEY en .env</>}
        </p>
      </div>

      <div>
        <Label>API Key OpenAI (Whisper para transcripción)</Label>
        <Input type="password" value={transcriptionApiKey} onChange={(e) => setTranscriptionApiKey(e.target.value)} placeholder={aiSettings?.transcription_api_key_secret_id ? "•••••••• (configurada)" : "sk-..."} />
      </div>

      <div>
        <Label>Budget mensual (tokens) — opcional</Label>
        <Input type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="ej: 1000000 (1M tokens/mes)" />
        {aiSettings && (
          <div className="mt-2 text-xs text-muted-foreground">
            Usado este mes: {aiSettings.tokens_used_this_month.toLocaleString()} tokens
            {aiSettings.cost_used_this_month_usd > 0 && ` · $${Number(aiSettings.cost_used_this_month_usd).toFixed(2)} USD`}
            {usagePct !== null && (
              <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-md">
                <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, usagePct)}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} className="bg-emerald-500 hover:bg-emerald-600 text-white">Guardar configuración IA</Button>
      </div>

      <div className="border-t border-border pt-4 mt-4">
        <h3 className="font-semibold mb-3 text-sm">Uso (últimos 30 días)</h3>
        <AIUsageChart />
      </div>
    </section>
  );
}

// ─── Templates ──────────────────────────────────────────────────────────────

function TemplatesSection({ templates, channels }: { templates: CrmWhatsAppTemplate[]; channels: CrmChannel[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const waChannels = channels.filter((c) => c.provider === "meta_cloud");

  const statusColor: Record<string, string> = {
    draft: "bg-zinc-500/10 text-zinc-500",
    pending: "bg-amber-500/10 text-amber-600",
    approved: "bg-emerald-500/10 text-emerald-600",
    rejected: "bg-red-500/10 text-red-600",
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Templates de WhatsApp</h2>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white" disabled={waChannels.length === 0}>
              <Plus className="size-4 mr-1.5" /> Nuevo template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Nuevo template</DialogTitle></DialogHeader>
            <TemplateForm channels={waChannels} onClose={() => setCreating(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="mb-3 p-3 rounded-lg border border-pink-500/30 bg-pink-500/5 text-xs text-pink-700 dark:text-pink-400">
        <strong>Solo WhatsApp.</strong> Instagram no usa templates aprobados — se rige por la ventana de mensajería 24h y tags de re-engagement (HUMAN_AGENT). Para Instagram, usá mensajes libres dentro 24h o broadcasts limitados.
      </div>

      {waChannels.length === 0 && (
        <p className="text-sm text-muted-foreground mb-3">Conectá un canal de WhatsApp Business primero.</p>
      )}

      {templates.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          Sin templates. Templates se necesitan para mensajes proactivos fuera de la ventana 24h.
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="border border-border rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-mono font-medium">{t.name}</code>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted">{t.language}</span>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted">{t.category}</span>
                    <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${statusColor[t.meta_status] ?? statusColor.draft}`}>
                      {t.meta_status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap line-clamp-3">{t.body}</p>
                  {t.meta_rejection_reason && (
                    <p className="text-xs text-red-500 mt-1">Razón rechazo: {t.meta_rejection_reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {t.meta_status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => startTransition(async () => {
                      try {
                        await submitTemplate(t.id);
                        toast.success("Enviado a Meta");
                        router.refresh();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Error");
                      }
                    })}>Enviar</Button>
                  )}
                  {t.meta_status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => startTransition(async () => {
                      await refreshTemplateStatus(t.id);
                      router.refresh();
                    })}>Refrescar status</Button>
                  )}
                  <Button size="sm" variant="ghost" className="hover:text-red-500" onClick={() => {
                    if (confirm("¿Eliminar?")) startTransition(async () => {
                      await deleteTemplate(t.id);
                      router.refresh();
                    });
                  }}>
                    <ExternalLink className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TemplateForm({ channels, onClose }: { channels: CrmChannel[]; onClose: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es_AR");
  const [category, setCategory] = useState<CrmTemplateCategory>("UTILITY");
  const [bodyText, setBodyText] = useState("");
  const [footer, setFooter] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createTemplate({
          channelId,
          name: name.trim(),
          language,
          category,
          bodyText,
          footer: footer || undefined,
          headerType: "NONE",
        });
        toast.success("Template creado (estado: draft). Enviá a Meta para aprobación.");
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 max-h-[70vh] overflow-y-auto">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Canal</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {channels.map((c) => <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Idioma</Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="es_AR">Español (Argentina)</SelectItem>
              <SelectItem value="es">Español</SelectItem>
              <SelectItem value="en_US">Inglés (US)</SelectItem>
              <SelectItem value="pt_BR">Portugués (BR)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Nombre (snake_case)</Label>
        <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="checkin_recordatorio" required />
      </div>
      <div>
        <Label>Categoría</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as CrmTemplateCategory)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="UTILITY">Utility (transaccional)</SelectItem>
            <SelectItem value="MARKETING">Marketing (promocional)</SelectItem>
            <SelectItem value="AUTHENTICATION">Auth (códigos)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Cuerpo</Label>
        <Textarea rows={5} value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Hola {{1}}, te esperamos en {{2}} mañana a las {{3}}." required />
        <p className="text-[10px] text-muted-foreground mt-1">Usar {"{{1}}, {{2}}"} etc. para variables. Meta puede pedir ejemplos.</p>
      </div>
      <div>
        <Label>Footer (opcional)</Label>
        <Input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Apart Cba · Reservas 24/7" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white">Crear (draft)</Button>
      </div>
    </form>
  );
}

// ─── Tags ───────────────────────────────────────────────────────────────────

function TagsSection({ tags }: { tags: CrmTag[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CrmTag | null>(null);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Etiquetas</h2>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white">
              <Plus className="size-4 mr-1.5" /> Nueva etiqueta
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nueva etiqueta</DialogTitle></DialogHeader>
            <TagForm onClose={() => setCreating(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {tags.map((t) => (
          <div key={t.id} className="border border-border rounded-lg p-3 flex items-center gap-2">
            <TagChip tag={t} size="sm" />
            {t.is_system && <span className="text-[10px] uppercase text-muted-foreground">sistema</span>}
            {t.description && <span className="text-xs text-muted-foreground line-clamp-1 ml-1">{t.description}</span>}
            <div className="ml-auto flex items-center gap-1">
              {!t.is_system && (
                <Dialog open={editing?.id === t.id} onOpenChange={(v) => setEditing(v ? t : null)}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0">edit</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Editar tag</DialogTitle></DialogHeader>
                    {editing && <TagForm initial={editing} onClose={() => setEditing(null)} />}
                  </DialogContent>
                </Dialog>
              )}
              {!t.is_system && (
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-red-500" onClick={() => {
                  if (confirm("¿Eliminar tag?")) startTransition(async () => {
                    await deleteTag(t.id);
                    router.refresh();
                  });
                }}>×</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TagForm({ initial, onClose }: { initial?: CrmTag; onClose: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#10b981");
  const [description, setDescription] = useState(initial?.description ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            await upsertTag({ id: initial?.id, name, color, description });
            toast.success("Tag guardada");
            onClose();
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error");
          }
        });
      }}
      className="space-y-3"
    >
      <div>
        <Label>Nombre</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <Label>Color</Label>
        <div className="flex items-center gap-2">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="size-9 cursor-pointer rounded border border-border" />
          <Input value={color} onChange={(e) => setColor(e.target.value)} className="flex-1 font-mono text-sm" />
        </div>
      </div>
      <div>
        <Label>Descripción (opcional)</Label>
        <Textarea rows={2} value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white">Guardar</Button>
      </div>
    </form>
  );
}
