import { redirect } from "next/navigation";
import Link from "next/link";
import { Sparkles, Wrench, Bell, LogOut, Building2, User } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { signOut } from "@/lib/actions/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { organization, role } = await getCurrentOrg();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-xl border-b">
        <div className="px-4 py-3 flex items-center justify-between">
          <Logo size="sm" />
          <form action={signOut}>
            <Button type="submit" size="icon" variant="ghost" className="size-8">
              <LogOut size={14} />
            </Button>
          </form>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pb-20">{children}</main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 z-20 bg-background/95 backdrop-blur-xl border-t">
        <div className="grid grid-cols-4 max-w-md mx-auto">
          {[
            { href: "/m", icon: Building2, label: "Inicio" },
            { href: "/m/limpieza", icon: Sparkles, label: "Limpieza", roles: ["admin", "limpieza", "recepcion"] },
            { href: "/m/mantenimiento", icon: Wrench, label: "Tickets", roles: ["admin", "mantenimiento", "recepcion"] },
            { href: "/m/conserjeria", icon: Bell, label: "Pedidos", roles: ["admin", "recepcion"] },
          ].filter((it) => !it.roles || it.roles.includes(role)).map((it) => {
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                className="flex flex-col items-center gap-1 py-2.5 hover:bg-accent/50 transition-colors"
              >
                <Icon size={18} />
                <span className="text-[10px] font-medium">{it.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
