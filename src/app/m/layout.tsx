import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Wrench,
  ListTodo,
  LogOut,
  Building2,
  MessageSquareText,
  ScrollText,
} from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { signOut } from "@/lib/actions/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { UserRole } from "@/lib/types/database";

function getInitials(name: string | null | undefined): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface MobileNavItem {
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  roles?: UserRole[];
}

const MOBILE_NAV: MobileNavItem[] = [
  { href: "/m", icon: Building2, label: "Inicio" },
  {
    href: "/m/parte-diario",
    icon: ScrollText,
    label: "Parte",
    roles: ["admin", "recepcion", "limpieza", "mantenimiento"],
  },
  { href: "/m/crm/inbox", icon: MessageSquareText, label: "CRM", roles: ["admin", "recepcion"] },
  {
    href: "/m/limpieza",
    icon: Sparkles,
    label: "Limpieza",
    roles: ["admin", "limpieza", "recepcion"],
  },
  {
    href: "/m/mantenimiento",
    icon: Wrench,
    label: "Tickets",
    roles: ["admin", "mantenimiento", "recepcion"],
  },
  { href: "/m/tareas", icon: ListTodo, label: "Tareas", roles: ["admin", "recepcion"] },
];

export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { role } = await getCurrentOrg();

  const visibleItems = MOBILE_NAV.filter((it) => !it.roles || it.roles.includes(role));

  return (
    <div className="min-h-svh bg-background flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-xl border-b safe-top safe-x">
        <div className="px-4 py-3 flex items-center justify-between">
          <Logo size="sm" />
          <div className="flex items-center gap-2">
            <Link href="/m/perfil" className="tap" aria-label="Mi perfil">
              <Avatar className="size-9">
                {session.profile.avatar_url && (
                  <AvatarImage
                    src={session.profile.avatar_url}
                    alt={session.profile.full_name ?? "Mi perfil"}
                  />
                )}
                <AvatarFallback className="text-xs">
                  {getInitials(session.profile.full_name)}
                </AvatarFallback>
              </Avatar>
            </Link>
            <form action={signOut}>
              <Button type="submit" size="icon" variant="ghost" className="size-9 tap">
                <LogOut size={16} />
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* Content — pb compensa la bottom nav + safe area */}
      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">{children}</main>

      {/* Bottom nav — usamos gridTemplateColumns inline para ser flexible al
          número de items visibles según rol (3 a 6). */}
      <nav className="fixed bottom-0 inset-x-0 z-20 bg-background/95 backdrop-blur-xl border-t safe-bottom safe-x">
        <div
          className="grid max-w-md mx-auto"
          style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
        >
          {visibleItems.map((it) => {
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                className="flex flex-col items-center gap-1 py-2.5 hover:bg-accent/50 active:bg-accent transition-colors tap"
              >
                <Icon size={20} />
                <span className="text-[10px] font-medium">{it.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
