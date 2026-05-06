"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { extractVariables } from "@/lib/crm/render-vars";
import type { CrmQuickReply, UserRole } from "@/lib/types/database";

export async function listQuickReplies(): Promise<CrmQuickReply[]> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_rapidos", "view")) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_quick_replies")
    .select("*")
    .eq("organization_id", organization.id)
    .order("usage_count", { ascending: false });

  return ((data ?? []) as CrmQuickReply[]).filter((r) => r.visible_to_roles.includes(role));
}

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  shortcut: z.string().regex(/^[a-z0-9_-]+$/i, "Solo letras, números, guiones").min(1).max(40),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(2000),
  visibleToRoles: z.array(z.enum(["admin", "recepcion", "mantenimiento", "limpieza", "owner_view"])).min(1),
});

export async function upsertQuickReply(input: z.infer<typeof upsertSchema>) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_rapidos", "create")) throw new Error("Sin permisos");

  const v = upsertSchema.parse(input);
  const admin = createAdminClient();
  const variables = extractVariables(v.body);

  if (v.id) {
    await admin
      .from("crm_quick_replies")
      .update({
        shortcut: v.shortcut.toLowerCase(),
        title: v.title,
        body: v.body,
        variables,
        visible_to_roles: v.visibleToRoles as UserRole[],
      })
      .eq("id", v.id)
      .eq("organization_id", organization.id);
  } else {
    await admin.from("crm_quick_replies").insert({
      organization_id: organization.id,
      shortcut: v.shortcut.toLowerCase(),
      title: v.title,
      body: v.body,
      variables,
      visible_to_roles: v.visibleToRoles as UserRole[],
      created_by: session.userId,
    });
  }

  revalidatePath("/dashboard/crm/rapidos");
  revalidatePath("/dashboard/crm/inbox");
}

export async function deleteQuickReply(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "crm_rapidos", "delete")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin.from("crm_quick_replies").delete().eq("id", id).eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/rapidos");
}

export async function bumpQuickReplyUsage(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin.rpc("crm_increment_quick_reply_usage", { p_id: id, p_org: organization.id });
  if (error) {
    // RPC no existe aún (no la creamos en migración) — incrementar manual best-effort
    const { data: row } = await admin
      .from("crm_quick_replies")
      .select("usage_count")
      .eq("id", id)
      .single();
    if (row) {
      await admin
        .from("crm_quick_replies")
        .update({ usage_count: row.usage_count + 1 })
        .eq("id", id);
    }
  }
}
