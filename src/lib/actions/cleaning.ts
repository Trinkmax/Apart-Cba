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
  addDaysYmd,
  dayRangeInTz,
  todayYmdInTz,
  ymdInTz,
  zonedTimeToUtc,
} from "@/lib/dates";
import { DEFAULT_CHECKLIST } from "@/lib/cleaning/default-checklist";
import {
  CHECKOUT_BOOKING_STATUSES,
  CLEANING_OVERDUE_DAYS,
  computeCleanlinessByUnit,
  computeUnitCleanliness,
  isStayContinuation,
  taskCoversCheckout,
  uncoveredCheckouts,
  type CleanlinessStay,
  type CleanlinessTask,
  type UnitCleanliness,
} from "@/lib/cleaning/cleanliness";
import type {
  CleaningEvent,
  CleaningStatus,
  CleaningTask,
  UnitStatus,
} from "@/lib/types/database";

/**
 * El motivo va a la fila que acaba de crear el trigger, y sólo a esa: con
 * `.order().limit()` el UPDATE de PostgREST pisaba el motivo de TODO el historial
 * de la unidad.
 */
async function setLatestStatusReason(unitId: string, reason: string): Promise<void> {
  const admin = createAdminClient();
  const { data: latest } = await admin
    .from("unit_status_history")
    .select("id")
    .eq("unit_id", unitId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return;
  await admin.from("unit_status_history").update({ reason }).eq("id", latest.id);
}

// Cuando una cleaning task se completa/verifica/cancela/borra, si la unidad
// estaba en status='limpieza' y ya no le quedan tareas por hacer, la liberamos.
// Esto evita el bug de "unidad bloqueada en el calendario aunque ya no haya
// tarea de limpieza".
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

  const { data: org } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();
  const tz = (org?.timezone as string | null) || DEFAULT_ORG_TIMEZONE;

  // ¿Quedan tareas PARA HOY (o atrasadas)? Las agendadas para más adelante no
  // cuentan: una unidad que se limpió hoy quedaba rayada para siempre porque
  // el próximo check-out ya tenía su limpieza creada. Le pasó a Habitana Firpo
  // el 07/09/2026: limpiaron y el departamento seguía "en limpieza" por una
  // tarea del día siguiente.
  const finDeHoy = dayRangeInTz(todayYmdInTz(tz), tz).endIso;
  let q = admin
    .from("cleaning_tasks")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", unitId)
    .eq("organization_id", organizationId)
    .in("status", ["pendiente", "en_progreso"])
    .lt("scheduled_for", finDeHoy);
  if (excludeTaskId) q = q.neq("id", excludeTaskId);
  const { count } = await q;
  if ((count ?? 0) > 0) return;

  // ¿Hay alguien adentro? El estado describe el AHORA: si otra reserva está en
  // check_in, la unidad quedó ocupada, no libre (misma regla que el trigger de
  // la migración 061). Sólo cuenta una estadía que cubre HOY: un check_in
  // viejo que nadie cerró (Habitana no marca salidas) dejaba la unidad
  // "ocupada" para siempre — migración 065.
  const hoy = todayYmdInTz(tz);
  const { count: conHuesped } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", unitId)
    .eq("organization_id", organizationId)
    .eq("status", "check_in")
    .eq("is_block", false)
    .lte("check_in_date", hoy)
    .gt("check_out_date", hoy);

  await admin
    .from("units")
    .update({ status: (conHuesped ?? 0) > 0 ? "ocupado" : "disponible" })
    .eq("id", unitId)
    .eq("organization_id", organizationId);

  // El status_history queda registrado por el trigger tg_units_status_history.
  // Marcamos la razón a posteriori si es posible.
  await setLatestStatusReason(unitId, "Auto: cleaning task finalizada/borrada");
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
  booking_out_id: z.string().uuid().optional().nullable(),
});

export type CleaningInput = z.infer<typeof cleaningSchema>;

/**
 * Plantilla de checklist de la organización, o la lista por defecto si todavía
 * no la editaron. Cada limpieza guarda SU copia: cambiar la plantilla no
 * reescribe las que ya se hicieron.
 */
