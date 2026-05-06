"use server";

import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";

export interface DailyUsageRow {
  organization_id: string;
  day: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  call_count: number;
}

export async function getAIUsageDaily(days = 30): Promise<DailyUsageRow[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data } = await admin
    .from("crm_ai_usage_daily")
    .select("*")
    .eq("organization_id", organization.id)
    .gte("day", since)
    .order("day", { ascending: true });
  return (data ?? []) as DailyUsageRow[];
}
