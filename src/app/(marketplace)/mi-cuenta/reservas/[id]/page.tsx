import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireGuestSession } from "@/lib/actions/guest-auth";
import { getReservationForGuest } from "@/lib/actions/reservation-status";
import { ReservationStatusView } from "@/components/marketplace/reservation/reservation-status-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu reserva",
  robots: { index: false, follow: false },
};

type Params = Promise<{ id: string }>;

/**
 * Detalle de una reserva desde "Mis reservas". Si tiene link de seguimiento
 * (todas las de la web nueva), se usa ese: es la misma página que ven en los
 * mails. Las reservas viejas sin solicitud se muestran acá con la misma vista.
 */
export default async function MiReservaPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireGuestSession(`/mi-cuenta/reservas/${encodeURIComponent(id)}`);
  const view = await getReservationForGuest(id);
  if (!view) notFound();
  if (view.status_path) redirect(view.status_path);
  return <ReservationStatusView view={view} backHref="/mi-cuenta" backLabel="Mis reservas" />;
}
