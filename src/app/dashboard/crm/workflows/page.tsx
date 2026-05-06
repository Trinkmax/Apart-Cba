import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { listCrmWorkflows } from "@/lib/actions/crm-workflows";
import { WorkflowsList } from "@/components/crm/workflows/workflow-list";

export const dynamic = "force-dynamic";

export default async function CrmWorkflowsPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "view")) redirect("/sin-acceso");

  const workflows = await listCrmWorkflows();
  return <WorkflowsList workflows={workflows} canEdit={can(role, "crm_workflows", "update")} />;
}
