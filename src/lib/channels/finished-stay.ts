/**
 * Una estadía que ya se vivió no se vuelve a cargar encima.
 *
 * `bookings_no_overlap` sólo cubre pendiente/confirmada/check_in: una reserva
 * con la salida hecha (`check_out`) ya no ocupa nada para la base. Eso sirve
 * para vender las noches que libera una salida anticipada, pero dejaba un
 * hueco: las noches que esa persona YA durmió quedaban libres para el
 * importador, y nada frenaba una segunda reserva encima.
 *
 * Habitana, AT4B 14→15/11/2026: Booking publicó el hueco y la reserva cargada a
 * mano (Florencia, cobrada, con notas) tenía plata, así que el sistema preguntó
 * «¿Es la misma reserva?». Nadie contestó; a la noche Cecilia hizo la salida,
 * el barrido cerró la pregunta por fecha y el reconcile de las 03:20 creó una
 * copia vacía encima. Cecilia vio la copia en verde, la "completó" y no
 * encontraba las notas ni la estadía.
 *
 * Fechas en `YYYY-MM-DD`, rango `[entrada, salida)`.
 */

export interface StaySpan {
  checkIn: string;
  checkOut: string;
}

export interface LocalStay extends StaySpan {
  id: string;
  status: string;
}

/** Estados que todavía cuentan como estadía (la misma lista que `bookings_no_overlap`). */
const LIVE_STATUSES = new Set(["pendiente", "confirmada", "check_in"]);

/** La estadía terminó: la última noche fue antes de hoy. */
export function stayHasEnded(stay: StaySpan, today: string): boolean {
  return stay.checkOut <= today;
}

/**
 * Con plata de por medio, vincular por unidad + fechas exactas pide un número o
 * un nombre: "mismas fechas" no alcanza para tomar el control de una reserva
 * viva. Cuando la estadía ya terminó (la local tiene la salida hecha, o las
 * fechas pasaron) no queda nada que la OTA pueda llevarse: el barrido de
 * cancelaciones no mira llegadas pasadas y el canal nunca toca una reserva que
 * cargó una persona. Ahí la coincidencia exacta es la misma estadía.
 */
export function canAdoptWithoutIdentity(
  candidateStatus: string,
  reservation: StaySpan,
  today: string,
): boolean {
  return candidateStatus === "check_out" || stayHasEnded(reservation, today);
}

/** Noches que comparten las dos estadías antes de hoy (las ya vividas). */
function sharesPastNights(a: StaySpan, b: StaySpan, today: string): boolean {
  const from = a.checkIn > b.checkIn ? a.checkIn : b.checkIn;
  let to = a.checkOut < b.checkOut ? a.checkOut : b.checkOut;
  if (today < to) to = today;
  return from < to;
}

function overlaps(a: StaySpan, b: StaySpan): boolean {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

export type InsertDecision =
  | { action: "insert" }
  /** Ya terminó y se pisa con una reserva del sistema: ni se carga ni se avisa (se avisó cuando importaba). */
  | { action: "skip"; with: LocalStay }
  /** Todavía no terminó y pisa noches que alguien ya durmió: lo mira una persona. */
  | { action: "conflict"; with: LocalStay };

/**
 * Antes de que el importador cree una reserva nueva. Lo que pisa una reserva
 * viva en noches que vienen lo sigue frenando `bookings_no_overlap` (conflicto
 * de siempre); acá se cubre lo que la base no ve.
 */
export function decideInsertOverLocalStays(
  reservation: StaySpan,
  locals: LocalStay[],
  today: string,
): InsertDecision {
  const touching = locals.filter(
    (l) => (LIVE_STATUSES.has(l.status) || l.status === "check_out") && overlaps(reservation, l),
  );
  if (touching.length === 0) return { action: "insert" };

  // Una estadía de la OTA que ya terminó y choca con una del sistema no se
  // carga: si era la misma, ya está; si era otra, el conflicto se mostró
  // mientras importaba. Abrirlo de nuevo cada noche sólo sería ruido.
  if (stayHasEnded(reservation, today)) return { action: "skip", with: touching[0] };

  const lived = touching.find((l) => l.status === "check_out" && sharesPastNights(reservation, l, today));
  if (lived) return { action: "conflict", with: lived };

  return { action: "insert" };
}
