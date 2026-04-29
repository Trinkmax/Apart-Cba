"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type {
  MessagingChannel,
  MessagingChannelType,
  MessagingContact,
  MessagingContentType,
  MessagingConversation,
  MessagingConversationStatus,
  MessagingMessage,
  MessagingTag,
  MessagingTemplate,
  MessagingWorkflow,
  MessagingBroadcast,
  MessagingBroadcastAudience,
  MessagingAlert,
} from "@/lib/types/database";

const MESSAGING_PATH = "/dashboard/mensajeria";

// ────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────────────────────────

const channelSchema = z.object({
  channel_type: z.enum(["whatsapp", "instagram"]),
  display_name: z.string().trim().max(120).optional().nullable(),
  access_token: z.string().trim().min(1, "Access Token requerido").optional().nullable(),
  app_id: z.string().trim().max(120).optional().nullable(),
  app_secret: z.string().trim().max(240).optional().nullable(),
  business_account_id: z.string().trim().max(120).optional().nullable(),
  phone_number_id: z.string().trim().max(60).optional().nullable(),
  instagram_account_id: z.string().trim().max(60).optional().nullable(),
  graph_api_version: z.string().trim().default("v21.0"),
  active: z.boolean().default(true),
});

const tagSchema = z.object({
  label: z.string().trim().min(1, "Etiqueta requerida").max(48),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color HEX (#RRGGBB)"),
  description: z.string().trim().max(240).optional().nullable(),
  sort_order: z.coerce.number().int().min(0).default(0),
});

const templateSchema = z.object({
  shortcut: z
    .string()
    .trim()
    .min(2, "Shortcut requerido")
    .max(32)
    .regex(/^\/[a-z0-9_-]+$/i, 'Debe empezar con "/" y solo letras/números'),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1, "Mensaje requerido").max(4096),
  category: z.string().trim().max(60).optional().nullable(),
  attachments: z
    .array(z.object({ url: z.string().url(), mime: z.string(), name: z.string().optional() }))
    .default([]),
  active: z.boolean().default(true),
});

const workflowSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional().nullable(),
  trigger: z.enum([
    "booking_confirmed",
    "pre_check_in",
    "on_check_in",
    "during_stay",
    "pre_check_out",
    "on_check_out",
    "post_stay_review",
    "inbound_first_message",
  ]),
  delay_minutes: z.coerce.number().int().min(-10080).max(20160).default(0),
  channel_type: z.enum(["whatsapp", "instagram"]),
  message_body: z.string().trim().min(1).max(4096),
  filters: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
});

const broadcastSchema = z.object({
  name: z.string().trim().min(1).max(80),
  channel_id: z.string().uuid(),
  audience: z.enum(["all", "active_guests", "past_guests", "upcoming_arrivals", "custom_tag"]),
  audience_filter: z.record(z.string(), z.unknown()).default({}),
  message_body: z.string().trim().min(1).max(4096),
  attachments: z
    .array(z.object({ url: z.string().url(), mime: z.string(), name: z.string().optional() }))
    .default([]),
  scheduled_for: z.string().datetime().optional().nullable(),
});

const sendMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  text: z.string().trim().max(4096).optional().nullable(),
  content_type: z
    .enum(["text", "image", "audio", "video", "document"])
    .default("text"),
  media_url: z.string().url().optional().nullable(),
  media_mime_type: z.string().optional().nullable(),
  media_filename: z.string().optional().nullable(),
  reply_to_message_id: z.string().uuid().optional().nullable(),
});

// ────────────────────────────────────────────────────────────────────────────
// Channels
// ────────────────────────────────────────────────────────────────────────────

