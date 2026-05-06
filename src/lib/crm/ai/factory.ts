"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getSecret } from "../encryption";
import { AnthropicClient } from "./anthropic";
import { OpenAIClient } from "./openai";
import type { AIClient, AITranscriber } from "./types";

/**
 * Resuelve el AIClient para una organización.
 * Si la org no tiene API key cargada → throw "ai_not_configured".
 *
 * vercel_gateway: usa el env VERCEL_AI_GATEWAY_API_KEY centralizado y el modelo
 * `provider/model` string (ej. "anthropic/claude-sonnet-4-6").
 */
export async function getAIClientForOrg(organizationId: string): Promise<{ client: AIClient; defaultModel: string }> {
  const admin = createAdminClient();
  const { data: settings, error } = await admin
    .from("crm_ai_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .single();

  if (error || !settings) throw new Error("ai_not_configured");

  if (settings.chat_provider === "anthropic") {
    const key = await getSecret(settings.chat_api_key_secret_id);
    if (!key) throw new Error("ai_not_configured: missing Anthropic key");
    return { client: new AnthropicClient(key), defaultModel: settings.chat_default_model };
  }

  if (settings.chat_provider === "openai") {
    const key = await getSecret(settings.chat_api_key_secret_id);
    if (!key) throw new Error("ai_not_configured: missing OpenAI key");
    return { client: new OpenAIClient(key), defaultModel: settings.chat_default_model };
  }

  if (settings.chat_provider === "vercel_gateway") {
    const key = process.env.VERCEL_AI_GATEWAY_API_KEY;
    if (!key) throw new Error("ai_not_configured: VERCEL_AI_GATEWAY_API_KEY missing");
    // Para Gateway usamos el cliente OpenAI con baseURL custom (estilo OpenAI-compatible).
    // El modelo viene como 'provider/model' string.
    const client = new OpenAIClient(key);
    return { client, defaultModel: settings.chat_default_model };
  }

  throw new Error(`Unsupported AI chat_provider: ${settings.chat_provider}`);
}

/**
 * Transcripción de audio. SIEMPRE OpenAI/Whisper.
 * Si la org no tiene transcription_api_key → throw.
 */
export async function getTranscriberForOrg(organizationId: string): Promise<AITranscriber> {
  const admin = createAdminClient();
  const { data: settings, error } = await admin
    .from("crm_ai_settings")
    .select("transcription_api_key_secret_id")
    .eq("organization_id", organizationId)
    .single();

  if (error || !settings) throw new Error("transcriber_not_configured");
  const key = await getSecret(settings.transcription_api_key_secret_id);
  if (!key) throw new Error("transcriber_not_configured: missing OpenAI key for Whisper");
  return new OpenAIClient(key);
}
