import type { CrmAiChatProvider } from "@/lib/types/database";

export interface AIChatContent {
  type: "text";
  text: string;
}

export interface AIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIClient {
  /** Generación libre de texto. */
  chat(input: {
    model: string;
    messages: AIChatMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; usage: AIUsage }>;

  /** Clasificación a un set de labels (multi o single). */
  classify(input: {
    model: string;
    text: string;
    labels: { slug: string; description?: string }[];
    multi?: boolean;
    instruction?: string;
  }): Promise<{ labels: string[]; confidence: number; usage: AIUsage }>;

  /** Resumir un thread de mensajes. */
  summarize(input: {
    model: string;
    text: string;
    style?: "short" | "bullets";
  }): Promise<{ summary: string; usage: AIUsage }>;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Costo USD aproximado (si conocemos pricing). */
  costUsd?: number;
}

export interface AITranscriber {
  transcribe(input: {
    audioBuffer: ArrayBuffer;
    mime: string;
    language?: string;
  }): Promise<{ text: string; language: string; durationSec?: number; costUsd?: number }>;
}

export type AIProviderSlug = CrmAiChatProvider;
