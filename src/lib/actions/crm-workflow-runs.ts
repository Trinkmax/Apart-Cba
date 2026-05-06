"use server";

import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import type { CrmWorkflowRun, CrmWorkflowStepLog } from "@/lib/types/database";

export async function listWorkflowRuns(workflowId: string, limit = 50): Promise<CrmWorkflowRun[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_workflow_runs")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("workflow_id", workflowId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CrmWorkflowRun[];
}

export async function getWorkflowRunDetail(runId: string): Promise<{
  run: CrmWorkflowRun;
  workflow: { id: string; name: string };
  steps: CrmWorkflowStepLog[];
} | null> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: run } = await admin
    .from("crm_workflow_runs")
    .select("*, workflow:crm_workflows(id,name)")
    .eq("id", runId)
    .eq("organization_id", organization.id)
    .single();
  if (!run) return null;

  const { data: steps } = await admin
    .from("crm_workflow_step_logs")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  type RunWithWf = CrmWorkflowRun & { workflow: { id: string; name: string } };
  const r = run as RunWithWf;
  return {
    run: r,
    workflow: r.workflow,
    steps: (steps ?? []) as CrmWorkflowStepLog[],
  };
}

export async function cancelRun(runId: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  await admin
    .from("crm_workflow_runs")
    .update({ status: "cancelled", ended_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("organization_id", organization.id)
    .in("status", ["queued", "running", "suspended"]);
}
