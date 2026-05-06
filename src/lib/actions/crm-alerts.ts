"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import type { Notification } from "@/lib/types/database";

const CRM_REF_TYPES = ["crm_conversation", "crm_broadcast", "crm_workflow", "crm_workflow_run"];

export async function listCrmAlerts(filter: "active" | "unread" | "all" = "active"): Promise<Notification[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  let query = admin
    .from("notifications")
    .select("*")
    .eq("organization_id", organization.id)
    .or(`ref_type.in.(${CRM_REF_TYPES.join(",")}),and(type.eq.manual,action_url.like./dashboard/crm%)`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (filter === "active") query = query.is("dismissed_at", null);
  if (filter === "unread") query = query.is("read_at", null).is("dismissed_at", null);

  const { data } = await query;
  return (data ?? []) as Notification[];
}

export async function markCrmAlertRead(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .is("read_at", null);
  revalidatePath("/dashboard/crm/alertas");
}

export async function dismissCrmAlert(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  await admin
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/alertas");
}

export async function markAllCrmAlertsRead() {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", organization.id)
    .in("ref_type", CRM_REF_TYPES)
    .is("read_at", null);
  revalidatePath("/dashboard/crm/alertas");
}
