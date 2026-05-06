import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getProviderForPhoneNumberId, getProviderForInstagramId } from "@/lib/crm/providers/factory";
import { getSecret } from "@/lib/crm/encryption";
import { dispatchEvent } from "@/lib/crm/workflows/dispatcher";
import type { ParsedInboundMessage, ParsedStatusUpdate, ParsedTemplateStatusUpdate } from "@/lib/crm/providers/types";
import type { CrmContactExternalKind, CrmMessageType } from "@/lib/types/database";

export const runtime = "nodejs"; // crypto.createHmac requiere node runtime
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook único de Meta WhatsApp Business API.
 * Routing multi-tenant: cada evento trae phone_number_id → resuelve org.
 *
 * GET: verify challenge (suscripción inicial Meta).
 * POST: eventos (messages, statuses, template_status).
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  // Sin canal específico, usamos el verify token global del .env como fallback.
  const expectedToken = process.env.META_WEBHOOK_DEFAULT_TOKEN;
  if (mode === "subscribe" && token && expectedToken && token === expectedToken) {
    return new Response(challenge ?? "", { status: 200 });
  }

  // Si tenemos múltiples canales con tokens distintos, hacer lookup en DB
  // por todos los webhook_verify_token_secret_id y comparar uno a uno.
  if (mode === "subscribe" && token) {
    const admin = createAdminClient();
    const { data: channels } = await admin
      .from("crm_channels")
      .select("id,webhook_verify_token_secret_id")
      .not("webhook_verify_token_secret_id", "is", null);
    for (const ch of channels ?? []) {
      const stored = await getSecret(ch.webhook_verify_token_secret_id);
      if (stored && stored === token) {
        return new Response(challenge ?? "", { status: 200 });
      }
    }
  }

  return NextResponse.json({ error: "verify_failed" }, { status: 403 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const objectType = (parsedBody as { object?: string } | null)?.object;

  // Routing según object: 'whatsapp_business_account' o 'instagram'
  let lookup: Awaited<ReturnType<typeof getProviderForPhoneNumberId>> | null = null;
  let externalKind: CrmContactExternalKind = "phone";

  if (objectType === "whatsapp_business_account") {
    const phoneNumberId = extractPhoneNumberId(parsedBody);
    if (!phoneNumberId) return NextResponse.json({ ok: true, ignored: "no_phone_number_id" });
    lookup = await getProviderForPhoneNumberId(phoneNumberId);
    externalKind = "phone";
  } else if (objectType === "instagram") {
    const entryId = extractEntryId(parsedBody);
    if (!entryId) return NextResponse.json({ ok: true, ignored: "no_entry_id" });
    lookup = await getProviderForInstagramId(entryId);
    externalKind = "igsid";
  } else {
    return NextResponse.json({ ok: true, ignored: `unsupported_object_${objectType ?? "null"}` });
  }

  if (!lookup) {
    return NextResponse.json({ ok: true, ignored: "channel_not_registered" });
  }

  const { provider, channel } = lookup;

  const appSecret = await getSecret(channel.app_secret_secret_id);
  if (appSecret) {
    const valid = provider.verifyWebhookSignature(rawBody, signature, appSecret);
    if (!valid) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  const events = provider.parseWebhook(parsedBody);
  const admin = createAdminClient();

  for (const ev of events) {
    if (ev.kind === "message") {
      await processInboundMessage(admin, channel.organization_id, channel.id, ev.message, externalKind);
    } else if (ev.kind === "status") {
      await processStatusUpdate(admin, channel.id, ev.status);
    } else if (ev.kind === "template_status") {
      await processTemplateStatus(admin, channel.id, ev.templateStatus);
    }
  }

  return NextResponse.json({ ok: true, events_processed: events.length, channel_provider: channel.provider });
}

function extractEntryId(body: unknown): string | null {
  const b = body as { entry?: { id?: string }[] } | null;
  return b?.entry?.[0]?.id ?? null;
}

function extractPhoneNumberId(body: unknown): string | null {
  const b = body as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[] } | null;
  return b?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
}

async function processInboundMessage(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  channelId: string,
  msg: ParsedInboundMessage,
  externalKind: CrmContactExternalKind,
) {
  const contactPayload: Record<string, unknown> = {
    organization_id: organizationId,
    external_id: msg.fromPhone, // IGSID si IG, phone si WA
    external_kind: externalKind,
    name: msg.profileName ?? null,
    contact_kind: "lead",
  };
  if (externalKind === "phone") {
    contactPayload.phone = msg.fromPhone;
  }

  const { data: contact, error: contactErr } = await admin
    .from("crm_contacts")
    .upsert(contactPayload, { onConflict: "organization_id,external_id,external_kind" })
    .select("id,guest_id,owner_id")
    .single();
  if (contactErr || !contact) {
    console.error("[webhook] contact upsert failed", contactErr?.message);
    return;
  }

  // Auto-link a guest/owner sólo si tenemos phone (WA inbound)
  if (externalKind === "phone") {
    if (!contact.guest_id) {
      const { data: guest } = await admin
        .from("guests")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("phone", msg.fromPhone)
        .maybeSingle();
      if (guest) {
        await admin
          .from("crm_contacts")
          .update({ guest_id: guest.id, contact_kind: "guest" })
          .eq("id", contact.id);
      }
    }
    if (!contact.owner_id) {
      const { data: owner } = await admin
        .from("owners")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("phone", msg.fromPhone)
        .maybeSingle();
      if (owner) {
        await admin
          .from("crm_contacts")
          .update({ owner_id: owner.id, contact_kind: "owner" })
          .eq("id", contact.id);
      }
    }
  }

  // 2. Upsert conversation (open/reopen)
  const { data: conv } = await admin
    .from("crm_conversations")
    .upsert({
      organization_id: organizationId,
      contact_id: contact.id,
      channel_id: channelId,
      status: "open",
    }, { onConflict: "organization_id,contact_id,channel_id" })
    .select("id")
    .single();
  if (!conv) return;

  // 3. Insert message (idempotencia por wa_message_id)
  const messageType = parseMessageType(msg.type);

  const { data: inserted, error: insErr } = await admin
    .from("crm_messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conv.id,
      contact_id: contact.id,
      channel_id: channelId,
      direction: "in",
      type: messageType,
      body: msg.text ?? msg.mediaCaption ?? null,
      payload: msg.rawPayload as Record<string, unknown>,
      wa_message_id: msg.waMessageId,
      sender_kind: "contact",
      status: "received",
      created_at: msg.timestamp.toISOString(),
    })
    .select("id")
    .single();

  if (insErr) {
    // Si es duplicado por wa_message_id, ignoramos silenciosamente
    if (!insErr.message.includes("uniq_crm_messages_wa_id")) {
      console.error("[webhook] message insert failed", insErr.message);
    }
    return;
  }

  // 4. Si es audio/imagen/etc., download del media y persist en Storage
  if (msg.mediaProviderId && messageType !== "text") {
    fireAndForgetMediaDownload(organizationId, channelId, inserted.id, msg.mediaProviderId);
  }

  // 5. dispatchEvent message.received → workflows
  // El trigger DB (tg_crm_messages_touch_conv) ya inserta crm_events. Aquí
  // disparamos también el dispatcher para que cree runs queued y trigger runner.
  await dispatchEvent({
    organizationId,
    eventType: "message.received",
    payload: {
      message_id: inserted.id,
      conversation_id: conv.id,
      contact_id: contact.id,
      type: messageType,
      text: msg.text ?? msg.mediaCaption ?? "",
      from_phone: msg.fromPhone,
    },
    conversationId: conv.id,
    contactId: contact.id,
  });
}