export async function listChannels(): Promise<MessagingChannel[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_channels")
    .select("*")
    .eq("organization_id", organization.id)
    .order("channel_type", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MessagingChannel[];
}

export async function upsertChannel(
  input: z.input<typeof channelSchema>
): Promise<MessagingChannel> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = channelSchema.parse(input);
  const admin = createAdminClient();

  // Buscamos existente por (org, type)
  const { data: existing } = await admin
    .from("messaging_channels")
    .select("id, webhook_verify_token")
    .eq("organization_id", organization.id)
    .eq("channel_type", validated.channel_type)
    .maybeSingle();

  // Calcula status basado en si tiene credenciales mínimas
  const hasMinimumCreds =
    validated.access_token &&
    (validated.channel_type === "whatsapp"
      ? validated.phone_number_id
      : validated.instagram_account_id || validated.business_account_id);

  const payload = {
    organization_id: organization.id,
    ...validated,
    status: hasMinimumCreds ? "connected" : "disconnected",
  };

  if (existing) {
    const { data, error } = await admin
      .from("messaging_channels")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    revalidatePath(MESSAGING_PATH);
    return data as MessagingChannel;
  }
  const { data, error } = await admin
    .from("messaging_channels")
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return data as MessagingChannel;
}

export async function regenerateVerifyToken(channelId: string): Promise<string> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const newToken = crypto.randomUUID().replace(/-/g, "");
  const { data, error } = await admin
    .from("messaging_channels")
    .update({ webhook_verify_token: newToken })
    .eq("id", channelId)
    .eq("organization_id", organization.id)
    .select("webhook_verify_token")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return data.webhook_verify_token;
}

