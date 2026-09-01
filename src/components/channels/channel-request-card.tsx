"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  confirmChannelRequest,
  discardChannelRequest,
  undoDiscardChannelRequest,
  type ChannelRequestRow,
} from "@/lib/actions/channel-requests";

/**
 * Una solicitud de OTA esperando decisión.
 *
 * Mismo contrato de UI que la tarjeta de cancelación: el sistema propone, una
 * persona decide, y la acción NO destructiva va primero. La diferencia es que
 * acá no hay urgencia — si nadie toca nada, la solicitud se resuelve sola
 * (Airbnb la retira del feed y se descarta, o pasa el TTL y se confirma).
 */
export function ChannelRequestCard({
  request,
  variant = "pending",
}: {
  request: ChannelRequestRow;
  variant?: "pending" | "discarded";
}) {
  const [isPending, startTransition] = useTransition();
  const canal = request.channel === "airbnb" ? "Airbnb" : "Booking";
  const nights = countNights(request.check_in, request.check_out);
  const days = request.days_to_check_in;
  const urgent = days !== null && days <= 3;

  const run = (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    okMessage: string,
  ) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(okMessage);
      else toast.error(res.error);
    });
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{request.unit?.name ?? "Unidad sin asignar"}</span>
            <Badge variant="outline" className="font-normal">
              {canal}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {request.check_in} → {request.check_out}
            {nights !== null ? ` · ${nights} ${nights === 1 ? "noche" : "noches"}` : ""}
            {request.confirmation_code ? ` · ${request.confirmation_code}` : ""}
          </p>
        </div>
        {request.external_url && (
          <Button asChild size="sm" variant="secondary" className="shrink-0">
            <a href={request.external_url} target="_blank" rel="noopener noreferrer">
              Ver en {canal} <ExternalLink className="ml-1 size-3.5" />
            </a>
          </Button>
        )}
      </div>

      {variant === "pending" ? (
        <p className="text-sm text-muted-foreground">
          Pedida {describeAge(request.hours_since_request)}.{" "}
          {request.holds_availability
            ? // Con hold_availability (hoy, Booking) las fechas SÍ quedan
              // retenidas: decir "no ocupa" dejaría al operador sin explicación
              // para una web que rechaza fechas que el PMS muestra libres.
              "No es una reserva todavía, pero las fechas quedan retenidas hasta que se resuelva."
            : "No ocupa el calendario hasta que se confirme."}{" "}
          Si {canal} la rechaza se descarta sola.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Se descartó sin llegar a ser una reserva: o {canal} la retiró de su calendario, o alguien
          del equipo la marcó como caída.
        </p>
      )}

      {variant === "pending" && urgent && (
        <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          {days !== null && days <= 0
            ? "La llegada es hoy"
            : `Llega en ${days} ${days === 1 ? "día" : "días"}`}
          {" — confirmala o descartala."}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {variant === "pending" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => confirmChannelRequest(request.id), "Se cargó la reserva.")}
            >
              Es una reserva
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => run(() => discardChannelRequest(request.id), "Solicitud descartada.")}
            >
              Se cayó
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(() => undoDiscardChannelRequest(request.id), "Solicitud reactivada.")
            }
          >
            Volver a activar
          </Button>
        )}
      </div>
    </div>
  );
}

/** La antigüedad viene calculada del server: el render no puede leer el reloj. */
function describeAge(hours: number | null): string {
  if (hours === null) return "hace un rato";
  if (hours < 1) return "recién";
  if (hours < 24) return `hace ${hours} h`;
  const d = Math.floor(hours / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

function countNights(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const n = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : null;
}
