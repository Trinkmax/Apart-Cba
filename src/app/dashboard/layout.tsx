import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { TopBar } from "@/components/dashboard/top-bar";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.memberships.length === 0 && !session.profile.is_superadmin) {
    redirect("/sin-acceso");
  }

  const { organization, role } = await getCurrentOrg();

  return (
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
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
