import Link from "next/link";
import { Cable } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { ChannelReservationRow } from "@/lib/channels/types";

/**
 * Estado de sincronización de una reserva de OTA, para el detalle de reserva.
 * Diferencia "esperando datos de la OTA" de "la OTA no proporcionó contacto" —
 * nunca el genérico "sin huésped" como único diagnóstico.
 */
export async function BookingChannelStatus({
  bookingId,
  organizationId,
  hasGuest,
}: {
  bookingId: string;
  organizationId: string;
  hasGuest: boolean;
}) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_reservations")
    .select("*, link:channel_links(id, last_success_at, status)")
    .eq("booking_id", bookingId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  const r = data as ChannelReservationRow & {
    link: { id: string; last_success_at: string | null; status: string } | null;
  };

  const guestProvided = Object.keys(r.guest ?? {}).length > 0;
  const guestState = hasGuest
    ? null
    : r.external_status === "cancelled"
      ? null
      : guestProvided
        ? "La OTA envió datos pero no se pudo crear el huésped — revisá Canales de venta."
        : r.confirmation_code
          ? "La OTA no proporcionó contacto del huésped."
          : "Esperando datos de la OTA (llegan por email de la reserva).";

  const freshness = r.link?.last_success_at
    ? `Calendario revisado ${formatDistanceToNow(new Date(r.link.last_success_at), { addSuffix: true, locale: es })}`
    : "Sin revisión reciente del calendario";

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1.5">
      <div className="flex items-center gap-1.5 font-medium">
        <Cable size={12} className="text-primary" />
        Sincronización con la OTA
        {r.link && (
          <Link
            href={`/dashboard/canales/${r.link.id}`}
            className="ml-auto underline underline-offset-2 text-muted-foreground hover:text-foreground"
          >
            Ver conexión
          </Link>
        )}
      </div>
      <div className="text-muted-foreground space-y-0.5">
        <div>
          Referencia externa:{" "}
          <span className="font-mono">{r.confirmation_code ?? r.ical_uid?.slice(0, 20) ?? "—"}</span>
        </div>
        <div>{freshness}</div>
        {r.missing_since && (
          <div className="text-amber-700 dark:text-amber-400">
            La reserva desapareció del calendario de la OTA — verificando posible cancelación.
          </div>
        )}
        {guestState && <div className="text-sky-700 dark:text-sky-400">{guestState}</div>}
      </div>
    </div>
  );
}
