"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import type {
  CrmConversation,
  CrmConversationListItem,
  CrmConversationStatus,
  CrmContact,
  CrmTag,
  CrmMessage,
  CrmContactWithLinks,
} from "@/lib/types/database";

// ─── List ──────────────────────────────────────────────────────────────────

interface ListParams {
  status?: CrmConversationStatus | "all";
  channelIds?: string[];
  tagSlugs?: string[];
  search?: string;
  limit?: number;
  assignedToMe?: boolean;
}

export async function listConversations(params: ListParams = {}): Promise<CrmConversationListItem[]> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  let query = admin
    .from("crm_conversations")
    .select(`
      *,
      contact:crm_contacts(*),
      channel:crm_channels(id,provider,display_name),
      conversation_tags:crm_conversation_tags(tag:crm_tags(*))
    `)
    .eq("organization_id", organization.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(params.limit ?? 100);

  if (params.status && params.status !== "all") query = query.eq("status", params.status);
  if (params.assignedToMe) query = query.eq("assigned_to", session.userId);
  if (params.channelIds?.length) query = query.in("channel_id", params.channelIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type Row = CrmConversation & {
    contact: CrmContact;
    channel: { id: string; provider: string; display_name: string };
    conversation_tags: { tag: CrmTag }[];
  };

  let rows = (data ?? []) as Row[];

  if (params.tagSlugs?.length) {
    rows = rows.filter((r) => r.conversation_tags.some((ct) => params.tagSlugs!.includes(ct.tag.slug)));
  }

  if (params.search) {
    const q = params.search.toLowerCase();
    rows = rows.filter((r) =>
      (r.contact.name?.toLowerCase().includes(q) ||
        r.contact.phone?.includes(q) ||
        r.contact.instagram_username?.toLowerCase().includes(q) ||
        r.contact.external_id.toLowerCase().includes(q) ||
        r.last_message_preview?.toLowerCase().includes(q)) ?? false,
    );
  }

  return rows.map((r) => ({
    ...r,
    tags: r.conversation_tags.map((ct) => ct.tag),
  })) as CrmConversationListItem[];
}

// ─── Get details (con messages + contact context) ──────────────────────────

export async function getConversationDetail(conversationId: string): Promise<{
  conversation: CrmConversationListItem;
  messages: CrmMessage[];
  contact: CrmContactWithLinks;
} | null> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: conv, error } = await admin
    .from("crm_conversations")
    .select(`
      *,
      contact:crm_contacts(*),
      channel:crm_channels(id,provider,display_name),
      conversation_tags:crm_conversation_tags(tag:crm_tags(*))
    `)
    .eq("id", conversationId)
    .eq("organization_id", organization.id)
    .single();

  if (error || !conv) return null;

  const { data: messages } = await admin
    .from("crm_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);

  const contactRaw = conv.contact as CrmContact;
  let contact: CrmContactWithLinks = { ...contactRaw };

  if (contactRaw.guest_id) {
    const { data: guest } = await admin
      .from("guests")
      .select("id,full_name,email,phone,document_number,total_bookings")
      .eq("id", contactRaw.guest_id)
      .single();

    const { data: booking } = await admin
      .from("bookings")
      .select(`
        id, unit_id, check_in_date, check_out_date, status, total_amount, paid_amount,
        unit:units(id,code,name)
      `)
      .eq("guest_id", contactRaw.guest_id)
      .eq("organization_id", organization.id)
      .in("status", ["confirmada", "check_in"])
      .order("check_in_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (guest) {
      contact = {
        ...contactRaw,
        guest: { ...guest, active_booking: booking ?? undefined },
      } as CrmContactWithLinks;
    }
  }

  if (contactRaw.owner_id) {
    const { data: owner } = await admin
      .from("owners")
      .select("id,full_name,email,phone,preferred_currency")
      .eq("id", contactRaw.owner_id)
      .single();
    if (owner) {
      contact = { ...contact, owner } as CrmContactWithLinks;
    }
  }

  const conversation = {
    ...conv,
    tags: (conv.conversation_tags as { tag: CrmTag }[]).map((ct) => ct.tag),
  } as CrmConversationListItem;

  // Reset unread count
  if (conv.unread_count > 0) {
    await admin.from("crm_conversations").update({ unread_count: 0 }).eq("id", conversationId);
  }

  return { conversation, messages: (messages ?? []) as CrmMessage[], contact };
}

