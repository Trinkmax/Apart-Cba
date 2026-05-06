"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/crm/phone";
import { renderTemplate } from "@/lib/crm/render-vars";
import { sendMessageNow } from "@/lib/crm/message-sender";
import { triggerWorkflowRunner } from "@/lib/crm/runner-trigger";

export interface BroadcastRow {
  id: string;
  organization_id: string;
  channel_id: string;
  template_id: string | null;
  name: string;
  audience: { kind: "guests" | "owners" | "phones"; filters?: Record<string, unknown>; phones?: string[] };
  template_params: Record<string, string>;
  scheduled_at: string | null;
  status: "draft" | "queued" | "sending" | "sent" | "partial" | "cancelled" | "failed";
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listBroadcasts(): Promise<BroadcastRow[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_broadcasts")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as BroadcastRow[];
}

export async function getBroadcastDetail(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: bcast } = await admin
    .from("crm_broadcasts")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (!bcast) return null;
  const { data: recipients } = await admin
    .from("crm_broadcast_recipients")
    .select("*")
    .eq("broadcast_id", id)
    .order("created_at", { ascending: true });
  return { broadcast: bcast as BroadcastRow, recipients: recipients ?? [] };
}

const audienceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("guests"),
    filters: z.object({
      hasActiveBooking: z.boolean().optional(),
      blacklisted: z.boolean().optional(),
      minStays: z.number().int().min(0).optional(),
    }).optional(),
  }),
  z.object({
    kind: z.literal("owners"),
    filters: z.object({}).optional(),
  }),
  z.object({
    kind: z.literal("phones"),
    phones: z.array(z.string()).min(1).max(5000),
  }),
  // Audiencia para IG: contactos del CRM con conversación abierta dentro 24h
  z.object({
    kind: z.literal("crm_contacts"),
    filters: z.object({
      tagSlugs: z.array(z.string()).optional(),
      onlyWithin24h: z.boolean().default(true),
      onlyOpen: z.boolean().default(true),
    }).optional(),
  }),
]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  channelId: z.string().uuid(),
  templateId: z.string().uuid().nullable().optional(),  // null si IG free-form
  freeFormText: z.string().min(1).max(2000).nullable().optional(), // alternativa para IG
  audience: audienceSchema,
  templateParams: z.record(z.string(), z.string()).default({}),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export async function createBroadcast(input: z.infer<typeof createSchema>): Promise<{ id: string; recipientsCount: number }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const v = createSchema.parse(input);
  const admin = createAdminClient();

  // Resolver canal para saber su provider
  const { data: channel } = await admin
    .from("crm_channels")
    .select("provider")
    .eq("id", v.channelId)
    .eq("organization_id", organization.id)
    .single();
  if (!channel) throw new Error("Canal no encontrado");
  const isIg = channel.provider === "meta_instagram";

  // Validación de contenido según provider
  if (!isIg) {
    if (!v.templateId) throw new Error("WhatsApp requiere un template aprobado");
    const { data: template } = await admin
      .from("crm_whatsapp_templates")
      .select("id,meta_status,name,language,body,variables_count")
      .eq("id", v.templateId)
      .eq("organization_id", organization.id)
      .single();
    if (!template) throw new Error("Template no encontrado");
    if (template.meta_status !== "approved") throw new Error("El template debe estar APPROVED por Meta antes de difundir");
  } else {
    if (!v.freeFormText) throw new Error("Instagram requiere texto del mensaje (free-form dentro de la ventana 24h)");
  }

  // Resolver audiencia (forzando provider para IG)
  const recipients = await resolveAudience(organization.id, v.audience, isIg ? v.channelId : null);
  if (recipients.length === 0) throw new Error("La audiencia resultó vacía");

  // Insertar broadcast (status=queued si scheduledAt en futuro, draft si null=ya)
  const status = v.scheduledAt ? "queued" : "draft";
  const { data: bcast, error } = await admin
    .from("crm_broadcasts")
    .insert({
      organization_id: organization.id,
      channel_id: v.channelId,
      template_id: v.templateId ?? null,
      name: v.name,
      audience: v.audience,
      template_params: { ...v.templateParams, _free_form_text: v.freeFormText ?? null },
      scheduled_at: v.scheduledAt,
      status,
      total_recipients: recipients.length,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !bcast) throw new Error(error?.message ?? "create_failed");

  // Insertar recipients
  const rows = recipients.map((r) => ({
    broadcast_id: bcast.id,
    organization_id: organization.id,
    contact_id: r.contactId ?? null,
    phone: r.phone,
    resolved_params: resolveParams(v.templateParams, r.vars),
    status: "pending" as const,
  }));

  // Insert in batches of 500 to avoid payload limits
  for (let i = 0; i < rows.length; i += 500) {
    await admin.from("crm_broadcast_recipients").insert(rows.slice(i, i + 500));
  }

  revalidatePath("/dashboard/crm/difusiones");
  return { id: bcast.id, recipientsCount: recipients.length };
}

interface ResolvedRecipient {
  phone: string;       // E.164 phone OR IGSID (depende del provider)
  contactId?: string | null;
  vars: Record<string, unknown>;
}

