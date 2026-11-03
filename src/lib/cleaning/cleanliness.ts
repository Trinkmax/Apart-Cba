/**
 * ¿Una unidad está sucia o limpia?
 *
 * Reclamo de Apart CBA (31/10/2026): el aviso de "sucio" dependía de que alguien
 * marcara el check-out — que encima se traba si hay saldo sin cobrar —, así que
 * llegaba cuando la limpieza ya tendría que estar hecha, y a veces no llegaba.
 *
 * La respuesta se CALCULA al leer, con las reservas y las tareas de limpieza. No
 * hay una columna "sucio" que un cron tenga que mantener al día: si el cron
 * falla, el aviso igual aparece; si la reserva se extiende, se apaga solo. Y como
 * la decisión de una persona se guarda en la misma tarea que ven Limpieza y el
 * Parte diario (ver `setUnitCleanliness`), las tres pantallas no pueden
 * contradecirse.
 *
 * Funciones puras: las usan las actions, el cron y los tests.
 */

import { addDaysYmd } from "@/lib/dates";
import type { BookingStatus, CleaningStatus, UnitStatus } from "@/lib/types/database";

/**
 * Reservas cuya salida deja una unidad para limpiar. Incluye `pendiente`: ocupa
 * calendario (entra en `bookings_no_overlap`) y Apart CBA tiene estadías reales
 * que nunca pasan de ahí. Dejarla afuera fue el bug del 30/10/2026: SAL525
 * (26→30/10) no tuvo limpieza, siguió figurando "disponible" y recibió otro
 * huésped ese mismo día.
 */
export const CHECKOUT_BOOKING_STATUSES = [
  "pendiente",
  "confirmada",
  "check_in",
  "check_out",
] as const satisfies readonly BookingStatus[];

/** Una limpieza vencida hace más que esto ya no avisa: hay organizaciones con decenas sin cerrar. */
export const CLEANING_OVERDUE_DAYS = 7;

/**
 * Cuándo toca limpiar:
 * - `now`: ya hay que hacerlo (el huésped se fue, se marcó a mano o quedó atrasada).
 * - `today`: el huésped sale hoy y todavía no se marcó la salida.
 * - `tomorrow`: sale mañana. Es el aviso del día anterior, que es cuando la
 *   operación organiza la limpieza.
 */
export type CleanlinessDue = "now" | "today" | "tomorrow";

/** Unidad sucia. Una unidad limpia no tiene entrada (`null`). */
export interface UnitCleanliness {
  due: CleanlinessDue;
  /** Día (YYYY-MM-DD) de la limpieza pendiente más vieja, si quedó atrasada. */
  overdueSince: string | null;
}

export interface CleanlinessTask {
  id: string;
  unit_id: string;
  status: CleaningStatus;
  /** Día LOCAL de `scheduled_for` (YYYY-MM-DD), ya convertido a la tz de la org. */
  scheduled_date: string;
  booking_out_id: string | null;
}

export interface CleanlinessStay {
  id: string;
  unit_id: string;
  status: BookingStatus;
  check_in_date: string;
  check_out_date: string;
  guest_id: string | null;
  lease_group_id: string | null;
}

export function isOpenCleaning(status: CleaningStatus): boolean {
  return status === "pendiente" || status === "en_progreso";
}

/**
 * ¿`next` sigue a `prev` sin que nadie se vaya? Mismo contrato o mismo huésped,
 * misma unidad y entrada el día de la salida. Es una renovación o el corte de un
 * alquiler mensual en tramos, no una salida: en 60 días de Apart CBA fueron 34 de
 * 224 "salidas", y sus tickets eran los que el equipo cancelaba a mano.
 */
export function isStayContinuation(
  prev: Pick<CleanlinessStay, "id" | "unit_id" | "check_out_date" | "guest_id" | "lease_group_id">,
  next: Pick<CleanlinessStay, "id" | "unit_id" | "check_in_date" | "guest_id" | "lease_group_id">,
): boolean {
  if (prev.id === next.id || prev.unit_id !== next.unit_id) return false;
  if (next.check_in_date !== prev.check_out_date) return false;
  if (prev.lease_group_id && prev.lease_group_id === next.lease_group_id) return true;
  return Boolean(prev.guest_id && prev.guest_id === next.guest_id);
}

/**
 * ¿Esta tarea ya resuelve la salida de una reserva?
 *
 * Abierta, siempre. Cerrada (incluso cancelada: lo que una persona decidió no se
 * resucita), sólo si era para esa fecha o después: si la reserva se extendió, una
 * tarea cerrada para la fecha vieja no dice nada de la salida nueva. Sin esto,
 * una reserva renovada no volvía a generar limpieza nunca.
 */
export function taskCoversCheckout(
  task: Pick<CleanlinessTask, "status" | "scheduled_date">,
  checkOutDate: string,
): boolean {
  return isOpenCleaning(task.status) || task.scheduled_date >= checkOutDate;
}

interface UnitInput {
  tasks: CleanlinessTask[];
  stays: CleanlinessStay[];
  today: string;
}

/** Ids de las reservas de esta lista que continúan en otra: esas salidas no existen. */
function continuingStayIds(stays: CleanlinessStay[]): Set<string> {
  const ids = new Set<string>();
  for (const prev of stays) {
    if (stays.some((next) => isStayContinuation(prev, next))) ids.add(prev.id);
  }
  return ids;
}

/**
 * Salidas de hoy o de mañana que todavía no tienen tarea: el cron recién las crea
 * a la medianoche, y una reserva de una noche cargada a la tarde tiene que avisar
 * igual. Es el mismo criterio que `ensureCleaningTasksForCheckouts`.
 */
