import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AIClient, AIUsage } from "./types";
import { ANTHROPIC_PRICING_USD_PER_1M } from "./models";

function estimateCost(model: string, prompt: number, completion: number): number {
  const p = ANTHROPIC_PRICING_USD_PER_1M[model];
  if (!p) return 0;
  return (prompt * p.input + completion * p.output) / 1_000_000;
}

export class AnthropicClient implements AIClient {
  private readonly anthropic: ReturnType<typeof createAnthropic>;
  constructor(apiKey: string) {
    this.anthropic = createAnthropic({ apiKey });
  }

  async chat(input: { model: string; messages: { role: string; content: string }[]; maxTokens?: number; temperature?: number }) {
    const { text, usage } = await generateText({
      model: this.anthropic(input.model),
      messages: input.messages.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })),
      maxOutputTokens: input.maxTokens ?? 1024,
      temperature: input.temperature ?? 0.7,
    });
    return { text, usage: toUsage(input.model, usage) };
  }

  async classify(input: {
    model: string;
    text: string;
    labels: { slug: string; description?: string }[];
    multi?: boolean;
    instruction?: string;
  }) {
    const labelDescriptions = input.labels.map((l) => `- ${l.slug}${l.description ? ": " + l.description : ""}`).join("\n");
    const sys = `Eres un clasificador de mensajes de un CRM de alquileres temporarios.
Recibís un mensaje y debés elegir ${input.multi ? "uno o más" : "exactamente UN"} label de la siguiente lista:
${labelDescriptions}

Devolvé SOLO un objeto JSON con este shape exacto, sin texto adicional:
{ "labels": ["slug1","slug2"], "confidence": 0.85 }
${input.instruction ?? ""}`.trim();

    const { text, usage } = await generateText({
      model: this.anthropic(input.model),
      system: sys,
      prompt: input.text,
      maxOutputTokens: 200,
      temperature: 0.2,
    });

    const parsed = parseClassifyJSON(text);
    return { labels: parsed.labels, confidence: parsed.confidence, usage: toUsage(input.model, usage) };
  }

  async summarize(input: { model: string; text: string; style?: "short" | "bullets" }) {
    const sys =
      input.style === "bullets"
        ? "Resumí el siguiente thread como bullets cortos (max 5)."
        : "Resumí el siguiente thread en 2-3 oraciones, en español rioplatense.";
    const { text, usage } = await generateText({
      model: this.anthropic(input.model),
      system: sys,
      prompt: input.text,
      maxOutputTokens: 400,
      temperature: 0.5,
    });
    return { summary: text, usage: toUsage(input.model, usage) };
  }
}

function parseClassifyJSON(raw: string): { labels: string[]; confidence: number } {
  // Strip markdown fences si los hay
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      labels: Array.isArray(obj.labels) ? obj.labels.map(String) : [],
      confidence: typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
    };
  } catch {
    // Fallback: extraer slugs por regex
    const fallback = raw.match(/[a-z][a-z0-9_-]+/g) ?? [];
    return { labels: fallback.slice(0, 5), confidence: 0.3 };
  }
}

function toUsage(model: string, raw: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined): AIUsage {
  const promptTokens = raw?.inputTokens ?? 0;
  const completionTokens = raw?.outputTokens ?? 0;
  const totalTokens = raw?.totalTokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens, costUsd: estimateCost(model, promptTokens, completionTokens) };
}
