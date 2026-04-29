"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  CalendarDays,
  Hotel,
  House,
  Wrench,
  Sparkles,
  Wallet,
  FileText,
  Cable,
  Boxes,
  Bell,
  Settings,
  ShieldCheck,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { can, type Resource } from "@/lib/permissions";
import type { Organization, OrganizationMember, UserProfile, UserRole } from "@/lib/types/database";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  resource: Resource | "*";
  badgeCount?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Operación",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, resource: "*" },
      { label: "Calendario", href: "/dashboard/unidades/kanban", icon: Hotel, resource: "units" },
      { label: "Calendario Mensual", href: "/dashboard/unidades/calendario/mensual", icon: House, resource: "units" },
      { label: "Unidades", href: "/dashboard/unidades", icon: Building2, resource: "units" },
      { label: "Reservas", href: "/dashboard/reservas", icon: CalendarDays, resource: "bookings" },
      { label: "Huéspedes", href: "/dashboard/huespedes", icon: Users, resource: "guests" },
    ],
  },
  {
    label: "Servicio",
    items: [
      { label: "Mantenimiento", href: "/dashboard/mantenimiento", icon: Wrench, resource: "tickets" },
      { label: "Limpieza", href: "/dashboard/limpieza", icon: Sparkles, resource: "cleaning" },
      { label: "Conserjería", href: "/dashboard/conserjeria", icon: Bell, resource: "concierge" },
      { label: "Inventario", href: "/dashboard/inventario", icon: Boxes, resource: "amenities" },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { label: "Caja", href: "/dashboard/caja", icon: Wallet, resource: "cash" },
      { label: "Liquidaciones", href: "/dashboard/liquidaciones", icon: FileText, resource: "settlements" },
      { label: "Propietarios", href: "/dashboard/propietarios", icon: ShieldCheck, resource: "owners" },
    ],
  },
  {
    label: "Integraciones",
    items: [
      { label: "Channel Manager", href: "/dashboard/channel-manager", icon: Cable, resource: "ical" },
    ],
  },
];

interface AppSidebarProps {
  currentOrg: Organization;
  currentRole: UserRole;
  memberships: (OrganizationMember & { organization: Organization })[];
  profile: UserProfile;
}

export function AppSidebar({ currentRole }: AppSidebarProps) {
  const pathname = usePathname();
  const isAdmin = currentRole === "admin";

  // El item activo es el de href más largo que coincida con el pathname.
  // Evita que "Unidades" se marque también cuando estás en "Kanban".
  const allHrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
  const matchingHrefs = allHrefs.filter((h) =>
    h === "/dashboard" ? pathname === h : pathname === h || pathname.startsWith(h + "/")
  );
  const longestMatch = matchingHrefs.sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === longestMatch;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border h-16 flex items-center px-4">
        <Link href="/dashboard" className="flex items-center gap-2 group">
          <Logo size="sm" showWordmark />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => {
          const visibleItems = group.items.filter(
            (item) => item.resource === "*" || can(currentRole, item.resource as Resource, "view")
          );
          if (visibleItems.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          tooltip={item.label}
                          isActive={active}
                          className={cn(
                            "transition-all duration-150",
                            active && "font-medium"
                          )}
                        >
                          <Link href={item.href}>
                            <Icon
                              size={18}
                              className={cn(
                                "transition-colors",
                                active && "text-sidebar-primary"
                              )}
                            />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Configuración</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Equipo y permisos" isActive={isActive("/dashboard/configuracion/equipo")}>
                    <Link href="/dashboard/configuracion/equipo">
                      <Users size={18} />
                      <span>Equipo y permisos</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Configuración" isActive={isActive("/dashboard/configuracion/general")}>
                    <Link href="/dashboard/configuracion/general">
                      <Settings size={18} />
                      <span>General</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="text-[10px] text-sidebar-foreground/50 text-center">
          Apart Cba · v1.0
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