async function checklistForOrg(
  organizationId: string,
): Promise<{ item: string; done: boolean }[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("cleaning_checklist")
    .eq("id", organizationId)
    .maybeSingle();
  const items = (data?.cleaning_checklist as string[] | null) ?? [];
  const base = items.length > 0 ? items : DEFAULT_CHECKLIST;
  return base.map((item) => ({ item, done: false }));
}

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
    .select("id, unit_id, check_out_date, check_out_time, guest_id, lease_group_id")
    .eq("organization_id", organizationId)
    .eq("check_out_date", date)
    .eq("is_block", false) // los bloqueos OTA no generan limpieza
    .in("status", [...CHECKOUT_BOOKING_STATUSES]);

  const allOuts = (outs ?? []) as Array<{
    id: string;
    unit_id: string;
    check_out_date: string;
    check_out_time: string | null;
    guest_id: string | null;
    lease_group_id: string | null;
  }>;
  if (allOuts.length === 0) return [];

  // Renovaciones y tramos de un alquiler mensual: el mismo huésped sigue en la
  // unidad, así que no hay salida ni nada que limpiar. Si el ticket ya se había
  // creado (renovó después), se saca: si la renovación se cae, esta misma función
  // lo vuelve a crear; una cancelación, en cambio, no se resucitaría.
  const { data: nexts } = await admin
    .from("bookings")
    .select("id, unit_id, check_in_date, guest_id, lease_group_id")
    .eq("organization_id", organizationId)
    .eq("check_in_date", date)
    .eq("is_block", false)
    .in("status", [...CHECKOUT_BOOKING_STATUSES]);
  const nextStays = (nexts ?? []) as Array<{
    id: string;
    unit_id: string;
    check_in_date: string;
    guest_id: string | null;
    lease_group_id: string | null;
  }>;
  const continuingIds = allOuts
    .filter((out) => nextStays.some((next) => isStayContinuation(out, next)))
    .map((out) => out.id);
  if (continuingIds.length > 0) {
    await admin
      .from("cleaning_tasks")
      .delete()
      .eq("organization_id", organizationId)
      .in("booking_out_id", continuingIds)
      .eq("status", "pendiente");
  }
  const outBookings = allOuts.filter((out) => !continuingIds.includes(out.id));
  if (outBookings.length === 0) return [];

  // Idempotencia doble:
  //  - sameDay: ya hay una limpieza ACTIVA/hecha ese día local para la unidad
  //    (rango, no eq — los timestamps reales nunca matchean una medianoche
  //    exacta). Las canceladas NO cuentan: si se cancela una reserva y la
  //    unidad se revende para la misma noche, el booking nuevo necesita su task.
  //  - sameBooking: ese booking ya tiene una task que resuelve ESTA salida
  //    (taskCoversCheckout). Una cancelada no se resucita, pero una cerrada para
  //    una fecha anterior no cuenta: la reserva se extendió y esta salida es otra.
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
      .select("booking_out_id, status, scheduled_for")
      .eq("organization_id", organizationId)
      .in("booking_out_id", bookingIds),
  ]);
  const coveredUnitIds = new Set(
    (sameDay ?? []).map((r) => (r as { unit_id: string }).unit_id),
  );
  const coveredBookingIds = new Set(
    (
      (sameBooking ?? []) as Array<{
        booking_out_id: string;
        status: CleaningStatus;
        scheduled_for: string;
      }>
    )
      .filter((r) =>
        taskCoversCheckout(
          { status: r.status, scheduled_date: ymdInTz(new Date(r.scheduled_for), timezone) },
          date,
        ),
      )
      .map((r) => r.booking_out_id),
  );

  // Acumular las filas de cleaning_tasks a insertar (saltando las que ya existen
  // → idempotencia) y hacer UN insert batch. Se itera por booking (no por
  // unidad) para que un booking viejo ya limpiado no tape al checkout real
  // del día cuando ambos comparten unidad.
  const checklist = await checklistForOrg(organizationId);
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

// ─── Sucio / limpio ─────────────────────────────────────────────────────────
// Ver src/lib/cleaning/cleanliness.ts: el estado se calcula, no se guarda.

type CleanlinessTaskRow = CleanlinessTask & {
  verified_at: string | null;
  completed_at: string | null;
};
type CleanlinessStayRow = CleanlinessStay & { check_out_time: string | null };

