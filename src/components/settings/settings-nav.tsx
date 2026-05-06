"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings as SettingsIcon, Palette, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

type SettingsNavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  exact?: boolean;
};

const ITEMS: SettingsNavItem[] = [
  { label: "General", href: "/dashboard/configuracion", icon: SettingsIcon, exact: true },
  { label: "Colores", href: "/dashboard/configuracion/colores", icon: Palette },
  { label: "Mensajería", href: "/dashboard/configuracion/mensajeria", icon: MessageSquareText },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Configuración"
      className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible -mx-1 px-1 md:mx-0 md:px-0"
    >
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm shrink-0 transition-colors",
              "border md:border-0",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border md:border-transparent font-medium"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground border-transparent"
            )}
          >
            <Icon size={16} className={cn("shrink-0", active && "text-primary")} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
