"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { validateWorkflowGraph } from "@/lib/crm/workflows/validator";
import { dispatchEvent } from "@/lib/crm/workflows/dispatcher";
import type { CrmWorkflow, CrmWorkflowGraph, CrmWorkflowTriggerType, CrmWorkflowStatus } from "@/lib/types/database";

export async function listCrmWorkflows(): Promise<CrmWorkflow[]> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "view")) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_workflows")
    .select("*")
    .eq("organization_id", organization.id)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CrmWorkflow[];
}

export async function getCrmWorkflow(id: string): Promise<CrmWorkflow | null> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "view")) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_workflows")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  return data as CrmWorkflow | null;
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  triggerType: z.enum(["message_received", "conversation_closed", "pms_event", "scheduled", "manual"]),
});

export async function createCrmWorkflow(input: z.infer<typeof createSchema>): Promise<{ id: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "create")) throw new Error("Sin permisos");

  const v = createSchema.parse(input);
  const admin = createAdminClient();

  const triggerNodeId = `trigger-${Date.now()}`;
  const initialGraph: CrmWorkflowGraph = {
    nodes: [{
      id: triggerNodeId,
      type: `trigger.${v.triggerType}`,
      position: { x: 400, y: 100 },
      data: { config: {} },
    }],
    edges: [],
  };

  const { data, error } = await admin
    .from("crm_workflows")
    .insert({
      organization_id: organization.id,
      name: v.name,
      description: v.description,
      trigger_type: v.triggerType as CrmWorkflowTriggerType,
      trigger_config: {},
      graph: initialGraph,
      status: "draft",
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "create_failed");

  revalidatePath("/dashboard/crm/workflows");
  return { id: data.id };
}

const saveGraphSchema = z.object({
  id: z.string().uuid(),
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }),
  triggerConfig: z.record(z.string(), z.any()).optional(),
  variables: z.record(z.string(), z.any()).optional(),
});

export async function saveCrmWorkflowGraph(input: z.infer<typeof saveGraphSchema>) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "update")) throw new Error("Sin permisos");

  const v = saveGraphSchema.parse(input);
  const admin = createAdminClient();

  const errors = validateWorkflowGraph(v.graph as CrmWorkflowGraph);
  await admin
    .from("crm_workflows")
    .update({
      graph: v.graph,
      trigger_config: v.triggerConfig ?? {},
      variables: v.variables ?? {},
      validation_errors: errors.length > 0 ? errors : null,
      version: 1, // increment lo hace publish
    })
    .eq("id", v.id)
    .eq("organization_id", organization.id);

  revalidatePath(`/dashboard/crm/workflows/${v.id}`);
  return { errors };
}

export async function publishCrmWorkflow(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: wf, error } = await admin
    .from("crm_workflows")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (error || !wf) throw new Error("Workflow no encontrado");

  const errors = validateWorkflowGraph(wf.graph as CrmWorkflowGraph);
  if (errors.length > 0) throw new Error(`Validación fallida: ${errors.map((e) => e.message).join("; ")}`);

  await admin
    .from("crm_workflows")
    .update({
      status: "active",
      active_version: wf.version,
      version: wf.version + 1,
      validation_errors: null,
    })
    .eq("id", id);

  revalidatePath("/dashboard/crm/workflows");
}

export async function setCrmWorkflowStatus(id: string, status: CrmWorkflowStatus) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("crm_workflows")
    .update({ status })
    .eq("id", id)
    .eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/workflows");
}

export async function duplicateCrmWorkflow(id: string): Promise<{ id: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "create")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: source } = await admin
    .from("crm_workflows")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (!source) throw new Error("Workflow origen no encontrado");

  const { data: clone, error } = await admin
    .from("crm_workflows")
    .insert({
      organization_id: organization.id,
      name: `${source.name} (copia)`,
      description: source.description,
      trigger_type: source.trigger_type,
      trigger_config: source.trigger_config,
      graph: source.graph,
      variables: source.variables,
      status: "draft",
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !clone) throw new Error(error?.message ?? "duplicate_failed");
  revalidatePath("/dashboard/crm/workflows");
  return { id: clone.id };
}

export async function deleteCrmWorkflow(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "delete")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin.from("crm_workflows").delete().eq("id", id).eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/workflows");
}

const runManualSchema = z.object({
  workflowId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
});

export async function installFromLibrary(slug: string): Promise<{ id: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "create")) throw new Error("Sin permisos");

  const { WORKFLOW_LIBRARY } = await import("@/lib/crm/workflow-library");
  const tpl = WORKFLOW_LIBRARY.find((w) => w.slug === slug);
  if (!tpl) throw new Error("Template no encontrado en biblioteca");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_workflows")
    .insert({
      organization_id: organization.id,
      name: tpl.name,
      description: tpl.description,
      trigger_type: tpl.triggerType,
      trigger_config: tpl.triggerConfig,
      graph: tpl.graph,
      status: "draft",
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "install_failed");
  revalidatePath("/dashboard/crm/workflows");
  return { id: data.id };
}

export async function runCrmWorkflowManual(input: z.infer<typeof runManualSchema>) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "update")) throw new Error("Sin permisos");

  const v = runManualSchema.parse(input);
  await dispatchEvent({
    organizationId: organization.id,
    eventType: "manual.run",
    payload: { workflow_id: v.workflowId },
    conversationId: v.conversationId,
  });
}
