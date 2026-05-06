import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { listQuickReplies } from "@/lib/actions/crm-quick-replies";
import { RapidosList } from "@/components/crm/rapidos/quick-reply-list";

export const dynamic = "force-dynamic";

export default async function CrmRapidosPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_rapidos", "view")) redirect("/sin-acceso");

  const rapidos = await listQuickReplies();
  return <RapidosList rapidos={rapidos} canEdit={can(role, "crm_rapidos", "create")} />;
}
