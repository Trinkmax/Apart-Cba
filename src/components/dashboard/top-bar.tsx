"use client";

import { useTheme } from "next-themes";
import Link from "next/link";
import { Moon, Sun, LogOut, Settings, Building2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { signOut } from "@/lib/actions/auth";
import { ROLE_META } from "@/lib/constants";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import { LiveIndicator } from "@/components/realtime/live-indicator";
import { InstallAppListener } from "@/components/pwa/install-app-prompt";
import { InstallAppMenuItem } from "@/components/pwa/install-app-menu-item";
import { TexLauncher } from "@/components/tex/tex-launcher";
import { can } from "@/lib/permissions";
import { DesktopSectionNav } from "./desktop-section-nav";
import { CommandPalette } from "./command-palette";
import type { Notification, Organization, UserProfile, UserRole } from "@/lib/types/database";

interface TopBarProps {
  currentOrg: Organization;
  currentRole: UserRole;
  profile: UserProfile;
  notifications?: Notification[];
  unreadCount?: number;
  /** Solicitudes del marketplace esperando respuesta (badge de la pestaña Solicitudes). */
  pendingRequests?: number;
}

export function TopBar({
  currentOrg,
  currentRole,
  profile,
  notifications = [],
  unreadCount = 0,
  pendingRequests = 0,
}: TopBarProps) {
  const { theme, setTheme } = useTheme();
  const roleMeta = ROLE_META[currentRole];

  return (
    <header className="sticky top-0 z-30 h-14 md:h-16 flex items-center gap-1.5 sm:gap-3 px-2 sm:px-4 lg:px-6 bg-background/85 backdrop-blur-xl border-b border-border safe-top safe-x">
      <SidebarTrigger className="size-9 tap" />
      {/* Qué organización y cambiar de organización viven arriba del sidebar
          (SidebarOrgHeader): acá había un recuadro con las iniciales que
          repetía lo mismo. */}
      <Separator orientation="vertical" className="h-6 mr-0 sm:mr-1 hidden sm:block" />

      {/* Dónde estás: las pestañas de la sección (o el camino en una ficha).
          Mismo mapa que el celular (`routes.ts`). Ocupa el lugar del espacio. */}
      <DesktopSectionNav
        role={currentRole}
        rentalsEnabled={currentOrg.rentals_enabled}
        pendingRequests={pendingRequests}
        canViewChannels={can(currentRole, "channels", "view")}
      />

      {/* ⌘K: ir a cualquier pantalla o encontrar cualquier cosa. */}
      <CommandPalette
        role={currentRole}
        rentalsEnabled={currentOrg.rentals_enabled}
        texEnabled={currentOrg.tex_enabled}
      />

      {/* Estado de la conexión en vivo. Único en toda la app: si esto no está
          en verde, lo que se ve en pantalla puede estar viejo. */}
      <LiveIndicator />

      {/* Tex, el asistente: sólo si la organización lo tiene encendido. */}
      {currentOrg.tex_enabled && currentRole !== "owner_view" ? <TexLauncher /> : null}

      {/* Notifications bell */}
      <NotificationsBell
        initialNotifications={notifications}
        initialUnreadCount={unreadCount}
      />

      {/* Theme toggle — escondido en pantallas muy chicas para ganar espacio */}
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="size-9 hidden sm:inline-flex"
      >
        <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">Cambiar tema</span>
      </Button>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 h-9 px-1.5 hover:bg-accent/60">
            <Avatar className="size-7">
              <AvatarImage src={profile.avatar_url ?? undefined} />
              <AvatarFallback className="text-[10px] font-semibold bg-primary/15 text-primary">
                {getInitials(profile.full_name)}
              </AvatarFallback>
            </Avatar>
            <span className={cn("text-sm font-medium hidden 2xl:block max-w-[120px] truncate")}>
              {profile.full_name.split(" ")[0]}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{profile.full_name}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="status-dot" style={{ backgroundColor: roleMeta.color }} />
                <span className="truncate">
                  {roleMeta.label} · {currentOrg.name}
                </span>
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profile.is_superadmin && (
            <DropdownMenuItem asChild>
              <a href="/superadmin" className="cursor-pointer text-rose-600 dark:text-rose-400">
                <Settings size={14} />
                Panel superadmin
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href="/dashboard/perfil" className="cursor-pointer">
              <Settings size={14} />
              Mi perfil
            </Link>
          </DropdownMenuItem>
          {/* "Acceso directo para notebook y tablet": se esconde solo si ya
              corre instalada. El diálogo lo aloja <InstallAppListener/>. */}
          <InstallAppMenuItem />
          <DropdownMenuItem asChild>
            <Link href="/dashboard/configuracion" className="cursor-pointer">
              <Building2 size={14} />
              Configuración
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => signOut()}
            className="text-destructive focus:text-destructive cursor-pointer"
          >
            <LogOut size={14} />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <InstallAppListener />
    </header>
  );
}
