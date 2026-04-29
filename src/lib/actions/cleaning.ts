"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { CleaningTask, CleaningStatus } from "@/lib/types/database";

// Cuando una cleaning task se completa/verifica/cancela/borra, si la unidad
// estaba en status='limpieza' y ya no le quedan tasks pendientes/en_progreso,
// la liberamos a 'disponible'. Esto evita el bug de "unidad bloqueada en el
// calendario aunque ya no haya tarea de limpieza".
async function releaseUnitIfNoActiveCleaning(
  unitId: string,
  organizationId: string,
  excludeTaskId?: string
): Promise<void> {
  const admin = createAdminClient();

  // ¿La unidad está en status='limpieza'?
  const { data: unit } = await admin
    .from("units")
    .select("id, status")
    .eq("id", unitId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!unit || unit.status !== "limpieza") return;

  // ¿Quedan tasks pendientes/en_progreso para esa unidad?
  let q = admin
    .from("cleaning_tasks")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", unitId)
    .eq("organization_id", organizationId)
    .in("status", ["pendiente", "en_progreso"]);
  if (excludeTaskId) q = q.neq("id", excludeTaskId);
  const { count } = await q;
  if ((count ?? 0) > 0) return;

  // Sin tasks activas → liberar unidad a 'disponible'.
  await admin
    .from("units")
    .update({ status: "disponible" })
    .eq("id", unitId)
    .eq("organization_id", organizationId);

  // El status_history queda registrado por el trigger tg_units_status_history.
  // Marcamos la razón a posteriori si es posible.
  await admin
    .from("unit_status_history")
    .update({ reason: "Auto: cleaning task finalizada/borrada" })
    .eq("unit_id", unitId)
    .order("created_at", { ascending: false })
    .limit(1);
}

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

  // Si la task pasa a un estado terminal, intentar liberar la unidad.
  if (status === "completada" || status === "verificada" || status === "cancelada") {
    const { data: task } = await admin
      .from("cleaning_tasks")
      .select("unit_id")
      .eq("id", id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (task?.unit_id) {
      await releaseUnitIfNoActiveCleaning(task.unit_id, organization.id, id);
    }
  }

  revalidatePath("/dashboard/limpieza");
  revalidatePath("/m/limpieza");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades");
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

export async function updateCleaningTask(id: string, input: Partial<CleaningInput>) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cleaning_tasks")
    .update(input)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/limpieza");
  return data as CleaningTask;
}

export async function deleteCleaningTask(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  // Capturar unit_id antes de borrar para poder liberar la unidad.
  const { data: task } = await admin
    .from("cleaning_tasks")
    .select("unit_id")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  const { error } = await admin
    .from("cleaning_tasks")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  if (task?.unit_id) {
    await releaseUnitIfNoActiveCleaning(task.unit_id, organization.id, id);
  }

  revalidatePath("/dashboard/limpieza");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades");
}
