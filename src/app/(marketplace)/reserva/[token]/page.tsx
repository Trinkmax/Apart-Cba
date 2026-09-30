import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReservationByToken } from "@/lib/actions/reservation-status";
import { ReservationStatusView } from "@/components/marketplace/reservation/reservation-status-view";

// El link ES la llave del huésped: nunca se indexa ni se cachea, y el token no
// sale de esta página en el Referer (WhatsApp, mapas, Instagram).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu reserva",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

type Params = Promise<{ token: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Seguimiento de un pedido o reserva de la web por link, sin cuenta
 * (`/reserva/<token>`, el link de todos los mails). `?nuevo=1` al llegar desde
 * el checkout muestra la bienvenida.
 */
export default async function ReservaPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const view = await getReservationByToken(token);
  if (!view) notFound();
  return <ReservationStatusView view={view} isNew={sp.nuevo === "1"} token={token} />;
}
