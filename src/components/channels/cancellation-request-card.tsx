"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CircleDollarSign, MessageSquareCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { decideCancellation, type PendingCancellation } from "@/lib/actions/channel-cancellations";

/** La misma decisión que el diálogo, en formato lista para la bandeja. */
export function CancellationRequestCard({ request }: { request: PendingCancellation }) {
  const [isPending, startTransition] = useTransition();
  const s = request.snapshot ?? {};
  const cobrado = Number(s.cobrado ?? 0);
  const canal = request.channel === "airbnb" ? "Airbnb" : "Booking";

  const decidir = (decision: "cancel" | "keep") => {
    startTransition(async () => {
      try {
        await decideCancellation({ request_id: request.id, decision });
        toast.success(decision === "keep" ? "La reserva se mantiene." : "Reserva cancelada.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo guardar la decisión");
      }
    });
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {request.risk === "alto" && (
              <AlertTriangle className="size-4 shrink-0 text-amber-500" />
            )}
            <span className="font-medium">
              {s.huesped ?? (s.es_bloqueo ? "Cierre de fechas" : "Sin huésped cargado")}
            </span>
            {s.origen && (
              <Badge variant="outline" className="font-normal">
                {s.origen === "directo" ? "Directa" : s.origen}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {s.unidad ?? "Unidad sin nombre"} · {s.check_in} → {s.check_out}
          </p>
        </div>
        {request.booking_id && (
          <Link
            href={`/dashboard/reservas/${request.booking_id}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Ver la reserva
          </Link>
        )}
      </div>

      <p className="text-sm">
        {request.reason_code === "ota_cancellation_email"
          ? `${canal} avisó por email que se canceló.`
          : `${canal} dejó de mostrarla en su calendario. Puede ser una cancelación real o un problema de lectura del feed.`}
      </p>

      {(cobrado > 0 || s.confirmacion_enviada) && (
        <ul className="space-y-1 text-sm">
          {cobrado > 0 && (
            <li className="flex items-start gap-2">
              <CircleDollarSign className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <span>Ya cobraste {money(cobrado, s.moneda)}.</span>
            </li>
          )}
          {s.confirmacion_enviada && (
            <li className="flex items-start gap-2">
              <MessageSquareCheck className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <span>Al huésped ya se le envió la confirmación.</span>
            </li>
          )}
        </ul>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" size="sm" disabled={isPending} onClick={() => decidir("cancel")}>
          Cancelar la reserva
        </Button>
        <Button size="sm" disabled={isPending} onClick={() => decidir("keep")}>
          <ShieldCheck className="size-4" />
          Mantener
        </Button>
      </div>
    </div>
  );
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
