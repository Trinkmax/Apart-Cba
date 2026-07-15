import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { isAdminLevel } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { IdentitySection } from "./identity-section";
import { BrandingSection } from "./branding-section";
import { CommunicationsSection } from "./communications-section";
import type { OrgMessageTemplate } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function OrganizacionPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { organization, role } = await getCurrentOrg();
  // Config de la organización: solo admin/recepción (esta ruta es hermana del
  // grupo (settings), así que NO hereda el guard de (settings)/layout.tsx).
  if (!isAdminLevel(role)) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: templates } = await admin
    .from("org_message_templates")
    .select("*")
    .eq("organization_id", organization.id)
    .order("event_type")
    .order("channel");

  return (
    <div className="container max-w-4xl py-6 px-4 sm:px-6 space-y-8">
      <h1 className="text-2xl font-bold">Configuración de organización</h1>

      <IdentitySection organization={organization} />
      <BrandingSection organization={organization} />
      <CommunicationsSection
        organization={organization}
        templates={(templates ?? []) as OrgMessageTemplate[]}
      />
    </div>
  );
}