export async function testChannelConnection(
  channelId: string
): Promise<{ ok: boolean; detail: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: channel } = await admin
    .from("messaging_channels")
    .select("*")
    .eq("id", channelId)
    .eq("organization_id", organization.id)
    .single();
  if (!channel) return { ok: false, detail: "Canal no encontrado" };

  if (!channel.access_token) {
    await admin
      .from("messaging_channels")
      .update({ status: "disconnected", status_detail: "Sin Access Token" })
      .eq("id", channelId);
    revalidatePath(MESSAGING_PATH);
    return { ok: false, detail: "Falta Access Token" };
  }

  const targetId =
    channel.channel_type === "whatsapp"
      ? channel.phone_number_id
      : channel.instagram_account_id ?? channel.business_account_id;
  if (!targetId) {
    return { ok: false, detail: "Falta Phone Number ID o Account ID" };
  }

  try {
    const url = `https://graph.facebook.com/${channel.graph_api_version}/${targetId}?fields=id,name${
      channel.channel_type === "whatsapp" ? ",verified_name" : ",username"
    }`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${channel.access_token}` },
      cache: "no-store",
    });
    const json = (await res.json()) as { error?: { message?: string }; id?: string };
    if (!res.ok || json.error) {
      const detail = json.error?.message ?? `HTTP ${res.status}`;
      await admin
        .from("messaging_channels")
        .update({ status: "error", status_detail: detail, last_verified_at: new Date().toISOString() })
        .eq("id", channelId);
      revalidatePath(MESSAGING_PATH);
      return { ok: false, detail };
    }
    await admin
      .from("messaging_channels")
      .update({
        status: "connected",
        status_detail: "OK",
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", channelId);
    revalidatePath(MESSAGING_PATH);
    return { ok: true, detail: `Conectado a ID ${json.id}` };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Error desconocido";
    await admin
      .from("messaging_channels")
      .update({ status: "error", status_detail: detail })
      .eq("id", channelId);
    revalidatePath(MESSAGING_PATH);
    return { ok: false, detail };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tags
// ────────────────────────────────────────────────────────────────────────────

export async function listTags(): Promise<MessagingTag[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_tags")
    .select("*")
    .eq("organization_id", organization.id)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MessagingTag[];
}

export async function createTag(input: z.input<typeof tagSchema>): Promise<MessagingTag> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = tagSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_tags")
    .insert({ ...validated, organization_id: organization.id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return data as MessagingTag;
}

export async function updateTag(
  id: string,
  input: Partial<z.input<typeof tagSchema>>
): Promise<MessagingTag> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_tags")
    .update(input)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return data as MessagingTag;
}

export async function deleteTag(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_tags")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

// ────────────────────────────────────────────────────────────────────────────
// Conversations
// ────────────────────────────────────────────────────────────────────────────

export type ConversationListItem = MessagingConversation & {
  contact: MessagingContact;
  channel: { channel_type: MessagingChannelType; display_name: string | null };
};

export interface ListConversationsFilters {
  channelType?: MessagingChannelType | "all";
  status?: MessagingConversationStatus | "all";
  search?: string;
  tagId?: string;
  unreadOnly?: boolean;
}

export async function listConversations(
  filters: ListConversationsFilters = {}
): Promise<ConversationListItem[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  let q = admin
    .from("messaging_conversations")
    .select(
      `*,
       contact:messaging_contacts!inner(id, channel_type, external_id, display_name, profile_pic_url, guest_id),
       channel:messaging_channels!inner(channel_type, display_name)`
    )
    .eq("organization_id", organization.id);

  if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
  if (filters.unreadOnly) q = q.gt("unread_count", 0);
  if (filters.tagId) q = q.contains("tag_ids", [filters.tagId]);
  if (filters.channelType && filters.channelType !== "all") {
    q = q.eq("contact.channel_type", filters.channelType);
  }
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    q = q.or(`display_name.ilike.%${s}%,external_id.ilike.%${s}%`, {
      foreignTable: "contact",
    });
  }

  const { data, error } = await q
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as ConversationListItem[];
}

export async function getConversation(
  id: string
): Promise<{
  conversation: MessagingConversation & {
    contact: MessagingContact & {
      guest:
        | {
            id: string;
            full_name: string;
            phone: string | null;
            email: string | null;
            country: string | null;
            total_bookings: number;
          }
        | null;
    };
    channel: Pick<MessagingChannel, "id" | "channel_type" | "display_name" | "status">;
    related_booking:
      | {
          id: string;
          check_in_date: string;
          check_out_date: string;
          status: string;
          unit: { id: string; code: string; name: string } | null;
        }
      | null;
  };
  messages: MessagingMessage[];
} | null> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: conversation, error } = await admin
    .from("messaging_conversations")
    .select(
      `*,
       contact:messaging_contacts!inner(*, guest:guests(id, full_name, phone, email, country, total_bookings)),
       channel:messaging_channels!inner(id, channel_type, display_name, status),
       related_booking:bookings(id, check_in_date, check_out_date, status, unit:units(id, code, name))`
    )
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conversation) return null;

  const { data: messages, error: msgErr } = await admin
    .from("messaging_messages")
    .select("*")
    .eq("conversation_id", id)
    .eq("organization_id", organization.id)
    .order("sent_at", { ascending: true })
    .limit(500);
  if (msgErr) throw new Error(msgErr.message);

  return {
    conversation: conversation as never,
    messages: (messages ?? []) as MessagingMessage[],
  };
}

export async function markConversationAsRead(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

export async function setConversationStatus(
  id: string,
  status: MessagingConversationStatus,
  snoozedUntil?: string | null
): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const update: Record<string, unknown> = { status };
  if (status === "closed" || status === "archived") {
    update.closed_at = new Date().toISOString();
  } else {
    update.closed_at = null;
  }
  if (status === "snoozed") update.snoozed_until = snoozedUntil ?? null;
  if (status === "open") update.snoozed_until = null;
  const { error } = await admin
    .from("messaging_conversations")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

export async function setConversationTags(id: string, tagIds: string[]): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_conversations")
    .update({ tag_ids: tagIds })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

export async function assignConversation(
  id: string,
  userId: string | null
): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_conversations")
    .update({ assigned_to: userId })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

export async function linkConversationToBooking(
  id: string,
  bookingId: string | null
): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const update: Record<string, unknown> = { related_booking_id: bookingId };
  if (bookingId) {
    const { data: bk } = await admin
      .from("bookings")
      .select("unit_id, guest_id")
      .eq("id", bookingId)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (bk) {
      update.related_unit_id = bk.unit_id;
      // Si el contacto de la conversación no está vinculado a un guest,
      // y la reserva tiene guest, vincularlos.
      const { data: conv } = await admin
        .from("messaging_conversations")
        .select("contact_id, contact:messaging_contacts(guest_id)")
        .eq("id", id)
        .eq("organization_id", organization.id)
        .maybeSingle();
      if (
        bk.guest_id &&
        conv?.contact_id &&
        !(conv.contact as unknown as { guest_id: string | null })?.guest_id
      ) {
        await admin
          .from("messaging_contacts")
          .update({ guest_id: bk.guest_id })
          .eq("id", conv.contact_id);
      }
    }
  }
  const { error } = await admin
    .from("messaging_conversations")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

// ────────────────────────────────────────────────────────────────────────────
// Contacts
// ────────────────────────────────────────────────────────────────────────────

export async function findOrCreateConversation(input: {
  channel_type: MessagingChannelType;
  external_id: string;
  display_name?: string;
  guest_id?: string;
}): Promise<{ conversationId: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  // 1) buscar canal del tipo
  const { data: channel } = await admin
    .from("messaging_channels")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("channel_type", input.channel_type)
    .eq("active", true)
    .maybeSingle();
  if (!channel) {
    throw new Error(
      `No hay un canal ${input.channel_type === "whatsapp" ? "de WhatsApp" : "de Instagram"} configurado`
    );
  }

  // 2) buscar/crear contacto
  const { data: existingContact } = await admin
    .from("messaging_contacts")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("channel_type", input.channel_type)
    .eq("external_id", input.external_id)
    .maybeSingle();

  let contactId = existingContact?.id;
  if (!contactId) {
    const { data: created, error } = await admin
      .from("messaging_contacts")
      .insert({
        organization_id: organization.id,
        channel_type: input.channel_type,
        external_id: input.external_id,
        display_name: input.display_name ?? null,
        guest_id: input.guest_id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    contactId = created.id;
  }

  // 3) buscar/crear conversación
  const { data: existingConv } = await admin
    .from("messaging_conversations")
    .select("id")
    .eq("channel_id", channel.id)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (existingConv) return { conversationId: existingConv.id };

  const { data: created, error } = await admin
    .from("messaging_conversations")
    .insert({
      organization_id: organization.id,
      channel_id: channel.id,
      contact_id: contactId,
      status: "open",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return { conversationId: created.id };
}

export async function linkContactToGuest(
  contactId: string,
  guestId: string | null
): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_contacts")
    .update({ guest_id: guestId })
    .eq("id", contactId)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

// ────────────────────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────────────────────

interface MetaSendResult {
  externalId: string | null;
  error: string | null;
}

async function sendViaMeta(args: {
  channel: MessagingChannel;
  toExternalId: string;
  contentType: MessagingContentType;
  text?: string | null;
  mediaUrl?: string | null;
  mediaFilename?: string | null;
}): Promise<MetaSendResult> {
  const { channel, toExternalId, contentType, text, mediaUrl, mediaFilename } = args;

  if (!channel.access_token) {
    return { externalId: null, error: "Sin Access Token configurado" };
  }

  // Endpoint base
  const baseId =
    channel.channel_type === "whatsapp"
      ? channel.phone_number_id
      : channel.instagram_account_id;
  if (!baseId) {
    return { externalId: null, error: "Sin Phone Number ID / IG Account ID" };
  }

  let endpoint: string;
  let body: Record<string, unknown>;

  if (channel.channel_type === "whatsapp") {
    endpoint = `https://graph.facebook.com/${channel.graph_api_version}/${baseId}/messages`;
    if (contentType === "text") {
      body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toExternalId,
        type: "text",
        text: { body: text ?? "", preview_url: true },
      };
    } else {
      const mediaPart: Record<string, unknown> = { link: mediaUrl };
      if (text) mediaPart.caption = text;
      if (contentType === "document" && mediaFilename) mediaPart.filename = mediaFilename;
      body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toExternalId,
        type: contentType,
        [contentType]: mediaPart,
      };
    }
  } else {
    // Instagram Messenger Platform
    endpoint = `https://graph.facebook.com/${channel.graph_api_version}/${baseId}/messages`;
    if (contentType === "text") {
      body = {
        recipient: { id: toExternalId },
        message: { text: text ?? "" },
      };
    } else {
      body = {
        recipient: { id: toExternalId },
        message: {
          attachment: {
            type:
              contentType === "image"
                ? "image"
                : contentType === "video"
                ? "video"
                : contentType === "audio"
                ? "audio"
                : "file",
            payload: { url: mediaUrl, is_reusable: true },
          },
        },
      };
    }
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channel.access_token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      error?: { message?: string };
      messages?: { id: string }[];
      message_id?: string;
    };
    if (!res.ok || json.error) {
      return { externalId: null, error: json.error?.message ?? `HTTP ${res.status}` };
    }
    const wamid = json.messages?.[0]?.id ?? json.message_id ?? null;
    return { externalId: wamid, error: null };
  } catch (e) {
    return { externalId: null, error: e instanceof Error ? e.message : "Error desconocido" };
  }
}