async function resolveAudience(
  organizationId: string,
  audience: z.infer<typeof audienceSchema>,
  igChannelId: string | null,
): Promise<ResolvedRecipient[]> {
  const admin = createAdminClient();

  // Audiencia para IG: contactos con conversación abierta dentro 24h
  if (audience.kind === "crm_contacts") {
    if (!igChannelId) return [];
    const f = audience.filters as { onlyWithin24h?: boolean; onlyOpen?: boolean; tagSlugs?: string[] } | undefined;
    const within24h = new Date(Date.now() - 24 * 3_600_000).toISOString();

    let query = admin
      .from("crm_conversations")
      .select(`
        contact_id,
        last_customer_message_at,
        contact:crm_contacts(id,external_id,external_kind,name,instagram_username),
        tags:crm_conversation_tags(tag_slug:crm_tags(slug))
      `)
      .eq("organization_id", organizationId)
      .eq("channel_id", igChannelId);
    if (f?.onlyOpen !== false) query = query.eq("status", "open");
    if (f?.onlyWithin24h !== false) query = query.gte("last_customer_message_at", within24h);

    const { data } = await query.limit(5000);
    type Row = {
      contact_id: string;
      contact: { id: string; external_id: string; external_kind: string; name: string | null; instagram_username: string | null };
      tags: { tag_slug: { slug: string } | null }[];
    };
    let rows = (data ?? []) as unknown as Row[];

    if (f?.tagSlugs && f.tagSlugs.length > 0) {
      const slugs = f.tagSlugs;
      rows = rows.filter((r) => r.tags.some((t) => t.tag_slug && slugs.includes(t.tag_slug.slug)));
    }

    return rows
      .filter((r) => r.contact?.external_id)
      .map((r) => ({
        phone: r.contact.external_id,
        contactId: r.contact.id,
        vars: { contact_name: r.contact.name, instagram_username: r.contact.instagram_username },
      }));
  }

  if (audience.kind === "phones") {
    const phones = audience.phones.map((p) => normalizePhone(p)).filter(Boolean);
    return phones.map((p) => ({ phone: p, vars: {} }));
  }

  if (audience.kind === "guests") {
    let query = admin
      .from("guests")
      .select("id,full_name,phone,blacklisted,total_bookings")
      .eq("organization_id", organizationId)
      .not("phone", "is", null);

    const f = audience.filters ?? {};
    if (f.blacklisted === false) query = query.eq("blacklisted", false);
    if (typeof f.minStays === "number") query = query.gte("total_bookings", f.minStays);

    const { data: guests } = await query.limit(5000);
    let result: ResolvedRecipient[] = (guests ?? [])
      .filter((g) => !!g.phone)
      .map((g) => ({
        phone: normalizePhone(g.phone as string),
        vars: { guest_name: g.full_name, total_bookings: g.total_bookings },
      }));

    if (f.hasActiveBooking) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: activeBookings } = await admin
        .from("bookings")
        .select("guest_id")
        .eq("organization_id", organizationId)
        .lte("check_in_date", today)
        .gte("check_out_date", today)
        .in("status", ["confirmada", "check_in"]);
      const activeIds = new Set((activeBookings ?? []).map((b) => b.guest_id));
      result = result.filter((_, i) => activeIds.has((guests ?? [])[i].id));
    }

    return result;
  }

  if (audience.kind === "owners") {
    const { data: owners } = await admin
      .from("owners")
      .select("id,full_name,phone")
      .eq("organization_id", organizationId)
      .not("phone", "is", null)
      .limit(5000);
    return (owners ?? [])
      .filter((o) => !!o.phone)
      .map((o) => ({
        phone: normalizePhone(o.phone as string),
        vars: { owner_name: o.full_name },
      }));
  }

  return [];
}

function resolveParams(
  paramTemplates: Record<string, string>,
  vars: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, tpl] of Object.entries(paramTemplates)) {
    out[key] = renderTemplate(tpl, vars);
  }
  return out;
}

export async function startBroadcast(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: bcast } = await admin
    .from("crm_broadcasts")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (!bcast) throw new Error("Broadcast no encontrado");
  if (bcast.status !== "draft" && bcast.status !== "queued") {
    throw new Error("Solo se pueden disparar broadcasts en estado draft o queued");
  }

  await admin
    .from("crm_broadcasts")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", id);

  // Procesamiento asíncrono — disparamos runner para que /api/cron/from-pg
  // procese el outbox y envíe los mensajes
  await processBroadcastBatch(id, 100);

  revalidatePath("/dashboard/crm/difusiones");
  triggerWorkflowRunner();
}

export async function cancelBroadcast(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");
  const admin = createAdminClient();
  await admin
    .from("crm_broadcasts")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.id);
  // Marcar recipients pending como skipped
  await admin
    .from("crm_broadcast_recipients")
    .update({ status: "skipped" })
    .eq("broadcast_id", id)
    .eq("status", "pending");
  revalidatePath("/dashboard/crm/difusiones");
}

export async function deleteBroadcast(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");
  const admin = createAdminClient();
  await admin.from("crm_broadcasts").delete().eq("id", id).eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/difusiones");
}

