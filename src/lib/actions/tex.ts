"use server";

/**
 * Tex del lado de la app (nov-2026): reabrir la conversación, empezar una
 * nueva, confirmar o descartar una propuesta, el resumen del día (sin LLM) y
 * el switch del superadmin. El chat en sí va por la route /api/tex/chat.
 *
 * Errores DEVUELTOS, nunca lanzados: en producción Next pisa el mensaje de
 * todo throw de una server action (CLAUDE.md).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "./auth";
import { getCurrentOrg } from "./org";
import { countPendingRequestsForOrg } from "./booking-requests";
import { getParteDiario } from "./parte-diario";
import { createAdminClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz } from "@/lib/dates";
import { buildToolContext } from "@/lib/tex/context";
import { actionNote } from "@/lib/tex/prompt";
import { toolsForRole } from "@/lib/tex/registry";
import { appendMessages, conversationView, createConversation, latestConversation, toProposalView } from "@/lib/tex/store";
import { findTool } from "@/lib/tex/tools";
import type { ProposalSummary, ProposalView, TexConversationView } from "@/lib/tex/types";
import type { TexActionRow } from "@/lib/types/database";

type Fail = { ok: false; error: string };

async function texContext() {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Tu sesión venció. Volvé a entrar." };
  const { organization, role } = await getCurrentOrg();
  if (!organization.tex_enabled) return { ok: false as const, error: "Tex no está activado en esta organización." };
  if (role === "owner_view") return { ok: false as const, error: "Tex no está disponible para tu rol." };
  return { ok: true as const, session, organization, role };
}

/** La conversación vigente (últimas 12 h) para dibujar al abrir Tex. */
export async function getTexConversation(): Promise<{ ok: true; view: TexConversationView } | Fail> {
  const c = await texContext();
  if (!c.ok) return c;
  const admin = createAdminClient();
  const conv = await latestConversation(admin, c.organization.id, c.session.userId);
  if (!conv) return { ok: true, view: { conversationId: null, messages: [], actions: {} } };
  return { ok: true, view: await conversationView(admin, conv) };
}

/** "Nueva conversación": la próxima pregunta arranca de cero. */
export async function startNewTexConversation(): Promise<{ ok: true; conversationId: string } | Fail> {
  const c = await texContext();
  if (!c.ok) return c;
  const conv = await createConversation(createAdminClient(), c.organization.id, c.session.userId);
  return { ok: true, conversationId: conv.id };
}

const idSchema = z.string().uuid();

/** Deja en la conversación la nota de qué pasó con la propuesta (append-only). */
async function noteOutcome(
  row: TexActionRow,
  outcome: "executed" | "failed" | "cancelled" | "expired",
  detail?: string | null,
) {
  // Best-effort: la acción ya pasó (o no). Si la nota no se guarda, NO se puede
  // informar como falla una acción que se ejecutó (llevaría a repetirla).
  try {
    const admin = createAdminClient();
    const summary = row.summary as ProposalSummary;
    const text = actionNote({ title: summary?.title ?? row.tool, outcome, detail });
    await appendMessages(
      admin,
      { id: row.conversation_id, organization_id: row.organization_id, user_id: row.user_id },
      [{ role: "user", content: [{ type: "text", text }], hidden: true }],
    );
    await admin
      .from("tex_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", row.conversation_id);
  } catch (e) {
    console.error(JSON.stringify({ tag: "tex_note_failed", action_id: row.id, message: e instanceof Error ? e.message : String(e) }));
  }
}

/** El estado actual de una propuesta (la app lo relee si la confirmación no llegó a responder). */
export async function getTexAction(actionId: string): Promise<{ ok: true; action: ProposalView } | Fail> {
  if (!idSchema.safeParse(actionId).success) return { ok: false, error: "Acción inválida." };
  const c = await texContext();
  if (!c.ok) return c;
  const { data } = await createAdminClient()
    .from("tex_actions")
    .select("*")
    .eq("id", actionId)
    .eq("organization_id", c.organization.id)
    .eq("user_id", c.session.userId)
    .maybeSingle();
  if (!data) return { ok: false, error: "No encontré esa propuesta." };
  return { ok: true, action: toProposalView(data as TexActionRow) };
}