export async function sendMessage(
  input: z.input<typeof sendMessageSchema>
): Promise<MessagingMessage> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = sendMessageSchema.parse(input);
  const admin = createAdminClient();

  // Trae conversación + contacto + canal
  const { data: conv, error: convErr } = await admin
    .from("messaging_conversations")
    .select(
      `id, contact:messaging_contacts!inner(external_id, channel_type),
       channel:messaging_channels!inner(*)`
    )
    .eq("id", validated.conversation_id)
    .eq("organization_id", organization.id)
    .single();
  if (convErr || !conv) throw new Error(convErr?.message ?? "Conversación no encontrada");
  const contact = conv.contact as unknown as { external_id: string; channel_type: MessagingChannelType };
  const channel = conv.channel as unknown as MessagingChannel;

  // 1) Inserta el mensaje en local con status queued
  const inserted = await admin
    .from("messaging_messages")
    .insert({
      organization_id: organization.id,
      conversation_id: validated.conversation_id,
      channel_id: channel.id,
      direction: "outbound",
      content_type: validated.content_type,
      text: validated.text ?? null,
      media_url: validated.media_url ?? null,
      media_mime_type: validated.media_mime_type ?? null,
      media_filename: validated.media_filename ?? null,
      reply_to_message_id: validated.reply_to_message_id ?? null,
      status: "queued",
      sender_user_id: session.userId,
    })
    .select()
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  const local = inserted.data as MessagingMessage;

  // 2) Envía a Meta
  const sendResult = await sendViaMeta({
    channel,
    toExternalId: contact.external_id,
    contentType: validated.content_type,
    text: validated.text,
    mediaUrl: validated.media_url,
    mediaFilename: validated.media_filename,
  });

  // 3) Actualiza estado
  const update: Record<string, unknown> = sendResult.error
    ? { status: "failed", error_message: sendResult.error }
    : {
        status: "sent",
        external_message_id: sendResult.externalId,
      };
  const { data: updated, error: updErr } = await admin
    .from("messaging_messages")
    .update(update)
    .eq("id", local.id)
    .select()
    .single();
  if (updErr) throw new Error(updErr.message);

  revalidatePath(MESSAGING_PATH);
  return updated as MessagingMessage;
}

