/**
 * Búsqueda libre del calendario PMS ("Buscar huésped, unidad…") — lógica pura.
 *
 * Regla de oro: la búsqueda elige QUÉ UNIDADES se muestran; nunca esconde la
 * ocupación de una unidad que sí se muestra. Antes el filtro de reservas y el
 * de unidades eran dos reglas distintas: buscar "DUARTE" dejaba a la vista
 * QUIROS1/QUIROS2 (su dirección es Duarte Quirós) pero borraba todas sus
 * reservas, porque ninguna tenía "duarte" en el huésped o el código → filas
 * vacías de unidades ocupadas, que es como se vende dos veces una fecha.
 *
 * Por eso la coincidencia de unidad y la de reserva viven acá juntas: una
 * reserva coincide por sus propios datos (huésped, código de la OTA) o por los
 * de su unidad (código, nombre, barrio, dirección) — exactamente los mismos
 * campos que hacen coincidir a la unidad.
 */

/** Minúsculas, sin tildes y con los espacios colapsados: "Quirós" ≡ "quiros". */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lo mínimo de una unidad que mira la búsqueda. */
export interface PmsSearchUnit {
  id: string;
  code?: string | null;
  name?: string | null;
  neighborhood?: string | null;
  address?: string | null;
}

/** Lo mínimo de una reserva que mira la búsqueda. */
export interface PmsSearchBooking {
  id: string;
  unit_id: string;
  external_id?: string | null;
  guest?: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  /** Join liviano de la reserva: se usa sólo si la unidad no está en la lista. */
  unit?: { code?: string | null; name?: string | null } | null;
}

// Un teléfono se escribe de mil maneras ("+54 9 351 563-9985", "3515639985"):
// si lo tipeado parece un número, se compara dígito contra dígito.
const PHONE_LIKE = /^[\d\s()+.-]+$/;
const MIN_PHONE_DIGITS = 4;

function digitsOf(value: string | null | undefined): string {
  return value ? value.replace(/\D/g, "") : "";
}

function includesNormalized(value: string | null | undefined, q: string): boolean {
  return q.length > 0 && normalizeSearchText(value).includes(q);
}

/** ¿La unidad coincide por código, nombre, barrio o dirección? (`q` ya normalizada) */
export function unitMatchesQuery(
  unit: Omit<PmsSearchUnit, "id"> | null | undefined,
  q: string,
): boolean {
  if (!unit || !q) return false;
  return (
    includesNormalized(unit.code, q) ||
    includesNormalized(unit.name, q) ||
    includesNormalized(unit.neighborhood, q) ||
    includesNormalized(unit.address, q)
  );
}

/**
 * ¿La reserva coincide POR SUS PROPIOS DATOS? Huésped (nombre, mail,
 * teléfono) o el código de la OTA. `rawQuery` es lo que tipeó la persona: el
 * teléfono necesita los dígitos originales.
 */
export function bookingOwnFieldsMatch(
  booking: PmsSearchBooking,
  q: string,
  rawQuery: string = q,
): boolean {
  if (!q) return false;
  if (
    includesNormalized(booking.guest?.full_name, q) ||
    includesNormalized(booking.guest?.email, q) ||
    includesNormalized(booking.external_id, q)
  ) {
    return true;
  }
  const trimmed = rawQuery.trim();
  if (PHONE_LIKE.test(trimmed)) {
    const qDigits = digitsOf(trimmed);
    if (qDigits.length >= MIN_PHONE_DIGITS && digitsOf(booking.guest?.phone).includes(qDigits)) {
      return true;
    }
  }
  return false;
}

/** ¿La reserva coincide por sus datos o por los de su unidad? */
export function bookingMatchesQuery(
  booking: PmsSearchBooking,
  unit: Omit<PmsSearchUnit, "id"> | null | undefined,
  q: string,
  rawQuery: string = q,
): boolean {
  return (
    bookingOwnFieldsMatch(booking, q, rawQuery) ||
    unitMatchesQuery(unit ?? booking.unit ?? null, q)
  );
}

export interface PmsSearchResult {
  /** Hay texto de búsqueda. Sin búsqueda los conjuntos están vacíos y no filtran. */
  active: boolean;
  /** Unidades que coinciden por sus propios datos. */
  matchedUnitIds: Set<string>;
  /** Reservas que coinciden por sus datos o por los de su unidad. */
  matchedBookingIds: Set<string>;
  /** Reservas que coinciden por sus propios datos (lo que cuenta como "coincidencia"). */
  ownMatchBookingIds: Set<string>;
  /** Unidades a mostrar: coincide la unidad o al menos una de sus reservas. */
  shownUnitIds: Set<string>;
}

/**
 * Corre la búsqueda sobre las unidades y las reservas que ya pasaron los
 * filtros explícitos (estado / canal / modo / cuotas). No filtra reservas:
 * devuelve qué unidades mostrar y qué reservas resaltar.
 */
