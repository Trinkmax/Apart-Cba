"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  CalendarDays,
  Hotel,
  Wrench,
  Sparkles,
  Wallet,
  FileText,
  Cable,
  ListTodo,
  Settings,
  ShieldCheck,
  ScrollText,
  Inbox,
  PieChart,
  LayoutGrid,
  FilePenLine,
  HandCoins,
  FileCheck,
  TrendingUp,
  BanknoteArrowUp,
  Building,
  UsersRound,
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
import { OrgBrand } from "@/components/brand/org-brand";
import { cn } from "@/lib/utils";
import { can, isAdminLevel, type Resource } from "@/lib/permissions";
import type { Organization, OrganizationMember, UserProfile, UserRole } from "@/lib/types/database";
import { PendingRequestsBadge } from "@/components/dashboard/pending-requests-badge";
import { isPathAllowedForOwner } from "@/lib/auth/route-access";

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
  /** Grupo de un módulo que se enciende por organización (p. ej. Alquileres). */
  module?: "rentals";
}

const NAV: NavGroup[] = [
  {
    label: "Operación",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, resource: "*" },
      { label: "Calendario", href: "/dashboard/unidades/kanban", icon: Hotel, resource: "bookings" },
      { label: "Unidades", href: "/dashboard/unidades", icon: Building2, resource: "units" },
      { label: "Reservas", href: "/dashboard/reservas", icon: CalendarDays, resource: "bookings" },
      { label: "Solicitudes", href: "/dashboard/reservas-pendientes", icon: Inbox, resource: "bookings" },
      { label: "Huéspedes", href: "/dashboard/huespedes", icon: Users, resource: "guests" },
    ],
  },
  {
    label: "Servicio",
    items: [
      { label: "Parte diario", href: "/dashboard/parte-diario", icon: ScrollText, resource: "parte_diario" },
      { label: "Mantenimiento", href: "/dashboard/mantenimiento", icon: Wrench, resource: "tickets" },
      { label: "Limpieza", href: "/dashboard/limpieza", icon: Sparkles, resource: "cleaning" },
      { label: "Tareas", href: "/dashboard/tareas", icon: ListTodo, resource: "concierge" },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { label: "Caja", href: "/dashboard/caja", icon: Wallet, resource: "cash" },
      // "Qué entra, qué se lleva cada uno y qué le queda a cada propietario":
      // la vista que junta ventas, comisión de plataformas, comisión propia y
      // neto a propietarios en un solo lugar, por mes.
      { label: "Resultados", href: "/dashboard/resultados", icon: PieChart, resource: "payments" },
      { label: "Liquidaciones", href: "/dashboard/liquidaciones", icon: FileText, resource: "settlements" },
      { label: "Propietarios", href: "/dashboard/propietarios", icon: ShieldCheck, resource: "owners" },
    ],
  },
  {
    // Alquileres tradicionales (contratos de 2-3 años con ajuste por índice).
    // Sólo aparece si la org tiene el módulo encendido (organizations.rentals_enabled).
    label: "Alquileres",
    module: "rentals",
    items: [
      { label: "Resumen", href: "/dashboard/alquileres", icon: LayoutGrid, resource: "rentals" },
      { label: "Contratos", href: "/dashboard/alquileres/contratos", icon: FilePenLine, resource: "rentals" },
      { label: "Cobranzas", href: "/dashboard/alquileres/cobranzas", icon: HandCoins, resource: "rentals" },
      { label: "Comprobantes", href: "/dashboard/alquileres/comprobantes", icon: FileCheck, resource: "rentals" },
      { label: "Ajustes", href: "/dashboard/alquileres/ajustes", icon: TrendingUp, resource: "rentals" },
      { label: "Rendiciones", href: "/dashboard/alquileres/rendiciones", icon: BanknoteArrowUp, resource: "rentals" },
      { label: "Propiedades", href: "/dashboard/alquileres/propiedades", icon: Building, resource: "rentals" },
      { label: "Inquilinos", href: "/dashboard/alquileres/personas", icon: UsersRound, resource: "rentals" },
    ],
  },
  {
    label: "Integraciones",
    items: [
      { label: "Canales de venta", href: "/dashboard/canales", icon: Cable, resource: "channels" },
    ],
  },
];

interface AppSidebarProps {
  currentOrg: Organization;
  currentRole: UserRole;
  memberships: (OrganizationMember & { organization: Organization })[];
  profile: UserProfile;
  /** Solicitudes del marketplace esperando respuesta (se mantiene en vivo). */
  pendingRequests?: number;
}

export function AppSidebar({
  currentOrg,
  currentRole,
  pendingRequests = 0,
}: AppSidebarProps) {
  const pathname = usePathname();
  const isAdmin = isAdminLevel(currentRole);

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
      <SidebarHeader className="border-b border-sidebar-border h-14 md:h-16 flex items-center px-3 md:px-4">
        <Link href="/dashboard" className="flex items-center gap-2 group">
          <OrgBrand organization={currentOrg} />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => {
          if (group.module === "rentals" && !currentOrg.rentals_enabled) return null;
          const visibleItems = group.items.filter(
            (item) =>
              (item.resource === "*" || can(currentRole, item.resource as Resource, "view")) &&
              // El propietario sólo ve las pantallas de su lista blanca.
              (currentRole !== "owner_view" || isPathAllowedForOwner(item.href))
          );
          if (visibleItems.length === 0) return null;
          // Si el grupo tiene un único ítem con el mismo nombre que el grupo,
          // ocultamos el label para no duplicar texto (caso "Mensajería").
          const hideLabel = visibleItems.length === 1 && visibleItems[0].label === group.label;
          return (
            <SidebarGroup key={group.label}>
              {!hideLabel && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
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
                            "transition-all duration-150 group-data-[mobile=true]:h-11 group-data-[mobile=true]:text-[15px]",
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
                            {item.href === "/dashboard/reservas-pendientes" && (
                              <PendingRequestsBadge
                                initialCount={pendingRequests}
                                canViewChannels={can(currentRole, "channels", "view")}
                              />
                            )}
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

        {isAdmin && (() => {
          // Un único módulo de Configuración: identidad, equipo, colores,
          // comunicaciones y mensajería viven dentro de /dashboard/configuracion.
          const onConfig =
            pathname === "/dashboard/configuracion" ||
            pathname.startsWith("/dashboard/configuracion/");
          return (
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Configuración" isActive={onConfig}>
                      <Link href="/dashboard/configuracion">
                        <Settings size={18} className={cn("transition-colors", onConfig && "text-sidebar-primary")} />
                        <span>Configuración</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })()}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="text-[10px] text-sidebar-foreground/50 text-center">
          rentOS · v1.0
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
