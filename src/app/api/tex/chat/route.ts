import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { createAdminClient } from "@/lib/supabase/server";
import { runTexTurn, texClient, TEX_MODEL } from "@/lib/tex/agent";
import { buildToolContext, turnContext } from "@/lib/tex/context";
import { encodeEvent } from "@/lib/tex/ndjson";
import { toolsForRole } from "@/lib/tex/registry";
import {
  appendMessages,
  createProposal,
  loadHistory,
  orgSpendSince,
  resolveConversation,
  touchConversation,
  typedMessagesSince,
} from "@/lib/tex/store";
import { TEX_TOOLS } from "@/lib/tex/tools";
import type { TexErrorCode, TexEvent } from "@/lib/tex/types";
import { USER_LIMITS } from "@/lib/tex/usage";
import { DEFAULT_ORG_TIMEZONE, dayRangeInTz, todayYmdInTz } from "@/lib/dates";

/**
 * POST /api/tex/chat — un turno de conversación con Tex, en streaming NDJSON.
 *
 * Route handler y no server action (lección de sharp-app): las actions corren
 * de a una por pestaña y una navegación las corta. Las herramientas llaman a
 * las server actions de siempre desde acá, con la cookie de la persona: el
 * filtro por organización y las validaciones siguen en un solo lugar.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().nullish(),
  pathname: z.string().max(300).nullish(),
  fresh: z.boolean().optional(),
});

const DEADLINE_MS = 52_000;

function jsonError(status: number, code: TexErrorCode, message: string) {
  return Response.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  // Mismo origen: las server actions lo traían de fábrica, una route no.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    try {
      if (new URL(origin).host !== host) return jsonError(403, "forbidden", "Origen no permitido.");
    } catch {
      return jsonError(403, "forbidden", "Origen no permitido.");
    }
  }
  if (process.env.TEX_DISABLED === "1") return jsonError(503, "disabled", "Tex está en pausa un ratito.");

  // Sesión ANTES de tocar actions que redirigen (requireSession tira NEXT_REDIRECT).
  const session = await getSession();
  if (!session) return jsonError(401, "unauthorized", "Tu sesión venció. Volvé a entrar.");
  let current: Awaited<ReturnType<typeof getCurrentOrg>>;
  try {
    current = await getCurrentOrg();
  } catch {
    return jsonError(403, "forbidden", "No tenés una organización activa.");
  }
  const { organization, role } = current;
  if (!organization.tex_enabled) return jsonError(403, "disabled", "Tex no está activado en esta organización.");
  if (role === "owner_view") return jsonError(403, "forbidden", "Tex todavía no está disponible para propietarios.");

  const client = texClient();
  if (!client) return jsonError(503, "not_configured", "Falta configurar la clave de Claude (ANTHROPIC_API_KEY).");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, "bad_request", "Mensaje inválido.");
  }

  const admin = createAdminClient();
  const now = Date.now();
  // El mes del presupuesto es el de la organización, no el del servidor (UTC).
  const tz = organization.timezone || DEFAULT_ORG_TIMEZONE;
  const monthStart = dayRangeInTz(`${todayYmdInTz(tz).slice(0, 7)}-01`, tz).startIso;
  const [last5, today, spent] = await Promise.all([
    typedMessagesSince(admin, session.userId, new Date(now - 5 * 60_000).toISOString()),
    typedMessagesSince(admin, session.userId, new Date(now - 24 * 3_600_000).toISOString()),
    orgSpendSince(admin, organization.id, monthStart),
  ]);
  if (last5 >= USER_LIMITS.perFiveMinutes || today >= USER_LIMITS.perDay) {
    return jsonError(429, "rate_limited", "Vamos muy rápido. Esperá un ratito y seguimos.");
  }
  const budget = Number(organization.tex_monthly_budget_usd ?? 25);
  if (spent >= budget) {
    return jsonError(402, "budget", "Tex llegó al tope de uso de este mes. Avisale al administrador.");
  }

  let conv: Awaited<ReturnType<typeof resolveConversation>>;
  let history: Awaited<ReturnType<typeof loadHistory>>;
  try {
    conv = await resolveConversation(admin, organization.id, session.userId, {
      conversationId: body.conversationId,
      fresh: body.fresh,
    });
    history = await loadHistory(admin, conv.id);
  } catch {
    return jsonError(500, "upstream", "No pude abrir la conversación. Probá de nuevo.");
  }

  const ctx = buildToolContext({
    organization,
    role,
    userId: session.userId,
    profile: session.profile,
    conversationId: conv.id,
  });
  const tools = toolsForRole(TEX_TOOLS, role);
  const userContent: BetaContentBlockParam[] = [
    { type: "text", text: turnContext(ctx, body.pathname) },
    { type: "text", text: body.message },
  ];

  // El mensaje de la persona se guarda primero (si el turno se corta, igual queda).
  try {
    await appendMessages(admin, conv, [{ role: "user", content: userContent, ui: { text: body.message } }]);
    await touchConversation(admin, conv, 1, body.message);
  } catch {
    return jsonError(500, "upstream", "No pude guardar tu mensaje. Probá de nuevo.");
  }

  const abort = new AbortController();
  const onClientAbort = () => abort.abort();
  req.signal.addEventListener("abort", onClientAbort);
  const deadline = setTimeout(() => abort.abort(), DEADLINE_MS);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (ev: TexEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeEvent(ev));
        } catch {
          closed = true;
        }
      };
      emit({ t: "start", conversationId: conv.id });
      try {
        const result = await runTexTurn({
          client,
          ctx,
          tools,
          history,
          userContent,
          emit,
          signal: abort.signal,
          async saveStep(step) {
            const rows: Parameters<typeof appendMessages>[2] = [
              {
                role: "assistant",
                content: step.assistant.content as unknown[],
                ui: { parts: step.parts },
                model: TEX_MODEL,
                inputTokens: step.usage.inputTokens,
                outputTokens: step.usage.outputTokens,
                cacheReadTokens: step.usage.cacheReadTokens,
                cacheWriteTokens: step.usage.cacheWriteTokens,
                costUsd: step.costUsd,
                requestId: step.requestId,
              },
            ];
            if (step.toolResults) rows.push({ role: "user", content: step.toolResults, hidden: true });
            await appendMessages(admin, conv, rows);
            await touchConversation(admin, conv, rows.length);
          },
          deadlineAt: Date.now() + DEADLINE_MS - 2_000,
          async saveCost(usage, costUsd, requestId) {
            // Fila oculta y sin contenido: suma al presupuesto, no entra a la historia.
            await appendMessages(admin, conv, [
              {
                role: "assistant",
                content: [],
                hidden: true,
                model: TEX_MODEL,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheReadTokens: usage.cacheReadTokens,
                cacheWriteTokens: usage.cacheWriteTokens,
                costUsd,
                requestId,
              },
            ]);
          },
          createProposal: (tool, payload, summary) =>
            createProposal(admin, {
              organization_id: organization.id,
              user_id: session.userId,
              conversation_id: conv.id,
              tool: tool.name,
              payload,
              summary,
            }),
        });
        emit({
          t: "done",
          stop: result.stop,
          usage: { ...result.usage, costUsd: Math.round(result.costUsd * 1_000_000) / 1_000_000 },
        });
      } catch (e) {
        if (abort.signal.aborted && !req.signal.aborted) {
          emit({ t: "error", code: "timeout", message: "Tardé demasiado. Probá con algo más concreto." });
        } else if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
          console.error(JSON.stringify({ tag: "tex_error", kind: "auth", status: e.status, request_id: e.requestID }));
          emit({ t: "error", code: "not_configured", message: "La clave de Claude no es válida. Avisale al administrador." });
        } else if (e instanceof Anthropic.RateLimitError) {
          emit({ t: "error", code: "rate_limited", message: "Hay mucha demanda en este momento. Probá en un minuto." });
        } else if (e instanceof Anthropic.APIUserAbortError || req.signal.aborted) {
          // Cerraron la hoja: no hay a quién avisarle.
        } else {
          const apiErr = e instanceof Anthropic.APIError ? e : null;
          console.error(
            JSON.stringify({
              tag: "tex_error",
              kind: "upstream",
              status: apiErr?.status ?? null,
              request_id: apiErr?.requestID ?? null,
              message: e instanceof Error ? e.message.slice(0, 400) : String(e),
            }),
          );
          emit({ t: "error", code: "upstream", message: "Se me trabó algo. Probá de nuevo en un toque." });
        }
      } finally {
        clearTimeout(deadline);
        req.signal.removeEventListener("abort", onClientAbort);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* ya cerrado */
          }
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
