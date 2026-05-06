import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { listCrmAlerts } from "@/lib/actions/crm-alerts";
import { CrmAlertsClient } from "@/components/crm/alertas/crm-alerts-client";

export const dynamic = "force-dynamic";

export default async function CrmAlertasPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "view")) redirect("/sin-acceso");

  const alerts = await listCrmAlerts("active");
  return <CrmAlertsClient initialAlerts={alerts} />;
}
