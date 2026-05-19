import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { dispatchEvent } from "@/lib/crm/workflows/dispatcher";
import type {
  ParsedInboundMessage,
  ParsedStatusUpdate,
  ParsedTemplateStatusUpdate,
} from "@/lib/crm/providers/types";
import type { CrmContactExternalKind, CrmMessageType } from "@/lib/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Shared inbound pipeline — used by BOTH webhook routes (Meta Cloud + Baileys)
 * so an inbound message lands, links to guest/owner, reopens the conversation
 * and fires `message.received` → workflows IDENTICALLY regardless of provider.
 * Extracted verbatim from the original /api/webhooks/whatsapp route; the only
 * addition is `prefetchedMedia` (Baileys uploads media itself).
 */
export async function processInboundMessage(
  admin: Admin,
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
    console.error("[inbound] contact upsert failed", contactErr?.message);
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

  // Upsert conversation (open/reopen)
  const { data: conv } = await admin
    .from("crm_conversations")
    .upsert(
      {
        organization_id: organizationId,
        contact_id: contact.id,
        channel_id: channelId,
        status: "open",
      },
      { onConflict: "organization_id,contact_id,channel_id" },
    )
    .select("id")
    .single();
  if (!conv) return;

  // Insert message (idempotencia por wa_message_id)
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
      console.error("[inbound] message insert failed", insErr.message);
    }
    return;
  }

  // Media:
  //  • Baileys → ya subido a Storage por el gateway: persistimos columnas + signed URL.
  //  • Meta → endpoint dedicado descarga de Graph API (comportamiento original).
  if (msg.prefetchedMedia) {
    const pm = msg.prefetchedMedia;
    const { data: signed } = await admin.storage
      .from("crm-media")
      .createSignedUrl(pm.storagePath, 60 * 60 * 24 * 7);
    await admin
      .from("crm_messages")
      .update({
        media_storage_path: pm.storagePath,
        media_url: signed?.signedUrl ?? null,
        media_mime: pm.mime,
        media_size_bytes: pm.sizeBytes ?? null,
        media_duration_ms: pm.durationMs ?? null,
        media_filename: pm.filename ?? null,
      })
      .eq("id", inserted.id);
  } else if (msg.mediaProviderId && messageType !== "text") {
    fireAndForgetMediaDownload(organizationId, channelId, inserted.id, msg.mediaProviderId);
  }

  // dispatchEvent message.received → workflows (idéntico para todos los proveedores)
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

export function parseMessageType(t: string): CrmMessageType {
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

function fireAndForgetMediaDownload(
  orgId: string,
  channelId: string,
  messageId: string,
  mediaId: string,
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const secret = process.env.PG_CRON_SECRET ?? "";
  fetch(
    `${baseUrl}/api/cron/from-pg?action=media-download&org=${orgId}&channel=${channelId}&msg=${messageId}&meta=${mediaId}`,
    {
      method: "POST",
      headers: { "x-pg-cron-secret": secret },
      cache: "no-store",
    },
  ).catch(() => undefined);
}

export async function processStatusUpdate(
  admin: Admin,
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

export async function processTemplateStatus(
  admin: Admin,
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