function parseMessageType(t: string): CrmMessageType {
  switch (t) {
    case "text":
    case "image":
    case "audio":
    case "video":
    case "document":
    case "location":
    case "contacts":
    case "sticker":
    case "reaction":
    case "story_reply":
    case "story_mention":
    case "share":
    case "postback":
    case "quick_reply":
      return t;
    case "interactive_button_reply":
      return "interactive_buttons";
    case "interactive_list_reply":
      return "interactive_list";
    default:
      return "unsupported";
  }
}

function fireAndForgetMediaDownload(orgId: string, channelId: string, messageId: string, mediaId: string) {
  // Endpoint dedicado descarga el media de Meta y lo guarda en Storage,
  // luego transcribe si es audio. Se invoca async para no bloquear el webhook.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const secret = process.env.PG_CRON_SECRET ?? "";
  fetch(`${baseUrl}/api/cron/from-pg?action=media-download&org=${orgId}&channel=${channelId}&msg=${messageId}&meta=${mediaId}`, {
    method: "POST",
    headers: { "x-pg-cron-secret": secret },
    cache: "no-store",
  }).catch(() => undefined);
}

async function processStatusUpdate(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
  status: ParsedStatusUpdate,
) {
  const update: Record<string, unknown> = {
    status: status.status,
    status_updated_at: status.timestamp.toISOString(),
  };
  if (status.status === "delivered") update.delivered_at = status.timestamp.toISOString();
  if (status.status === "read") update.read_at = status.timestamp.toISOString();
  if (status.status === "failed") {
    update.error_code = status.errorCode;
    update.error_message = status.errorMessage;
  }

  await admin
    .from("crm_messages")
    .update(update)
    .eq("channel_id", channelId)
    .eq("wa_message_id", status.waMessageId);
}

async function processTemplateStatus(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
  ts: ParsedTemplateStatusUpdate,
) {
  const newStatus = ts.newStatus.toLowerCase();
  const update: Record<string, unknown> = {
    meta_status: newStatus,
    last_polled_at: new Date().toISOString(),
  };
  if (newStatus === "approved") update.approved_at = new Date().toISOString();
  if (newStatus === "rejected" && ts.rejectionReason) update.meta_rejection_reason = ts.rejectionReason;

  await admin
    .from("crm_whatsapp_templates")
    .update(update)
    .eq("channel_id", channelId)
    .eq("meta_template_id", ts.metaTemplateId);
}
