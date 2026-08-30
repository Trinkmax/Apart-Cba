"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getProviderForChannel } from "./providers/factory";
import type { OutboundMessageBody } from "./providers/types";

const BACKOFF_SECONDS = [30, 120, 480, 1800, 7200]; // 30s, 2min, 8min, 30min, 2h
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Cuánto puede quedar una fila en 'sending' antes de considerarla colgada y
 * volver a tomarla. Tiene que ser > maxDuration de /api/cron/from-pg (60 s) y
 * > timeout del provider (15-20 s), para no pisar un envío que todavía está en
 * curso en otra invocación. La marca de claim es next_attempt_at (no hay
 * columna claimed_at), ver comentario en el PATCH de claim más abajo.
 */
// No se exporta: el archivo es "use server" y Next solo permite exportar
// funciones async desde módulos con esa directiva.
const SENDING_STALE_MS = 10 * 60_000;

/**
 * Procesa la cola outbox: toma mensajes pendientes con next_attempt_at <= now()
 * (más las filas 'sending' colgadas) y los envía vía el provider correspondiente.
 * Retry exponencial. Entrega at-least-once: si la función muere entre que el
 * provider aceptó el mensaje y el PATCH a 'sent', la recuperación de 'sending'
 * lo reenvía (Meta no tiene clave de idempotencia).
 *
 * Por qué SOLO 'pending' (y no 'failed'):
 *   Antes el filtro era status IN ('pending','failed'). Una fila que agotaba
 *   max_attempts quedaba en 'failed' con next_attempt_at vencido → seguía
 *   matcheando en cada tick y se le hacían 2 PATCH (outbox + crm_messages) que
 *   no cambiaban nada. Medido 2026-08-30: 12 filas terminales × 288 ticks/día ×
 *   2 PATCH = 6.912 requests/día de ruido y ~6 s de cada tick de from-pg
 *   (~230 ms de RTT gru1↔us-west-2 por request). 'failed' ahora es terminal
 *   de verdad; los reintentos legítimos siempre se guardaron como 'pending' con
 *   next_attempt_at = now + backoff, así que no se pierde ninguno.
 */
export async function processOutbox(
  opts: { limit?: number; channelId?: string } = {},
): Promise<{ processed: number; sent: number; failed: number; recovered: number }> {
  const admin = createAdminClient();
  const limit = opts.limit ?? 50;
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - SENDING_STALE_MS).toISOString();

  // Un solo request: pendientes vencidas OR 'sending' colgadas (claim más viejo
  // que SENDING_STALE_MS). toISOString() da sufijo Z sin '+' ni comas, seguro
  // dentro del .or() de PostgREST. El índice parcial idx_crm_outbox_due cubre la
  // rama pending; la rama sending es un seq scan sobre decenas de filas.
  let query = admin
    .from("crm_message_outbox")
    .select("*")
    .or(`and(status.eq.pending,next_attempt_at.lte.${nowIso}),and(status.eq.sending,next_attempt_at.lte.${staleIso})`)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  if (opts.channelId) query = query.eq("channel_id", opts.channelId);

  const { data: items, error } = await query;
  if (error) {
    console.error("[outbox] fetch failed", error.message);
    return { processed: 0, sent: 0, failed: 0, recovered: 0 };
  }

  let sent = 0;
  let failed = 0;
  let recovered = 0;
  for (const item of items ?? []) {
    const maxAttempts = item.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
    const previousAttempts = item.attempts ?? 0;

    if (item.status === "sending") {
      // Quedó claimeada por una invocación que murió (maxDuration, OOM, provider
      // colgado). Se loguea para poder auditar duplicados si el envío sí salió.
      console.warn("[outbox] recovered stale sending", item.id, `attempts=${previousAttempts}`);
      recovered += 1;
    }

    // Caso excepcional (ya no corre cada tick): una fila recuperada que agotó
    // los claims. Se cierra acá para que no loopee para siempre.
    if (previousAttempts >= maxAttempts) {
      await admin
        .from("crm_message_outbox")
        .update({ status: "failed", last_error: item.last_error ?? "max_attempts" })
        .eq("id", item.id);
      await admin
        .from("crm_messages")
        .update({ status: "failed", error_message: item.last_error ?? "max_attempts", status_updated_at: nowIso })
        .eq("id", item.message_id);
      failed += 1;
      continue;
    }

    // El intento se cuenta al CLAIMEAR, no al resolver: si la función muere a
    // mitad, la fila vuelve como 'sending' vencida con attempts ya incrementado,
    // y una fila envenenada termina en 'failed' después de max_attempts claims.
    // next_attempt_at = now hace de marca de claim para la recuperación.
    // Best-effort, sin row-level lock (follow-up: RPC con FOR UPDATE SKIP LOCKED).
    const attempts = previousAttempts + 1;
    await admin
      .from("crm_message_outbox")
      .update({ status: "sending", next_attempt_at: new Date().toISOString(), attempts })
      .eq("id", item.id);

    try {
      const provider = await getProviderForChannel(item.channel_id);
      const payload = item.payload as { toPhone: string; body: OutboundMessageBody; replyToWaMessageId?: string };
      const result = await provider.send({
        toPhone: payload.toPhone,
        body: payload.body,
        replyToWaMessageId: payload.replyToWaMessageId,
      });

      if (result.ok) {
        await admin.from("crm_message_outbox").update({
          status: "sent",
          sent_at: new Date().toISOString(),
        }).eq("id", item.id);
        await admin.from("crm_messages").update({
          status: "sent",
          wa_message_id: result.providerMessageId,
          status_updated_at: new Date().toISOString(),
        }).eq("id", item.message_id);
        sent += 1;
      } else {
        // Cambio de comportamiento: un error NO retryable (token vencido, fuera
        // de la ventana de 24 h, etc.) queda 'failed' al primer intento. Antes se
        // volvía a tomar cada tick por el filtro IN ('pending','failed').
        const isRetryable = result.isRetryable && attempts < maxAttempts;
        const nextDelay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
        await admin.from("crm_message_outbox").update({
          status: isRetryable ? "pending" : "failed",
          last_error: `${result.errorCode}: ${result.errorMessage}`,
          next_attempt_at: isRetryable ? new Date(Date.now() + nextDelay * 1000).toISOString() : item.next_attempt_at,
        }).eq("id", item.id);
        if (!isRetryable) {
          await admin.from("crm_messages").update({
            status: "failed",
            error_code: result.errorCode,
            error_message: result.errorMessage,
            status_updated_at: new Date().toISOString(),
          }).eq("id", item.message_id);
          failed += 1;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isRetryable = attempts < maxAttempts;
      const nextDelay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
      await admin.from("crm_message_outbox").update({
        status: isRetryable ? "pending" : "failed",
        last_error: message,
        next_attempt_at: isRetryable ? new Date(Date.now() + nextDelay * 1000).toISOString() : item.next_attempt_at,
      }).eq("id", item.id);
      if (!isRetryable) {
        await admin.from("crm_messages").update({
          status: "failed",
          error_message: message,
          status_updated_at: new Date().toISOString(),
        }).eq("id", item.message_id);
        failed += 1;
      }
    }
  }

  return { processed: items?.length ?? 0, sent, failed, recovered };
}
