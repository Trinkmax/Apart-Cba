"use server";

import { createAdminClient } from "@/lib/supabase/server";
import type { OutboundMessageBody, TemplateComponentParam } from "./providers/types";
import type { CrmMessageSenderKind } from "@/lib/types/database";

export interface SendMessageInput {
  organizationId: string;
  conversationId: string;
  contactId: string;
  channelId: string;
  body: OutboundMessageBody;
  senderUserId?: string;
  senderKind: CrmMessageSenderKind;
  workflowRunId?: string;
  replyToWaMessageId?: string;
  templateName?: string;
  templateVariables?: Record<string, unknown>;
}

/**
 * Encola un mensaje saliente: persiste fila en crm_messages (status=queued) +
 * fila en crm_message_outbox + dispara el outbox processor (fire-and-forget).
 *
 * El processor real (lib/crm/outbox.ts) corre desde /api/cron/from-pg y
 * desde un endpoint immediate cuando hace falta.
 */
export async function sendMessageNow(input: SendMessageInput): Promise<{ messageId: string }> {
  const admin = createAdminClient();

  // 1. Mapear body → fields persistidos en crm_messages
  const messageRow = mapBodyToMessageRow(input.body);

  // 2. Resolver el identificador del contacto (phone E.164 para WA, IGSID para IG)
  const { data: contact, error: contactErr } = await admin
    .from("crm_contacts")
    .select("phone, external_id, external_kind")
    .eq("id", input.contactId)
    .single();
  if (contactErr || !contact) throw new Error(`Contact ${input.contactId} not found`);
  const recipientId = (contact.external_id as string) ?? (contact.phone as string);

  // 3. Insertar mensaje
  const { data: msg, error: msgErr } = await admin
    .from("crm_messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      channel_id: input.channelId,
      direction: "out",
      type: messageRow.type,
      body: messageRow.body,
      media_url: messageRow.media_url,
      payload: messageRow.payload,
      template_name: input.templateName,
      template_variables: input.templateVariables,
      sender_user_id: input.senderUserId,
      sender_kind: input.senderKind,
      workflow_run_id: input.workflowRunId,
      status: "queued",
    })
    .select("id")
    .single();

  if (msgErr || !msg) throw new Error(`Failed to insert message: ${msgErr?.message}`);

  // 4. Insertar en outbox (toPhone field también vale como IGSID para IG)
  await admin.from("crm_message_outbox").insert({
    organization_id: input.organizationId,
    conversation_id: input.conversationId,
    message_id: msg.id,
    channel_id: input.channelId,
    payload: {
      toPhone: recipientId,
      body: input.body,
      replyToWaMessageId: input.replyToWaMessageId,
    },
    status: "pending",
    next_attempt_at: new Date().toISOString(),
  });

  // 5. Trigger immediate flush (fire-and-forget) — handled out-of-module
  return { messageId: msg.id };
}

function mapBodyToMessageRow(body: OutboundMessageBody): {
  type: string;
  body: string | null;
  media_url: string | null;
  payload: Record<string, unknown> | null;
} {
  switch (body.type) {
    case "text":
      return { type: "text", body: body.text, media_url: null, payload: null };
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker":
      return {
        type: body.type,
        body: body.caption ?? null,
        media_url: body.mediaUrl,
        payload: { filename: body.filename },
      };
    case "location":
      return { type: "location", body: null, media_url: null, payload: { latitude: body.latitude, longitude: body.longitude, name: body.name, address: body.address } };
    case "interactive_buttons":
      return {
        type: "interactive_buttons",
        body: body.bodyText,
        media_url: null,
        payload: { headerText: body.headerText, footerText: body.footerText, buttons: body.buttons },
      };
    case "interactive_list":
      return {
        type: "interactive_list",
        body: body.bodyText,
        media_url: null,
        payload: { headerText: body.headerText, footerText: body.footerText, buttonText: body.buttonText, sections: body.sections },
      };
    case "template":
      return {
        type: "template",
        body: null,
        media_url: null,
        payload: { templateName: body.templateName, language: body.language, components: body.components as TemplateComponentParam[] },
      };
  }
}
