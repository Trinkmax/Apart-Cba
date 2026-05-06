import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";

export default async function CrmIndexPage() {
  const { role } = await getCurrentOrg();
  if (can(role, "crm_inbox", "view")) redirect("/dashboard/crm/inbox");
  if (can(role, "crm_workflows", "view")) redirect("/dashboard/crm/workflows");
  if (can(role, "crm_rapidos", "view")) redirect("/dashboard/crm/rapidos");
  if (can(role, "crm_config", "view")) redirect("/dashboard/crm/config");
  redirect("/sin-acceso");
}
