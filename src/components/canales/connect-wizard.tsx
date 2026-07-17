"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  CircleEllipsis,
  Download,
  Loader2,
  Search,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "./copy-button";
import {
  activateLink,
  createDraftLinks,
  getLinkExportUrl,
  saveLinkFeed,
} from "@/lib/actions/channels";
import type { ChannelLinkOverview } from "@/lib/actions/channels";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import type { Channel } from "@/lib/channels/types";

/**
 * Asistente de conexión — persistente y recuperable: los borradores viven en
 * channel_links, así que salir y volver retoma donde quedó. Una selección
 * múltiple crea un checklist POR UNIDAD (cada anuncio tiene su propia URL:
 * una sola URL no sirve para varios anuncios).
 */
export function ConnectWizard({
  units,
  links,
  focusLinkId,
}: {
  units: { id: string; code: string; name: string }[];
  links: ChannelLinkOverview[];
  focusLinkId?: string;
}) {
  const focusLink = links.find((l) => l.id === focusLinkId);
  const [channel, setChannel] = useState<Channel | null>(focusLink?.channel ?? null);
  const [step, setStep] = useState<"channel" | "units" | "checklist">(
    focusLink ? "checklist" : "channel",
  );

  const drafts = useMemo(
    () => links.filter((l) => l.status === "draft" && (!channel || l.channel === channel)),
    [links, channel],
  );
  const pendingVerification = useMemo(
    () => links.filter((l) => l.status === "active" && !l.last_export_access_at),
    [links],
  );

  return (
    <div className="space-y-4">
      {step === "channel" && (
        <ChannelStep
          onPick={(c) => {
            setChannel(c);
            setStep("units");
          }}
          drafts={links.filter((l) => l.status === "draft")}
          onResume={(c) => {
            setChannel(c);
            setStep("checklist");
          }}
          pendingVerification={pendingVerification.length}
        />
      )}
      {step === "units" && channel && (
        <UnitsStep
          channel={channel}
          units={units}
          links={links}
          onBack={() => setStep("channel")}
          onCreated={() => setStep("checklist")}
        />
      )}
      {step === "checklist" && channel && (
        <ChecklistStep
          channel={channel}
          drafts={drafts}
          focusLinkId={focusLinkId}
          onBack={() => setStep("channel")}
          onAddMore={() => setStep("units")}
        />
      )}
    </div>
  );
}

// ─── Paso 1: elegir OTA ──────────────────────────────────────────────────────

function ChannelStep({
  onPick,
  onResume,
  drafts,
  pendingVerification,
}: {
  onPick: (c: Channel) => void;
  onResume: (c: Channel) => void;
  drafts: ChannelLinkOverview[];
  pendingVerification: number;
}) {
  const draftAirbnb = drafts.filter((d) => d.channel === "airbnb").length;
  const draftBooking = drafts.filter((d) => d.channel === "booking").length;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">1 · ¿Con qué canal querés conectar?</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Cada departamento se conecta canal por canal. Podés repetir el asistente para el otro canal.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        {(["airbnb", "booking"] as const).map((c) => {
          const meta = BOOKING_SOURCE_META[c];
          const draftCount = c === "airbnb" ? draftAirbnb : draftBooking;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold" style={{ color: meta.color }}>
                  {meta.label}
                </span>
                <ArrowRight size={15} className="text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {c === "airbnb"
                  ? "Sincronización por calendario (iCal) del anuncio."
                  : "Sincronización por calendario (iCal) de la propiedad."}
              </p>
              {draftCount > 0 && (
                <span
                  className="mt-2 inline-block text-[11px] underline underline-offset-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResume(c);
                  }}
                >
                  Retomar {draftCount} {draftCount === 1 ? "borrador" : "borradores"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {pendingVerification > 0 && (
        <p className="text-xs text-muted-foreground">
          {pendingVerification} {pendingVerification === 1 ? "conexión activa espera" : "conexiones activas esperan"}{" "}
          que la OTA consulte el calendario por primera vez — no requiere acción tuya.
        </p>
      )}
    </div>
  );
}

// ─── Paso 2: elegir unidades ─────────────────────────────────────────────────

