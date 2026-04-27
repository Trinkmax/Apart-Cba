"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { ConciergeRequest, ConciergeStatus } from "@/lib/types/database";

const conciergeSchema = z.object({
  unit_id: z.string().uuid().optional().nullable(),
  booking_id: z.string().uuid().optional().nullable(),
  guest_id: z.string().uuid().optional().nullable(),
  request_type: z.string().optional().nullable(),
  description: z.string().min(2, "Descripción requerida"),
  status: z.enum(["pendiente", "en_progreso", "completada", "rechazada", "cancelada"]).default("pendiente"),
  priority: z.enum(["baja", "normal", "alta", "urgente"]).default("normal"),
  cost: z.coerce.number().min(0).optional().nullable(),
  cost_currency: z.string().default("ARS"),
  charge_to_guest: z.boolean().default(false),
  scheduled_for: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type ConciergeInput = z.infer<typeof conciergeSchema>;

export async function listConciergeRequests(filters?: { status?: ConciergeStatus }) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("concierge_requests")
    .select(`*, unit:units(id, code, name), guest:guests(id, full_name)`)
    .eq("organization_id", organization.id);
  if (filters?.status) q = q.eq("status", filters.status);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createConciergeRequest(input: ConciergeInput) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = conciergeSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("concierge_requests")
    .insert({
      ...validated,
      organization_id: organization.id,
      created_by: session.userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/conserjeria");
  return data as ConciergeRequest;
}

export async function changeConciergeStatus(id: string, status: ConciergeStatus) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const update: Record<string, unknown> = { status };
  if (status === "completada") update.completed_at = new Date().toISOString();
  const { error } = await admin
    .from("concierge_requests")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/conserjeria");
}

export async function updateConciergeRequest(id: string, input: Partial<ConciergeInput>) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("concierge_requests")
    .update(input)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/conserjeria");
  return data as ConciergeRequest;
}

export async function deleteConciergeRequest(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("concierge_requests")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/conserjeria");
}