export function uncoveredCheckouts<S extends CleanlinessStay>({
  tasks,
  stays,
  today,
}: {
  tasks: CleanlinessTask[];
  stays: S[];
  today: string;
}): S[] {
  const tomorrow = addDaysYmd(today, 1);
  const continuing = continuingStayIds(stays);
  return stays.filter((stay) => {
    if (stay.check_out_date !== today && stay.check_out_date !== tomorrow) return false;
    if (continuing.has(stay.id)) return false;
    const linked = tasks.some(
      (t) => t.booking_out_id === stay.id && taskCoversCheckout(t, stay.check_out_date),
    );
    if (linked) return false;
    // Una limpieza por unidad por día: otra tarea de esa fecha ya la cubre.
    return !tasks.some(
      (t) => t.scheduled_date === stay.check_out_date && t.status !== "cancelada",
    );
  });
}

/**
 * Una tarea vieja sin cerrar no ensucia una unidad a la que ya entró otra estadía:
 * si alguien está adentro desde ese día, o se limpió o ya no hay nada que hacer.
 * Sólo vale para días pasados: el día del recambio, el aviso es lo más urgente.
 */
function isSuperseded(taskDate: string, stays: CleanlinessStay[], today: string): boolean {
  if (taskDate >= today) return false;
  return stays.some(
    (s) =>
      s.status !== "check_out" && // salió antes de tiempo: ya no hay nadie adentro
      s.check_in_date >= taskDate &&
      s.check_in_date <= today &&
      s.check_out_date > today,
  );
}

const DUE_RANK: Record<CleanlinessDue, number> = { tomorrow: 1, today: 2, now: 3 };

function mostUrgent(a: CleanlinessDue | null, b: CleanlinessDue): CleanlinessDue {
  return a && DUE_RANK[a] >= DUE_RANK[b] ? a : b;
}

/** Devuelve `null` si la unidad está limpia. Espera sólo las tareas y estadías de esa unidad. */
export function computeUnitCleanliness({
  unitStatus,
  tasks,
  stays,
  today,
}: UnitInput & { unitStatus: UnitStatus | null }): UnitCleanliness | null {
  const tomorrow = addDaysYmd(today, 1);
  const oldest = addDaysYmd(today, -CLEANING_OVERDUE_DAYS);
  const continuing = continuingStayIds(stays);
  const stayById = new Map(stays.map((s) => [s.id, s]));

  // El rayado del calendario: si la unidad figura en limpieza, está sucia.
  let due: CleanlinessDue | null = unitStatus === "limpieza" ? "now" : null;
  let overdueSince: string | null = null;

  for (const task of tasks) {
    if (!isOpenCleaning(task.status)) continue;
    const date = task.scheduled_date;
    if (date > tomorrow || date < oldest) continue;
    if (task.booking_out_id && continuing.has(task.booking_out_id)) continue;
    if (isSuperseded(date, stays, today)) continue;

    if (date < today) {
      due = "now";
      if (!overdueSince || date < overdueSince) overdueSince = date;
      continue;
    }
    // Sin reserva asociada la marcó una persona: es sucio ya, no "cuando salga".
    const stay = task.booking_out_id ? stayById.get(task.booking_out_id) : undefined;
    if (!task.booking_out_id || stay?.status === "check_out") {
      due = "now";
      continue;
    }
    due = mostUrgent(due, date === today ? "today" : "tomorrow");
  }

  for (const stay of uncoveredCheckouts({ tasks, stays, today })) {
    if (stay.status === "check_out") due = "now";
    else due = mostUrgent(due, stay.check_out_date === today ? "today" : "tomorrow");
  }

  return due ? { due, overdueSince } : null;
}

/** Sólo devuelve las unidades sucias: una unidad que no aparece está limpia. */
export function computeCleanlinessByUnit({
  tasks,
  stays,
  today,
  limpiezaUnitIds,
}: UnitInput & { limpiezaUnitIds: string[] }): Record<string, UnitCleanliness> {
  const limpieza = new Set(limpiezaUnitIds);
  const unitIds = new Set<string>([
    ...limpiezaUnitIds,
    ...tasks.map((t) => t.unit_id),
    ...stays.map((s) => s.unit_id),
  ]);
  const byUnit: Record<string, UnitCleanliness> = {};
  for (const unitId of unitIds) {
    const state = computeUnitCleanliness({
      unitStatus: limpieza.has(unitId) ? "limpieza" : null,
      tasks: tasks.filter((t) => t.unit_id === unitId),
      stays: stays.filter((s) => s.unit_id === unitId),
      today,
    });
    if (state) byUnit[unitId] = state;
  }
  return byUnit;
}

// ─── Textos ─────────────────────────────────────────────────────────────────
// Usan las palabras del equipo: "sucio" y "limpio", no "pendiente de limpieza".

export const CLEANLINESS_LABEL: Record<CleanlinessDue, string> = {
  now: "Sucio",
  today: "Sucio hoy",
  tomorrow: "Sucio mañana",
};

/** Para el celular, donde la fila mide 96 px. */
export const CLEANLINESS_SHORT_LABEL: Record<CleanlinessDue, string> = {
  now: "Sucio",
  today: "Hoy",
  tomorrow: "Mañana",
};

export function cleanlinessHint(state: UnitCleanliness): string {
  if (state.due === "tomorrow") return "El huésped sale mañana.";
  if (state.due === "today") return "El huésped sale hoy.";
  if (state.overdueSince) {
    const [, month, day] = state.overdueSince.split("-");
    return `Limpieza pendiente desde el ${day}/${month}.`;
  }
  return "Hay que limpiarlo.";
}
