"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { CleaningTask, CleaningStatus } from "@/lib/types/database";

const cleaningSchema = z.object({
  unit_id: z.string().uuid(),
  scheduled_for: z.string(),
  assigned_to: z.string().uuid().optional().nullable(),
  status: z.enum(["pendiente", "en_progreso", "completada", "verificada", "cancelada"]).default("pendiente"),
  checklist: z.array(z.object({ item: z.string(), done: z.boolean(), note: z.string().optional() })).default([]),
  cost: z.coerce.number().min(0).optional().nullable(),
  cost_currency: z.string().default("ARS"),
  notes: z.string().optional().nullable(),
});

export type CleaningInput = z.infer<typeof cleaningSchema>;

const DEFAULT_CHECKLIST = [
  "Cocina (vajilla, electrodomésticos)",
  "Baño (sanitarios, ducha, espejos)",
  "Dormitorios (cambio de sábanas)",
  "Living / comedor",
  "Pisos (aspirar / trapear)",
  "Toallas y blanquería",
  "Reposición amenities (papel, jabón, café)",
  "Ventilación / olores",
  "Verificación de inventario",
];

export async function listCleaningTasks(filters?: {
  status?: CleaningStatus;
  assignedTo?: string;
  upcoming?: boolean;
}) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("cleaning_tasks")
    .select(`*, unit:units(id, code, name)`)
    .eq("organization_id", organization.id);
  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
  if (filters?.upcoming) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    q = q.gte("scheduled_for", todayStart.toISOString()).in("status", ["pendiente", "en_progreso"]);
  }
  const { data, error } = await q.order("scheduled_for");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCleaningTask(input: CleaningInput) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = cleaningSchema.parse(input);
  const checklist = validated.checklist.length > 0
    ? validated.checklist
    : DEFAULT_CHECKLIST.map((item) => ({ item, done: false }));
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cleaning_tasks")
    .insert({ ...validated, checklist, organization_id: organization.id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/limpieza");
  return data as CleaningTask;
}

export async function changeCleaningStatus(id: string, status: CleaningStatus) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const update: Record<string, unknown> = { status };
  if (status === "verificada") update.verified_by = session.userId;
  const { error } = await admin
    .from("cleaning_tasks")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/limpieza");
  revalidatePath("/m/limpieza");
}

export async function assignCleaning(id: string, userId: string | null) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("cleaning_tasks")
    .update({ assigned_to: userId })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/limpieza");
}

export async function updateCleaningChecklist(id: string, checklist: { item: string; done: boolean; note?: string }[]) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("cleaning_tasks")
    .update({ checklist })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/limpieza");
  revalidatePath("/m/limpieza");
}
