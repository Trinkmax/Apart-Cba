import { notFound, redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getWorkflowRunDetail } from "@/lib/actions/crm-workflow-runs";
import { WorkflowRunDetail } from "@/components/crm/workflows/runs/run-detail";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ runId: string }>;
}

export default async function WorkflowRunPage({ params }: Props) {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "view")) redirect("/sin-acceso");

  const { runId } = await params;
  const detail = await getWorkflowRunDetail(runId);
  if (!detail) notFound();

  return <WorkflowRunDetail run={detail.run} workflow={detail.workflow} steps={detail.steps} />;
}