function UnitsStep({
  channel,
  units,
  links,
  onBack,
  onCreated,
}: {
  channel: Channel;
  units: { id: string; code: string; name: string }[];
  links: ChannelLinkOverview[];
  onBack: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const meta = BOOKING_SOURCE_META[channel];

  const connectedUnits = new Set(links.filter((l) => l.channel === channel).map((l) => l.unit_id));
  const filtered = units.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return u.code.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function create() {
    startTransition(async () => {
      try {
        const r = await createDraftLinks({ channel, unit_ids: Array.from(selected) });
        toast.success(`${r.created} ${r.created === 1 ? "conexión creada" : "conexiones creadas"}`);
        router.refresh();
        onCreated();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al crear las conexiones");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">
            2 · Elegí los departamentos para{" "}
            <span style={{ color: meta.color }}>{meta.label}</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Cada departamento tendrá su propio checklist (los anuncios no comparten calendario).
          </p>
        </div>
        <div className="relative w-56">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar…"
            className="pl-8 h-9"
            aria-label="Buscar unidad"
          />
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <ul className="divide-y divide-border max-h-[420px] overflow-y-auto">
          {filtered.map((u) => {
            const already = connectedUnits.has(u.id);
            return (
              <li key={u.id}>
                <label
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                    already ? "opacity-50" : "cursor-pointer hover:bg-accent/30"
                  }`}
                >
                  <Checkbox
                    checked={already || selected.has(u.id)}
                    disabled={already}
                    onCheckedChange={() => toggle(u.id)}
                    aria-label={`Seleccionar ${u.code}`}
                  />
                  <span className="font-mono text-xs text-muted-foreground w-14 shrink-0">{u.code}</span>
                  <span className="flex-1 truncate">{u.name}</span>
                  {already && <Badge variant="secondary">Ya conectado</Badge>}
                </label>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">Sin resultados.</li>
          )}
        </ul>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft size={14} /> Volver
        </Button>
        <Button onClick={create} disabled={selected.size === 0 || pending} className="gap-1.5">
          {pending && <Loader2 size={14} className="animate-spin" />}
          Crear checklist ({selected.size})
        </Button>
      </div>
    </div>
  );
}

// ─── Paso 3: checklist por unidad ────────────────────────────────────────────

function ChecklistStep({
  channel,
  drafts,
  focusLinkId,
  onBack,
  onAddMore,
}: {
  channel: Channel;
  drafts: ChannelLinkOverview[];
  focusLinkId?: string;
  onBack: () => void;
  onAddMore: () => void;
}) {
  const meta = BOOKING_SOURCE_META[channel];
  const otaCalendarPath =
    channel === "airbnb"
      ? "Airbnb → Calendario → Disponibilidad → Conectar calendarios"
      : "Booking.com → Tarifas y disponibilidad → Sincronizar calendarios";

  if (drafts.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="p-8 text-center space-y-2">
          <CircleCheck size={22} className="mx-auto text-emerald-600" />
          <p className="text-sm font-medium">No quedan borradores pendientes para {meta.label}</p>
          <p className="text-xs text-muted-foreground">
            Podés agregar más departamentos o volver al tablero.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button variant="outline" onClick={onAddMore}>
              Agregar departamentos
            </Button>
            <Button asChild>
              <Link href="/dashboard/canales">Ir al tablero</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">
          3 · Checklist por departamento — <span style={{ color: meta.color }}>{meta.label}</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Para cada departamento: pegá el calendario del anuncio (paso A), copiá nuestro calendario y
          cargalo en <b>{otaCalendarPath}</b> (paso B), y activá. La conexión queda{" "}
          <b>Esperando verificación</b> hasta que la OTA consulte nuestro calendario por primera vez.
        </p>
      </div>

      <div className="space-y-3">
        {drafts.map((d) => (
          <DraftChecklistCard key={d.id} link={d} highlight={d.id === focusLinkId} channel={channel} />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft size={14} /> Volver
        </Button>
        <Button variant="outline" onClick={onAddMore}>
          Agregar más departamentos
        </Button>
      </div>
    </div>
  );
}

function DraftChecklistCard({
  link,
  channel,
  highlight,
}: {
  link: ChannelLinkOverview;
  channel: Channel;
  highlight?: boolean;
}) {
  const router = useRouter();
  const [feedUrl, setFeedUrl] = useState("");
  const [feedSaved, setFeedSaved] = useState(Boolean(link.feed_secret_id));
  const [feedEvents, setFeedEvents] = useState<number | null>(null);
  const [saving, startSaving] = useTransition();
  const [activating, startActivating] = useTransition();

  function saveFeed() {
    startSaving(async () => {
      try {
        const r = await saveLinkFeed({ link_id: link.id, feed_url: feedUrl.trim() });
        setFeedSaved(true);
        setFeedEvents(r.events);
        toast.success(`Calendario leído correctamente (${r.events} eventos)`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo leer el calendario");
      }
    });
  }

  function activate() {
    startActivating(async () => {
      try {
        await activateLink(link.id);
        toast.success(`${link.unit.code} conectado — primera sincronización ejecutada`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo activar");
      }
    });
  }

  const placeholder =
    channel === "airbnb"
      ? "https://www.airbnb.com/calendar/ical/…ics?s=…"
      : "https://ical.booking.com/v1/export?t=…";

  return (
    <Card className={`p-4 space-y-3 ${highlight ? "border-primary/50" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{link.unit.code}</span>
        <span className="font-medium text-sm">{link.unit.name}</span>
        <Badge variant="secondary" className="ml-auto">
          Borrador
        </Badge>
      </div>
      <Separator />

      {/* Paso A: feed entrante */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium flex items-center gap-1.5">
          <Download size={12} />
          A · Pegá el enlace del calendario del anuncio
          {feedSaved && (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Check size={12} /> cargado{feedEvents !== null ? ` (${feedEvents} eventos)` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder={placeholder}
            className="h-9 text-xs font-mono"
            aria-label={`Calendario entrante de ${link.unit.code}`}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={saveFeed}
            disabled={!feedUrl.trim() || saving}
            className="gap-1.5 shrink-0"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Probar y guardar
          </Button>
        </div>
      </div>

      {/* Paso B: export saliente */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium flex items-center gap-1.5">
          <Upload size={12} /> B · Cargá nuestro calendario dentro de la OTA
        </div>
        <div className="flex items-center gap-2">
          <CopyButton
            getValue={() => getLinkExportUrl(link.id)}
            label="Copiar enlace de nuestro calendario"
            size="sm"
          />
          <span className="text-[11px] text-muted-foreground">
            {link.last_export_access_at ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CircleCheck size={11} /> La OTA ya lo consultó
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <CircleEllipsis size={11} /> Aún no consultado por la OTA
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Paso C: activar */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-muted-foreground">
          Al activar, revisamos el calendario cada 5 minutos. La OTA decide cuándo relee el nuestro.
        </p>
        <Button size="sm" onClick={activate} disabled={!feedSaved || activating} className="gap-1.5">
          {activating && <Loader2 size={13} className="animate-spin" />}
          Activar conexión
        </Button>
      </div>
    </Card>
  );
}
