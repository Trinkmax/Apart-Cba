import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import {
  getUnreadCount,
  listNotifications,
} from "@/lib/actions/notifications";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { TopBar } from "@/components/dashboard/top-bar";
import { BookingStatusColorsProvider } from "@/lib/booking-status-colors";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.memberships.length === 0 && !session.profile.is_superadmin) {
    redirect("/sin-acceso");
  }

  const { organization, role } = await getCurrentOrg();

  // Notificaciones: si fallan no rompemos el dashboard. La campana queda vacía.
  const [notifications, unreadCount] = await Promise.all([
    listNotifications("active", 30).catch(() => []),
    getUnreadCount().catch(() => 0),
  ]);

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
