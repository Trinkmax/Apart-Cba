"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CalendarOff,
  CircleDot,
  ExternalLink,
  Loader2,
  LockOpen,
  Moon,
  RefreshCw,
  Undo2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDate, formatNights } from "@/lib/format";
import {
  getChannelBlockContext,
  promoteBlockToBooking,
  releaseChannelBlock,
  undoReleaseChannelBlock,
  type ChannelBlockContext,
} from "@/lib/actions/blocks";
import type { BookingWithRelations } from "@/lib/types/database";
import { cn } from "@/lib/utils";

/**
 * Panel de un bloqueo importado (`booking.is_block`).
 *
 * Antes de esto el bloqueo abría el popover de reserva con TODO deshabilitado:
 * el operador veía una barra gris ocupando fechas, sin un solo botón para
 * sacarla — y el único camino real ("Ver completo" → "Editar" → Estado:
 * Cancelada) no lo encontraba nadie. Este componente existe para responder las
 * tres preguntas que el operador tiene delante de una barra gris:
 *
 *   1. ¿qué es esto?          → de dónde vino y por qué no es una reserva
 *   2. ¿sigue vigente?        → si la OTA todavía publica esas fechas cerradas
 *   3. ¿qué hago con esto?    → liberar las fechas o convertirlo en reserva
 *
 * Una sola fuente para las dos superficies donde aparece un bloqueo: el
 * popover del grid del PMS (`variant="popover"`) y el detalle de la reserva,
 * a donde caen el calendario mensual y el mobile (`variant="card"`).
 */

interface Props {
  booking: Pick<
    BookingWithRelations,
    "id" | "source" | "status" | "check_in_date" | "check_out_date"
  >;
  unitCode: string;
  unitName: string;
  variant?: "popover" | "card";
  /** Abre el dialog de edición después de convertirlo en reserva. Opcional en card. */
  onEdit?: () => void;
  onDone?: () => void;
}

