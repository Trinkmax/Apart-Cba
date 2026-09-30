import Link from "next/link";
import { ChevronRight, MessageCircle, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import type { BookingRequestWithRelations } from "@/lib/types/database";
import { displayTitle, formatPhoneAR, whatsappLink } from "@/lib/marketplace/display";
import { dateTimeLabel, stayRangeLabel } from "@/lib/marketplace/staff-helpers";
import { BookingRequestActions } from "@/components/bookings/booking-request-actions";
import { ExpiryLabel } from "./expiry-label";

export const REQUEST_STATUS_META: Record<string, { label: string; cls: string }> = {
  pendiente: {
    label: "Pendiente",
    cls: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
  },
  aprobada: {
    label: "Confirmada",
    cls: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
  },
  rechazada: {
    label: "Rechazada",
    cls: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900",
  },
  expirada: { label: "Vencida", cls: "bg-muted text-muted-foreground border-border" },
  cancelada: { label: "Cancelada", cls: "bg-muted text-muted-foreground border-border" },
};

export function unitTitleOf(r: BookingRequestWithRelations): string {
  return displayTitle(r.unit?.marketplace_title ?? r.unit?.name ?? null).title;
}

/** Tarjeta de un pedido de la web en la lista de Solicitudes. */
export function WebRequestCard({
  request: r,
  serverNow,
  canViewMoney,
  canApprove,
  canReject,
}: {
  request: BookingRequestWithRelations;
  serverNow: number;
  canViewMoney: boolean;
  canApprove: boolean;
  canReject: boolean;
}) {
  const isPending = r.status === "pendiente";
  const status = REQUEST_STATUS_META[r.status] ?? REQUEST_STATUS_META.pendiente;
  const title = unitTitleOf(r);
  const wa = whatsappLink(r.guest_phone);
  const total = Number(r.total_amount);
  const estimate = r.deposit_estimate != null ? Number(r.deposit_estimate) : null;
  const detailHref = `/dashboard/reservas-pendientes/${r.id}`;

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={detailHref} className="font-semibold leading-snug hover:underline underline-offset-2 line-clamp-2">
            {title}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {r.unit?.code ? `Unidad ${r.unit.code} · ` : ""}Pedido {dateTimeLabel(r.created_at)}
          </p>
        </div>
        {isPending ? (
          <ExpiryLabel expiresAt={r.expires_at} serverNow={serverNow} className="shrink-0 pt-0.5" />
        ) : (
          <Badge className={status.cls + " shrink-0"}>{status.label}</Badge>
        )}
      </div>

      <div className="space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">{r.guest_full_name}</span>
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-8 items-center gap-1 text-emerald-700 hover:underline underline-offset-2 dark:text-emerald-400"
            >
              <MessageCircle className="size-3.5" aria-hidden />
              {formatPhoneAR(r.guest_phone) ?? r.guest_phone}
            </a>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
          <span>{stayRangeLabel(r.check_in_date, r.check_out_date, r.nights)}</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" aria-hidden />
            {r.guests_count === 1 ? "1 huésped" : `${r.guests_count} huéspedes`}
          </span>
        </p>
        {canViewMoney ? (
          <p className="tabular-nums">
            <span className="font-semibold">{formatMoney(total, r.currency)}</span>
            {estimate != null && estimate > 0 ? (
              <span className="text-muted-foreground"> · seña estimada {formatMoney(estimate, r.currency)}</span>
            ) : null}
          </p>
        ) : null}
      </div>

      {r.special_requests ? (
        <p className="line-clamp-3 whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {r.special_requests}
        </p>
      ) : null}

      <ResolutionLine request={r} />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        {isPending ? (
          <BookingRequestActions
            compact
            canApprove={canApprove}
            canReject={canReject}
            request={{
              id: r.id,
              total,
              currency: r.currency,
              guestName: r.guest_full_name,
              guestPhone: r.guest_phone,
              unitTitle: title,
              checkIn: r.check_in_date,
              checkOut: r.check_out_date,
              nights: r.nights,
              guests: r.guests_count,
            }}
          />
        ) : (
          <span />
        )}
        <Link
          href={detailHref}
          className="inline-flex min-h-9 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Ver detalle <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

/** Cómo terminó un pedido resuelto (en la pestaña "Resueltas"). */
function ResolutionLine({ request: r }: { request: BookingRequestWithRelations }) {
  if (r.status === "aprobada") {
    return (
      <p className="text-sm text-muted-foreground">
        Confirmada {r.approved_at ? dateTimeLabel(r.approved_at) : ""}
        {r.resulting_booking_id ? (
          <>
            {" · "}
            <Link href={`/dashboard/reservas/${r.resulting_booking_id}`} className="font-medium text-foreground hover:underline underline-offset-2">
              Ver reserva
            </Link>
          </>
        ) : null}
      </p>
    );
  }
  if (r.status === "rechazada") {
    return (
      <p className="line-clamp-2 text-sm text-muted-foreground">
        Rechazada {r.rejected_at ? dateTimeLabel(r.rejected_at) : ""}
        {r.rejection_reason ? ` · «${r.rejection_reason}»` : ""}
      </p>
    );
  }
  if (r.status === "expirada") {
    return <p className="text-sm text-muted-foreground">Venció {dateTimeLabel(r.expires_at)} sin respuesta.</p>;
  }
  if (r.status === "cancelada") {
    // Una inmediata que no pudo cargarse (fechas ocupadas al mismo tiempo) queda
    // cancelada con approved_at; la que retira el huésped, sin él.
    return (
      <p className="text-sm text-muted-foreground">
        {r.approved_at ? "No llegó a ser reserva: las fechas se ocuparon al mismo tiempo." : "El huésped retiró el pedido."}
      </p>
    );
  }
  return null;
}
