import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionContext } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { TopBar } from "@/components/dashboard/top-bar";
import { TrialBanner } from "@/components/dashboard/trial-banner";
import { BookingStatusColorsProvider } from "@/lib/booking-status-colors";
import { LiveProvider } from "@/lib/realtime/live-context";
import { LiveBookingAlerts } from "@/components/realtime/live-booking-alerts";
import { CancellationDecisionDialog } from "@/components/channels/cancellation-decision-dialog";
import { listPendingCancellations } from "@/lib/actions/channel-cancellations";
import { countPendingRequestsForOrg } from "@/lib/actions/booking-requests";
import { can } from "@/lib/permissions";
import { PATHNAME_HEADER, isPathAllowedForOwner } from "@/lib/auth/route-access";

// Techo de wall-clock para todo /dashboard/* (páginas y sus Server Actions;
// una page puede pisarlo exportando un valor mayor). Sin esto, el default de
// Fluid en Pro es 300 s: cuando Supabase se cuelga (incidente 2026-08-29) cada
// instancia queda reservada y facturando Provisioned Memory hasta 5 minutos.
// Esto solo acota el daño; el timeout por request lo pone el fetch de
// src/lib/supabase/server.ts. No bajar de 60: acá viven actions legítimamente
// largas (PDF de liquidación, purga de datos demo, fotos de hasta 15 MB).
export const maxDuration = 60;

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Un solo round trip: sesión + org activa + notificaciones vienen juntas
  // del RPC get_session_context (cacheado por request).
  const session = await getSessionContext();
  if (!session) redirect("/login");

  if (session.memberships.length === 0 && !session.profile.is_superadmin) {
    redirect("/sin-acceso");
  }

  const { organization, role } = await getCurrentOrg();
  const { notifications, unreadCount } = session;

  // Rol "Propietario": lista blanca de pantallas (src/lib/auth/route-access.ts).
  // Cubre la carga completa de cualquier URL; las navegaciones con <Link> las
  // cubre el layout de cada segmento cerrado (StaffOnly), porque este layout
  // no se vuelve a renderizar al navegar entre páginas hijas.
  if (role === "owner_view") {
    const path = (await headers()).get(PATHNAME_HEADER);
    if (path && !isPathAllowedForOwner(path)) redirect("/dashboard");
  }

  // Cancelaciones que una OTA propuso y todavía nadie resolvió. Ninguna reserva
  // se cancela sola: hasta que alguien decida, siguen vivas y ocupando fechas.
  const [pendingCancellations, pendingRequests] = await Promise.all([
    listPendingCancellations(),
    // El contador del sidebar: una solicitud del marketplace que nadie ve es la
    // ventana en la que se vende dos veces la misma fecha.
    can(role, "bookings", "view") && role !== "owner_view"
      ? countPendingRequestsForOrg().catch(() => 0)
      : Promise.resolve(0),
  ]);

  return (
    <BookingStatusColorsProvider override={organization.booking_status_colors}>
      {/* Capa en vivo: un solo WebSocket para todo el dashboard. Va por fuera
          de las páginas para que la conexión sobreviva a la navegación y a los
          router.refresh() que ella misma dispara. */}
      <LiveProvider
        organizationId={organization.id}
        userId={session.userId}
        role={role}
        timezone={organization.timezone}
      >
      <SidebarProvider defaultOpen>
        <AppSidebar
          currentOrg={organization}
          currentRole={role}
          memberships={session.memberships}
          profile={session.profile}
          pendingRequests={pendingRequests}
        />
        <SidebarInset className="min-w-0 overflow-x-hidden">
          <TopBar
            currentOrg={organization}
            currentRole={role}
            memberships={session.memberships}
            profile={session.profile}
            notifications={notifications}
            unreadCount={unreadCount}
          />
          {organization.is_trial && organization.demo_data_seeded_at && (
            <TrialBanner canPurge={role === "admin"} />
          )}
          <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 safe-bottom">
            {children}
          </main>
          <CancellationDecisionDialog pending={pendingCancellations} />
        </SidebarInset>
      </SidebarProvider>
        <LiveBookingAlerts />
      </LiveProvider>
    </BookingStatusColorsProvider>
  );
}
