import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";
import { SetupForm } from "@/components/setup/setup-form";

export default async function SetupPage() {
  const admin = createAdminClient();
  // Sólo accesible si NO hay user_profiles aún (primera instalación)
  const { count } = await admin
    .from("user_profiles")
    .select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) redirect("/login");

  // Verificar si ya hay org "apartcba"
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "apartcba")
    .maybeSingle();

  return (
    <div className="min-h-screen flex items-center justify-center p-6 brand-gradient">
      <div className="w-full max-w-md bg-background rounded-2xl shadow-2xl p-8 space-y-6 animate-scale-in">
        <div className="flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Configuración inicial</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Creá la primera cuenta de superadmin para tu organización.
          </p>
        </div>
        <SetupForm hasOrg={!!org} orgId={org?.id ?? null} />
      </div>
    </div>
  );
}
