"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { UNIT_REF_SELECT } from "@/lib/constants";
import { isAdminLevel } from "@/lib/permissions";
import {
  DEFAULT_ORG_TIMEZONE,
  dayRangeInTz,
  todayYmdInTz,
  zonedTimeToUtc,
} from "@/lib/dates";
import type { CleaningEvent, CleaningStatus, CleaningTask } from "@/lib/types/database";

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
  /** Si es `true`, devuelve sólo las tareas ya archivadas por el reset semanal. Default: sólo activas. */
  showArchived?: boolean;
}) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("cleaning_tasks")
    .select(`*, unit:units(${UNIT_REF_SELECT})`)
    .eq("organization_id", organization.id);
  if (filters?.showArchived) {
    q = q.not("archived_at", "is", null);
  } else {
    q = q.is("archived_at", null);
  }
  if (filters?.status) q = q.eq("status", filters.status);
  // Visibilidad por fila: admin/recepción ven todo (respetando el filtro
  // opcional assignedTo); el resto (limpieza) solo ve sus tareas asignadas.
  const effectiveAssignedTo = isAdminLevel(role) ? filters?.assignedTo : session.userId;
  if (effectiveAssignedTo) q = q.eq("assigned_to", effectiveAssignedTo);
  if (filters?.upcoming) {
    // Inicio del día en la tz de la org — NO la del server (Vercel corre en UTC;
    // su medianoche son las 21:00 del día anterior en Argentina).
    const { startIso } = dayRangeInTz(todayYmdInTz(DEFAULT_ORG_TIMEZONE));
    q = q.gte("scheduled_for", startIso).in("status", ["pendiente", "en_progreso"]);
  }
  const { data, error } = filters?.showArchived
    ? await q.order("archived_at", { ascending: false })
    : await q.order("scheduled_for");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Idempotente: por cada booking con check_out_date = `date` que aún no tenga
 * una cleaning_task agendada para esa fecha, la crea en estado "pendiente".
 *
 * `date` es el día LOCAL de la org (YYYY-MM-DD). El `scheduled_for` insertado
 * es un timestamptz real: la hora de check-out del booking en la timezone de
 * la org (no medianoche UTC — eso corría la tarea al día anterior en el
 * tablero, que fue el bug de "limpiezas del 3/07 apareciendo el día 2").
 *
 * No requiere session (se llama desde crons). El caller debe encargarse de la
 * autorización (CRON_SECRET o requireSession + permission check).
 *
 * Devuelve la lista de tasks creadas para que el caller pueda emitir
 * notificaciones / eventos CRM con metadata (unit_id, booking_id).
 */
export async function ensureCleaningTasksForCheckouts(
  organizationId: string,
  date: string,
  actorId: string | null = null,
  timezone: string = DEFAULT_ORG_TIMEZONE,
): Promise<
  Array<{
    cleaning_task_id: string;
    unit_id: string;
    booking_out_id: string;
  }>
