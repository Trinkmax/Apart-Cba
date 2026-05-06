import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { AIClient, AIUsage, AITranscriber } from "./types";
import { OPENAI_PRICING_USD_PER_1M } from "./models";

function estimateCost(model: string, prompt: number, completion: number): number {
  const p = OPENAI_PRICING_USD_PER_1M[model];
  if (!p) return 0;
  return (prompt * p.input + completion * p.output) / 1_000_000;
}

export class OpenAIClient implements AIClient, AITranscriber {
  private readonly openai: ReturnType<typeof createOpenAI>;
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.openai = createOpenAI({ apiKey });
  }

  async chat(input: { model: string; messages: { role: string; content: string }[]; maxTokens?: number; temperature?: number }) {
    const { text, usage } = await generateText({
      model: this.openai(input.model),
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
      model: this.openai(input.model),
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
      model: this.openai(input.model),
      system: sys,
      prompt: input.text,
      maxOutputTokens: 400,
      temperature: 0.5,
    });
    return { summary: text, usage: toUsage(input.model, usage) };
  }

  async transcribe(input: { audioBuffer: ArrayBuffer; mime: string; language?: string }) {
    const form = new FormData();
    const blob = new Blob([input.audioBuffer], { type: input.mime });
    const ext = mimeToExt(input.mime);
    form.append("file", blob, `audio.${ext}`);
    form.append("model", "whisper-1");
    if (input.language) form.append("language", input.language);
    form.append("response_format", "verbose_json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Whisper transcription failed: ${res.status}`);
    const data = (await res.json()) as { text: string; language: string; duration?: number };

    const costUsd = data.duration ? (data.duration / 60) * 0.006 : undefined;
    return { text: data.text, language: data.language, durationSec: data.duration, costUsd };
  }
}

function mimeToExt(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  if (mime.includes("m4a") || mime.includes("mp4")) return "m4a";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("wav")) return "wav";
  return "ogg";
}

function parseClassifyJSON(raw: string): { labels: string[]; confidence: number } {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      labels: Array.isArray(obj.labels) ? obj.labels.map(String) : [],
      confidence: typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
    };
  } catch {
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