export function searchPms(
  rawQuery: string,
  units: readonly PmsSearchUnit[],
  bookings: readonly PmsSearchBooking[],
): PmsSearchResult {
  const q = normalizeSearchText(rawQuery);
  const result: PmsSearchResult = {
    active: q.length > 0,
    matchedUnitIds: new Set(),
    matchedBookingIds: new Set(),
    ownMatchBookingIds: new Set(),
    shownUnitIds: new Set(),
  };
  if (!result.active) return result;

  const unitById = new Map<string, PmsSearchUnit>();
  for (const u of units) {
    unitById.set(u.id, u);
    if (unitMatchesQuery(u, q)) {
      result.matchedUnitIds.add(u.id);
      result.shownUnitIds.add(u.id);
    }
  }
  for (const b of bookings) {
    const own = bookingOwnFieldsMatch(b, q, rawQuery);
    const viaUnit = unitById.has(b.unit_id)
      ? result.matchedUnitIds.has(b.unit_id)
      : unitMatchesQuery(b.unit ?? null, q);
    if (own) {
      result.ownMatchBookingIds.add(b.id);
      result.shownUnitIds.add(b.unit_id);
    }
    if (own || viaUnit) result.matchedBookingIds.add(b.id);
  }
  return result;
}

/**
 * Cómo se pinta una barra con una búsqueda activa:
 *  · "none"  → normal. Sin búsqueda, o la unidad entera coincide (buscaste la
 *              unidad: todas sus reservas son igual de relevantes).
 *  · "match" → la reserva coincide y su unidad no: es la barra que buscabas.
 *  · "dim"   → otra reserva de una unidad que apareció por una coincidencia
 *              ajena. Se atenúa pero SE VE: la unidad está ocupada igual.
 */
export type SearchEmphasis = "none" | "match" | "dim";

export function bookingSearchEmphasis(
  result: PmsSearchResult,
  booking: Pick<PmsSearchBooking, "id" | "unit_id">,
): SearchEmphasis {
  if (!result.active) return "none";
  if (result.matchedUnitIds.has(booking.unit_id)) return "none";
  return result.matchedBookingIds.has(booking.id) ? "match" : "dim";
}

/** Dónde está la coincidencia de una fila que no se ve en pantalla. */
export interface OffscreenSearchMatch {
  /** La reserva que coincide más cerca de la ventana dibujada. */
  bookingId: string;
  checkIn: string;
  /** Antes o después de la ventana: para la flecha del aviso. */
  direction: "before" | "after";
}

function isoDayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

/**
 * Filas que aparecen SÓLO por reservas que coinciden por sus propios datos
 * (huésped, código de la OTA) y ninguna de esas reservas cae en la ventana
 * dibujada `[windowFrom, windowTo)` (half-open, como el lazy-load). La búsqueda
 * corre sobre todo lo cargado, así que buscar "Pérez" puede listar una unidad
 * cuya reserva de Pérez quedó en un mes que ya no está en pantalla: la fila se
 * ve sólo con barras atenuadas y sin el anillo de coincidencia, sin decir por
 * qué está. Para cada una devuelve la coincidencia más cercana a la ventana
 * (a igual distancia, la que viene: es la que se va a operar).
 *
 * Una unidad que coincide por sus propios datos no entra: se muestra por eso,
 * no por una reserva.
 */
export function offscreenSearchMatches(
  result: PmsSearchResult,
  bookings: readonly (Pick<PmsSearchBooking, "id" | "unit_id"> & {
    check_in_date: string;
    check_out_date: string;
  })[],
  windowFrom: string,
  windowTo: string,
): Map<string, OffscreenSearchMatch> {
  if (!result.active || result.ownMatchBookingIds.size === 0) return new Map();
  const nearest = new Map<string, OffscreenSearchMatch & { distance: number }>();
  const inWindow = new Set<string>();
  const from = isoDayNumber(windowFrom);
  const to = isoDayNumber(windowTo);
  for (const b of bookings) {
    if (!result.ownMatchBookingIds.has(b.id)) continue;
    if (result.matchedUnitIds.has(b.unit_id)) continue;
    if (inWindow.has(b.unit_id)) continue;
    if (b.check_in_date < windowTo && b.check_out_date > windowFrom) {
      inWindow.add(b.unit_id);
      nearest.delete(b.unit_id);
      continue;
    }
    const after = b.check_in_date >= windowTo;
    const distance = after
      ? isoDayNumber(b.check_in_date) - to
      : from - isoDayNumber(b.check_out_date);
    const prev = nearest.get(b.unit_id);
    const better =
      !prev ||
      distance < prev.distance ||
      (distance === prev.distance && after && prev.direction === "before");
    if (better) {
      nearest.set(b.unit_id, {
        bookingId: b.id,
        checkIn: b.check_in_date,
        direction: after ? "after" : "before",
        distance,
      });
    }
  }
  const out = new Map<string, OffscreenSearchMatch>();
  nearest.forEach(({ bookingId, checkIn, direction }, unitId) => {
    out.set(unitId, { bookingId, checkIn, direction });
  });
  return out;
}
