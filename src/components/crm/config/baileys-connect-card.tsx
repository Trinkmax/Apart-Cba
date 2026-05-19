"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Smartphone, QrCode, LogOut, RefreshCw, ShieldAlert, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useRealtimeRows } from "@/hooks/use-realtime-rows";
import {
  connectBaileys,
  disconnectBaileys,
  requestBaileysPairingCode,
  getBaileysState,
  type BaileysState,
} from "@/lib/actions/crm-baileys";
import type { CrmBaileysSession, CrmBaileysSessionStatus } from "@/lib/types/database";

const STATUS_META: Record<
  CrmBaileysSessionStatus,
  { label: string; tone: "green" | "amber" | "red" | "zinc" }
> = {
  connected: { label: "Conectado", tone: "green" },
  connecting: { label: "Conectando…", tone: "amber" },
  qr: { label: "Escaneá el QR", tone: "amber" },
  pairing: { label: "Ingresá el código", tone: "amber" },
  disconnected: { label: "Desconectado", tone: "zinc" },
  logged_out: { label: "Sesión cerrada en el teléfono", tone: "red" },
  conflict: { label: "Conflicto (WhatsApp Web abierto en otro lado)", tone: "red" },
  error: { label: "Error", tone: "red" },
  banned: { label: "Número bloqueado por WhatsApp", tone: "red" },
};

const TONE_CLASS: Record<"green" | "amber" | "red" | "zinc", string> = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  red: "bg-red-500/15 text-red-700 dark:text-red-400",
  zinc: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

export function BaileysConnectCard({
  organizationId,
  initial,
}: {
  organizationId: string;
  initial: BaileysState;
}) {
  const [session, setSession] = useState<CrmBaileysSession | null>(initial.session);
  const [channelStatus, setChannelStatus] = useState(initial.channel?.status ?? null);
  const [phoneInput, setPhoneInput] = useState("");
  const [pending, startTransition] = useTransition();

  const status: CrmBaileysSessionStatus = session?.status ?? "disconnected";
  const isPendingLink = status === "qr" || status === "pairing" || status === "connecting";

  const refresh = useCallback(async () => {
    try {
      const s = await getBaileysState();
      setSession(s.session);
      setChannelStatus(s.channel?.status ?? null);
    } catch {
      /* noop */
    }
  }, []);

  // Live updates while the admin scans (gateway is the single writer).
  useRealtimeRows<CrmBaileysSession>({
    table: "crm_baileys_sessions",
    organizationId,
    onInsert: (row) => setSession(row),
    onUpdate: (row) => setSession(row),
  });

  // Fallback poll while a link is in progress (QR rotates ~every minute).
  useEffect(() => {
    if (!isPendingLink) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [isPendingLink, refresh]);

  const handleConnect = () =>
    startTransition(async () => {
      try {
        await connectBaileys();
        toast.success("Generando QR… escanealo desde WhatsApp en el teléfono.");
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo conectar");
      }
    });

  const handlePairing = () =>
    startTransition(async () => {
      try {
        await requestBaileysPairingCode({ phoneNumber: phoneInput });
        toast.success("Pedí el código. Ingresalo en el teléfono cuando aparezca.");
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo generar el código");
      }
    });

  const handleDisconnect = () =>
    startTransition(async () => {
      if (!confirm("¿Desvincular WhatsApp? Vas a tener que volver a escanear el QR.")) return;
      try {
        await disconnectBaileys();
        toast.success("WhatsApp desvinculado");
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al desvincular");
      }
    });

  const meta = STATUS_META[status];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-emerald-500/15 grid place-items-center">
            <Smartphone className="size-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold leading-tight">WhatsApp (vía Baileys)</h3>
            <p className="text-xs text-muted-foreground">
              Vinculá un número con QR — como WhatsApp Web. Sin API oficial.
            </p>
          </div>
        </div>
        <Badge className={TONE_CLASS[meta.tone]} variant="secondary">
          {meta.label}
        </Badge>
      </div>

      {!initial.configured && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
          El gateway no está configurado. Definí <code>WHATSAPP_GATEWAY_URL</code> y{" "}
          <code>WHATSAPP_GATEWAY_SECRET</code> en el entorno de la app (y desplegá el
          servicio <code>whatsapp-gateway</code> en Railway).
        </div>
      )}

      {status === "connected" && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Número vinculado:</span>
          <span className="font-medium">+{session?.phone ?? "—"}</span>
          {session?.device_name && (
            <span className="text-muted-foreground">· {session.device_name}</span>
          )}
        </div>
      )}

      {status === "qr" && session?.qr && (
        <div className="flex flex-col items-center gap-2 py-2">
          <Image
            src={session.qr}
            alt="QR de WhatsApp"
            width={240}
            height={240}
            unoptimized
            className="rounded-lg border bg-white p-2"
          />
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <QrCode className="size-3.5" />
            WhatsApp → Dispositivos vinculados → Vincular un dispositivo
          </p>
        </div>
      )}

      {status === "pairing" && session?.pairing_code && (
        <div className="flex flex-col items-center gap-1.5 py-3">
          <p className="text-xs text-muted-foreground">Código de vinculación</p>
          <p className="text-3xl font-mono font-bold tracking-[0.3em]">
            {session.pairing_code}
          </p>
          <p className="text-xs text-muted-foreground">
            Teléfono → Dispositivos vinculados → Vincular con número
          </p>
        </div>
      )}

      {session?.last_error && status !== "connected" && (
        <p className="text-xs text-red-600 dark:text-red-400">{session.last_error}</p>
      )}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        {status === "connected" ? (
          <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={pending}>
            <LogOut className="size-4" /> Desvincular
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={handleConnect} disabled={pending || !initial.configured}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
              {isPendingLink ? "Regenerar QR" : "Conectar con QR"}
            </Button>
            <div className="flex items-center gap-1.5">
              <Input
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="549351… (sin +)"
                inputMode="numeric"
                className="h-9 w-40"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handlePairing}
                disabled={pending || !initial.configured || phoneInput.replace(/[^0-9]/g, "").length < 8}
              >
                Vincular por número
              </Button>
            </div>
          </>
        )}
        {isPendingLink && (
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={pending}>
            <RefreshCw className="size-4" /> Actualizar
          </Button>
        )}
      </div>

      <div className="rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground flex gap-2">
        <ShieldAlert className="size-4 shrink-0 mt-0.5" />
        <span>
          Baileys usa WhatsApp Web de forma no oficial. Hay riesgo de bloqueo del
          número, sobre todo con envíos masivos. Usá un número dedicado, evitá spam
          y respetá los tiempos. La API oficial de Meta sigue disponible por
          organización si necesitás cumplimiento estricto de los términos.
          {channelStatus ? ` · Canal: ${channelStatus}` : ""}
        </span>
      </div>
    </Card>
  );
}
