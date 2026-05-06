"use server";

import { createAdminClient } from "@/lib/supabase/server";
import type { AIUsage } from "./types";

/**
 * Incrementa el contador mensual de tokens / costo + agregación diaria por modelo.
 * No-op si no existe la fila (debería existir tras seed).
 */
export async function trackAIUsage(input: { organizationId: string; usage: AIUsage; model: string }) {
  const admin = createAdminClient();
  const { organizationId, usage, model } = input;

  // RPC v2: actualiza monthly + daily-by-model
  const { error: rpcV2Err } = await admin.rpc("crm_increment_ai_usage_v2", {
    p_org_id: organizationId,
    p_model: model,
    p_prompt_tokens: usage.promptTokens,
    p_completion_tokens: usage.completionTokens,
    p_total_tokens: usage.totalTokens,
    p_cost_usd: usage.costUsd ?? 0,
  });
  if (!rpcV2Err) return;

  // Fallback al RPC v1 si no existe (migración 011 aún no aplicada)
  const { error: rpcErr } = await admin.rpc("crm_increment_ai_usage", {
    p_org_id: organizationId,
    p_tokens: usage.totalTokens,
    p_cost_usd: usage.costUsd ?? 0,
  });
  if (rpcErr) {
    console.error("[ai/usage] RPC failed, falling back:", rpcErr.message);
    const { data: row } = await admin
      .from("crm_ai_settings")
      .select("tokens_used_this_month, cost_used_this_month_usd")
      .eq("organization_id", organizationId)
      .single();
    if (!row) return;
    await admin
      .from("crm_ai_settings")
      .update({
        tokens_used_this_month: row.tokens_used_this_month + usage.totalTokens,
        cost_used_this_month_usd: Number(row.cost_used_this_month_usd) + (usage.costUsd ?? 0),
      })
      .eq("organization_id", organizationId);
  }
}

/**
 * Verifica que la org no haya excedido su budget mensual.
 * Throws si está por encima del límite.
 */
export async function assertAIBudget(organizationId: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_ai_settings")
    .select("monthly_token_budget, tokens_used_this_month")
    .eq("organization_id", organizationId)
    .single();
  if (error || !data) return; // sin row, sin enforcement
  if (data.monthly_token_budget == null) return; // sin budget, unlimited
  if (data.tokens_used_this_month >= data.monthly_token_budget) {
    throw new Error("budget_exceeded");
  }
}
