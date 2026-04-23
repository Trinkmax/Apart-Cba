import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile.is_superadmin) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-xl border-b">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 gap-1">
              <ShieldAlert size={11} />
              Superadmin
            </Badge>
          </div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft size={13} /> Volver al dashboard
          </Link>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