> {
  const admin = createAdminClient();

  const { data: outs } = await admin
    .from("bookings")
    .select("id, unit_id, check_out_time")
    .eq("organization_id", organizationId)
    .eq("check_out_date", date)
    .eq("is_block", false) // los bloqueos OTA no generan limpieza
    .in("status", ["confirmada", "check_in", "check_out"]);

  const outBookings = (outs ?? []) as Array<{
    id: string;
    unit_id: string;
    check_out_time: string | null;
  }>;
  if (outBookings.length === 0) return [];

  // Idempotencia doble:
  //  - sameDay: ya hay una limpieza ACTIVA/hecha ese día local para la unidad
  //    (rango, no eq — los timestamps reales nunca matchean una medianoche
  //    exacta). Las canceladas NO cuentan: si se cancela una reserva y la
  //    unidad se revende para la misma noche, el booking nuevo necesita su task.
  //  - sameBooking: ese booking ya tiene task (cualquier estado, incluso
  //    cancelada — si el staff la canceló a mano no la resucitamos; también
  //    cubre la task del trigger de check-out aunque haya quedado en otro día).
  const { startIso, endIso } = dayRangeInTz(date, timezone);
  const bookingIds = outBookings.map((b) => b.id);
  const [{ data: sameDay }, { data: sameBooking }] = await Promise.all([
    admin
      .from("cleaning_tasks")
      .select("unit_id")
      .eq("organization_id", organizationId)
      .gte("scheduled_for", startIso)
      .lt("scheduled_for", endIso)
      .neq("status", "cancelada")
      .is("archived_at", null),
    admin
      .from("cleaning_tasks")
      .select("booking_out_id")
      .eq("organization_id", organizationId)
      .in("booking_out_id", bookingIds),
  ]);
  const coveredUnitIds = new Set(
    (sameDay ?? []).map((r) => (r as { unit_id: string }).unit_id),
  );
  const coveredBookingIds = new Set(
    (sameBooking ?? []).map((r) => (r as { booking_out_id: string }).booking_out_id),
  );

  // Acumular las filas de cleaning_tasks a insertar (saltando las que ya existen
  // → idempotencia) y hacer UN insert batch. Se itera por booking (no por
  // unidad) para que un booking viejo ya limpiado no tape al checkout real
  // del día cuando ambos comparten unidad.
  const checklist = DEFAULT_CHECKLIST.map((item) => ({ item, done: false }));
  const taskRows: Array<{
    organization_id: string;
    unit_id: string;
    booking_out_id: string;
    scheduled_for: string;
    status: "pendiente";
    checklist: { item: string; done: boolean }[];
  }> = [];
  for (const booking of outBookings) {
    if (coveredBookingIds.has(booking.id)) continue;
    if (coveredUnitIds.has(booking.unit_id)) continue;
    coveredUnitIds.add(booking.unit_id); // 1 task por unidad por día
    taskRows.push({
      organization_id: organizationId,
      unit_id: booking.unit_id,
      booking_out_id: booking.id,
      // La limpieza arranca cuando el huésped se va: hora de check-out local.
      scheduled_for: zonedTimeToUtc(
        date,
        booking.check_out_time ?? "11:00",
        timezone,
      ).toISOString(),
      status: "pendiente",
      checklist,
    });
  }

  const created: Array<{
    cleaning_task_id: string;
    unit_id: string;
    booking_out_id: string;
  }> = [];

  if (taskRows.length === 0) return created;

  const { data: insTasks, error: tasksErr } = await admin
    .from("cleaning_tasks")
    .insert(taskRows)
    .select("id, unit_id, booking_out_id");
  if (tasksErr || !insTasks) {
    console.warn(
      "[cleaning/ensureCleaningTasksForCheckouts] insert falló",
      tasksErr?.message,
    );
    return created;
  }

  // Aparear cada task creada con su booking_out_id (único por unidad en este loop)
  // y construir el array de cleaning_events para UN insert batch.
  const eventRows = (insTasks as Array<{
    id: string;
    unit_id: string;
    booking_out_id: string;
  }>).map((t) => ({
    cleaning_task_id: t.id,
    organization_id: organizationId,
    actor_id: actorId,
    event_type: "created" as const,
    to_status: "pendiente" as const,
    metadata: { source: "checkout_tomorrow_auto", booking_out_id: t.booking_out_id },
  }));

  await admin.from("cleaning_events").insert(eventRows);

  for (const t of insTasks as Array<{
    id: string;
    unit_id: string;
    booking_out_id: string;
  }>) {
    created.push({
      cleaning_task_id: t.id,
      unit_id: t.unit_id,
      booking_out_id: t.booking_out_id,
    });
  }

  if (created.length > 0) {
    revalidatePath("/dashboard/limpieza");
    revalidatePath("/dashboard/parte-diario");
  }

  return created;
}

export async function createCleaningTask(input: CleaningInput) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = cleaningSchema.parse(input);
  // scheduled_for es timestamptz: un string date-only caería a medianoche UTC
  // (= 21:00 del día anterior en Argentina y la task aparece el día equivocado).
  // Normalizamos a las 11:00 locales de ese día.
  if (/^\d{4}-\d{2}-\d{2}$/.test(validated.scheduled_for)) {
    validated.scheduled_for = zonedTimeToUtc(
      validated.scheduled_for,
      "11:00",
      DEFAULT_ORG_TIMEZONE,
    ).toISOString();
  }
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

  await admin.from("cleaning_events").insert({
    cleaning_task_id: (data as CleaningTask).id,
    organization_id: organization.id,
    actor_id: session.userId,
    event_type: "created",
    to_status: validated.status,
    metadata: { scheduled_for: validated.scheduled_for },
  });

  revalidatePath("/dashboard/limpieza");

  try {
    const { publishCrmEvent } = await import("@/lib/crm/events");
    await publishCrmEvent({
      organizationId: organization.id,
      eventType: "cleaning.assigned",
      payload: { cleaning_task_id: (data as CleaningTask).id, unit_id: validated.unit_id, scheduled_for: validated.scheduled_for },
      refType: "cleaning",
      refId: (data as CleaningTask).id,
    });
  } catch (e) {
    console.warn("[cleaning/createCleaningTask] crm publish failed", e);
  }

  return data as CleaningTask;
}

