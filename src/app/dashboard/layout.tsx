import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { TopBar } from "@/components/dashboard/top-bar";
import { BookingStatusColorsProvider } from "@/lib/booking-status-colors";

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

  return (
    <BookingStatusColorsProvider override={organization.booking_status_colors}>
      <SidebarProvider defaultOpen>
        <AppSidebar
          currentOrg={organization}
          currentRole={role}
          memberships={session.memberships}
          profile={session.profile}
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
          <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 safe-bottom">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </BookingStatusColorsProvider>
  );
}
