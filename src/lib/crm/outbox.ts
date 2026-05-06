"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getProviderForChannel } from "./providers/factory";
import type { OutboundMessageBody } from "./providers/types";

const BACKOFF_SECONDS = [30, 120, 480, 1800, 7200]; // 30s, 2min, 8min, 30min, 2h

/**
 * Procesa la cola outbox: toma mensajes con next_attempt_at <= now() y los envía
 * vía el provider correspondiente. Retry exponencial. Idempotencia por message_id.
 */
export async function processOutbox(opts: { limit?: number; channelId?: string } = {}): Promise<{ processed: number; sent: number; failed: number }> {
  const admin = createAdminClient();
  const limit = opts.limit ?? 50;

  let query = admin
    .from("crm_message_outbox")
    .select("*")
    .lte("next_attempt_at", new Date().toISOString())
    .in("status", ["pending", "failed"])
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  if (opts.channelId) query = query.eq("channel_id", opts.channelId);

  const { data: items, error } = await query;
  if (error) {
    console.error("[outbox] fetch failed", error.message);
    return { processed: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const item of items ?? []) {
    if ((item.attempts ?? 0) >= (item.max_attempts ?? 5)) {
      await admin.from("crm_message_outbox").update({ status: "failed" }).eq("id", item.id);
      await admin.from("crm_messages").update({ status: "failed", error_message: item.last_error ?? "max_attempts" }).eq("id", item.message_id);
      failed += 1;
      continue;
    }

    // Marcar sending para evitar concurrencia (best-effort, sin row-level lock)
    await admin.from("crm_message_outbox").update({ status: "sending" }).eq("id", item.id);

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
          attempts: (item.attempts ?? 0) + 1,
        }).eq("id", item.id);
        await admin.from("crm_messages").update({
          status: "sent",
          wa_message_id: result.providerMessageId,
          status_updated_at: new Date().toISOString(),
        }).eq("id", item.message_id);
        sent += 1;
      } else {
        const attempts = (item.attempts ?? 0) + 1;
        const isRetryable = result.isRetryable && attempts < (item.max_attempts ?? 5);
        const nextDelay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
        await admin.from("crm_message_outbox").update({
          status: isRetryable ? "pending" : "failed",
          attempts,
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
      const attempts = (item.attempts ?? 0) + 1;
      const isRetryable = attempts < (item.max_attempts ?? 5);
      const nextDelay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
      await admin.from("crm_message_outbox").update({
        status: isRetryable ? "pending" : "failed",
        attempts,
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

  return { processed: items?.length ?? 0, sent, failed };
}
