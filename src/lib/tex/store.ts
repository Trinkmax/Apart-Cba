import "server-only";

/**
 * Dónde vive una conversación con Tex (nov-2026): tex_conversations,
 * tex_messages (append-only) y tex_actions (las propuestas). Service role:
 * cada función recibe org y usuario ya validados por quien la llama.
 *
 * `content` se guarda como TEXTO JSON (un string adentro del jsonb), no como
 * objeto: jsonb reordena las claves y Haiku 5.5 valida que la historia que
 * vuelve sea la misma que produjo cada bloque de thinking. Así vuelve igual.
 */
import type {
  BetaContentBlockParam,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createAdminClient } from "@/lib/supabase/server";
import type { TexActionRow, TexConversation, TexMessageRow } from "@/lib/types/database";
import type {
  ProposalSummary,
  ProposalView,
  TexConversationView,
  TexHistoryMessage,
  TexPart,
} from "./types";

type Admin = ReturnType<typeof createAdminClient>;

/** Una conversación se retoma si tuvo movimiento en las últimas 12 h y no es larguísima. */
const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_MESSAGES = 60;

export async function latestConversation(admin: Admin, orgId: string, userId: string): Promise<TexConversation | null> {
  const { data } = await admin
    .from("tex_conversations")
    .select("*")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const conv = (data as TexConversation | null) ?? null;
  if (!conv) return null;
  const fresh = Date.now() - new Date(conv.last_message_at).getTime() < RESUME_WINDOW_MS;
  return fresh && conv.message_count < MAX_MESSAGES ? conv : null;
}

export async function createConversation(admin: Admin, orgId: string, userId: string): Promise<TexConversation> {
  const { data, error } = await admin
    .from("tex_conversations")
    .insert({ organization_id: orgId, user_id: userId })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "No pude abrir la conversación.");
  return data as TexConversation;
}

/** La conversación pedida (si es de esta persona) o la última vigente o una nueva. */
export async function resolveConversation(
  admin: Admin,
  orgId: string,
  userId: string,
  opts: { conversationId?: string | null; fresh?: boolean },
): Promise<TexConversation> {
  if (!opts.fresh && opts.conversationId) {
    const { data } = await admin
      .from("tex_conversations")
      .select("*")
      .eq("id", opts.conversationId)
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    const conv = data as TexConversation | null;
    if (conv && conv.message_count < MAX_MESSAGES) return conv;
  }
  if (!opts.fresh) {
    const latest = await latestConversation(admin, orgId, userId);
    if (latest) return latest;
  }
  return createConversation(admin, orgId, userId);
}

function parseContent(raw: unknown): BetaContentBlockParam[] {
  const v = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return Array.isArray(v) ? (v as BetaContentBlockParam[]) : [];
}

/**
 * La historia para el modelo, en orden. Si quedó un `tool_use` sin su
 * resultado (se cortó en el medio), se descarta desde ahí: la API no acepta
 * un tool_use colgado.
 */
export async function loadHistory(admin: Admin, conversationId: string): Promise<BetaMessageParam[]> {
  const { data, error } = await admin
    .from("tex_messages")
    .select("role, content, seq")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: true })
    .limit(400);
  if (error) throw new Error(error.message);
  const msgs: BetaMessageParam[] = ((data ?? []) as Array<Pick<TexMessageRow, "role" | "content">>)
    .map((r) => ({ role: r.role, content: parseContent(r.content) }))
    .filter((m) => m.content.length > 0);
  // Un assistant con tool_use tiene que tener detrás un user con todos sus tool_result.
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const uses = m.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id);
    if (uses.length === 0) continue;
    const next = msgs[i + 1];
    const results =
      next && next.role === "user" && Array.isArray(next.content)
        ? new Set(
            next.content
              .filter((b) => b.type === "tool_result")
              .map((b) => (b as { tool_use_id: string }).tool_use_id),
          )
        : new Set<string>();
    if (!uses.every((id) => results.has(id))) return msgs.slice(0, i);
  }
  return msgs;
}

export type NewMessage = {
  role: "user" | "assistant";
  content: unknown[];
  ui?: unknown;
  hidden?: boolean;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  requestId?: string | null;
};

export async function appendMessages(
  admin: Admin,
  conv: { id: string; organization_id: string; user_id: string },
  rows: NewMessage[],
): Promise<void> {
  if (rows.length === 0) return;
  // Todas con las mismas claves: PostgREST manda NULL (no DEFAULT) a las que falten en un lote.
  const payload = rows.map((r) => ({
    conversation_id: conv.id,
    organization_id: conv.organization_id,
    user_id: conv.user_id,
    role: r.role,
    content: JSON.stringify(r.content),
    ui: r.ui ?? null,
    hidden: r.hidden ?? false,
    model: r.model ?? null,
    input_tokens: r.inputTokens ?? 0,
    output_tokens: r.outputTokens ?? 0,
    cache_read_tokens: r.cacheReadTokens ?? 0,
    cache_write_tokens: r.cacheWriteTokens ?? 0,
    cost_usd: r.costUsd ?? 0,
    request_id: r.requestId ?? null,
  }));
  const { error } = await admin.from("tex_messages").insert(payload);
  if (error) throw new Error(error.message);
}