export async function changeCleaningStatus(id: string, status: CleaningStatus) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: prev } = await admin
    .from("cleaning_tasks")
    .select("status, unit_id")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  const update: Record<string, unknown> = { status };
  if (status === "verificada") update.verified_by = session.userId;
  const { error } = await admin
    .from("cleaning_tasks")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  if (prev && prev.status !== status) {
    await admin.from("cleaning_events").insert({
      cleaning_task_id: id,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "status_changed",
      from_status: prev.status,
      to_status: status,
      metadata: { source: "kanban_or_chip" },
    });
  }

  // Si la task pasa a un estado terminal, intentar liberar la unidad.
  if (status === "completada" || status === "verificada" || status === "cancelada") {
    if (prev?.unit_id) {
      await releaseUnitIfNoActiveCleaning(prev.unit_id, organization.id, id);
    }
  }

  revalidatePath("/dashboard/limpieza");
  revalidatePath("/m/limpieza");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades");

  if (status === "completada" || status === "verificada") {
    try {
      const { publishCrmEvent } = await import("@/lib/crm/events");
      await publishCrmEvent({
        organizationId: organization.id,
        eventType: "cleaning.completed",
        payload: { cleaning_task_id: id, unit_id: prev?.unit_id, status },
        refType: "cleaning",
        refId: id,
      });
    } catch (e) {
      console.warn("[cleaning/changeCleaningStatus] crm publish failed", e);
    }
  }
}

export async function assignCleaning(id: string, userId: string | null) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("cleaning_tasks")
    .update({ assigned_to: userId })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  await admin.from("cleaning_events").insert({
    cleaning_task_id: id,
    organization_id: organization.id,
    actor_id: session.userId,
    event_type: "assigned",
    metadata: { assigned_to: userId },
  });

  revalidatePath("/dashboard/limpieza");
}

export async function updateCleaningChecklist(id: string, checklist: { item: string; done: boolean; note?: string }[]) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("cleaning_tasks")
    .update({ checklist })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  const done = checklist.filter((c) => c.done).length;
  await admin.from("cleaning_events").insert({
    cleaning_task_id: id,
    organization_id: organization.id,
    actor_id: session.userId,
    event_type: "checklist_updated",
    metadata: { done, total: checklist.length },
  });

  revalidatePath("/dashboard/limpieza");
  revalidatePath("/m/limpieza");
}

export async function updateCleaningTask(id: string, input: Partial<CleaningInput>) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: prev } = await admin
    .from("cleaning_tasks")
    .select("status")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  const { data, error } = await admin
    .from("cleaning_tasks")
    .update(input)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  const newStatus = input.status;
  if (prev && newStatus && prev.status !== newStatus) {
    await admin.from("cleaning_events").insert({
      cleaning_task_id: id,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "status_changed",
      from_status: prev.status,
      to_status: newStatus,
      metadata: { source: "edit_form" },
    });
  } else {
    await admin.from("cleaning_events").insert({
      cleaning_task_id: id,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "updated",
      metadata: { source: "edit_form" },
    });
  }

  revalidatePath("/dashboard/limpieza");
  return data as CleaningTask;
}

export async function listCleaningEvents(taskId: string): Promise<
  (CleaningEvent & { actor: { full_name: string | null } | null })[]
> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const admin = createAdminClient();
  // Visibilidad por fila: limpieza solo ve el historial de sus tareas.
  if (!isAdminLevel(role)) {
    const { data: owner } = await admin
      .from("cleaning_tasks")
      .select("assigned_to")
      .eq("id", taskId)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (!owner || owner.assigned_to !== session.userId) return [];
  }
  const { data, error } = await admin
    .from("cleaning_events")
    .select("*")
    .eq("cleaning_task_id", taskId)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const events = (data ?? []) as CleaningEvent[];

  const actorIds = Array.from(
    new Set(events.map((e) => e.actor_id).filter((v): v is string => !!v))
  );
  let byId = new Map<string, { full_name: string | null }>();
  if (actorIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", actorIds);
    byId = new Map(
      (profiles ?? []).map((p) => [
        p.user_id as string,
        { full_name: (p.full_name as string | null) ?? null },
      ])
    );
  }

  return events.map((e) => ({
    ...e,
    actor: e.actor_id ? byId.get(e.actor_id) ?? { full_name: null } : null,
  }));
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
