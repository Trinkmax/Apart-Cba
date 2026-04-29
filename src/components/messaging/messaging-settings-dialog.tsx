"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  Check,
  RefreshCcw,
  Plug,
  PlugZap,
  Tag as TagIcon,
  Plus,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  upsertChannel,
  testChannelConnection,
  regenerateVerifyToken,
  createTag,
  updateTag,
  deleteTag,
} from "@/lib/actions/messaging";
import { toast } from "sonner";
import { WhatsAppIcon, InstagramIcon } from "./channel-icons";
import type { MessagingChannel, MessagingTag } from "@/lib/types/database";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channels: MessagingChannel[];
  tags: MessagingTag[];
}

type Tab = "whatsapp" | "instagram" | "tags";

export function MessagingSettingsDialog({ open, onOpenChange, channels, tags }: Props) {
  const [tab, setTab] = useState<Tab>("whatsapp");

  const wa = channels.find((c) => c.channel_type === "whatsapp") ?? null;
  const ig = channels.find((c) => c.channel_type === "instagram") ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] p-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border flex-shrink-0">
          <DialogTitle>Configuración de mensajería</DialogTitle>
          <DialogDescription>
            Conectá tus canales de Meta y gestioná las etiquetas del inbox.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex-shrink-0 border-b border-border px-5">
          <div className="flex items-center gap-1">
            <TabButton
              active={tab === "whatsapp"}
              onClick={() => setTab("whatsapp")}
              icon={<WhatsAppIcon className="size-4" />}
              label="WhatsApp"
              status={wa?.status ?? "disconnected"}
            />
            <TabButton
              active={tab === "instagram"}
              onClick={() => setTab("instagram")}
              icon={<InstagramIcon className="size-4" />}
              label="Instagram"
              status={ig?.status ?? "disconnected"}
            />
            <TabButton
              active={tab === "tags"}
              onClick={() => setTab("tags")}
              icon={<TagIcon className="size-4 text-muted-foreground" />}
              label="Etiquetas"
              count={tags.length}
            />
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto">
          {tab === "whatsapp" && <ChannelForm channel={wa} channelType="whatsapp" />}
          {tab === "instagram" && <ChannelForm channel={ig} channelType="instagram" />}
          {tab === "tags" && <TagsManager initialTags={tags} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  status,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  status?: "connected" | "disconnected" | "error";
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      {status && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "connected"
              ? "bg-emerald-500"
              : status === "error"
              ? "bg-red-500"
              : "bg-muted-foreground/40"
          )}
        />
      )}
      {count !== undefined && (
        <span className="text-[10px] tabular-nums opacity-70">{count}</span>
      )}
    </button>
  );
}

// ─── Channel form ────────────────────────────────────────────────────────────