async function loadCleanlinessInputs(
  organizationId: string,
  timezone: string,
  unitId?: string,
): Promise<{
  today: string;
  tasks: CleanlinessTaskRow[];
  stays: CleanlinessStayRow[];
}> {
  const admin = createAdminClient();
  const today = todayYmdInTz(timezone);
  const tomorrow = addDaysYmd(today, 1);
  const fromIso = dayRangeInTz(addDaysYmd(today, -CLEANING_OVERDUE_DAYS), timezone).startIso;
  const toIso = dayRangeInTz(tomorrow, timezone).endIso;

  // Todas las tareas, no sólo las abiertas: una cerrada es la decisión de que ya
  // no hace falta limpiar. Tampoco se filtran las archivadas: el reset del lunes
  // no puede borrar esa decisión.
  let tasksQuery = admin
    .from("cleaning_tasks")
    .select("id, unit_id, status, scheduled_for, booking_out_id, verified_at, completed_at")
    .eq("organization_id", organizationId)
    .gte("scheduled_for", fromIso)
    .lt("scheduled_for", toIso);
  // Las estadías que pisan hoy o mañana alcanzan: las que salen, las que entran y
  // la que tapa una tarea vieja.
  let staysQuery = admin
    .from("bookings")
    .select("id, unit_id, status, check_in_date, check_out_date, check_out_time, guest_id, lease_group_id")
    .eq("organization_id", organizationId)
    .eq("is_block", false)
    .in("status", [...CHECKOUT_BOOKING_STATUSES])
    .lte("check_in_date", tomorrow)
    .gte("check_out_date", today);
  if (unitId) {
    tasksQuery = tasksQuery.eq("unit_id", unitId);
    staysQuery = staysQuery.eq("unit_id", unitId);
  }
  const [tasksRes, staysRes] = await Promise.all([tasksQuery, staysQuery]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (staysRes.error) throw new Error(staysRes.error.message);

  const tasks = ((tasksRes.data ?? []) as Array<
    Omit<CleanlinessTaskRow, "scheduled_date"> & { scheduled_for: string }
  >).map((t) => ({
    ...t,
    scheduled_date: ymdInTz(new Date(t.scheduled_for), timezone),
  }));
  return { today, tasks, stays: (staysRes.data ?? []) as CleanlinessStayRow[] };
}

/**
 * Las unidades sucias de la org, por id. Una unidad que no aparece está limpia.
 * Sólo para admin y recepción: limpieza ve únicamente lo que tiene asignado y
 * el propietario no opera esto.
 */
export async function listUnitCleanliness(): Promise<Record<string, UnitCleanliness>> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) return {};
  const timezone = organization.timezone || DEFAULT_ORG_TIMEZONE;
  const admin = createAdminClient();
  const [{ today, tasks, stays }, limpieza] = await Promise.all([
    loadCleanlinessInputs(organization.id, timezone),
    admin
      .from("units")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("status", "limpieza"),
  ]);
  if (limpieza.error) throw new Error(limpieza.error.message);
  return computeCleanlinessByUnit({
    today,
    tasks,
    stays,
    limpiezaUnitIds: (limpieza.data ?? []).map((u) => u.id as string),
  });
}

export type SetUnitCleanlinessResult =
  | { ok: true; cleanliness: UnitCleanliness | null }
  | { ok: false; error: string };

/**
 * El botón sucio/limpio del calendario y de la ficha de la unidad: la operación
 * cambia sobre la marcha ("un depto renovó y se quedó, ese no se limpia y se
 * limpia otro") y tiene que poder decirlo sin abrir un ticket.
 *
 * La decisión se guarda EN las tareas de limpieza, no en una columna aparte: así
 * el calendario, Limpieza y el Parte diario dicen lo mismo y lo marcado a mano le
 * aparece a quien limpia.
 *
 * Sin `revalidatePath` a propósito: cualquier llamada hace que Next re-renderice
 * la página actual dentro de la respuesta de la action, y en el calendario eso son
 * todas las unidades y reservas por cada clic. El tablero se actualiza por la capa
 * en vivo (también en otras pestañas) y las rutas dinámicas no quedan cacheadas al
 * navegar.
 */
