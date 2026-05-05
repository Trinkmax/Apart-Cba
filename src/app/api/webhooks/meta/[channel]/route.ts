import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { MessagingChannelType, MessagingContentType } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Channel = "whatsapp" | "instagram";

function isValidChannel(c: string): c is Channel {
  return c === "whatsapp" || c === "instagram";
}

// ─── GET — Webhook verification handshake (hub.challenge) ─────────────────────
export async function GET(
  req: Request,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel } = await params;
  if (!isValidChannel(channel)) {
    return NextResponse.json({ error: "invalid channel" }, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return new NextResponse("forbidden", { status: 403 });
  }

  // Buscar en TODAS las orgs un canal con ese verify_token + tipo
  const admin = createAdminClient();
  const { data: ch } = await admin
    .from("messaging_channels")
    .select("id")
    .eq("channel_type", channel)
    .eq("webhook_verify_token", token)
    .eq("active", true)
    .maybeSingle();

  if (!ch) return new NextResponse("forbidden", { status: 403 });

  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

// ─── POST — Recepción de eventos ──────────────────────────────────────────────
export async function POST(
  req: Request,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel } = await params;
  if (!isValidChannel(channel)) {
    return NextResponse.json({ error: "invalid channel" }, { status: 404 });
  }

  const raw = (await req.json()) as Record<string, unknown>;

  try {
    if (channel === "whatsapp") {
      await handleWhatsAppEvent(raw);
    } else {
      await handleInstagramEvent(raw);
    }
  } catch (e) {
    console.error("[webhook]", channel, e);
  }

  // Meta espera 200 incluso ante errores: si devolvemos 5xx, reintenta y nos
  // duplica los mensajes. Logueamos y respondemos OK.
  return NextResponse.json({ ok: true });
}

// ───────────────────────────── helpers ──────────────────────────────────────

async function ensureContactAndConversation(args: {
  organizationId: string;
  channelId: string;
  channelType: MessagingChannelType;
  externalId: string;
  displayName?: string | null;
  profilePicUrl?: string | null;
}): Promise<{ contactId: string; conversationId: string }> {
  const admin = createAdminClient();

  // contact
  const { data: existingContact } = await admin
    .from("messaging_contacts")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("channel_type", args.channelType)
    .eq("external_id", args.externalId)
    .maybeSingle();

  let contactId: string;
  if (existingContact?.id) {
    contactId = existingContact.id;
  } else {
    // Auto-link a guest si encontramos uno con el mismo phone (solo WA)
    let guestId: string | null = null;
    if (args.channelType === "whatsapp") {
      const phoneNorm = args.externalId.replace(/\D/g, "");
      const { data: g } = await admin
        .from("guests")
        .select("id")
        .eq("organization_id", args.organizationId)
        .ilike("phone", `%${phoneNorm}%`)
        .maybeSingle();
      guestId = g?.id ?? null;
    }
    const { data: created, error } = await admin
      .from("messaging_contacts")
      .insert({
        organization_id: args.organizationId,
        channel_type: args.channelType,
        external_id: args.externalId,
        display_name: args.displayName ?? null,
        profile_pic_url: args.profilePicUrl ?? null,
        guest_id: guestId,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "No contact created");
    contactId = created.id;
  }
  if (existingContact && args.displayName) {
    // refresh display name si lo trae
    await admin
      .from("messaging_contacts")
      .update({ display_name: args.displayName, profile_pic_url: args.profilePicUrl })
      .eq("id", contactId);
  }

  const { data: existingConv } = await admin
    .from("messaging_conversations")
    .select("id")
    .eq("channel_id", args.channelId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existingConv) return { contactId, conversationId: existingConv.id };

  const { data: created, error } = await admin
    .from("messaging_conversations")
    .insert({
      organization_id: args.organizationId,
      channel_id: args.channelId,
      contact_id: contactId,
      status: "open",
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "No conversation created");
  return { contactId, conversationId: created.id };
}

interface WhatsAppPayload {
  object?: string;
  entry?: {
    id: string;
    changes?: {
      field: string;
      value: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: WhatsAppMessage[];
        statuses?: {
          id?: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
        }[];
      };
    }[];
  }[];
}

async function handleWhatsAppEvent(payload: WhatsAppPayload): Promise<void> {
  const admin = createAdminClient();
  const entries = payload.entry ?? [];

  for (const entry of entries) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Identifica el canal por phone_number_id
      const { data: ch } = await admin
        .from("messaging_channels")
        .select("id, organization_id, channel_type")
        .eq("channel_type", "whatsapp")
        .eq("phone_number_id", phoneNumberId)
        .eq("active", true)
        .maybeSingle();
      if (!ch) continue;

      // Status updates (delivered, read, failed)
      for (const s of value.statuses ?? []) {
        if (!s.id || !s.status) continue;
        const update: Record<string, unknown> = { status: s.status };
        if (s.status === "delivered") update.delivered_at = isoTs(s.timestamp);
        if (s.status === "read") update.read_at = isoTs(s.timestamp);
        await admin
          .from("messaging_messages")
          .update(update)
          .eq("channel_id", ch.id)
          .eq("external_message_id", s.id);
      }

      // Inbound messages
      const profileMap = new Map(
        (value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name])
      );

      for (const m of value.messages ?? []) {
        if (!m.from || !m.id) continue;
        const { conversationId } = await ensureContactAndConversation({
          organizationId: ch.organization_id,
          channelId: ch.id,
          channelType: "whatsapp",
          externalId: m.from,
          displayName: profileMap.get(m.from) ?? null,
        });

        const built = buildWhatsAppMessageRow(m);
        await admin
          .from("messaging_messages")
          .insert({
            organization_id: ch.organization_id,
            conversation_id: conversationId,
            channel_id: ch.id,
            direction: "inbound",
            external_message_id: m.id,
            sent_at: isoTs(m.timestamp) ?? new Date().toISOString(),
            status: "delivered",
            ...built,
          })
          // si Meta reintenta y ya lo insertamos, evita duplicados
          .select()
          .single()
          .then(undefined, () => undefined);
      }
    }
  }
}

