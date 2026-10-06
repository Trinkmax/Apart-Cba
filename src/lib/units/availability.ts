/**
 * "Buscar disp" del calendario PMS — lógica pura de disponibilidad por rango.
 *
 * Antes el filtro miraba el state del board, que sólo tiene la ventana
 * LAZY-CARGADA: preguntar por fechas fuera de esa ventana no encontraba
 * ninguna reserva y declaraba libres todas las unidades. Ahora el board pide
 * al server las reservas y solicitudes del rango exacto y decide acá.
 *
 * Fechas YYYY-MM-DD, rangos semiabiertos [desde, hasta): el día de salida no
 * se ocupa (salida y entrada el mismo día es un recambio, no un choque) —
 * la misma regla que `listBookingsInRange` y `bookings_no_overlap`.
 */

/** Tope de rango: más de dos años es casi seguro un año mal tipeado. */
export const AVAILABILITY_MAX_DAYS = 731;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function isoToUtcMs(iso: string): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  // Date.parse acepta "2026-02-31" corriéndolo a marzo: lo rechazamos.
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : null;
}

export type AvailabilityRangeCheck =
  | { ok: true; from: string; to: string; nights: number; key: string }
  | {
      ok: false;
      /** `incomplete`: falta alguna fecha → no hay búsqueda (no es un error). */
      reason: "incomplete" | "invalid" | "order" | "too_long";
      message: string | null;
    };

/** Valida el rango que tipeó la persona antes de preguntarle nada al server. */
export function checkAvailabilityRange(from: string, to: string): AvailabilityRangeCheck {
  const f = from.trim();
  const t = to.trim();
  if (!f || !t) return { ok: false, reason: "incomplete", message: null };
  const fMs = isoToUtcMs(f);
  const tMs = isoToUtcMs(t);
  if (fMs === null || tMs === null) {
    return { ok: false, reason: "invalid", message: "Revisá las fechas: alguna no es válida." };
  }
  if (tMs <= fMs) {
    return {
      ok: false,
      reason: "order",
      message: "La fecha de salida tiene que ser posterior a la de entrada.",
    };
  }
  const nights = Math.round((tMs - fMs) / DAY_MS);
  if (nights > AVAILABILITY_MAX_DAYS) {
    return { ok: false, reason: "too_long", message: "Elegí un rango de hasta 2 años." };
  }
  return { ok: true, from: f, to: t, nights, key: `${f}|${t}` };
}

/** ¿Se pisan [aFrom, aTo) y [bFrom, bTo)? El día de salida queda libre. */
export function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom < bTo && aTo > bFrom;
}

/**
 * Estados que ocupan la unidad. Todo lo que no está cancelado ni fue un
 * no-show: también `check_out` (una salida anticipada puede seguir dentro del
 * rango y se prefiere un falso "ocupada" a un falso "libre").
 */
export function statusOccupies(status: string): boolean {
  return status !== "cancelada" && status !== "no_show";
}

export interface OccupancyBooking {
  id: string;
  unit_id: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  /** Un cierre de calendario no es una reserva, pero ocupa igual. */
  is_block?: boolean | null;
}

export interface OccupancyRequest {
  id: string;
  unit_id: string | null;
  check_in: string | null;
  check_out: string | null;
  /** La política del canal dice que la solicitud retiene la venta. */
  holds_availability: boolean;
}

export interface UnitAvailability {
  /** Ocupadas: reserva activa, cierre o solicitud que retiene la venta. */
  busy: Set<string>;
  /**
   * Libres pero con una solicitud de OTA que NO retiene la venta (Airbnb con
   * `hold_availability = false`). Siguen en la lista —el dueño decidió que una
   * solicitud no cierra el calendario— pero con aviso, igual que el formulario
   * de reserva, para que nadie venda esas fechas sin saberlo.
   */
  tentative: Set<string>;
}

/**
 * Qué unidades están ocupadas en [from, to).
 *
 * Recibe TODAS las versiones conocidas de cada fila (la foto del server para
 * el rango + el state local, que trae lo optimista y lo que llegó en vivo) y
 * alcanza con que UNA ocupe para marcar la unidad. Es deliberadamente
 * conservador: una reserva que se movió cuenta en su lugar viejo y en el
 * nuevo hasta la próxima lectura — un falso "ocupada" se corrige solo, un
 * falso "libre" es una venta doble.
 */
export function computeUnitAvailability(input: {
  from: string;
  to: string;
  bookings: Iterable<OccupancyBooking>;
  requests?: Iterable<OccupancyRequest>;
}): UnitAvailability {
  const { from, to } = input;
  const busy = new Set<string>();
  const tentative = new Set<string>();
  for (const b of input.bookings) {
    if (!b.unit_id || !statusOccupies(b.status)) continue;
    if (rangesOverlap(b.check_in_date, b.check_out_date, from, to)) busy.add(b.unit_id);
  }
  for (const r of input.requests ?? []) {
    if (!r.unit_id || !r.check_in || !r.check_out) continue;
    if (!rangesOverlap(r.check_in, r.check_out, from, to)) continue;
    if (r.holds_availability) busy.add(r.unit_id);
    else tentative.add(r.unit_id);
  }
  for (const id of busy) tentative.delete(id);
  return { busy, tentative };
}