export async function setUnitCleanliness(
  unitId: string,
  target: "limpio" | "sucio",
): Promise<SetUnitCleanlinessResult> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) {
    return { ok: false, error: "No tenés permiso para cambiar si una unidad está limpia o sucia." };
  }
  const parsed = z
    .object({ unitId: z.string().uuid(), target: z.enum(["limpio", "sucio"]) })
    .safeParse({ unitId, target });
  if (!parsed.success) return { ok: false, error: "No se pudo identificar la unidad." };

  const admin = createAdminClient();
  const { data: unit, error: unitError } = await admin
    .from("units")
    .select("id, status")
    .eq("id", unitId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (unitError) {
    console.error("[cleaning/setUnitCleanliness]", unitError.message);
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
  if (!unit) return { ok: false, error: "No encontramos esa unidad." };

  const timezone = organization.timezone || DEFAULT_ORG_TIMEZONE;
  const context: CleanlinessWriteContext = {
    organizationId: organization.id,
    userId: session.userId,
    unitId,
    unitStatus: unit.status as UnitStatus,
    timezone,
  };

  try {
    if (target === "limpio") await markUnitClean(context);
    else await markUnitDirty(context);

    const [{ today, tasks, stays }, { data: fresh }] = await Promise.all([
      loadCleanlinessInputs(organization.id, timezone, unitId),
      admin.from("units").select("status").eq("id", unitId).maybeSingle(),
    ]);
    return {
      ok: true,
      cleanliness: computeUnitCleanliness({
        unitStatus: (fresh?.status as UnitStatus | undefined) ?? null,
        tasks,
        stays,
        today,
      }),
    };
  } catch (err) {
    console.error("[cleaning/setUnitCleanliness]", (err as Error).message);
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}

interface CleanlinessWriteContext {
  organizationId: string;
  userId: string;
  unitId: string;
  unitStatus: UnitStatus;
  timezone: string;
}

async function setUnitStatusByHand(
  context: CleanlinessWriteContext,
  status: UnitStatus,
  reason: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("units")
    .update({ status, status_changed_by: context.userId })
    .eq("id", context.unitId)
    .eq("organization_id", context.organizationId);
  if (error) throw new Error(error.message);
  await setLatestStatusReason(context.unitId, reason);
}

/**
 * Cierra en un paso todo lo que está para hoy o antes de mañana. Queda en
 * "verificada" sin `completed_at`, que es exactamente lo que la migración 075 lee
 * como "cerrada en un paso": si se tocó ANTES de que el huésped se fuera y después
 * se marca la salida, vuelve a aparecer sucio. Nunca un departamento sucio que no
 * figura.
 */
async function markUnitClean(context: CleanlinessWriteContext): Promise<void> {
  const { organizationId, unitId, userId, unitStatus, timezone } = context;
  const admin = createAdminClient();
  const { today, tasks, stays } = await loadCleanlinessInputs(organizationId, timezone, unitId);
  const tomorrow = addDaysYmd(today, 1);

  // La unidad primero, con la persona: si se cierra antes la tarea, el trigger la
  // pasa a disponible sin autor y aunque haya un huésped adentro.
  if (unitStatus === "limpieza") {
    const { count } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("unit_id", unitId)
      .eq("status", "check_in")
      .eq("is_block", false)
      .lte("check_in_date", today)
      .gt("check_out_date", today);
    await setUnitStatusByHand(
      context,
      (count ?? 0) > 0 ? "ocupado" : "disponible",
      "Marcado limpio a mano",
    );
  }

  // Una salida de hoy o de mañana sin tarea todavía (el cron recién la crea a la
  // medianoche): se crea para que la decisión quede guardada y no vuelva a avisar.
  const uncovered = uncoveredCheckouts({ tasks, stays, today });
  if (uncovered.length > 0) {
    const checklist = await checklistForOrg(organizationId);
    const { data: created, error } = await admin
      .from("cleaning_tasks")
      .insert(
        uncovered.map((stay) => ({
          organization_id: organizationId,
          unit_id: unitId,
          booking_out_id: stay.id,
          scheduled_for: zonedTimeToUtc(
            stay.check_out_date,
            (stay.check_out_time ?? "11:00").slice(0, 5),
            timezone,
          ).toISOString(),
          status: "pendiente",
          checklist,
        })),
      )
      .select("id");
    if (error) throw new Error(error.message);
    await admin.from("cleaning_events").insert(
      (created ?? []).map((t) => ({
        cleaning_task_id: t.id,
        organization_id: organizationId,
        actor_id: userId,
        event_type: "created",
        to_status: "pendiente",
        metadata: { source: "unit_cleanliness_button" },
      })),
    );
  }

  // Sin cota inferior: "limpio" también cierra las viejas que ya no avisan.
  const { data: open, error: openError } = await admin
    .from("cleaning_tasks")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("unit_id", unitId)
    .in("status", ["pendiente", "en_progreso"])
    .lt("scheduled_for", dayRangeInTz(tomorrow, timezone).endIso);
  if (openError) throw new Error(openError.message);
  const openTasks = (open ?? []) as Array<{ id: string; status: CleaningStatus }>;
  if (openTasks.length === 0) return;

  const { error: closeError } = await admin
    .from("cleaning_tasks")
    .update({ status: "verificada", verified_by: userId })
    .eq("organization_id", organizationId)
    .in("id", openTasks.map((t) => t.id));
  if (closeError) throw new Error(closeError.message);

  await admin.from("cleaning_events").insert(
    openTasks.map((t) => ({
      cleaning_task_id: t.id,
      organization_id: organizationId,
      actor_id: userId,
      event_type: "status_changed",
      from_status: t.status,
      to_status: "verificada",
      metadata: { source: "unit_cleanliness_button" },
    })),
  );
}

async function markUnitDirty(context: CleanlinessWriteContext): Promise<void> {
  const { organizationId, unitId, userId, unitStatus, timezone } = context;
  const admin = createAdminClient();
  const { today, tasks, stays } = await loadCleanlinessInputs(organizationId, timezone, unitId);

  // Lo que se cerró hoy en un paso se reabre: es deshacer el "limpio". Crear otra
  // tarea dejaba dos tickets para la misma salida. Una limpieza que alguien hizo
  // de verdad (completed_at) no se toca: si volvió a ensuciarse, es otra.
  const startOfToday = new Date(dayRangeInTz(today, timezone).startIso).getTime();
  const reopen = tasks.filter(
    (t) =>
      t.status === "verificada" &&
      !t.completed_at &&
      t.verified_at !== null &&
      new Date(t.verified_at).getTime() >= startOfToday,
  );
  if (reopen.length > 0) {
    const { error } = await admin
      .from("cleaning_tasks")
      .update({ status: "pendiente", verified_at: null, verified_by: null })
      .eq("organization_id", organizationId)
      .in("id", reopen.map((t) => t.id));
    if (error) throw new Error(error.message);
    await admin.from("cleaning_events").insert(
      reopen.map((t) => ({
        cleaning_task_id: t.id,
        organization_id: organizationId,
        actor_id: userId,
        event_type: "status_changed",
        from_status: "verificada",
        to_status: "pendiente",
        metadata: { source: "unit_cleanliness_button" },
      })),
    );
  }

  const reopenedIds = new Set(reopen.map((t) => t.id));
  const afterReopen = tasks.map((t) =>
    reopenedIds.has(t.id) ? { ...t, status: "pendiente" as const } : t,
  );
  const alreadyDirty = computeUnitCleanliness({
    unitStatus,
    tasks: afterReopen,
    stays,
    today,
  });
  if (!alreadyDirty) {
    // Sin reserva asociada: es lo que le dice al cálculo que es sucio ya, no
    // "cuando salga". Si después se marca el check-out, el trigger la adopta.
    const { data: created, error } = await admin
      .from("cleaning_tasks")
      .insert({
        organization_id: organizationId,
        unit_id: unitId,
        booking_out_id: null,
        scheduled_for: new Date().toISOString(),
        status: "pendiente",
        checklist: await checklistForOrg(organizationId),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await admin.from("cleaning_events").insert({
      cleaning_task_id: created.id,
      organization_id: organizationId,
      actor_id: userId,
      event_type: "created",
      to_status: "pendiente",
      metadata: { source: "unit_cleanliness_button" },
    });
  }

  // El rayado del calendario sólo si no hay nadie: con una estadía en curso (aun
  // sin el check-in marcado, Apart CBA no siempre lo marca) el aviso alcanza y no
  // hay que tapar la ocupación. Mantenimiento y bloqueado no se pisan.
  const stayInProgress = stays.some(
    (s) => s.status !== "check_out" && s.check_in_date <= today && s.check_out_date > today,
  );
  if (!stayInProgress && ["disponible", "reservado", "ocupado"].includes(unitStatus)) {
    await setUnitStatusByHand(context, "limpieza", "Marcado sucio a mano");
  }
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
  const checklist =
    validated.checklist.length > 0
      ? validated.checklist
      : await checklistForOrg(organization.id);
  const admin = createAdminClient();
  // El Parte diario crea la limpieza de un check-out que no tenía tarea: va
  // atada a esa reserva. El trigger de check-out sólo reconoce como "la
  // limpieza de esta salida" a las tareas con su booking_out_id; sin el
  // vínculo, al marcar la salida creaba OTRA sin asignar que quien limpia no
  // ve (Habitana COF II/DZN, 27/10/2026). Sólo si la reserva es de esta org y
  // de esta unidad.
  if (validated.booking_out_id) {
    const { data: outBooking } = await admin
      .from("bookings")
      .select("id")
      .eq("id", validated.booking_out_id)
      .eq("organization_id", organization.id)
      .eq("unit_id", validated.unit_id)
      .maybeSingle();
    if (!outBooking) validated.booking_out_id = null;
  }
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
  revalidatePath("/dashboard/unidades/calendario/mensual");
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
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/unidades");
}