export function ChannelBlockPanel({
  booking,
  unitCode,
  unitName,
  variant = "popover",
  onEdit,
  onDone,
}: Props) {
  const router = useRouter();
  const [ctx, setCtx] = useState<ChannelBlockContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [releasing, startRelease] = useTransition();
  const [promoting, startPromote] = useTransition();
  const [undoing, startUndo] = useTransition();

  const sourceMeta = BOOKING_SOURCE_META[booking.source];
  const nights = formatNights(booking.check_in_date, booking.check_out_date);
  const busy = releasing || promoting || undoing;

  useEffect(() => {
    let alive = true;
    getChannelBlockContext(booking.id)
      .then((c) => {
        if (alive) setCtx(c);
      })
      .catch(() => {
        /* el popover funciona igual sin contexto del canal */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [booking.id]);

  const canManage = ctx?.can_manage ?? false;
  const stillInFeed = ctx?.still_in_feed ?? false;
  const released = booking.status === "cancelada";

  function handleUndo() {
    startUndo(async () => {
      const result = await undoReleaseChannelBlock({ booking_id: booking.id });
      if (!result.ok) {
        toast.error("No se pudo restaurar", { description: result.error });
        return;
      }
      toast.success("Bloqueo restaurado", {
        description: `${unitCode} vuelve a estar ocupado en esas fechas.`,
      });
      onDone?.();
      router.refresh();
    });
  }

  function handleRelease() {
    startRelease(async () => {
      const result = await releaseChannelBlock({ booking_id: booking.id });
      if (!result.ok) {
        toast.error("No se pudo liberar", { description: result.error });
        return;
      }
      toast.success("Fechas liberadas", {
        description: `${unitCode} queda disponible del ${formatDate(booking.check_in_date, "d MMM")} al ${formatDate(booking.check_out_date, "d MMM")}.`,
        duration: 10_000,
        // Liberado, el bloqueo sale del calendario y ya no hay dónde volver a
        // encontrarlo: el "deshacer" tiene que estar acá o no está en ningún lado.
        action: {
          label: "Deshacer",
          onClick: () => {
            void undoReleaseChannelBlock({ booking_id: booking.id }).then((r) => {
              if (!r.ok) {
                toast.error("No se pudo deshacer", { description: r.error });
                return;
              }
              toast.success("Bloqueo restaurado");
              router.refresh();
            });
          },
        },
      });
      onDone?.();
      router.refresh();
    });
  }

  function handlePromote() {
    startPromote(async () => {
      const result = await promoteBlockToBooking({ booking_id: booking.id });
      if (!result.ok) {
        toast.error("No se pudo convertir", { description: result.error });
        return;
      }
      toast.success("Ahora es una reserva", {
        description: "Cargale el huésped y el importe.",
      });
      onDone?.();
      onEdit?.();
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "text-sm",
        variant === "popover"
          ? "w-[360px] max-w-[92vw]"
          : "w-full overflow-hidden rounded-xl border bg-card"
      )}
    >
      {/* Header — el gris punteado del bloqueo, para que el panel se lea como
          continuación de la barra que el usuario acaba de tocar. */}
      <div
        className="px-4 pt-3 pb-3 border-b"
        style={{
          background:
            "repeating-linear-gradient(135deg, rgba(100,116,139,0.14) 0 6px, rgba(100,116,139,0.05) 6px 12px)",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            {released ? <LockOpen size={12} /> : <CalendarOff size={12} />}
            {released ? "Fechas liberadas" : "Fechas bloqueadas"}
          </div>
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: sourceMeta.color }}
            />
            {sourceMeta.label}
          </Badge>
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs">
          <CircleDot size={12} className="text-muted-foreground" />
          <span className="font-mono font-semibold">{unitCode}</span>
          <span className="text-muted-foreground truncate">· {unitName}</span>
        </div>

        <div className="mt-1.5 flex items-center gap-2 font-semibold">
          {formatDate(booking.check_in_date, "EEE d MMM")}
          <ArrowRight size={13} className="text-muted-foreground" />
          {formatDate(booking.check_out_date, "EEE d MMM")}
          <span className="ml-auto flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
            <Moon size={11} /> {nights} {nights === 1 ? "noche" : "noches"}
          </span>
        </div>
      </div>

      {/* Qué es + si sigue vigente en la OTA */}
      <div className="px-4 py-3 space-y-2.5">
        {loading ? (
          <Skeleton className="h-4 w-full" />
        ) : (
          <FeedStatus ctx={ctx} sourceLabel={sourceMeta.label} />
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {released ? (
            <>
              Las fechas están disponibles para vender y este bloqueo no se
              vuelve a importar, aunque {sourceMeta.label} lo siga publicando.
            </>
          ) : (
            <>
              Estas fechas están marcadas como cierre: ocupan el calendario para
              no vender dos veces, pero no cuentan como reserva — quedan fuera de
              la lista de reservas, del parte diario, de las limpiezas
              automáticas, de los KPIs y de la liquidación al propietario.
              {booking.source === "booking" && (
                <>
                  {" "}
                  Booking exporta las reservas y los cierres con la misma
                  etiqueta (<span className="font-mono">CLOSED</span>), así que
                  esto lo definió alguien del equipo, no el canal.
                </>
              )}
            </>
          )}
        </p>
      </div>

      <Separator />

      {/* Acciones */}
      {released ? (
        <div className="px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start gap-2 text-xs"
            disabled={!canManage || busy}
            onClick={handleUndo}
          >
            {undoing ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
            <span className="flex-1 text-left">Volver a bloquear estas fechas</span>
          </Button>
        </div>
      ) : canManage ? (
        <div className="px-4 py-3 space-y-2">
          {!confirming ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full justify-start gap-2 text-xs"
                disabled={busy}
                onClick={handlePromote}
              >
                {promoting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <UserPlus size={13} />
                )}
                <span className="flex-1 text-left">Es una reserva real</span>
                <span className="text-[10px] text-muted-foreground">
                  cargar huésped
                </span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full justify-start gap-2 text-xs"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                <LockOpen size={13} />
                <span className="flex-1 text-left">Liberar estas fechas</span>
              </Button>
            </>
          ) : (
            <ReleaseConfirm
              stillInFeed={stillInFeed}
              sourceLabel={sourceMeta.label}
              pending={releasing}
              onCancel={() => setConfirming(false)}
              onConfirm={handleRelease}
            />
          )}
        </div>
      ) : (
        <div className="px-4 py-3 text-[11px] text-muted-foreground">
          Solo admin o recepción puede liberar fechas bloqueadas.
        </div>
      )}

      {/* Pie: rastro hacia el origen real del bloqueo */}
      <div className="px-4 py-2.5 border-t bg-muted/30 flex items-center gap-3 text-[11px]">
        {ctx?.link ? (
          <Link
            href={`/dashboard/canales/${ctx.link.id}`}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw size={11} /> Ver conexión
          </Link>
        ) : (
          <Link
            href="/dashboard/canales"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw size={11} /> Canales de venta
          </Link>
        )}
        {variant === "popover" && (
          <Link
            href={`/dashboard/reservas/${booking.id}`}
            className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink size={11} /> Ver detalle
          </Link>
        )}
      </div>
    </div>
  );
}

/** Semáforo honesto: ¿la OTA sigue publicando estas fechas como ocupadas? */
function FeedStatus({
  ctx,
  sourceLabel,
}: {
  ctx: ChannelBlockContext | null;
  sourceLabel: string;
}) {
  if (!ctx?.reservation) {
    return (
      <Row
        tone="neutral"
        title="Sin conexión de origen"
        detail="Este bloqueo no está vinculado a una conexión activa. Podés liberarlo sin riesgo."
      />
    );
  }

  const { external_status, missing_since, last_seen_at } = ctx.reservation;

  if (external_status === "ignored") {
    return (
      <Row
        tone="neutral"
        title="Liberado por el equipo"
        detail={`Ya no se vuelve a importar desde ${sourceLabel}.`}
      />
    );
  }
  if (external_status === "cancelled") {
    return (
      <Row
        tone="ok"
        title={`Ya no está en ${sourceLabel}`}
        detail="La OTA lo sacó de su calendario. Podés liberarlo sin riesgo."
      />
    );
  }
  if (missing_since) {
    return (
      <Row
        tone="warn"
        title={`Desapareció del calendario de ${sourceLabel}`}
        detail={`Sin verlo desde ${relativeTime(missing_since)}. Se libera solo al confirmarse, o liberalo vos ahora.`}
      />
    );
  }
  return (
    <Row
      tone="live"
      title={`${sourceLabel} sigue mostrando estas fechas ocupadas`}
      detail={
        last_seen_at
          ? `Última lectura del calendario ${relativeTime(last_seen_at)}.`
          : undefined
      }
    />
  );
}

function Row({
  tone,
  title,
  detail,
}: {
  tone: "live" | "ok" | "warn" | "neutral";
  title: string;
  detail?: string;
}) {
  const dot =
    tone === "live"
      ? "bg-amber-500"
      : tone === "ok"
        ? "bg-emerald-500"
        : tone === "warn"
          ? "bg-orange-500"
          : "bg-slate-400";
  return (
    <div className="flex gap-2">
      <span
        className={cn("mt-1 size-2 shrink-0 rounded-full", dot, tone === "live" && "animate-pulse")}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-xs font-medium leading-snug">{title}</div>
        {detail && (
          <div className="text-[11px] leading-snug text-muted-foreground">{detail}</div>
        )}
      </div>
    </div>
  );
}

function ReleaseConfirm({
  stillInFeed,
  sourceLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  stillInFeed: boolean;
  sourceLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-2.5 space-y-2.5">
      {stillInFeed ? (
        <div className="flex gap-2">
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <p className="text-[11px] leading-relaxed">
            <span className="font-semibold">
              {sourceLabel} todavía tiene estas fechas cerradas.
            </span>{" "}
            Si las liberás acá y era una reserva real, podés vender la misma
            fecha dos veces. Liberá solo si sabés que fue un cierre tuyo.
          </p>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Las fechas quedan disponibles para vender. Si {sourceLabel} vuelve a
          informarlas como ocupadas, no se van a importar de nuevo.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 flex-1 text-xs"
          disabled={pending}
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          className="h-7 flex-1 gap-1.5 text-xs"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending && <Loader2 size={12} className="animate-spin" />}
          Liberar
        </Button>
      </div>
    </div>
  );
}

/** "hace 3 min" / "hace 2 h" / "hace 4 días" — sin traer una librería. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return "hace un rato";
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}
