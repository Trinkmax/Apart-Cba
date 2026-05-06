import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getCurrentOrg();
  if (role !== "admin") redirect("/dashboard");

  return (
    <div className="page-x page-y">
      <div className="max-w-6xl mx-auto space-y-5">
        <header className="flex items-center gap-2">
          <Settings className="size-5 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            Configuración
          </h1>
        </header>

        <div className="grid gap-6 md:grid-cols-[200px_1fr] md:gap-8">
          <SettingsNav />
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
