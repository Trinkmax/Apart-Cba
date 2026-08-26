import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getParteDiarioForUser } from "@/lib/actions/parte-diario";
import { MobileBriefing } from "@/components/parte-diario/mobile-briefing";
import { LiveRefresh } from "@/components/realtime/live-refresh";

export const dynamic = "force-dynamic";

export default async function MobileParteDiarioPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "view")) redirect("/m");

  const payload = await getParteDiarioForUser();

  // Suscribirse a `bookings` le manda al navegador la fila COMPLETA de cada
  // reserva (huésped, importes, notas). Limpieza y mantenimiento tienen
  // bookings.view denegado: no se suscriben. Lo suyo llega por sus propias
  // tablas, filtradas además por asignado.
  const canViewBookings = can(role, "bookings", "view");

  return (
    <div className="p-4">
      <LiveRefresh
        tables={
          canViewBookings
            ? ["bookings", "cleaning_tasks", "maintenance_tickets"]
            : ["cleaning_tasks", "maintenance_tickets"]
        }
        assigneeScoped={!canViewBookings}
        throttleMs={10_000}
      />
      <MobileBriefing payload={payload} />
    </div>
  );
}