interface WhatsAppMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string; link?: string };
  video?: { id?: string; mime_type?: string; caption?: string; link?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean; link?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string; link?: string };
  sticker?: { id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
  context?: { id?: string };
}

function buildWhatsAppMessageRow(m: WhatsAppMessage): {
  content_type: MessagingContentType;
  text: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  media_caption: string | null;
  raw: Record<string, unknown>;
} {
  const t = (m.type ?? "text") as string;
  if (t === "text") {
    return {
      content_type: "text",
      text: m.text?.body ?? null,
      media_url: null,
      media_mime_type: null,
      media_filename: null,
      media_caption: null,
      raw: m as Record<string, unknown>,
    };
  }
  const map: Record<string, MessagingContentType> = {
    image: "image",
    video: "video",
    audio: "audio",
    document: "document",
    sticker: "sticker",
    location: "location",
    contacts: "contacts",
  };
  const type = (map[t] ?? "system") as MessagingContentType;
  const media =
    t === "image"
      ? m.image
      : t === "video"
      ? m.video
      : t === "audio"
      ? m.audio
      : t === "document"
      ? m.document
      : null;
  return {
    content_type: type,
    text: null,
    media_url: (media as { link?: string } | null)?.link ?? null,
    media_mime_type: (media as { mime_type?: string } | null)?.mime_type ?? null,
    media_filename: (media as { filename?: string } | null)?.filename ?? null,
    media_caption: (media as { caption?: string } | null)?.caption ?? null,
    raw: m as Record<string, unknown>,
  };
}

interface InstagramPayload {
  object?: string;
  entry?: {
    id: string;
    time?: number;
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        attachments?: { type?: string; payload?: { url?: string } }[];
        is_echo?: boolean;
      };
      reaction?: { mid?: string; action?: string; emoji?: string };
    }[];
  }[];
}

async function handleInstagramEvent(payload: InstagramPayload): Promise<void> {
  const admin = createAdminClient();
  const entries = payload.entry ?? [];

  for (const entry of entries) {
    const igAccountId = entry.id;
    const { data: ch } = await admin
      .from("messaging_channels")
      .select("id, organization_id, instagram_account_id")
      .eq("channel_type", "instagram")
      .eq("instagram_account_id", igAccountId)
      .eq("active", true)
      .maybeSingle();
    if (!ch) continue;

    for (const m of entry.messaging ?? []) {
      const isEcho = !!m.message?.is_echo;
      const senderId = m.sender?.id;
      const recipientId = m.recipient?.id;
      if (!senderId || !recipientId || !m.message?.mid) continue;

      const externalContactId = isEcho ? recipientId : senderId;
      const { conversationId } = await ensureContactAndConversation({
        organizationId: ch.organization_id,
        channelId: ch.id,
        channelType: "instagram",
        externalId: externalContactId,
      });

      const attachment = m.message.attachments?.[0];
      const contentType: MessagingContentType = attachment
        ? attachment.type === "image"
          ? "image"
          : attachment.type === "video"
          ? "video"
          : attachment.type === "audio"
          ? "audio"
          : "document"
        : "text";

      await admin
        .from("messaging_messages")
        .insert({
          organization_id: ch.organization_id,
          conversation_id: conversationId,
          channel_id: ch.id,
          direction: isEcho ? "outbound" : "inbound",
          external_message_id: m.message.mid,
          sent_at: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
          status: "delivered",
          content_type: contentType,
          text: m.message.text ?? null,
          media_url: attachment?.payload?.url ?? null,
          raw: m as Record<string, unknown>,
        })
        .select()
        .single()
        .then(undefined, () => undefined);
    }
  }
}

function isoTs(unix?: string | number | null): string | null {
  if (!unix) return null;
  const n = typeof unix === "string" ? parseInt(unix, 10) : unix;
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}
