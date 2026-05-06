"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { triggerWorkflowRunner } from "../runner-trigger";

export interface DispatchEventInput {
  organizationId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  conversationId?: string | null;
  contactId?: string | null;
  refType?: string;
  refId?: string;
}

/**
 * Despacha un evento PMS/messaging al motor de workflows:
 * 1. Persiste en crm_events (audit)
 * 2. Resume runs suspendidos esperando respuesta (sólo si message.received)
 * 3. Selecciona workflows con trigger matching y crea runs queued
 * 4. Dispara fire-and-forget al runner para latencia inmediata
 */
export async function dispatchEvent(input: DispatchEventInput): Promise<{ runsCreated: number }> {
  const admin = createAdminClient();
  const payload = input.payload ?? {};

  const { data: event, error: insertErr } = await admin
    .from("crm_events")
    .insert({
      organization_id: input.organizationId,
      event_type: input.eventType,
      payload,
      conversation_id: input.conversationId ?? null,
      contact_id: input.contactId ?? null,
      ref_type: input.refType ?? null,
      ref_id: input.refId ?? null,
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("[dispatcher] insert event failed", insertErr.message);
    return { runsCreated: 0 };
  }

  // 2. Resume reply waiters
  if (input.eventType === "message.received" && input.conversationId) {
    const { error } = await admin.rpc("crm_resume_reply_waiters", { p_conversation_id: input.conversationId });
    if (error) console.error("[dispatcher] resume waiters failed", error.message);
  }

  // 3. Match workflows
  const { data: matches } = await admin.rpc("crm_select_workflows_for_event", {
    p_organization_id: input.organizationId,
    p_event_type: input.eventType,
    p_payload: payload,
  });

  const list = Array.isArray(matches) ? (matches as { workflow_id: string; workflow_version: number; trigger_config: Record<string, unknown> }[]) : [];

  let runsCreated = 0;
  for (const m of list) {
    if (!matchesFilters(m.trigger_config, payload)) continue;

    await admin.from("crm_workflow_runs").insert({
      organization_id: input.organizationId,
      workflow_id: m.workflow_id,
      workflow_version: m.workflow_version,
      status: "queued",
      trigger_payload: payload,
      conversation_id: input.conversationId ?? null,
      contact_id: input.contactId ?? null,
      variables: { triggered_at: new Date().toISOString(), event_type: input.eventType, ...payload },
    });
    runsCreated += 1;
  }

  if (event) {
    await admin
      .from("crm_events")
      .update({ dispatched: true, dispatched_at: new Date().toISOString() })
      .eq("id", event.id);
  }

  // 4. Trigger immediate runner (fire-and-forget)
  if (runsCreated > 0) {
    triggerWorkflowRunner();
  }

  return { runsCreated };
}

function matchesFilters(triggerConfig: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  // Filtros opcionales sobre el payload (e.g., keywords, tags, channels).
  // Implementación mínima MVP: aceptar todo.
  const filters = triggerConfig.filters as Record<string, unknown> | undefined;
  if (!filters) return true;

  // Keywords (sub-string en text)
  const keywords = filters.keywords as string[] | undefined;
  if (Array.isArray(keywords) && keywords.length > 0) {
    const text = String((payload.text ?? "")).toLowerCase();
    const hit = keywords.some((kw) => text.includes(kw.toLowerCase()));
    if (!hit) return false;
  }

  // fromKind (lead/guest/owner)
  const fromKind = filters.fromKind as string | undefined;
  if (fromKind && payload.contact_kind && payload.contact_kind !== fromKind) return false;

  return true;
}