function ChannelForm({
  channel,
  channelType,
}: {
  channel: MessagingChannel | null;
  channelType: "whatsapp" | "instagram";
}) {
  const [accessToken, setAccessToken] = useState(channel?.access_token ?? "");
  const [appId, setAppId] = useState(channel?.app_id ?? "");
  const [appSecret, setAppSecret] = useState(channel?.app_secret ?? "");
  const [businessId, setBusinessId] = useState(channel?.business_account_id ?? "");
  const [phoneId, setPhoneId] = useState(channel?.phone_number_id ?? "");
  const [igAccountId, setIgAccountId] = useState(channel?.instagram_account_id ?? "");
  const [displayName, setDisplayName] = useState(channel?.display_name ?? "");
  const [showSecrets, setShowSecrets] = useState(false);
  const [savePending, startSave] = useTransition();
  const [testPending, startTest] = useTransition();
  const [tokenPending, startTokenRegen] = useTransition();
  const [verifyToken, setVerifyToken] = useState(channel?.webhook_verify_token ?? "");

  useEffect(() => {
    if (channel) {
      setAccessToken(channel.access_token ?? "");
      setAppId(channel.app_id ?? "");
      setAppSecret(channel.app_secret ?? "");
      setBusinessId(channel.business_account_id ?? "");
      setPhoneId(channel.phone_number_id ?? "");
      setIgAccountId(channel.instagram_account_id ?? "");
      setDisplayName(channel.display_name ?? "");
      setVerifyToken(channel.webhook_verify_token);
    }
  }, [channel]);

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? "");
  const webhookUrl = `${baseUrl}/api/webhooks/meta/${channelType}`;

  const handleSave = () => {
    startSave(async () => {
      try {
        await upsertChannel({
          channel_type: channelType,
          display_name: displayName || null,
          access_token: accessToken || null,
          app_id: appId || null,
          app_secret: appSecret || null,
          business_account_id: businessId || null,
          phone_number_id: channelType === "whatsapp" ? phoneId || null : null,
          instagram_account_id: channelType === "instagram" ? igAccountId || null : null,
          graph_api_version: channel?.graph_api_version ?? "v21.0",
          active: true,
        });
        toast.success("Configuración guardada");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  };

  const handleTest = () => {
    if (!channel) {
      toast.error("Guardá primero la configuración");
      return;
    }
    startTest(async () => {
      const r = await testChannelConnection(channel.id);
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    });
  };

  const regenerateToken = () => {
    if (!channel) return;
    startTokenRegen(async () => {
      try {
        const t = await regenerateVerifyToken(channel.id);
        setVerifyToken(t);
        toast.success("Token regenerado. Actualizalo en Meta.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  const isConnected = channel?.status === "connected";
  const isError = channel?.status === "error";
  const isWA = channelType === "whatsapp";

  return (
    <div className="p-5 space-y-5">
      {/* Estado */}
      <div
        className={cn(
          "rounded-lg border p-3 flex items-start gap-3",
          isConnected
            ? "border-emerald-500/40 bg-emerald-500/5"
            : isError
            ? "border-red-500/40 bg-red-500/5"
            : "border-border bg-muted/40"
        )}
      >
        <div
          className={cn(
            "size-9 rounded-lg grid place-items-center shrink-0",
            isConnected
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : isError
              ? "bg-red-500/15 text-red-500"
              : "bg-muted text-muted-foreground"
          )}
        >
          {isConnected ? <PlugZap size={17} /> : <Plug size={17} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">
            {isConnected ? "Conectado" : isError ? "Error de conexión" : "No conectado"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {channel?.status_detail ??
              `Configurá las credenciales para conectar ${
                isWA ? "WhatsApp Business" : "Instagram Direct"
              }.`}
          </p>
        </div>
        {channel && (
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testPending} className="gap-1.5">
            {testPending ? <RefreshCcw size={12} className="animate-spin" /> : <Plug size={12} />}
            Probar
          </Button>
        )}
      </div>

      {/* Webhook setup */}
      <Section
        step={1}
        title="Configurar webhook en Meta"
        subtitle={
          isWA
            ? "Meta Developer Console → WhatsApp → Configuración → Webhook"
            : "Meta Developer Console → Instagram → Webhooks (suscribite al campo messages)"
        }
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">URL de devolución de llamada</Label>
            <CopyField value={webhookUrl} className="mt-1.5" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Token de verificación</Label>
              {channel && (
                <button
                  type="button"
                  onClick={regenerateToken}
                  disabled={tokenPending}
                  className="text-[10px] text-primary hover:underline"
                >
                  Regenerar
                </button>
              )}
            </div>
            <CopyField value={verifyToken || "Guardá la configuración para generar el token"} className="mt-1.5" mono />
          </div>
          <div className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="text-emerald-500">●</span> Evento a suscribir:{" "}
            <code className="text-emerald-500 font-mono">messages</code>
          </div>
        </div>
      </Section>

      {/* Credenciales */}
      <Section
        step={2}
        title={`Credenciales ${isWA ? "Meta API · WhatsApp" : "Meta API · Instagram"}`}
        subtitle="Las obtenés en tu app de Meta for Developers (Business Settings)."
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="ch-name" className="text-xs">
              Nombre interno (opcional)
            </Label>
            <Input
              id="ch-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={isWA ? "ej. Apart Cba +54 351…" : "@apartcba"}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="ch-token" className="text-xs">
              Access Token <span className="text-red-500">*</span>
            </Label>
            <div className="relative mt-1.5">
              <Input
                id="ch-token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                type={showSecrets ? "text" : "password"}
                placeholder="EAA…"
                className="pr-10 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowSecrets((p) => !p)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecrets ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {isWA ? (
            <>
              <div>
                <Label htmlFor="ch-phone" className="text-xs">
                  Phone Number ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ch-phone"
                  value={phoneId}
                  onChange={(e) => setPhoneId(e.target.value)}
                  placeholder="106440…"
                  className="mt-1.5 font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  ID del número de teléfono de WhatsApp Business.
                </p>
              </div>
              <div>
                <Label htmlFor="ch-waba" className="text-xs">
                  WhatsApp Business Account ID
                </Label>
                <Input
                  id="ch-waba"
                  value={businessId}
                  onChange={(e) => setBusinessId(e.target.value)}
                  placeholder="WABA ID"
                  className="mt-1.5 font-mono text-xs"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="ch-page" className="text-xs">
                  Facebook Page ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ch-page"
                  value={businessId}
                  onChange={(e) => setBusinessId(e.target.value)}
                  placeholder="1871…"
                  className="mt-1.5 font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  ID de la Página de Facebook conectada a tu Instagram Business.
                </p>
              </div>
              <div>
                <Label htmlFor="ch-ig" className="text-xs">
                  Instagram Account ID <span className="text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  id="ch-ig"
                  value={igAccountId}
                  onChange={(e) => setIgAccountId(e.target.value)}
                  placeholder="178414…"
                  className="mt-1.5 font-mono text-xs"
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ch-app" className="text-xs">
                App ID <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="ch-app"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="App ID de Meta"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="ch-secret" className="text-xs">
                App Secret <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="ch-secret"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="••••••"
                type={showSecrets ? "text" : "password"}
                className="mt-1.5 font-mono text-xs"
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Acciones */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button onClick={handleSave} disabled={savePending} className="gap-2">
          {savePending && <RefreshCcw size={14} className="animate-spin" />}
          Guardar configuración
        </Button>
      </div>
    </div>
  );
}

function Section({
  step,
  title,
  subtitle,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-start gap-3 mb-3">
        <span className="size-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center shrink-0 mt-0.5">
          {step}
        </span>
        <div>
          <h3 className="text-xs uppercase tracking-wide font-semibold">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </header>
      <div className="pl-9">{children}</div>
    </section>
  );
}

function CopyField({ value, mono, className }: { value: string; mono?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("relative", className)}>
      <Input
        readOnly
        value={value}
        className={cn(
          "pr-10 cursor-pointer select-all bg-muted/40 hover:bg-muted/60 transition-colors",
          mono && "font-mono text-xs"
        )}
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
        title="Copiar"
      >
        {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// ─── Tags manager ────────────────────────────────────────────────────────────

function TagsManager({ initialTags }: { initialTags: MessagingTag[] }) {
  const [tags, setTags] = useState<MessagingTag[]>(initialTags);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#10b981");
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const addTag = () => {
    if (!newLabel.trim()) return;
    startTransition(async () => {
      try {
        const r = await createTag({
          label: newLabel.trim(),
          color: newColor,
          description: null,
          sort_order: tags.length,
        });
        setTags((prev) => [...prev, r]);
        setNewLabel("");
        setNewColor("#10b981");
        toast.success("Etiqueta creada");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <div className="p-5 space-y-4">
      <div className="rounded-lg border border-border bg-card p-3">
        <Label className="text-xs">Crear etiqueta</Label>
        <div className="flex items-center gap-2 mt-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="ej. Pre-llegada, VIP, Reclamo…"
            className="flex-1 h-9"
          />
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="size-9 rounded-md border border-input cursor-pointer"
            title="Color"
          />
          <Button onClick={addTag} disabled={!newLabel.trim() || pending} className="gap-1.5">
            <Plus size={14} /> Crear
          </Button>
        </div>
      </div>

      <ul className="space-y-1.5">
        {tags.length === 0 && (
          <li className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Sin etiquetas todavía. Las etiquetas te ayudan a clasificar conversaciones por
            tipo de consulta.
          </li>
        )}
        {tags.map((t) => (
          <TagRow
            key={t.id}
            tag={t}
            isEditing={editingId === t.id}
            onStartEdit={() => setEditingId(t.id)}
            onCancelEdit={() => setEditingId(null)}
            onUpdated={(updated) => {
              setTags((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
              setEditingId(null);
            }}
            onDeleted={() => setTags((prev) => prev.filter((x) => x.id !== t.id))}
          />
        ))}
      </ul>
    </div>
  );
}

function TagRow({
  tag,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onUpdated,
  onDeleted,
}: {
  tag: MessagingTag;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onUpdated: (t: MessagingTag) => void;
  onDeleted: () => void;
}) {
  const [label, setLabel] = useState(tag.label);
  const [color, setColor] = useState(tag.color);
  const [pending, startTransition] = useTransition();

  if (isEditing) {
    return (
      <li className="rounded-lg border border-border bg-card p-2.5 flex items-center gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="size-7 rounded border border-input cursor-pointer"
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="flex-1 h-8"
        />
        <Button
          size="sm"
          className="h-8"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              try {
                const r = await updateTag(tag.id, { label, color });
                onUpdated(r);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error");
              }
            });
          }}
        >
          <Check size={13} />
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={onCancelEdit}>
          <X size={13} />
        </Button>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border bg-card p-2.5 flex items-center gap-3 group">
      <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
      <span className="text-sm font-medium flex-1">{tag.label}</span>
      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
        <Button size="icon" variant="ghost" className="size-7" onClick={onStartEdit}>
          <Pencil size={12} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
          disabled={pending}
          onClick={() => {
            if (!confirm(`¿Eliminar etiqueta "${tag.label}"?`)) return;
            startTransition(async () => {
              try {
                await deleteTag(tag.id);
                onDeleted();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error");
              }
            });
          }}
        >
          <Trash2 size={12} />
        </Button>
      </div>
    </li>
  );
}
