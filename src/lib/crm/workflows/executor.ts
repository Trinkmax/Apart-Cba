"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getNode } from "./registry";
import type { NodeContext, NodeResult } from "./types";
import type { CrmWorkflowGraph, CrmWorkflowNode } from "@/lib/types/database";

const MAX_STEPS_PER_RUN = 200;

interface ExecuteOptions {
  runId: string;
}

export async function runWorkflow({ runId }: ExecuteOptions): Promise<void> {
  const admin = createAdminClient();
  const { data: run, error } = await admin
    .from("crm_workflow_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (error || !run) {
    console.error("[workflow-executor] run not found", runId);
    return;
  }

  if (run.status === "success" || run.status === "failed" || run.status === "cancelled") return;

  // Marcar como running
  await admin.from("crm_workflow_runs").update({ status: "running" }).eq("id", runId);

  const { data: workflow, error: wfErr } = await admin
    .from("crm_workflows")
    .select("graph,version,organization_id")
    .eq("id", run.workflow_id)
    .single();

  if (wfErr || !workflow) {
    await failRun(runId, "workflow_not_found");
    return;
  }

  const graph = workflow.graph as CrmWorkflowGraph;
  let currentNodeId: string | null = run.current_node_id ?? findStartNodeId(graph);
  let variables: Record<string, unknown> = (run.variables ?? {}) as Record<string, unknown>;
  let stepsExecuted: number = run.steps_executed ?? 0;

  while (currentNodeId && stepsExecuted < MAX_STEPS_PER_RUN) {
    const node = graph.nodes.find((n) => n.id === currentNodeId);
    if (!node) break;
    const def = getNode(node.type);
    if (!def) {
      await failRun(runId, `Unknown node type: ${node.type}`);
      return;
    }

    const ctx: NodeContext = {
      organizationId: run.organization_id,
      conversationId: run.conversation_id ?? undefined,
      contactId: run.contact_id ?? undefined,
      triggerMessageId: (run.trigger_payload as { message_id?: string } | null)?.message_id,
      variables,
      workflowId: run.workflow_id,
      runId,
      emitEvent: async (eventType, payload) => {
        await admin.from("crm_events").insert({
          organization_id: run.organization_id,
          event_type: eventType,
          payload,
          conversation_id: run.conversation_id,
          contact_id: run.contact_id,
        });
      },
      log: () => {},
      admin,
    };

    const t0 = Date.now();
    let result: NodeResult;
    try {
      const config = def.configSchema.parse(node.data?.config ?? {});
      result = await def.execute(ctx, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logStep(admin, runId, run.organization_id, node, "failed", null, null, message, Date.now() - t0);
      await failRun(runId, message);
      return;
    }
    const ms = Date.now() - t0;

    await logStep(
      admin,
      runId,
      run.organization_id,
      node,
      result.kind === "error" ? "failed" : "success",
      null,
      "output" in result ? (result.output as Record<string, unknown> | undefined) ?? null : null,
      result.kind === "error" ? result.error : null,
      ms,
    );

    stepsExecuted += 1;

    if (result.kind === "wait_time") {
      await admin
        .from("crm_workflow_runs")
        .update({
          status: "suspended",
          current_node_id: currentNodeId,
          variables,
          steps_executed: stepsExecuted,
          resume_at: result.resumeAt.toISOString(),
          resume_reason: "wait_time",
        })
        .eq("id", runId);
      return;
    }

    if (result.kind === "wait_reply") {
      await admin
        .from("crm_workflow_runs")
        .update({
          status: "suspended",
          current_node_id: currentNodeId,
          variables,
          steps_executed: stepsExecuted,
          resume_at: result.timeoutAt?.toISOString() ?? null,
          resume_reason: "wait_reply",
        })
        .eq("id", runId);
      return;
    }

    if (result.kind === "error") {
      await failRun(runId, result.error);
      return;
    }

    if (result.kind === "stop") {
      await completeRun(runId, run.organization_id, run.workflow_id);
      return;
    }

    if ("output" in result && result.output) {
      variables = { ...variables, ...result.output };
    }

    const handle = result.kind === "branch" ? result.outputId : (result.kind === "next" ? result.outputId ?? "next" : "next");
    const nextEdge = graph.edges.find((e) => e.source === currentNodeId && (e.sourceHandle ?? "next") === handle);
    currentNodeId = nextEdge?.target ?? null;
  }

  if (stepsExecuted >= MAX_STEPS_PER_RUN) {
    await failRun(runId, "max_steps_exceeded");
  } else {
    await completeRun(runId, run.organization_id, run.workflow_id);
  }
}

function findStartNodeId(graph: CrmWorkflowGraph): string | null {
  // Trigger node = node sin in-edges (o el primer node del tipo trigger.*)
  const incoming = new Set(graph.edges.map((e) => e.target));
  const trig = graph.nodes.find((n) => n.type.startsWith("trigger.") || !incoming.has(n.id));
  return trig?.id ?? null;
}

async function failRun(runId: string, error: string) {
  const admin = createAdminClient();
  const { data: run } = await admin.from("crm_workflow_runs").select("workflow_id").eq("id", runId).single();
  await admin
    .from("crm_workflow_runs")
    .update({ status: "failed", error, ended_at: new Date().toISOString() })
    .eq("id", runId);
  if (run) {
    await admin.rpc("crm_increment_workflow_counts", { p_wf_id: run.workflow_id, p_success: false });
  }
}

async function completeRun(runId: string, _orgId: string, workflowId: string) {
  const admin = createAdminClient();
  await admin
    .from("crm_workflow_runs")
    .update({ status: "success", ended_at: new Date().toISOString() })
    .eq("id", runId);
  await admin.rpc("crm_increment_workflow_counts", { p_wf_id: workflowId, p_success: true });
}

async function logStep(
  admin: ReturnType<typeof createAdminClient>,
  runId: string,
  orgId: string,
  node: CrmWorkflowNode,
  status: "success" | "failed" | "skipped" | "pending",
  inputSnapshot: Record<string, unknown> | null,
  outputSnapshot: Record<string, unknown> | null,
  error: string | null,
  durationMs: number,
) {
  await admin.from("crm_workflow_step_logs").insert({
    run_id: runId,
    organization_id: orgId,
    node_id: node.id,
    node_type: node.type,
    status,
    input_snapshot: inputSnapshot,
    output_snapshot: outputSnapshot,
    error,
    duration_ms: durationMs,
  });
}
