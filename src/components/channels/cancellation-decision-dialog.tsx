"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarX2,
  CircleDollarSign,
  MessageSquareCheck,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { decideCancellation, type PendingCancellation } from "@/lib/actions/channel-cancellations";

/**
 * El diálogo que le devuelve al operador la decisión de cancelar.
 *
 * Antes, cuando una OTA dejaba de listar una reserva, el sistema la cancelaba
 * solo y la reserva se esfumaba del calendario sin dejar rastro. Ahora se
 * pregunta, y la pregunta viene con todo lo que hace falta para responderla:
 * quién es el huésped, cuánto pagó, si ya se le mandó la confirmación y cuánto
 * falta para que llegue.
 *
 * Dos decisiones de diseño que importan:
 *   · "Mantener la reserva" es la acción primaria. Cancelar es lo destructivo y
 *     lo irreversible para el huésped; no puede ser el botón fácil.
 *   · Se puede posponer, pero no descartar. Vuelve en la próxima navegación
 *     hasta que alguien decida — que es exactamente lo que no pasó con las 37
 *     notificaciones que nadie leyó.
 */
export function CancellationDecisionDialog({ pending }: { pending: PendingCancellation[] }) {
  const [dismissed, setDismissed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const queue = pending.filter((p) => !!p);
  const current = queue[0];
  if (!current || dismissed) return null;

  const s = current.snapshot ?? {};
  const cobrado = Number(s.cobrado ?? 0);
  const total = Number(s.total ?? 0);
  const esBloqueo = Boolean(s.es_bloqueo);
  const canal = current.channel === "airbnb" ? "Airbnb" : "Booking";

  const decidir = (decision: "cancel" | "keep") => {
    startTransition(async () => {
      try {
        await decideCancellation({ request_id: current.id, decision });
        toast.success(
          decision === "keep"
            ? "La reserva se mantiene. No te vamos a volver a preguntar por esto."
            : "Reserva cancelada.",
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo guardar la decisión");
      }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && setDismissed(true)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {current.risk === "alto" ? (
              <AlertTriangle className="size-5 shrink-0 text-amber-500" />
            ) : (
              <CalendarX2 className="size-5 shrink-0 text-muted-foreground" />
            )}
            <DialogTitle>
              {esBloqueo
                ? `${canal} sacó un cierre de fechas`
                : `${canal} dejó de mostrar esta reserva`}
            </DialogTitle>
          </div>
          <DialogDescription>
            {current.reason_code === "ota_cancellation_email"
              ? `Llegó un email de ${canal} diciendo que se canceló. Todavía no la cancelamos: confirmalo vos.`
              : `Dejó de aparecer en el calendario de ${canal}. Puede ser una cancelación real o un problema de lectura del feed — no lo podemos distinguir solos.`}
          </DialogDescription>
        </DialogHeader>

        {/* La reserva en cuestión */}
        <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{s.huesped ?? (esBloqueo ? "Cierre de fechas" : "Sin huésped cargado")}</span>
            {s.origen && (
              <Badge variant="outline" className="shrink-0 font-normal">
                {s.origen === "directo" ? "Directa" : s.origen}
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground">
            {s.unidad ?? "Unidad sin nombre"} · {formatRange(s.check_in, s.check_out)}
          </div>
          {typeof s.dias_para_llegada === "number" && s.dias_para_llegada >= 0 && (
            <div className="text-muted-foreground">
              {s.dias_para_llegada === 0
                ? "Llega hoy"
                : s.dias_para_llegada === 1
                  ? "Llega mañana"
                  : `Llega en ${s.dias_para_llegada} días`}
            </div>
          )}
          {total > 0 && (
            <div className="text-muted-foreground">
              Total {money(total, s.moneda)}
              {cobrado > 0 && <> · cobrado {money(cobrado, s.moneda)}</>}
            </div>
          )}
        </div>

        {/* Lo que hace grave a esta decisión, dicho sin vueltas */}
        {(cobrado > 0 || s.confirmacion_enviada) && (
          <ul className="space-y-1.5 text-sm">
            {cobrado > 0 && (
              <li className="flex items-start gap-2">
                <CircleDollarSign className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span>
                  Ya cobraste {money(cobrado, s.moneda)}. Si cancelás, revisá la devolución.
                </span>
              </li>
            )}
            {s.confirmacion_enviada && (
              <li className="flex items-start gap-2">
                <MessageSquareCheck className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span>Al huésped ya se le envió la confirmación de esta reserva.</span>
              </li>
            )}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          Si la mantenés, las fechas siguen ocupadas y no te volvemos a preguntar por esto.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            disabled={isPending}
            onClick={() => setDismissed(true)}
            className="sm:mr-auto"
          >
            Después
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" disabled={isPending} onClick={() => decidir("cancel")}>
              Cancelar la reserva
            </Button>
            <Button disabled={isPending} onClick={() => decidir("keep")}>
              <ShieldCheck className="size-4" />
              Mantener la reserva
            </Button>
          </div>
        </div>

        {queue.length > 1 && (
          <p className="text-center text-xs text-muted-foreground">
            Hay {queue.length - 1} {queue.length - 1 === 1 ? "aviso más" : "avisos más"} esperando
            tu decisión.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatRange(from?: string | null, to?: string | null): string {
  if (!from || !to) return "fechas sin definir";
  return `${short(from)} → ${short(to)}`;
}

function short(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y.slice(2)}`;
}

function money(amount: number, currency?: string | null): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: currency ?? "ARS",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency ?? "ARS"} ${Math.round(amount).toLocaleString("es-AR")}`;
  }
}
