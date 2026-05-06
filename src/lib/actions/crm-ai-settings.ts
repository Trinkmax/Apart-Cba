"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { createSecret, updateSecret } from "@/lib/crm/encryption";
import type { CrmAiSettings } from "@/lib/types/database";

export async function getAISettings(): Promise<CrmAiSettings | null> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_ai_settings")
    .select("*")
    .eq("organization_id", organization.id)
    .maybeSingle();
  return data as CrmAiSettings | null;
}

const updateSchema = z.object({
  chatProvider: z.enum(["anthropic", "openai", "vercel_gateway"]).optional(),
  chatDefaultModel: z.string().optional(),
  chatApiKey: z.string().min(10).optional(),
  transcriptionApiKey: z.string().min(10).optional(),
  monthlyTokenBudget: z.number().int().min(0).nullable().optional(),
  enabledModels: z.array(z.string()).min(1).optional(),
});

export async function updateAISettings(input: z.infer<typeof updateSchema>) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const v = updateSchema.parse(input);
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("crm_ai_settings")
    .select("chat_api_key_secret_id,transcription_api_key_secret_id")
    .eq("organization_id", organization.id)
    .single();

  const update: Record<string, unknown> = {};
  if (v.chatProvider) update.chat_provider = v.chatProvider;
  if (v.chatDefaultModel) update.chat_default_model = v.chatDefaultModel;
  if (v.monthlyTokenBudget !== undefined) update.monthly_token_budget = v.monthlyTokenBudget;
  if (v.enabledModels) update.enabled_models = v.enabledModels;

  if (v.chatApiKey) {
    if (existing?.chat_api_key_secret_id) {
      await updateSecret(existing.chat_api_key_secret_id, v.chatApiKey);
    } else {
      const sid = await createSecret(`crm_ai_chat_${organization.id}`, v.chatApiKey);
      update.chat_api_key_secret_id = sid;
    }
  }
  if (v.transcriptionApiKey) {
    if (existing?.transcription_api_key_secret_id) {
      await updateSecret(existing.transcription_api_key_secret_id, v.transcriptionApiKey);
    } else {
      const sid = await createSecret(`crm_ai_transcribe_${organization.id}`, v.transcriptionApiKey);
      update.transcription_api_key_secret_id = sid;
    }
  }

  await admin
    .from("crm_ai_settings")
    .update(update)
    .eq("organization_id", organization.id);

  revalidatePath("/dashboard/crm/config");
}
