"use client";

import * as React from "react";
import Link from "next/link";
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
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import type { Organization, OrganizationMember, UserProfile, UserRole } from "@/lib/types/database";
import { PendingRequestsBadge } from "@/components/dashboard/pending-requests-badge";
import { SCREEN_ICONS } from "@/components/mobile/icons";
import { desktopNav, routeMeta, type ShellContext } from "@/components/mobile/routes";
import { useShellPathname } from "@/components/mobile/shell-store";
import { SidebarOrgHeader } from "./sidebar-org-header";
import { SidebarTexCard } from "./sidebar-tex-card";

/*
 * El sidebar de la compu (nov-2026), con la misma estructura que el celular:
 * pocas puertas grandes (Hoy · Reservas · Caja) y, adentro de cada una, sus
 * pestañas, que viven en la barra de arriba (DesktopSectionNav). Debajo, «Tu
 * negocio» (lo que en el celular está en «Más») y Tex al pie. Pasó de 17
 * ítems a 8. Todo sale de `src/components/mobile/routes.ts`: el celular y la
 * compu no se pueden desincronizar.
 *
 * Cada sección muestra en chiquito lo que tiene adentro ("Caja · Resultados ·
 * Liquidaciones · Propietarios"): se entiende dónde está cada cosa sin listar
 * todo. Dónde estás lo marca una pastilla que se desliza con el resorte de iOS.
 */

interface AppSidebarProps {
  currentOrg: Organization;
  currentRole: UserRole;
  memberships: (OrganizationMember & { organization: Organization })[];
  profile: UserProfile;
  /** Solicitudes del marketplace esperando respuesta (se mantiene en vivo). */
  pendingRequests?: number;
}

export function AppSidebar({ currentOrg, currentRole, memberships, pendingRequests = 0 }: AppSidebarProps) {
  const pathname = useShellPathname();
  const ctx = React.useMemo<ShellContext>(
    () => ({ role: currentRole, rentalsEnabled: currentOrg.rentals_enabled }),
    [currentRole, currentOrg.rentals_enabled],
  );
  const nav = React.useMemo(() => desktopNav(ctx), [ctx]);
  const meta = React.useMemo(() => routeMeta(pathname, ctx), [pathname, ctx]);
  const canViewChannels = can(currentRole, "channels", "view");
  const showTex = currentOrg.tex_enabled && currentRole !== "owner_view";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border h-14 md:h-16 flex flex-row items-center px-2 md:px-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <SidebarOrgHeader
          currentOrg={currentOrg}
          memberships={memberships}
          homeHref={nav.sections[0]?.href ?? "/dashboard"}
        />
      </SidebarHeader>

      <SidebarContent>
        <div className="relative flex flex-col gap-1">
          <ActivePill activeKey={`${meta.tab}:${meta.link}`} />

          <SidebarGroup className="pt-3">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {nav.sections.map((s) => {
                  const active = meta.tab === s.id;
                  const Icon = SCREEN_ICONS[s.icon];
                  const inside = s.subtabs.map((t) => t.label).join(" · ");
                  return (
                    <SidebarMenuItem key={s.id}>
                      <SidebarMenuButton
                        asChild
                        size="lg"
                        isActive={active}
                        tooltip={inside ? `${s.label} — ${inside}` : s.label}
                        className="relative z-[1] gap-3 data-[active=true]:bg-transparent hover:bg-sidebar-accent/50"
                      >
                        <Link href={s.href}>
                          <span
                            className={cn(
                              "grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors duration-200",
                              active
                                ? "bg-[oklch(0.5_0.09_152)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_6px_14px_-8px_oklch(0.5_0.09_152)] dark:bg-[oklch(0.62_0.09_152)]"
                                : "bg-sidebar-accent text-sidebar-foreground/80",
                            )}
                          >
                            <Icon size={17} strokeWidth={active ? 2.3 : 1.9} />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col leading-tight">
                            <span className={cn("text-[14px]", active ? "font-semibold" : "font-medium")}>{s.label}</span>
                            {inside ? (
                              <span className="truncate text-[11px] text-sidebar-foreground/55">{inside}</span>
                            ) : null}
                          </span>
                          {s.id === "reservas" && can(currentRole, "bookings", "view") && currentRole !== "owner_view" ? (
                            <PendingRequestsBadge initialCount={pendingRequests} canViewChannels={canViewChannels} />
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {nav.groups.map((g) => (
            <SidebarGroup key={g.id}>
              {g.rows.length > 1 ? <SidebarGroupLabel>{g.title}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.rows.map((row) => {
                    const active = meta.link === row.id && meta.tab === "mas";
                    const Icon = SCREEN_ICONS[row.icon];
                    return (
                      <SidebarMenuItem key={row.id}>
                        <SidebarMenuButton
                          asChild
                          tooltip={row.label}
                          isActive={active}
                          className={cn(
                            "relative z-[1] gap-3 data-[active=true]:bg-transparent hover:bg-sidebar-accent/50",
                            active && "font-medium",
                          )}
                        >
                          <Link href={row.href}>
                            <Icon size={17} className={cn("transition-colors", active && "text-sidebar-primary")} />
                            <span>{row.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        {showTex ? <SidebarTexCard /> : null}
        <div className="text-[10px] text-sidebar-foreground/50 text-center group-data-[collapsible=icon]:hidden">
          rentOS · v1.0
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * La pastilla que marca la pantalla actual: una sola, que se desliza de un
 * ítem a otro con el resorte de iOS (en vez de prenderse y apagarse en cada
 * ítem). Se mide sobre el botón activo; sigue al sidebar cuando se colapsa.
 *
 * El contenedor sale del PADRE de la pastilla y no de un ref del padre: los
 * efectos de un hijo corren antes de que React le ponga el ref al padre, así
 * que al cargar la página ese ref todavía está vacío (y la pastilla no
 * aparecía hasta la primera navegación).
 */
function ActivePill({ activeKey }: { activeKey: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [box, setBox] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [animate, setAnimate] = React.useState(false);

  React.useLayoutEffect(() => {
    const wrap = ref.current?.parentElement;
    if (!wrap) return;
    const measure = () => {
      const el = wrap.querySelector<HTMLElement>('[data-sidebar="menu-button"][data-active="true"]');
      if (!el) {
        setBox(null);
        // Al volver a aparecer (en otro ítem) no tiene que "volar" desde el viejo.
        setAnimate(false);
        return;
      }
      const a = el.getBoundingClientRect();
      const b = wrap.getBoundingClientRect();
      const next = { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
      setBox((prev) =>
        prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [activeKey]);

  // La primera posición no se anima (al cargar no debe "volar" desde arriba).
  React.useEffect(() => {
    if (!box || animate) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [box, animate]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "lg-sidebar-pill pointer-events-none absolute top-0 left-0 z-0 rounded-[12px]",
        !box && "invisible",
        box && animate && "lg-sidebar-pill-animate",
      )}
      style={box ? { transform: `translate3d(${box.x}px, ${box.y}px, 0)`, width: box.w, height: box.h } : { width: 0, height: 0 }}
    />
  );
}