/**
 * La persona tocó «Confirmar». Se reclama la propuesta de forma atómica
 * (pending → executing, una sola vez), se re-valida el payload y el permiso,
 * y recién ahí corre la server action real.
 */
export async function confirmTexAction(actionId: string): Promise<{ ok: true; action: ProposalView } | (Fail & { action?: ProposalView })> {
  if (!idSchema.safeParse(actionId).success) return { ok: false, error: "Acción inválida." };
  const c = await texContext();
  if (!c.ok) return c;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: claimed } = await admin
    .from("tex_actions")
    .update({ status: "executing", decided_at: nowIso })
    .eq("id", actionId)
    .eq("organization_id", c.organization.id)
    .eq("user_id", c.session.userId)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .select("*")
    .maybeSingle();

  if (!claimed) {
    const { data: existing } = await admin
      .from("tex_actions")
      .select("*")
      .eq("id", actionId)
      .eq("organization_id", c.organization.id)
      .eq("user_id", c.session.userId)
      .maybeSingle();
    const row = existing as TexActionRow | null;
    if (!row) return { ok: false, error: "No encontré esa propuesta." };
    if (row.status === "pending") {
      // Venció: se marca y Tex se entera.
      const { data: exp } = await admin
        .from("tex_actions")
        .update({ status: "expired", decided_at: nowIso })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
      if (exp) await noteOutcome(exp as TexActionRow, "expired");
      return {
        ok: false,
        error: "Esta propuesta venció (duran 15 minutos). Pedile a Tex que la arme de nuevo.",
        action: toProposalView((exp as TexActionRow) ?? row),
      };
    }
    return { ok: false, error: "Esta propuesta ya se resolvió.", action: toProposalView(row) };
  }

  const row = claimed as TexActionRow;
  const finish = async (status: "executed" | "failed", patch: { result?: unknown; error?: string | null }) => {
    const { data } = await admin
      .from("tex_actions")
      .update({ status, result: patch.result ?? null, error: patch.error ?? null })
      .eq("id", row.id)
      .select("*")
      .single();
    return toProposalView((data as TexActionRow) ?? { ...row, status, ...patch });
  };

  const tool = findTool(row.tool);
  if (!tool || tool.kind !== "write") {
    const view = await finish("failed", { error: "Esta acción ya no existe." });
    await noteOutcome(row, "failed", "La acción ya no existe.");
    return { ok: false, error: "Esta acción ya no existe.", action: view };
  }
  // El rol puede haber cambiado desde que se propuso.
  if (toolsForRole([tool], c.role).length === 0) {
    const view = await finish("failed", { error: "Ya no tenés permiso para esto." });
    await noteOutcome(row, "failed", "Sin permiso.");
    return { ok: false, error: "Ya no tenés permiso para esto.", action: view };
  }
  const parsed = tool.payload.safeParse(row.payload);
  if (!parsed.success) {
    const view = await finish("failed", { error: "La propuesta quedó inválida." });
    await noteOutcome(row, "failed", "Datos inválidos.");
    return { ok: false, error: "La propuesta quedó inválida. Pedile a Tex que la arme de nuevo.", action: view };
  }

  const ctx = buildToolContext({
    organization: c.organization,
    role: c.role,
    userId: c.session.userId,
    profile: c.session.profile,
    conversationId: row.conversation_id,
  });

  let outcome: Awaited<ReturnType<typeof tool.execute>>;
  try {
    outcome = await tool.execute(parsed.data, ctx);
  } catch (e) {
    outcome = { ok: false, error: e instanceof Error ? e.message : "Algo falló." };
  }

  if (!outcome.ok) {
    const view = await finish("failed", { error: outcome.error });
    await noteOutcome(row, "failed", outcome.error);
    return { ok: false, error: outcome.error, action: view };
  }
  const view = await finish("executed", { result: { message: outcome.message, href: outcome.href, data: outcome.data ?? null } });
  await noteOutcome(row, "executed", outcome.message);
  console.log(JSON.stringify({ tag: "tex_action", tool: row.tool, status: "executed", action_id: row.id }));
  return { ok: true, action: view };
}

