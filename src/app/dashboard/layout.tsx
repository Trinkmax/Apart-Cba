import { redirect } from "next/navigation";
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

  // Cancelaciones que una OTA propuso y todavía nadie resolvió. Ninguna reserva
  // se cancela sola: hasta que alguien decida, siguen vivas y ocupando fechas.
  const [pendingCancellations, pendingRequests] = await Promise.all([
    listPendingCancellations(),
    // El contador del sidebar: una solicitud del marketplace que nadie ve es la
    // ventana en la que se vende dos veces la misma fecha.
    can(role, "bookings", "view")
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
