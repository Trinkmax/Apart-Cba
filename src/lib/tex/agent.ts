import "server-only";

/**
 * El loop de Tex (nov-2026): Claude Haiku 5.5 con herramientas, en streaming.
 *
 * Patrón del SDK oficial (manual loop): `client.beta.messages.stream` +
 * `finalMessage()`; si pidió herramientas, se corren (en paralelo) y todos los
 * resultados vuelven en UN mensaje; hasta que termina o se llega al tope.
 *
 * Reglas que vienen de la documentación de Haiku 5.5 y de lo aprendido en sharp-app:
 * - Sin `temperature` (400) y sin prefill. Thinking adaptativo (no se puede apagar).
 * - Preserved thinking: la historia es append-only; `drop_block` como red si
 *   algo cambia (beta `thinking-binding-controls-2026-08-01`).
 * - Herramientas con `eager_input_streaming`: el servidor ya no valida los
 *   inputs, así que los valida Zod antes de correr nada.
 * - `refusal` y `max_tokens` frenan el turno: nunca se corre un tool_use cortado.
 * - Cada paso (assistant + sus tool_result) se guarda JUNTO: nunca queda un
 *   tool_use sin resultado en la base.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createHash } from "node:crypto";
import { anthropicTools } from "./registry";
import { TEX_SYSTEM } from "./prompt";
import type { ReadResult, TexTool, ToolContext } from "./tool";
import type { ProposalView, TexCard, TexEvent, TexPart } from "./types";
import { addUsage, callCostUsd, ZERO_USAGE, type TokenUsage } from "./usage";
import { choiceButtons, cleanReplies } from "./replies";

export const TEX_MODEL = process.env.TEX_MODEL || "claude-haiku-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const TEX_EFFORT: Effort = EFFORTS.includes(process.env.TEX_EFFORT as Effort)
  ? (process.env.TEX_EFFORT as Effort)
  : "medium";

const MAX_STEPS = 8;
const MAX_TOKENS = 16_000;
const TOOL_TIMEOUT_MS = 25_000;
const MAX_RESULT_CHARS = 24_000;
const BETAS = ["thinking-binding-controls-2026-08-01"];

let cachedClient: Anthropic | null = null;
export function texClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 45_000 });
  return cachedClient;
}

export type StepToSave = {
  assistant: BetaMessage;
  parts: TexPart[];
  toolResults: BetaToolResultBlockParam[] | null;
  usage: TokenUsage;
  costUsd: number;
  requestId: string | null;
};

export type TurnOptions = {
  client: Anthropic;
  ctx: ToolContext;
  tools: TexTool[];
  history: BetaMessageParam[];
  userContent: BetaContentBlockParam[];
  emit: (e: TexEvent) => void;
  signal: AbortSignal;
  saveStep: (step: StepToSave) => Promise<void>;
  /** Llamadas que se cobran pero no dejan un paso guardado (rechazo, corte): igual cuentan para el presupuesto. */
  saveCost: (usage: TokenUsage, costUsd: number, requestId: string | null) => Promise<void>;
  /** Cuándo vence el turno (ms epoch): las herramientas no pueden pasarse de ahí. */
  deadlineAt: number;
  createProposal: (tool: TexTool, payload: unknown, summary: import("./types").ProposalSummary) => Promise<ProposalView>;
};

export type TurnResult = { usage: TokenUsage; costUsd: number; stop: string };

