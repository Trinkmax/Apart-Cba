/**
 * Plata y topes de Tex (nov-2026). Lo puro (costo) se prueba en
 * `__tests__/usage.test.ts`; los topes leen la base.
 *
 * Haiku 5.5 tiene dos tarifas según el largo del prompt (≤ 100K tokens /
 * más): entrada US$0.10 / 0.50 por millón, salida US$0.50 / 2.50. La lectura
 * de caché vale 0.1× la entrada y la escritura (5 min) 1.25×.
 */

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

type Rate = { input: number; output: number };
const HAIKU_55: { small: Rate; large: Rate } = {
  small: { input: 0.1, output: 0.5 },
  large: { input: 0.5, output: 2.5 },
};
const LONG_PROMPT = 100_000;

/** Costo en USD de UNA llamada (el largo del prompt decide la tarifa). */
export function callCostUsd(u: TokenUsage): number {
  const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const rate = prompt > LONG_PROMPT ? HAIKU_55.large : HAIKU_55.small;
  const usd =
    (u.inputTokens * rate.input +
      u.cacheReadTokens * rate.input * 0.1 +
      u.cacheWriteTokens * rate.input * 1.25 +
      u.outputTokens * rate.output) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Los topes por persona: mensajes escritos (no los internos). */
export const USER_LIMITS = { perFiveMinutes: 30, perDay: 300 } as const;

/** Primer día del mes (UTC) de una fecha `YYYY-MM-DD`: el corte del presupuesto. */
export function monthStartIso(todayYmd: string): string {
  return `${todayYmd.slice(0, 7)}-01T00:00:00.000Z`;
}
