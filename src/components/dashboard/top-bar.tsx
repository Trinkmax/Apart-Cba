"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, LogOut, ChevronsUpDown, Check, Settings } from "lucide-react";
import { useTransition } from "react";
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
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { signOut } from "@/lib/actions/auth";
import { setCurrentOrg } from "@/lib/actions/org";
import { ROLE_META } from "@/lib/constants";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Organization, OrganizationMember, UserProfile, UserRole } from "@/lib/types/database";

interface TopBarProps {
  currentOrg: Organization;
  currentRole: UserRole;
  memberships: (OrganizationMember & { organization: Organization })[];
  profile: UserProfile;
}

export function TopBar({ currentOrg, currentRole, memberships, profile }: TopBarProps) {
  const { theme, setTheme } = useTheme();
  const [isPending, startTransition] = useTransition();
  const roleMeta = ROLE_META[currentRole];

  const handleSwitchOrg = (orgId: string) => {
    if (orgId === currentOrg.id) return;
    startTransition(async () => {
      await setCurrentOrg(orgId);
    });
  };

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center gap-3 px-4 lg:px-6 bg-background/80 backdrop-blur-xl border-b border-border">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6 mr-1" />

      {/* Org switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="gap-2 px-2 h-9 font-medium text-sm hover:bg-accent/60"
            disabled={isPending}
          >
            <div
              className="size-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
              style={{ background: currentOrg.primary_color ?? "var(--brand-teal)" }}
            >
              {currentOrg.name.slice(0, 2).toUpperCase()}
            </div>
            <span className="max-w-[180px] truncate">{currentOrg.name}</span>
            <ChevronsUpDown size={14} className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Organizaciones
          </DropdownMenuLabel>
          {memberships.map((m) => {
            const isCurrent = m.organization_id === currentOrg.id;
            return (
              <DropdownMenuItem
                key={m.organization_id}
                onClick={() => handleSwitchOrg(m.organization_id)}
                className="cursor-pointer gap-2"
              >
                <div
                  className="size-7 rounded-md flex items-center justify-center text-[11px] font-bold text-white shadow-sm shrink-0"
                  style={{ background: m.organization.primary_color ?? "var(--brand-teal)" }}
                >
                  {m.organization.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{m.organization.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {ROLE_META[m.role].label}
                  </div>
                </div>
                {isCurrent && <Check size={14} className="text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Badge
        variant="secondary"
        className="hidden md:inline-flex gap-1.5 font-normal text-xs"
        style={{ color: roleMeta.color, borderColor: roleMeta.color + "40" }}
      >
        <span className="status-dot" style={{ backgroundColor: roleMeta.color }} />
        {roleMeta.label}
      </Badge>

      <div className="flex-1" />

      {/* Theme toggle */}
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="size-9"
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
            <span className={cn("text-sm font-medium hidden md:block max-w-[120px] truncate")}>
              {profile.full_name.split(" ")[0]}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{profile.full_name}</span>
              <span className="text-xs text-muted-foreground truncate">{profile.phone ?? ""}</span>
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
          <DropdownMenuItem>
            <Settings size={14} />
            Mi perfil
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
    </header>
  );
}
