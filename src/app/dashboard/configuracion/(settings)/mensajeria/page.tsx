import { getCurrentOrg } from "@/lib/actions/org";
import { can, isAdminLevel } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { CrmConfigShell } from "@/components/crm/config/crm-config-shell";

export const dynamic = "force-dynamic";

export default async function MensajeriaConfigPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_config", "view") && !isAdminLevel(role)) redirect("/sin-acceso");

  return <CrmConfigShell />;
}