export async function touchConversation(
  admin: Admin,
  conv: TexConversation,
  added: number,
  title?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
    message_count: conv.message_count + added,
  };
  if (title && !conv.title) patch.title = title.slice(0, 120);
  await admin.from("tex_conversations").update(patch).eq("id", conv.id);
  conv.message_count += added;
  if (title && !conv.title) conv.title = title.slice(0, 120);
}

// ── Propuestas ───────────────────────────────────────────────────────────────

export async function createProposal(
  admin: Admin,
  row: {
    organization_id: string;
    user_id: string;
    conversation_id: string;
    tool: string;
    payload: unknown;
    summary: ProposalSummary;
  },
): Promise<ProposalView> {
  const { data, error } = await admin.from("tex_actions").insert(row).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "No pude guardar la propuesta.");
  return toProposalView(data as TexActionRow);
}

/** Más que esto en "ejecutando" es que la función se cortó en el medio. */
const STUCK_EXECUTING_MS = 3 * 60_000;

export function toProposalView(row: TexActionRow): ProposalView {
  const expired = row.status === "pending" && new Date(row.expires_at).getTime() < Date.now();
  const stuck =
    row.status === "executing" &&
    row.decided_at !== null &&
    Date.now() - new Date(row.decided_at).getTime() > STUCK_EXECUTING_MS;
  const result = row.result as { message?: string; href?: string } | null;
  return {
    id: row.id,
    tool: row.tool,
    summary: row.summary as ProposalSummary,
    status: expired ? "expired" : stuck ? "failed" : row.status,
    result: result && result.message ? { message: result.message, href: result.href } : null,
    error: stuck ? "Se cortó mientras se hacía: revisá en la pantalla si quedó registrado antes de repetirlo." : row.error,
    expiresAt: row.expires_at,
  };
}

// ── Lo que ve la app al reabrir ──────────────────────────────────────────────

type UiUser = { text?: string };
type UiAssistant = { parts?: TexPart[] };

/** La conversación lista para dibujar: los pasos del agente se juntan en un solo mensaje. */
export async function conversationView(admin: Admin, conv: TexConversation): Promise<TexConversationView> {
  const [{ data: rows }, { data: actions }] = await Promise.all([
    admin
      .from("tex_messages")
      .select("id, role, ui, hidden, created_at, seq")
      .eq("conversation_id", conv.id)
      .order("seq", { ascending: true })
      .limit(400),
    admin.from("tex_actions").select("*").eq("conversation_id", conv.id).order("created_at", { ascending: true }),
  ]);

  const messages: TexHistoryMessage[] = [];
  for (const r of (rows ?? []) as Array<Pick<TexMessageRow, "id" | "role" | "ui" | "hidden" | "created_at">>) {
    if (r.hidden) continue;
    if (r.role === "user") {
      const text = (r.ui as UiUser | null)?.text;
      if (text) messages.push({ id: r.id, role: "user", text, createdAt: r.created_at });
      continue;
    }
    const parts = (r.ui as UiAssistant | null)?.parts ?? [];
    if (parts.length === 0) continue;
    const prev = messages[messages.length - 1];
    if (prev && prev.role === "assistant") prev.parts.push(...parts);
    else messages.push({ id: r.id, role: "assistant", parts: [...parts], createdAt: r.created_at });
  }

  const byId: Record<string, ProposalView> = {};
  for (const a of (actions ?? []) as TexActionRow[]) byId[a.id] = toProposalView(a);
  return { conversationId: conv.id, messages, actions: byId };
}

// ── Topes ────────────────────────────────────────────────────────────────────

export async function typedMessagesSince(admin: Admin, userId: string, sinceIso: string): Promise<number> {
  const { count, error } = await admin
    .from("tex_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .eq("hidden", false)
    .gte("created_at", sinceIso);
  // Falla cerrado: sin poder contar, se toma como tope alcanzado.
  if (error) return Number.POSITIVE_INFINITY;
  return count ?? 0;
}

/** Lo gastado por la organización desde `sinceIso` (USD). Pagina: nunca el tope de 1000 filas. */
export async function orgSpendSince(admin: Admin, orgId: string, sinceIso: string): Promise<number> {
  let total = 0;
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await admin
      .from("tex_messages")
      .select("cost_usd")
      .eq("organization_id", orgId)
      .eq("role", "assistant")
      .gte("created_at", sinceIso)
      .range(from, from + 999);
    // Falla cerrado: sin poder sumar el gasto, se toma como presupuesto agotado.
    if (error || !data) return Number.POSITIVE_INFINITY;
    for (const r of data as Array<{ cost_usd: number | string }>) total += Number(r.cost_usd) || 0;
    if (data.length < 1000) break;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}