// ─── Send text (user-facing) ───────────────────────────────────────────────

const sendTextSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().min(1).max(4096),
});

export async function sendTextMessage(input: z.infer<typeof sendTextSchema>) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const validated = sendTextSchema.parse(input);
  const admin = createAdminClient();

  const { data: conv } = await admin
    .from("crm_conversations")
    .select("id,contact_id,channel_id,status,last_customer_message_at")
    .eq("id", validated.conversationId)
    .eq("organization_id", organization.id)
    .single();
  if (!conv) throw new Error("Conversación no encontrada");

  // Validar ventana 24h WhatsApp
  if (conv.last_customer_message_at) {
    const last = new Date(conv.last_customer_message_at).getTime();
    const ageHours = (Date.now() - last) / 3_600_000;
    if (ageHours > 24) {
      throw new Error("session_expired_use_template");
    }
  } else {
    // No hay mensaje del cliente nunca → no se puede enviar free-form
    throw new Error("session_expired_use_template");
  }

  const { sendMessageNow } = await import("@/lib/crm/message-sender");
  const result = await sendMessageNow({
    organizationId: organization.id,
    conversationId: conv.id,
    contactId: conv.contact_id,
    channelId: conv.channel_id,
    body: { type: "text", text: validated.text },
    senderUserId: session.userId,
    senderKind: "human",
  });

  // Trigger flush inmediato
  const { triggerWorkflowRunner } = await import("@/lib/crm/runner-trigger");
  triggerWorkflowRunner();

  revalidatePath("/dashboard/crm/inbox");
  return { messageId: result.messageId };
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

export async function closeConversation(conversationId: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("crm_conversations")
    .update({ status: "closed", closed_at: new Date().toISOString(), closed_reason: "manual" })
    .eq("id", conversationId)
    .eq("organization_id", organization.id);

  await admin.from("crm_events").insert({
    organization_id: organization.id,
    event_type: "conversation.closed",
    conversation_id: conversationId,
    payload: { reason: "manual", closed_by: session.userId },
  });

  revalidatePath("/dashboard/crm/inbox");
}

export async function reopenConversation(conversationId: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("crm_conversations")
    .update({ status: "open", closed_at: null, closed_reason: null })
    .eq("id", conversationId)
    .eq("organization_id", organization.id);

  revalidatePath("/dashboard/crm/inbox");
}

export async function assignConversation(conversationId: string, userId: string | null) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("crm_conversations")
    .update({ assigned_to: userId })
    .eq("id", conversationId)
    .eq("organization_id", organization.id);

  revalidatePath("/dashboard/crm/inbox");
}

export async function snoozeConversation(conversationId: string, until: Date) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { error } = await admin.rpc("crm_snooze_conversation", {
    p_id: conversationId,
    p_org: organization.id,
    p_until: until.toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/crm/inbox");
}

export async function archiveConversation(conversationId: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("crm_conversations")
    .update({ status: "archived" })
    .eq("id", conversationId)
    .eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/inbox");
}

// ─── Bulk operations ───────────────────────────────────────────────────────

export async function bulkCloseConversations(ids: string[]) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("crm_conversations")
    .update({ status: "closed", closed_at: new Date().toISOString(), closed_reason: "manual" })
    .in("id", ids)
    .eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/inbox");
}

export async function bulkArchiveConversations(ids: string[]) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("crm_conversations")
    .update({ status: "archived" })
    .in("id", ids)
    .eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/inbox");
}

export async function bulkTagConversations(ids: string[], tagId: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  // Validar que el tag pertenece a la org
  const { data: tag } = await admin
    .from("crm_tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", organization.id)
    .single();
  if (!tag) throw new Error("Tag inválida");

  const rows = ids.map((conversation_id) => ({
    conversation_id,
    tag_id: tagId,
    added_via: "manual" as const,
  }));
  await admin.from("crm_conversation_tags").upsert(rows, { onConflict: "conversation_id,tag_id" });
  revalidatePath("/dashboard/crm/inbox");
}
