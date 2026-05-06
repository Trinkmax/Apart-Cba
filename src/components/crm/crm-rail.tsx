"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquareText,
  Megaphone,
  GitBranch,
  BellRing,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can, type Resource } from "@/lib/permissions";
import type { UserRole } from "@/lib/types/database";

type RailItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  resource: Resource;
};

const ITEMS: RailItem[] = [
  { label: "Inbox", href: "/dashboard/crm/inbox", icon: MessageSquareText, resource: "crm_inbox" },
  { label: "Difusiones", href: "/dashboard/crm/difusiones", icon: Megaphone, resource: "crm_workflows" },
  { label: "Workflows", href: "/dashboard/crm/workflows", icon: GitBranch, resource: "crm_workflows" },
  { label: "Alertas", href: "/dashboard/crm/alertas", icon: BellRing, resource: "crm_inbox" },
  { label: "Rápidos", href: "/dashboard/crm/rapidos", icon: Zap, resource: "crm_rapidos" },
];

export function CrmRail({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const visible = ITEMS.filter((it) => can(role, it.resource, "view"));
  if (visible.length === 0) return null;

  return (
    <aside
      aria-label="Mensajería"
      className={cn(
        "sticky top-0 self-start shrink-0 z-10",
        "h-[calc(100dvh_-_3.5rem)] md:h-[calc(100dvh_-_4rem)]",
        "w-[68px] border-r border-border bg-sidebar/60 backdrop-blur-sm",
      )}
    >
      <nav className="flex flex-col gap-1 py-2">
        {visible.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={cn(
                "group relative mx-2 flex flex-col items-center gap-0.5 rounded-md px-1 py-2 transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary"
                />
              )}
              <Icon size={18} className="shrink-0" />
              <span className="text-[10px] leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