function toUsage(m: BetaMessage): TokenUsage {
  const u = m.usage as unknown as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} tardó demasiado.`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Lo que le queda al turno para una herramienta (nunca más de 25 s). */
function toolBudget(opts: Pick<TurnOptions, "deadlineAt">): number {
  return Math.max(1_500, Math.min(TOOL_TIMEOUT_MS, opts.deadlineAt - Date.now() - 1_500));
}

function clipJson(value: unknown): string {
  // Las notas de confirmación son del sistema: un dato (un nombre, una nota de
  // un huésped) no puede hacerse pasar por una.
  const s = JSON.stringify(value ?? null).replace(/<(\/?)nota_del_sistema/gi, "‹$1nota");
  if (s.length <= MAX_RESULT_CHARS) return s;
  return `${s.slice(0, MAX_RESULT_CHARS)}… (recortado: pedí menos filas o filtrá)`;
}

function zodIssues(err: unknown): string {
  const issues = (err as { issues?: Array<{ path?: PropertyKey[]; message?: string }> })?.issues ?? [];
  return issues
    .slice(0, 6)
    .map((i) => `${(i.path ?? []).map(String).join(".") || "input"}: ${i.message ?? "inválido"}`)
    .join("; ");
}

/** Corre una herramienta y devuelve el resultado para el modelo + lo que dibuja la app. */
async function runTool(
  use: BetaToolUseBlock,
  opts: TurnOptions,
  byName: Map<string, TexTool>,
): Promise<{ result: BetaToolResultBlockParam; parts: TexPart[] }> {
  const parts: TexPart[] = [];
  const tool = byName.get(use.name);
  const fail = (msg: string, note?: string) => {
    opts.emit({ t: "tool", id: use.id, name: use.name, label: tool?.label ?? "…", state: "error", note });
    parts.push({ type: "tool", id: use.id, name: use.name, label: tool?.label ?? "…", state: "error", note });
    return { result: { type: "tool_result" as const, tool_use_id: use.id, is_error: true, content: msg }, parts };
  };
  if (!tool) return fail("Esa herramienta no está disponible para el rol de esta persona.");

  const parsed = tool.input.safeParse(use.input);
  if (!parsed.success) return fail(`Datos inválidos: ${zodIssues(parsed.error)}. Corregí y volvé a intentar.`);

  try {
    if (tool.kind === "read") {
      const r: ReadResult = await withTimeout(tool.run(parsed.data, opts.ctx), toolBudget(opts), "La consulta");
      if (!r.ok) return fail(r.error, "No se pudo");
      const cards: TexCard[] = [...(r.card ? [r.card] : []), ...(r.cards ?? [])];
      cards.forEach((card, i) => {
        const id = `${use.id}:${i}`;
        opts.emit({ t: "card", id, card });
        parts.push({ type: "card", id, card });
      });
      if (r.navigate) {
        opts.emit({ t: "navigate", href: r.navigate.href, label: r.navigate.label });
        parts.push({ type: "navigate", href: r.navigate.href, label: r.navigate.label });
      }
      const replies = cleanReplies(r.replies);
      if (replies.length) {
        opts.emit({ t: "replies", items: replies });
        parts.push({ type: "replies", items: replies });
      }
      opts.emit({ t: "tool", id: use.id, name: tool.name, label: tool.label, state: "done" });
      parts.unshift({ type: "tool", id: use.id, name: tool.name, label: tool.label, state: "done" });
      return { result: { type: "tool_result", tool_use_id: use.id, content: clipJson(r.data) }, parts };
    }

    const r = await withTimeout(tool.propose(parsed.data, opts.ctx), toolBudget(opts), "La preparación");
    if (r.ok === "ask") {
      opts.emit({ t: "tool", id: use.id, name: tool.name, label: tool.label, state: "done", note: "Falta un dato" });
      parts.push({ type: "tool", id: use.id, name: tool.name, label: tool.label, state: "done", note: "Falta un dato" });
      const replies = cleanReplies(r.replies);
      if (replies.length) {
        opts.emit({ t: "replies", items: replies });
        parts.push({ type: "replies", items: replies });
      }
      return {
        result: {
          type: "tool_result",
          tool_use_id: use.id,
          content: clipJson({
            falta_confirmar: r.question,
            respuestas_sugeridas: replies,
            nota:
              "Todavía NO armé nada. Preguntale esto en una línea (podés mejorar la redacción, sin agregar datos ni " +
              "suponer la respuesta). Las respuestas sugeridas ya se muestran como botones. Con la respuesta, volvé a " +
              "llamar la herramienta con el dato.",
          }),
        },
        parts,
      };
    }
    if (r.ok === "choose") {
      opts.emit({ t: "tool", id: use.id, name: tool.name, label: tool.label, state: "done", note: "Falta elegir" });
      parts.push({ type: "tool", id: use.id, name: tool.name, label: tool.label, state: "done", note: "Falta elegir" });
      // Un botón por opción, cada uno con un texto distinto (o ninguno): tocar
      // uno manda su texto, y dos «Juan Pérez» iguales dejarían al modelo adivinando.
      const buttons = choiceButtons(r.options);
      if (buttons.length) {
        opts.emit({ t: "replies", items: buttons });
        parts.push({ type: "replies", items: buttons });
      }
      return {
        result: {
          type: "tool_result",
          tool_use_id: use.id,
          content: clipJson({
            necesito_que_elija: r.question,
            opciones: r.options.map((o, i) => ({
              id: o.id,
              opcion: o.label,
              detalle: o.detail,
              ...(buttons.length ? { boton: buttons[i] } : {}),
            })),
            nota: buttons.length
              ? "Preguntale cuál con una lista corta: las opciones ya se ven como botones. Si contesta con el texto de un " +
                "botón, es la opción que tiene ese «boton». Después volvé a llamar la herramienta con el id elegido."
              : "Preguntale cuál con una lista corta, con el detalle que distingue a cada una. Si la respuesta no " +
                "señala una sola opción, volvé a preguntar. Después volvé a llamar la herramienta con el id elegido.",
          }),
        },
        parts,
      };
    }
    if (!r.ok) return fail(r.error, "No se pudo preparar");
    const view = await opts.createProposal(tool, r.payload, r.summary);
    opts.emit({ t: "tool", id: use.id, name: tool.name, label: tool.label, state: "done" });
    opts.emit({ t: "proposal", action: view });
    parts.push({ type: "tool", id: use.id, name: tool.name, label: tool.label, state: "done" });
    parts.push({ type: "proposal", actionId: view.id });
    return {
      result: {
        type: "tool_result",
        tool_use_id: use.id,
        content: clipJson({
          estado: "esperando_confirmacion",
          accion_id: view.id,
          resumen: [r.summary.title, ...r.summary.lines.map((l) => `${l.label}: ${l.value}`)].join(" · "),
          nota: "Todavía NO se hizo. La persona lo tiene que confirmar con el botón de la tarjeta.",
        }),
      },
      parts,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Algo falló.", "Falló");
  }
}

export async function runTexTurn(opts: TurnOptions): Promise<TurnResult> {
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const toolDefs = anthropicTools(opts.tools) as unknown as BetaToolUnion[];
  const messages: BetaMessageParam[] = [...opts.history, { role: "user", content: opts.userContent }];
  let total: TokenUsage = ZERO_USAGE;
  let totalCost = 0;
  let parseRetries = 0;
  const userHash = createHash("sha256").update(opts.ctx.user.id).digest("hex").slice(0, 32);

  for (let step = 0; step < MAX_STEPS; step++) {
    const parts: TexPart[] = [];
    let textBuf = "";
    let streamedChars = 0;
    const startedTools: Array<{ id: string; name: string; label: string }> = [];
    const flushText = () => {
      if (textBuf) {
        parts.push({ type: "text", text: textBuf });
        textBuf = "";
      }
    };

    const stream = opts.client.beta.messages.stream(
      {
        model: TEX_MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: TEX_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: toolDefs,
        tool_choice: { type: "auto" },
        messages,
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        output_config: { effort: TEX_EFFORT },
        // Auto-caché de la conversación: cada vuelta del loop reusa la anterior.
        cache_control: { type: "ephemeral" },
        metadata: { user_id: userHash },
        betas: BETAS,
      },
      { signal: opts.signal },
    );
    stream.on("text", (delta) => {
      textBuf += delta;
      streamedChars += delta.length;
      opts.emit({ t: "text", d: delta });
    });
    stream.on("streamEvent", (ev) => {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
        flushText();
        const t = byName.get(ev.content_block.name);
        startedTools.push({ id: ev.content_block.id, name: ev.content_block.name, label: t?.label ?? "Pensando…" });
        opts.emit({
          t: "tool",
          id: ev.content_block.id,
          name: ev.content_block.name,
          label: t?.label ?? "Pensando…",
          state: "start",
        });
      }
    });

    let msg: BetaMessage;
    try {
      msg = await stream.finalMessage();
      parseRetries = 0;
    } catch (e) {
      // Con eager input streaming, un input que no parsea rechaza el turno: se reintenta (acotado).
      if (e instanceof Anthropic.APIError || parseRetries++ >= 2) throw e;
      // Lo que ya se mostró de este intento se retira: si no, el texto saldría dos veces.
      if (streamedChars > 0) opts.emit({ t: "rewind", chars: streamedChars });
      for (const t of startedTools) opts.emit({ t: "tool", id: t.id, name: t.name, label: t.label, state: "error", note: "Reintento" });
      continue;
    }
    flushText();

    const usage = toUsage(msg);
    const cost = callCostUsd(usage);
    total = addUsage(total, usage);
    totalCost += cost;
    const requestId = (stream as unknown as { request_id?: string | null }).request_id ?? null;

    console.log(
      JSON.stringify({
        tag: "tex_llm",
        step,
        model: msg.model,
        stop: msg.stop_reason,
        in: usage.inputTokens,
        out: usage.outputTokens,
        cache_read: usage.cacheReadTokens,
        cache_write: usage.cacheWriteTokens,
        usd: cost,
        request_id: requestId,
      }),
    );

    if (msg.stop_reason === "refusal") {
      await opts.saveCost(usage, cost, requestId).catch(() => {});
      opts.emit({
        t: "error",
        code: "refusal",
        message: "Eso no lo puedo responder. Probá preguntarlo de otra manera.",
      });
      return { usage: total, costUsd: totalCost, stop: "refusal" };
    }

    const uses = msg.content.filter((b: BetaContentBlock): b is BetaToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) {
      await opts.saveStep({ assistant: msg, parts, toolResults: null, usage, costUsd: cost, requestId });
      if (msg.stop_reason === "max_tokens") {
        opts.emit({ t: "error", code: "upstream", message: "La respuesta quedó cortada. Pedime algo más acotado." });
      }
      return { usage: total, costUsd: totalCost, stop: msg.stop_reason ?? "end_turn" };
    }
    if (msg.stop_reason === "max_tokens") {
      await opts.saveCost(usage, cost, requestId).catch(() => {});
      // Un tool_use cortado nunca se corre (y no se guarda: quedaría sin resultado).
      opts.emit({ t: "error", code: "upstream", message: "Me quedé sin espacio para terminar. Pedime algo más acotado." });
      return { usage: total, costUsd: totalCost, stop: "max_tokens" };
    }

    // Se cortó el turno (cerraron la hoja, se pasó del tiempo): no se corre nada más.
    if (opts.signal.aborted) {
      await opts.saveCost(usage, cost, requestId).catch(() => {});
      return { usage: total, costUsd: totalCost, stop: "aborted" };
    }
    const ran = await Promise.all(uses.map((u) => runTool(u, opts, byName)));
    for (const r of ran) parts.push(...r.parts);
    const toolResults = ran.map((r) => r.result);
    await opts.saveStep({ assistant: msg, parts, toolResults, usage, costUsd: cost, requestId });
    messages.push({ role: "assistant", content: msg.content as unknown as BetaContentBlockParam[] });
    messages.push({ role: "user", content: toolResults });
  }

  opts.emit({ t: "error", code: "upstream", message: "Di demasiadas vueltas. ¿Me lo pedís de nuevo, más concreto?" });
  return { usage: total, costUsd: totalCost, stop: "max_steps" };
}
