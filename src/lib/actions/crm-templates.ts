"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { getProviderForChannel } from "@/lib/crm/providers/factory";
import { extractVariables } from "@/lib/crm/render-vars";
import type { CrmWhatsAppTemplate, CrmTemplateButton } from "@/lib/types/database";

export async function listTemplates(): Promise<CrmWhatsAppTemplate[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_whatsapp_templates")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  return (data ?? []) as CrmWhatsAppTemplate[];
}

const createSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().regex(/^[a-z0-9_]{1,512}$/, "snake_case lowercase only"),
  language: z.string().default("es_AR"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  bodyText: z.string().min(1).max(1024),
  bodyExample: z.array(z.array(z.string())).optional(),
  headerType: z.enum(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).default("NONE"),
  headerText: z.string().max(60).optional(),
  headerMediaUrl: z.string().url().optional(),
  footer: z.string().max(60).optional(),
  buttons: z.array(z.object({
    type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
    text: z.string().max(25),
    url: z.string().url().optional(),
    phone_number: z.string().optional(),
  })).max(10).optional(),
});

export async function createTemplate(input: z.infer<typeof createSchema>): Promise<{ id: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const v = createSchema.parse(input);
  const admin = createAdminClient();
  const variablesCount = extractVariables(v.bodyText).filter((x) => /^\d+$/.test(x)).length;

  const { data, error } = await admin
    .from("crm_whatsapp_templates")
    .insert({
      organization_id: organization.id,
      channel_id: v.channelId,
      name: v.name,
      language: v.language,
      category: v.category,
      header_type: v.headerType,
      header_text: v.headerText,
      header_media_url: v.headerMediaUrl,
      body: v.bodyText,
      body_example: v.bodyExample ? { body_text: v.bodyExample } : null,
      footer: v.footer,
      buttons: v.buttons as CrmTemplateButton[] | null,
      variables_count: variablesCount,
      meta_status: "draft",
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "create_failed");

  revalidatePath("/dashboard/crm/config");
  return { id: data.id };
}

export async function submitTemplate(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: tpl } = await admin
    .from("crm_whatsapp_templates")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (!tpl) throw new Error("Template no encontrado");

  const provider = await getProviderForChannel(tpl.channel_id);
  const result = await provider.submitTemplate({
    name: tpl.name,
    language: tpl.language,
    category: tpl.category,
    bodyText: tpl.body,
    bodyExample: (tpl.body_example as { body_text: string[][] } | null)?.body_text,
    headerType: tpl.header_type ?? "NONE",
    headerText: tpl.header_text ?? undefined,
    headerMediaUrl: tpl.header_media_url ?? undefined,
    footer: tpl.footer ?? undefined,
    buttons: tpl.buttons as CrmTemplateButton[] | undefined,
  });

  await admin
    .from("crm_whatsapp_templates")
    .update({
      meta_template_id: result.metaTemplateId,
      meta_status: result.status.toLowerCase() === "approved" ? "approved" : "pending",
      submitted_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/dashboard/crm/config");
}

export async function refreshTemplateStatus(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: tpl } = await admin
    .from("crm_whatsapp_templates")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (!tpl?.meta_template_id) throw new Error("Template aún no enviado");

  const provider = await getProviderForChannel(tpl.channel_id);
  const status = await provider.getTemplateStatus(tpl.meta_template_id);

  const newStatus = status.status.toLowerCase();
  const update: Record<string, unknown> = {
    meta_status: newStatus,
    last_polled_at: new Date().toISOString(),
  };
  if (newStatus === "approved") update.approved_at = new Date().toISOString();
  if (newStatus === "rejected") update.meta_rejection_reason = status.rejectionReason;

  await admin.from("crm_whatsapp_templates").update(update).eq("id", id);
  revalidatePath("/dashboard/crm/config");
}

export async function deleteTemplate(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");
  const admin = createAdminClient();
  await admin.from("crm_whatsapp_templates").delete().eq("id", id).eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/config");
}