/**
 * Procesa N recipients pendientes de un broadcast: encola mensajes en outbox
 * (que se enviará via /api/cron/from-pg).
 */
export async function processBroadcastBatch(broadcastId: string, batchSize: number) {
  const admin = createAdminClient();

  const { data: bcast } = await admin
    .from("crm_broadcasts")
    .select("*, template:crm_whatsapp_templates(*), channel:crm_channels(provider)")
    .eq("id", broadcastId)
    .single();

  if (!bcast) return { sent: 0, remaining: 0 };

  type BcastJoin = {
    template: { name: string; language: string; variables_count: number } | null;
    channel: { provider: string };
    template_params: Record<string, unknown>;
  };
  const join = bcast as unknown as BcastJoin;
  const isIg = join.channel?.provider === "meta_instagram";
  const tpl = join.template;
  const freeFormText = (join.template_params as { _free_form_text?: string })?._free_form_text;

  if (!isIg && !tpl) return { sent: 0, remaining: 0 };
  if (isIg && !freeFormText) return { sent: 0, remaining: 0 };

  const { data: pendingRecipients } = await admin
    .from("crm_broadcast_recipients")
    .select("*")
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending")
    .limit(batchSize);

  let sent = 0;
  for (const r of pendingRecipients ?? []) {
    try {
      // Upsert contact según provider
      const externalKind = isIg ? "igsid" : "phone";
      const contactPayload: Record<string, unknown> = {
        organization_id: bcast.organization_id,
        external_id: r.phone,
        external_kind: externalKind,
        contact_kind: "lead",
      };
      if (!isIg) contactPayload.phone = r.phone;

      const { data: contact } = await admin
        .from("crm_contacts")
        .upsert(contactPayload, { onConflict: "organization_id,external_id,external_kind" })
        .select("id")
        .single();
      if (!contact) continue;

      // Upsert conversation (open/reopen)
      const { data: conv } = await admin
        .from("crm_conversations")
        .upsert({
          organization_id: bcast.organization_id,
          contact_id: contact.id,
          channel_id: bcast.channel_id,
          status: "open",
        }, { onConflict: "organization_id,contact_id,channel_id" })
        .select("id")
        .single();
      if (!conv) continue;

      let result;
      if (isIg && freeFormText) {
        const { renderTemplate } = await import("@/lib/crm/render-vars");
        const text = renderTemplate(freeFormText, (r.resolved_params as Record<string, unknown>) ?? {});
        result = await sendMessageNow({
          organizationId: bcast.organization_id,
          conversationId: conv.id,
          contactId: contact.id,
          channelId: bcast.channel_id,
          body: { type: "text", text },
          senderKind: "system",
        });
      } else if (tpl) {
        // Construir parameters de Meta template
        const params = Object.entries(r.resolved_params as Record<string, string>)
          .filter(([k]) => k !== "_free_form_text")
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, value]) => ({ type: "text" as const, text: value }));

        result = await sendMessageNow({
          organizationId: bcast.organization_id,
          conversationId: conv.id,
          contactId: contact.id,
          channelId: bcast.channel_id,
          body: {
            type: "template",
            templateName: tpl.name,
            language: tpl.language,
            components: [{ type: "body", parameters: params }],
          },
          senderKind: "system",
          templateName: tpl.name,
          templateVariables: r.resolved_params as Record<string, unknown>,
        });
      } else {
        continue;
      }

      await admin
        .from("crm_broadcast_recipients")
        .update({
          status: "sent",
          message_id: result.messageId,
          contact_id: contact.id,
          sent_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      sent += 1;
    } catch (err) {
      await admin
        .from("crm_broadcast_recipients")
        .update({ status: "failed", error: err instanceof Error ? err.message : String(err) })
        .eq("id", r.id);
    }
  }

  // Update counters en el broadcast (RPC no creado en la migración → manual)
  await refreshBroadcastCountersManual(broadcastId);

  // Si no quedan pendientes, marcar como completado
  const { count: remainingPending } = await admin
    .from("crm_broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending");

  if ((remainingPending ?? 0) === 0) {
    const { count: failed } = await admin
      .from("crm_broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId)
      .eq("status", "failed");
    const finalStatus = (failed ?? 0) > 0 ? "partial" : "sent";
    await admin
      .from("crm_broadcasts")
      .update({ status: finalStatus, finished_at: new Date().toISOString() })
      .eq("id", broadcastId);
  }

  return { sent, remaining: remainingPending ?? 0 };
}

async function refreshBroadcastCountersManual(broadcastId: string) {
  const admin = createAdminClient();
  const counts = await Promise.all(
    (["sent", "delivered", "read", "failed"] as const).map(async (status) => {
      const { count } = await admin
        .from("crm_broadcast_recipients")
        .select("id", { count: "exact", head: true })
        .eq("broadcast_id", broadcastId)
        .eq("status", status);
      return [status, count ?? 0] as const;
    }),
  );
  const update: Record<string, number> = {};
  for (const [status, count] of counts) {
    update[`${status}_count`] = count;
  }
  await admin.from("crm_broadcasts").update(update).eq("id", broadcastId);
}
