"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import type { CrmTag } from "@/lib/types/database";

export async function listTags(): Promise<CrmTag[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_tags")
    .select("*")
    .eq("organization_id", organization.id)
    .order("display_order", { ascending: true });
  return (data ?? []) as CrmTag[];
}

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().max(200).optional(),
});

export async function upsertTag(input: z.infer<typeof upsertSchema>) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const v = upsertSchema.parse(input);
  const admin = createAdminClient();

  if (v.id) {
    await admin
      .from("crm_tags")
      .update({ name: v.name, color: v.color, description: v.description })
      .eq("id", v.id)
      .eq("organization_id", organization.id);
  } else {
    const slug = v.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await admin.from("crm_tags").insert({
      organization_id: organization.id,
      slug,
      name: v.name,
      color: v.color,
      description: v.description,
      is_system: false,
    });
  }

  revalidatePath("/dashboard/crm");
}

export async function deleteTag(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "delete")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: tag } = await admin
    .from("crm_tags")
    .select("is_system")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (tag?.is_system) throw new Error("No se pueden borrar tags del sistema");

  await admin.from("crm_tags").delete().eq("id", id).eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm");
}

export async function addTagToConversation(conversationId: string, tagId: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  // Validar pertenencia
  const { data: tag } = await admin
    .from("crm_tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", organization.id)
    .single();
  if (!tag) throw new Error("Tag inválida");

  await admin.from("crm_conversation_tags").upsert({
    conversation_id: conversationId,
    tag_id: tagId,
    added_via: "manual",
    added_by: session.userId,
  }, { onConflict: "conversation_id,tag_id" });

  revalidatePath("/dashboard/crm/inbox");
}

export async function removeTagFromConversation(conversationId: string, tagId: string) {
  await requireSession();
  await getCurrentOrg();
  const admin = createAdminClient();
  await admin
    .from("crm_conversation_tags")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("tag_id", tagId);
  revalidatePath("/dashboard/crm/inbox");
}