/** La persona tocó «Cancelar» en la tarjeta. */
export async function cancelTexAction(actionId: string): Promise<{ ok: true; action: ProposalView } | Fail> {
  if (!idSchema.safeParse(actionId).success) return { ok: false, error: "Acción inválida." };
  const c = await texContext();
  if (!c.ok) return c;
  const admin = createAdminClient();
  const { data } = await admin
    .from("tex_actions")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("organization_id", c.organization.id)
    .eq("user_id", c.session.userId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (!data) return { ok: false, error: "Esta propuesta ya se resolvió." };
  await noteOutcome(data as TexActionRow, "cancelled");
  return { ok: true, action: toProposalView(data as TexActionRow) };
}

// ── "Tex te cuenta": el resumen del día, sin LLM ─────────────────────────────

export type TexBrief = {
  day: string;
  headline: string;
  lines: string[];
  /** Lo que se le pregunta a Tex si tocan la tarjeta. */
  prompt: string;
  tone: "calm" | "busy" | "alert";
  counts: { checkIns: number; checkOuts: number; dirtyWithArrival: number; dirty: number; requests: number };
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Lo que Tex tiene para contar hoy: llegadas, salidas, sucios con llegada y
 * solicitudes sin responder. Determinista y barato (nada de LLM): lo usan la
 * burbuja del círculo de Tex y la tarjeta de Hoy.
 */
export async function getTexBrief(): Promise<TexBrief | null> {
  const session = await getSession();
  if (!session) return null;
  const { organization, role } = await getCurrentOrg();
  // El resumen habla de llegadas y salidas: sólo para quien ve reservas (como el parte).
  if (!can(role, "parte_diario", "view") || !can(role, "bookings", "view") || role === "owner_view") return null;
  const tz = organization.timezone || DEFAULT_ORG_TIMEZONE;
  const today = todayYmdInTz(tz);
  const [parte, requests] = await Promise.all([
    getParteDiario(today).catch(() => null),
    countPendingRequestsForOrg().catch(() => 0),
  ]);
  if (!parte) return null;
  const arriving = new Set(parte.check_ins.map((b) => b.unit_id));
  const dirtyWithArrival = parte.sucios.filter((s) => arriving.has(s.unit_id)).length;
  const counts = {
    checkIns: parte.check_ins.length,
    checkOuts: parte.check_outs.length,
    dirtyWithArrival,
    dirty: parte.sucios.length,
    requests,
  };

  const headline =
    counts.checkIns === 0 && counts.checkOuts === 0
      ? "Hoy no entra ni sale nadie."
      : `Hoy ${counts.checkIns ? `${counts.checkIns === 1 ? "entra" : "entran"} ${counts.checkIns}` : "no entra nadie"}${
          counts.checkOuts ? ` y ${counts.checkOuts === 1 ? "sale" : "salen"} ${counts.checkOuts}` : ""
        }.`;
  const lines: string[] = [];
  if (dirtyWithArrival > 0) lines.push(`${plural(dirtyWithArrival, "unidad sigue sucia", "unidades siguen sucias")} y tienen llegada hoy.`);
  else if (counts.dirty > 0) lines.push(`${plural(counts.dirty, "unidad para limpiar", "unidades para limpiar")}.`);
  if (requests > 0) lines.push(`${plural(requests, "solicitud espera", "solicitudes esperan")} respuesta.`);
  const tone: TexBrief["tone"] = dirtyWithArrival > 0 || requests > 0 ? "alert" : counts.checkIns + counts.checkOuts > 0 ? "busy" : "calm";

  return {
    day: today,
    headline,
    lines,
    prompt:
      "Armame el plan de hoy: quién entra y sale, qué hay que limpiar primero y qué cobros o solicitudes tengo pendientes.",
    tone,
    counts,
  };
}

// ── Superadmin: encender Tex por organización ────────────────────────────────

export async function setOrgTexEnabled(orgId: string, enabled: boolean): Promise<{ ok: true } | Fail> {
  const session = await getSession();
  if (!session?.profile.is_superadmin) return { ok: false, error: "Sólo el equipo de la plataforma puede activar Tex." };
  if (!idSchema.safeParse(orgId).success) return { ok: false, error: "Organización inválida." };
  const { error } = await createAdminClient().from("organizations").update({ tex_enabled: enabled }).eq("id", orgId);
  if (error) return { ok: false, error: error.message };
  console.log(JSON.stringify({ tag: "tex_toggle", org: orgId, enabled, by: session.userId }));
  revalidatePath("/superadmin");
  return { ok: true };
}