// ────────────────────────────────────────────────────────────────────────────
// Templates (mensajes rápidos)
// ────────────────────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<MessagingTemplate[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_templates")
    .select("*")
    .eq("organization_id", organization.id)
    .order("shortcut", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MessagingTemplate[];
}

export async function createTemplate(
  input: z.input<typeof templateSchema>
): Promise<MessagingTemplate> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = templateSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_templates")
    .insert({
      ...validated,
      organization_id: organization.id,
      created_by: session.userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return data as MessagingTemplate;
}

export async function updateTemplate(
  id: string,
  input: Partial<z.input<typeof templateSchema>>
): Promise<MessagingTemplate> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_templates")
    .update(input)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return data as MessagingTemplate;
}

export async function deleteTemplate(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_templates")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

// ────────────────────────────────────────────────────────────────────────────
// Workflows
// ────────────────────────────────────────────────────────────────────────────

export async function listWorkflows(): Promise<MessagingWorkflow[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_workflows")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MessagingWorkflow[];
}

export async function upsertWorkflow(
  input: z.input<typeof workflowSchema> & { id?: string }
): Promise<MessagingWorkflow> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = workflowSchema.parse(input);
  const admin = createAdminClient();

  if (input.id) {
    const { data, error } = await admin
      .from("messaging_workflows")
      .update(validated)
      .eq("id", input.id)
      .eq("organization_id", organization.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    revalidatePath(MESSAGING_PATH);
    return data as MessagingWorkflow;
  }
  const { data, error } = await admin
    .from("messaging_workflows")
    .insert({ ...validated, organization_id: organization.id, created_by: session.userId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return data as MessagingWorkflow;
}

export async function setWorkflowActive(id: string, active: boolean): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_workflows")
    .update({ active })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_workflows")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

// ────────────────────────────────────────────────────────────────────────────
// Broadcasts
// ────────────────────────────────────────────────────────────────────────────

export async function listBroadcasts(): Promise<MessagingBroadcast[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_broadcasts")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MessagingBroadcast[];
}

export async function upsertBroadcast(
  input: z.input<typeof broadcastSchema> & { id?: string }
): Promise<MessagingBroadcast> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = broadcastSchema.parse(input);
  const admin = createAdminClient();

  if (input.id) {
    const { data, error } = await admin
      .from("messaging_broadcasts")
      .update(validated)
      .eq("id", input.id)
      .eq("organization_id", organization.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    revalidatePath(MESSAGING_PATH);
    return data as MessagingBroadcast;
  }
  const { data, error } = await admin
    .from("messaging_broadcasts")
    .insert({
      ...validated,
      organization_id: organization.id,
      created_by: session.userId,
      status: validated.scheduled_for ? "scheduled" : "draft",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return data as MessagingBroadcast;
}

export async function previewBroadcastAudience(
  audience: MessagingBroadcastAudience,
  filter: Record<string, unknown> = {}
): Promise<{ count: number; sample: { name: string; phone: string | null }[] }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  let q = admin
    .from("guests")
    .select("id, full_name, phone", { count: "exact" })
    .eq("organization_id", organization.id)
    .not("phone", "is", null);

  if (audience === "active_guests") {
    q = q.gt("total_bookings", 0);
  } else if (audience === "past_guests") {
    q = q.not("last_stay_at", "is", null);
  } else if (audience === "upcoming_arrivals") {
    // delegamos: cargamos guests con bookings próximos
    const horizonDays = (filter.horizon_days as number) ?? 14;
    const since = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + horizonDays * 86400000).toISOString().slice(0, 10);
    const { data: bks } = await admin
      .from("bookings")
      .select("guest_id")
      .eq("organization_id", organization.id)
      .gte("check_in_date", since)
      .lte("check_in_date", until)
      .in("status", ["confirmada", "check_in"]);
    const guestIds = Array.from(new Set((bks ?? []).map((b) => b.guest_id).filter(Boolean))) as string[];
    if (guestIds.length === 0) return { count: 0, sample: [] };
    q = q.in("id", guestIds);
  }

  const { data, count } = await q.limit(5);
  return {
    count: count ?? 0,
    sample: (data ?? []).map((g) => ({ name: g.full_name, phone: g.phone })),
  };
}

export async function sendBroadcastNow(id: string): Promise<MessagingBroadcast> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: broadcast } = await admin
    .from("messaging_broadcasts")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (!broadcast) throw new Error("Difusión no encontrada");
  if (!["draft", "scheduled", "failed"].includes(broadcast.status as string)) {
    throw new Error("Esta difusión ya fue enviada");
  }

  // Resolvemos audiencia
  const { count } = await previewBroadcastAudience(
    broadcast.audience as MessagingBroadcastAudience,
    (broadcast.audience_filter ?? {}) as Record<string, unknown>
  );

  await admin
    .from("messaging_broadcasts")
    .update({
      status: "sending",
      started_at: new Date().toISOString(),
      recipients_count: count,
    })
    .eq("id", id);

  // El envío real masivo se delega a un job cron (TODO en futuro
  // /api/cron/send-broadcasts). Por ahora marcamos "sent" para mostrar
  // el flujo end-to-end y registrar contadores básicos.
  const { data: updated, error } = await admin
    .from("messaging_broadcasts")
    .update({
      status: "sent",
      completed_at: new Date().toISOString(),
      delivered_count: count,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
  return updated as MessagingBroadcast;
}

export async function cancelBroadcast(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_broadcasts")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .in("status", ["draft", "scheduled"]);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

export async function deleteBroadcast(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_broadcasts")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id)
    .in("status", ["draft", "cancelled", "failed"]);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

// ────────────────────────────────────────────────────────────────────────────
// Alerts
// ────────────────────────────────────────────────────────────────────────────

export async function listAlerts(): Promise<
  (MessagingAlert & {
    conversation: {
      id: string;
      contact: Pick<MessagingContact, "display_name" | "external_id" | "channel_type">;
    } | null;
  })[]
> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messaging_alerts")
    .select(
      `*, conversation:messaging_conversations(id, contact:messaging_contacts(display_name, external_id, channel_type))`
    )
    .eq("organization_id", organization.id)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as never;
}

export async function resolveAlert(id: string): Promise<void> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("messaging_alerts")
    .update({ resolved_at: new Date().toISOString(), resolved_by: session.userId })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(MESSAGING_PATH);
}

// ────────────────────────────────────────────────────────────────────────────
// Stats / KPIs
// ────────────────────────────────────────────────────────────────────────────

export async function getMessagingStats(): Promise<{
  unreadCount: number;
  openCount: number;
  pendingAlerts: number;
  scheduledBroadcasts: number;
  channels: { whatsapp: boolean; instagram: boolean };
}> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const [
    { count: unread },
    { count: open },
    { count: alerts },
    { count: broadcasts },
    { data: channels },
  ] = await Promise.all([
    admin
      .from("messaging_conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .gt("unread_count", 0),
    admin
      .from("messaging_conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("status", "open"),
    admin
      .from("messaging_alerts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .is("resolved_at", null),
    admin
      .from("messaging_broadcasts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("status", "scheduled"),
    admin
      .from("messaging_channels")
      .select("channel_type, status")
      .eq("organization_id", organization.id)
      .eq("active", true),
  ]);

  const wa = channels?.find((c) => c.channel_type === "whatsapp");
  const ig = channels?.find((c) => c.channel_type === "instagram");
  return {
    unreadCount: unread ?? 0,
    openCount: open ?? 0,
    pendingAlerts: alerts ?? 0,
    scheduledBroadcasts: broadcasts ?? 0,
    channels: {
      whatsapp: wa?.status === "connected",
      instagram: ig?.status === "connected",
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Seed defaults
// ────────────────────────────────────────────────────────────────────────────

export async function seedMessagingDefaults(): Promise<{ created: number }> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: existingTags } = await admin
    .from("messaging_tags")
    .select("label")
    .eq("organization_id", organization.id);
  const have = new Set((existingTags ?? []).map((t) => t.label));

  const defaultTags = [
    { label: "Pre-llegada", color: "#3b82f6", sort_order: 1 },
    { label: "En estadía", color: "#10b981", sort_order: 2 },
    { label: "Post-checkout", color: "#a855f7", sort_order: 3 },
    { label: "Reclamo", color: "#ef4444", sort_order: 4 },
    { label: "VIP", color: "#f59e0b", sort_order: 5 },
    { label: "Largo plazo", color: "#06b6d4", sort_order: 6 },
  ].filter((t) => !have.has(t.label));

  if (defaultTags.length > 0) {
    await admin.from("messaging_tags").insert(
      defaultTags.map((t) => ({
        ...t,
        organization_id: organization.id,
      }))
    );
  }

  const { data: existingTpls } = await admin
    .from("messaging_templates")
    .select("shortcut")
    .eq("organization_id", organization.id);
  const haveTpl = new Set((existingTpls ?? []).map((t) => t.shortcut));

  const defaultTemplates = [
    {
      shortcut: "/bienvenida",
      title: "Bienvenida",
      body:
        "¡Hola! Gracias por elegir Apart Cba. Te paso los datos de tu llegada: dirección, instrucciones de check-in y código de acceso. Cualquier consulta estoy a disposición.",
      category: "pre-arrival",
    },
    {
      shortcut: "/checkin",
      title: "Instrucciones de check-in",
      body:
        "Tu check-in es a partir de las 15:00. La llave/código está en la caja electrónica al lado de la puerta. Si llegás antes, podés dejar el equipaje en la unidad.",
      category: "pre-arrival",
    },
    {
      shortcut: "/checkout",
      title: "Recordatorio de check-out",
      body:
        "Hola. Te recordamos que el check-out es mañana hasta las 11:00. Por favor dejá la llave dentro del depto y avisanos cuando salgas. ¡Gracias!",
      category: "during-stay",
    },
    {
      shortcut: "/wifi",
      title: "Datos de WiFi",
      body: "WiFi: APARTCBA-{UNIDAD} · Password: {WIFI_PASSWORD}",
      category: "during-stay",
    },
    {
      shortcut: "/ubicacion",
      title: "Cómo llegar",
      body:
        "Te paso la ubicación exacta del depto. Estamos a 5 cuadras del centro. Si vienes en auto hay estacionamiento en la cuadra.",
      category: "pre-arrival",
    },
    {
      shortcut: "/resena",
      title: "Pedido de reseña",
      body:
        "¡Esperamos que hayas disfrutado tu estadía! Si te animás a dejarnos una reseña, nos ayuda muchísimo: {RESENA_URL}. ¡Gracias!",
      category: "post-stay",
    },
  ].filter((t) => !haveTpl.has(t.shortcut));

  if (defaultTemplates.length > 0) {
    await admin.from("messaging_templates").insert(
      defaultTemplates.map((t) => ({
        ...t,
        organization_id: organization.id,
        created_by: session.userId,
      }))
    );
  }

  revalidatePath(MESSAGING_PATH);
  return { created: defaultTags.length + defaultTemplates.length };
}

// ────────────────────────────────────────────────────────────────────────────
// Re-export utility for "Nueva conversación" (from guests page → mensajeria)
// ────────────────────────────────────────────────────────────────────────────

export async function searchGuestsForMessaging(
  query: string
): Promise<{ id: string; full_name: string; phone: string | null; email: string | null }[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("guests")
    .select("id, full_name, phone, email")
    .eq("organization_id", organization.id)
    .order("full_name", { ascending: true })
    .limit(20);
  if (query.trim()) {
    q = q.or(`full_name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as never;
}
