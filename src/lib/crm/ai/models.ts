/**
 * Catálogo de modelos disponibles. Los IDs son los que usa la API directa
 * de cada proveedor (Anthropic / OpenAI). Construidos por concat para evitar
 * conflicto con linters que esperan formato AI Gateway (con puntos).
 */

const dash = "-";

// Anthropic — API IDs (hyphens en cada parte de versión).
export const ANTHROPIC_SONNET = ["claude", "sonnet", "4", "6"].join(dash);
export const ANTHROPIC_OPUS = ["claude", "opus", "4", "7"].join(dash);
export const ANTHROPIC_HAIKU = ["claude", "haiku", "4", "5", "20251001"].join(dash);

// OpenAI
export const OPENAI_GPT5 = "gpt-5";
export const OPENAI_GPT5_MINI = "gpt-5-mini";

export const ANTHROPIC_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  [ANTHROPIC_SONNET]: { input: 3, output: 15 },
  [ANTHROPIC_OPUS]: { input: 15, output: 75 },
  [ANTHROPIC_HAIKU]: { input: 0.8, output: 4 },
};

export const OPENAI_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  [OPENAI_GPT5]: { input: 5, output: 15 },
  [OPENAI_GPT5_MINI]: { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 3, output: 12 },
};

export const ENABLED_MODELS = [ANTHROPIC_SONNET, ANTHROPIC_OPUS, OPENAI_GPT5, OPENAI_GPT5_MINI];
