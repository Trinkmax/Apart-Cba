import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { isAdminLevel } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { DomainCard } from "@/components/settings/org/domain-card";
import { TemplatesSection } from "@/components/settings/org/templates-section";
import type { OrgMessageTemplate } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ComunicacionesPage() {
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: templates } = await admin
    .from("org_message_templates")
    .select("*")
    .eq("organization_id", organization.id)
    .order("event_type")
    .order("channel");

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
          Comunicaciones
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Dominio propio para los mails al huésped y plantillas editables.
        </p>
      </header>

      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-3">
        <h3 className="text-sm font-semibold">Dominio de envío</h3>
        <DomainCard organization={organization} />
      </div>

      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-3">
        <h3 className="text-sm font-semibold">Plantillas</h3>
        <TemplatesSection templates={(templates ?? []) as OrgMessageTemplate[]} />
      </div>
    </section>
  );
}
