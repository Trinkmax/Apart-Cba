import type { UnitDefaultMode, UnitPricingRule } from "@/lib/types/database";
import type { CatalogListing } from "./contracts";
import { addDaysIso, computePricing, countNights, formatCurrency, priceForNight } from "./pricing";
import { effectiveMinNights as stayMinNights } from "./reservation-view";
import { computeSena, depositRuleLabel, restoAlLlegar, type DepositPolicy } from "./sena";
import { isMonthlyStay, offersMonthlyStays, offersShortStays, quoteStay } from "./stay";

/**
 * La cuenta del widget de reserva de la ficha (/u/[slug]): qué fechas se
 * pueden elegir, qué se cotiza, qué seña se pide y qué botón se muestra.
 *
 * Todo puro (sin React ni fechas del reloj salvo `today`, que se recibe) para
 * que el widget de escritorio, la hoja de mobile y los tests usen la MISMA
 * cuenta que después recalcula el server en el checkout.
 *
 * Calendario: las fechas ocupadas son NOCHES (rango half-open
 * [check-in, check-out), igual que el constraint bookings_no_overlap). Una
 * noche ocupada nunca puede ser llegada, pero la primera noche ocupada después
 * de la llegada sí puede ser salida: es el "checkout de recambio" (el huésped
 * sale a la mañana y el siguiente entra ese mismo día). Ninguna fecha posterior
 * a esa sirve de salida: el rango saltaría un bloqueo. Por eso NO se usa
 * `excludeDisabled` de react-day-picker (es inclusivo: trataría el día de
 * recambio como parte del rango y lo rechazaría).
 */

export type StayView = "noche" | "mes";

/** Lo que el widget necesita de la unidad (StorefrontListingDetail lo cumple). */
export interface WidgetListing {
  id: string;
  display_title: string;
  base_price: number;
  cleaning_fee: number | null;
  monthly_price: number | null;
  marketplace_currency: string;
  instant_book: boolean;
  default_mode: UnitDefaultMode | string | null;
  min_nights: number;
  max_nights: number | null;
  max_guests: number | null;
  pricing_rules: UnitPricingRule[];
}

/** Máximo de huéspedes si la unidad no lo tiene cargado. */
export const DEFAULT_MAX_GUESTS = 12;
/** Meses que se pueden consultar desde la web (igual que el buscador). */
export const MAX_CONSULT_MONTHS = 12;

// ─── Calendario ──────────────────────────────────────────────────────────────

/** Primera noche ocupada DESPUÉS de la llegada (la fecha de recambio), o null. */
export function nextBlockedAfter(blocked: ReadonlySet<string>, checkIn: string): string | null {
  if (!checkIn) return null;
  let min: string | null = null;
  for (const b of blocked) {
    if (b > checkIn && (min === null || b < min)) min = b;
  }
  return min;
}

/** ¿Alguna noche de [from, to) está ocupada? */
export function rangeHasBlockedNight(blocked: ReadonlySet<string>, from: string, to: string): boolean {
  if (!from || !to || to <= from) return false;
  let cursor = from;
  let safety = 0;
  while (cursor < to && safety < 366 * 2) {
    if (blocked.has(cursor)) return true;
    cursor = addDaysIso(cursor, 1);
    safety++;
  }
  return false;
}

export interface CalendarSelectionState {
  checkIn: string;
  checkOut: string;
  blocked: ReadonlySet<string>;
  /** nextBlockedAfter(blocked, checkIn), precalculado por el widget. */
  nextBlocked: string | null;
}

/**
 * Día deshabilitado en el calendario de rango (los límites hoy/12 meses los
 * pone el calendario aparte).
 * - La salida elegida nunca se deshabilita.
 * - Eligiendo la salida: antes de la llegada rige la ocupación; después, todo
 *   hasta la fecha de recambio inclusive se puede elegir y nada más allá.
 * - Si no: las noches ocupadas no se pueden elegir.
 */
export function isCalendarDayDisabled(day: string, s: CalendarSelectionState): boolean {
  if (s.checkOut && day === s.checkOut) return false;
  const selectingEnd = Boolean(s.checkIn && !s.checkOut);
  if (selectingEnd) {
    if (day <= s.checkIn) return s.blocked.has(day);
    if (s.nextBlocked) return day > s.nextBlocked;
    return false;
  }
  return s.blocked.has(day);
}

/**
 * Día que se muestra tachado ("No disponible"). La salida elegida y la fecha
 * de recambio elegible no se tachan: para el huésped son días válidos.
 */
export function isCalendarDayStruck(day: string, s: CalendarSelectionState): boolean {
  if (s.checkOut && day === s.checkOut) return false;
  const selectingEnd = Boolean(s.checkIn && !s.checkOut);
  if (selectingEnd && s.nextBlocked && day === s.nextBlocked) return false;
  return s.blocked.has(day);
}

/**
 * Qué queda elegido después de un click (lo que devuelve react-day-picker en
 * modo rango, ya en ISO). `from === to` es el primer click: todavía no hay
 * salida. Un rango que cruza una noche ocupada (p. ej. un click hacia atrás que
 * invierte el rango por encima de un bloqueo) se reinicia desde la llegada.
 */
export function resolveRangeSelection(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
  blocked: ReadonlySet<string>,
): { checkIn: string; checkOut: string; complete: boolean } {
  if (!fromIso) return { checkIn: "", checkOut: "", complete: false };
  if (blocked.has(fromIso)) return { checkIn: "", checkOut: "", complete: false };
  const complete = Boolean(toIso && toIso !== fromIso);
  if (complete && rangeHasBlockedNight(blocked, fromIso, toIso as string)) {
    return { checkIn: fromIso, checkOut: "", complete: false };
  }
  return { checkIn: fromIso, checkOut: complete ? (toIso as string) : "", complete };
}

// ─── Fechas de la estadía ────────────────────────────────────────────────────

/** Suma meses calendario a un ISO; si el día no existe (31 → feb) va al último. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Meses aproximados de una estadía larga (para prellenar la vista por mes). */
export function monthsFromNights(nights: number): number {
  if (!Number.isFinite(nights) || nights <= 0) return 1;
  return clampInt(Math.round(nights / 30), 1, MAX_CONSULT_MONTHS);
}

export function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function maxGuestsFor(listing: Pick<WidgetListing, "max_guests">): number {
  const n = Number(listing.max_guests);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_GUESTS;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: string | null | undefined): v is string {
  if (!v || !ISO_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-10-03" → "3 de octubre" (sin depender del ICU del entorno). */
export function longDayEs(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS_ES[m - 1]}`;
}

export function nightsLabel(n: number): string {
  return n === 1 ? "1 noche" : `${n} noches`;
}

export function monthsLabel(n: number): string {
  return n === 1 ? "1 mes" : `${n} meses`;
}

export function guestsCountLabel(n: number): string {
  return n === 1 ? "1 huésped" : `${n} huéspedes`;
}

// ─── Prellenado desde la URL ─────────────────────────────────────────────────

export interface StaySelection {
  view: StayView;
  checkIn: string;
  /** Vista noche: la salida elegida. Vista mes: se deriva de checkIn + months. */
  checkOut: string;
  months: number;
  guests: number;
}

/** Vista con la que abre la ficha: la unidad sólo mensual abre "mes". */
export function defaultView(listing: Pick<WidgetListing, "default_mode" | "min_nights">): StayView {
  return offersShortStays(listing) ? "noche" : "mes";
}

/**
 * Lee `?checkin&checkout&huespedes` (contrato de /buscar y del checkout). Una
 * llegada vencida (link viejo, pestaña abierta días) se descarta: si no, el
 * botón habilitaría fechas que el server rechaza. 28+ noches → vista por mes.
 */
export function parseStayParams(
  search: string | URLSearchParams | null | undefined,
  listing: Pick<WidgetListing, "default_mode" | "min_nights" | "max_guests">,
  today: string,
): StaySelection {
  const sp = typeof search === "string" || search == null ? new URLSearchParams(search ?? "") : search;
  const rawIn = sp.get("checkin");
  const rawOut = sp.get("checkout");
  const rawGuests = sp.get("huespedes");

  const checkIn = isIsoDate(rawIn) && rawIn >= today ? rawIn : "";
  const checkOut = checkIn && isIsoDate(rawOut) && rawOut > checkIn ? rawOut : "";
  const parsedGuests = rawGuests && /^\d{1,3}$/.test(rawGuests) ? Number(rawGuests) : 1;
  const guests = clampInt(parsedGuests, 1, maxGuestsFor(listing));

  const nights = checkIn && checkOut ? countNights(checkIn, checkOut) : 0;
  const long = isMonthlyStay(nights);
  const view: StayView = long ? "mes" : defaultView(listing);
  const months = long ? monthsFromNights(nights) : 1;
  return {
    view,
    checkIn,
    checkOut: view === "mes" && checkIn ? addMonthsIso(checkIn, months) : checkOut,
    months,
    guests,
  };
}

// ─── Estadía mínima ──────────────────────────────────────────────────────────

/**
 * Estadía mínima de la unidad para unas fechas. Nunca menos que la de la
 * unidad: la web no puede habilitar algo que el checkout rechace.
 *
 * - Sólo con llegada: la pista temprana del calendario, la regla de precio que
 *   gana la noche de llegada si pide más (temporada alta, fines de semana
 *   largos).
 * - Con llegada y salida: la regla del servidor (submitCheckout), el más alto
 *   entre la unidad y las reglas que tarifan ALGUNA noche de [llegada, salida).
 *   Una estadía que arranca antes de un finde largo con mínimo 3 pide 3 aunque
 *   la noche de llegada no tenga regla.
 */
export function effectiveMinNights(
  // pricing_rules opcional: el catálogo de /buscar (CatalogListing) también la usa.
  listing: Pick<WidgetListing, "min_nights" | "base_price"> & { pricing_rules?: UnitPricingRule[] | null },
  checkInIso: string | null | undefined,
  checkOutIso?: string | null,
): number {
  const base = Math.max(1, Math.round(Number(listing.min_nights) || 1));
  if (!checkInIso || !isIsoDate(checkInIso)) return base;
  const rules = listing.pricing_rules ?? [];
  const basePrice = Number(listing.base_price) || 0;
  const { rule } = priceForNight(checkInIso, basePrice, rules);
  const override = rule?.min_nights_override != null ? Math.round(Number(rule.min_nights_override)) : null;
  const arrival = override != null && Number.isFinite(override) && override > base ? override : base;
  if (!checkOutIso || !isIsoDate(checkOutIso) || checkOutIso <= checkInIso) return arrival;
  const pricedNights = computePricing({ checkInIso, checkOutIso, basePrice, cleaningFee: null, rules }).nights;
  return Math.max(arrival, stayMinNights({ unitMinNights: listing.min_nights, rules, pricedNights }));
}

// ─── Evaluación de la estadía ────────────────────────────────────────────────

export type StayIssue = "dates_order" | "past" | "blocked" | "min_nights" | "max_nights" | "guests_max" | "no_price";

export type WidgetCta =
  | { kind: "choose_dates"; label: string }
  | { kind: "change_dates"; label: string }
  | { kind: "fix_guests"; label: string }
  | { kind: "request"; label: string; href: string }
  | { kind: "instant"; label: string; href: string }
  | { kind: "consult"; label: string };

export type StayEvaluation =
  | { kind: "empty"; view: StayView; hint: string; cta: WidgetCta }
  | { kind: "invalid"; view: StayView; issue: StayIssue; message: string; nights: number; cta: WidgetCta }
  | {
      kind: "nightly";
      view: "noche";
      nights: number;
      subtotal: number;
      cleaningFee: number;
      total: number;
      avgNightly: number;
      /** Seña de la política (null = sin seña). */
      sena: number | null;
      /** "1 noche", "30 %"; null sin seña. */
      senaRule: string | null;
      /** Lo que se paga al llegar (total − seña). */
      resto: number;
      cta: WidgetCta;
    }
  | {
      kind: "monthly";
      view: StayView;
      /** view = el huésped eligió "Por mes"; long_stay = eligió 28+ noches por noche. */
      reason: "view" | "long_stay";
      nights: number | null;
      monthlyPrice: number | null;
      estimatedTotal: number | null;
      /** Hay noches ocupadas en el período (se consulta igual). */
      hasBlocked: boolean;
      cta: WidgetCta;
    };

export const CONSULT_CTA: WidgetCta = { kind: "consult", label: "Consultar por WhatsApp" };

/** Link al checkout (no pide login: se puede pedir sin cuenta). */
export function checkoutHref(unitId: string, checkIn: string, checkOut: string, guests: number): string {
  const params = new URLSearchParams({ checkin: checkIn, checkout: checkOut, huespedes: String(guests) });
  return `/checkout/${unitId}?${params.toString()}`;
}

function positive(v: number | null | undefined): number | null {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
}

export interface EvaluateStayParams {
  listing: WidgetListing;
  view: StayView;
  checkIn: string;
  checkOut: string;
  guests: number;
  blocked: ReadonlySet<string>;
  /** Hoy en Argentina (todayIsoAR). */
  today: string;
  policy: Pick<DepositPolicy, "rule" | "percent">;
}

function monthlyEvaluation(p: EvaluateStayParams, reason: "view" | "long_stay"): StayEvaluation {
  const { listing, checkIn, checkOut } = p;
  const monthly = positive(listing.monthly_price);
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    return { kind: "monthly", view: p.view, reason, nights: null, monthlyPrice: monthly, estimatedTotal: null, hasBlocked: false, cta: CONSULT_CTA };
  }
  const q = quoteStay({
    checkInIso: checkIn,
    checkOutIso: checkOut,
    basePrice: Number(listing.base_price) || 0,
    cleaningFee: listing.cleaning_fee,
    monthlyPrice: monthly,
    pricingRules: listing.pricing_rules ?? [],
    currency: listing.marketplace_currency,
  });
  return {
    kind: "monthly",
    view: p.view,
    reason,
    nights: q.nights,
    monthlyPrice: monthly,
    estimatedTotal: q.kind === "monthly" ? q.estimatedTotal : null,
    hasBlocked: rangeHasBlockedNight(p.blocked, checkIn, checkOut),
    cta: CONSULT_CTA,
  };
}

/**
 * Qué muestra el widget para lo elegido. Mismo orden de chequeos que el
 * checkout: fechas → 28+ noches (se consultan) → ocupación → mínimo/máximo de
 * noches → huéspedes → precio.
 */
export function evaluateStay(p: EvaluateStayParams): StayEvaluation {
  const { listing, checkIn, checkOut } = p;
  if (p.view === "mes" || !offersShortStays(listing)) return monthlyEvaluation(p, "view");

  const choose: WidgetCta = { kind: "choose_dates", label: "Elegir fechas" };
  const change: WidgetCta = { kind: "change_dates", label: "Cambiar fechas" };
  if (!checkIn) return { kind: "empty", view: "noche", hint: "Elegí tus fechas para ver el total.", cta: choose };
  if (!checkOut) return { kind: "empty", view: "noche", hint: "Elegí la fecha de salida.", cta: choose };
  if (checkOut <= checkIn) {
    return { kind: "invalid", view: "noche", issue: "dates_order", message: "La salida tiene que ser después de la llegada.", nights: 0, cta: change };
  }
  const nights = countNights(checkIn, checkOut);
  if (checkIn < p.today) {
    return { kind: "invalid", view: "noche", issue: "past", message: "Esa llegada ya pasó. Elegí otra fecha.", nights, cta: change };
  }
  if (isMonthlyStay(nights)) return monthlyEvaluation(p, "long_stay");
  if (rangeHasBlockedNight(p.blocked, checkIn, checkOut)) {
    return { kind: "invalid", view: "noche", issue: "blocked", message: "Algunas de esas noches ya están ocupadas. Probá con otras fechas.", nights, cta: change };
  }
  // El mínimo que exige el servidor (submitCheckout): el más alto entre la
  // unidad y las reglas de precio que tarifan ALGUNA noche de la estadía (no
  // sólo la de llegada, que es la pista temprana del calendario).
  const min = effectiveMinNights(listing, checkIn, checkOut);
  if (nights < min) {
    return { kind: "invalid", view: "noche", issue: "min_nights", message: `Para esas fechas la estadía mínima es de ${nightsLabel(min)}.`, nights, cta: change };
  }
  const max = positive(listing.max_nights);
  if (max != null && nights > max) {
    return { kind: "invalid", view: "noche", issue: "max_nights", message: `La estadía máxima es de ${nightsLabel(max)}.`, nights, cta: change };
  }
  const maxGuests = maxGuestsFor(listing);
  if (p.guests > maxGuests) {
    return { kind: "invalid", view: "noche", issue: "guests_max", message: `Este lugar recibe hasta ${guestsCountLabel(maxGuests)}.`, nights, cta: { kind: "fix_guests", label: "Cambiar huéspedes" } };
  }

  const q = quoteStay({
    checkInIso: checkIn,
    checkOutIso: checkOut,
    basePrice: Number(listing.base_price) || 0,
    cleaningFee: listing.cleaning_fee,
    monthlyPrice: positive(listing.monthly_price),
    pricingRules: listing.pricing_rules ?? [],
    currency: listing.marketplace_currency,
  });
  if (q.kind !== "nightly" || !(q.total > 0)) {
    return { kind: "invalid", view: "noche", issue: "no_price", message: "Consultanos el precio para esas fechas.", nights, cta: CONSULT_CTA };
  }
  const sena = computeSena({ policy: p.policy, nights: q.nights, subtotal: q.subtotal, total: q.total, currency: listing.marketplace_currency });
  const href = checkoutHref(listing.id, checkIn, checkOut, p.guests);
  return {
    kind: "nightly",
    view: "noche",
    nights: q.nights,
    subtotal: q.subtotal,
    cleaningFee: q.cleaningFee,
    total: q.total,
    avgNightly: q.avgNightly,
    sena,
    senaRule: sena != null ? depositRuleLabel(p.policy) : null,
    resto: restoAlLlegar(q.total, sena),
    cta: listing.instant_book
      ? { kind: "instant", label: "Reservar", href }
      : { kind: "request", label: "Pedir reserva", href },
  };
}

/** Pestañas del widget: "Por noches | Por mes" sólo si la unidad ofrece las dos. */
export function viewOptions(listing: Pick<WidgetListing, "default_mode" | "min_nights">): StayView[] {
  const short = offersShortStays(listing);
  const monthly = offersMonthlyStays(listing);
  if (short && monthly) return ["noche", "mes"];
  return short ? ["noche"] : ["mes"];
}

/**
 * Texto de la seña para "Cómo se paga" (ProcessSteps): el monto si ya hay una
 * cotización por noche, si no la regla ("1 noche", "30 %"). null = sin seña.
 */
export function senaStepLabel(
  evaluation: StayEvaluation | null,
  policy: Pick<DepositPolicy, "rule" | "percent">,
  currency: string,
): string | null {
  if (evaluation?.kind === "nightly") {
    return evaluation.sena != null ? formatCurrency(evaluation.sena, currency) : null;
  }
  return depositRuleLabel(policy);
}

// ─── Consultas (WhatsApp / mail) ─────────────────────────────────────────────

export interface ConsultParams {
  title: string;
  hood?: string | null;
  view: StayView;
  checkIn?: string | null;
  checkOut?: string | null;
  months?: number | null;
  guests?: number | null;
  /** Link absoluto a la ficha: le ahorra al equipo buscar de qué unidad se habla. */
  url?: string | null;
}

/** Mensaje precargado para consultar por una unidad (sin emojis). */
export function consultMessage(p: ConsultParams): string {
  const place = p.hood ? `${p.title} en ${p.hood}` : p.title;
  const guests = p.guests && p.guests > 0 ? `, para ${p.guests === 1 ? "1 persona" : `${p.guests} personas`}` : "";
  let text: string;
  if (p.view === "mes") {
    const from = p.checkIn && isIsoDate(p.checkIn) ? `, desde el ${longDayEs(p.checkIn)}` : "";
    const months = p.months && p.months > 0 ? ` por ${monthsLabel(p.months)}` : "";
    text = `Hola, quiero consultar por ${place} para una estadía por mes${from}${months}${guests}. ¿Me pasan el precio y las condiciones?`;
  } else {
    const dates =
      p.checkIn && p.checkOut && isIsoDate(p.checkIn) && isIsoDate(p.checkOut)
        ? `, del ${longDayEs(p.checkIn)} al ${longDayEs(p.checkOut)}`
        : "";
    text = `Hola, quiero consultar por ${place}${dates}${guests}.`;
  }
  return p.url ? `${text}\n${p.url}` : text;
}

/** Asunto del mail de consulta. */
export function consultSubject(p: Pick<ConsultParams, "title" | "view">): string {
  return p.view === "mes" ? `Consulta por mes: ${p.title}` : `Consulta: ${p.title}`;
}

/** mailto: con asunto y cuerpo precargados; null sin email. */
export function consultMailto(email: string | null | undefined, subject: string, body: string): string | null {
  const to = (email ?? "").trim();
  if (!to || !to.includes("@")) return null;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ─── Aviso ?error= (el checkout vuelve a la ficha cuando algo cambió) ───────

/**
 * Códigos que el checkout puede mandar en `/u/<slug>?error=<código>`. También
 * se aceptan los textos viejos de checkUnitAvailability. Cualquier otra cosa se
 * muestra con el genérico: el parámetro viene por URL y un link armado podría
 * poner cualquier texto dentro de un aviso "oficial".
 */
export const LISTING_ERROR_CODES = {
  fechas: "Las fechas no son válidas. Elegilas de nuevo en el calendario.",
  pasado: "Esa llegada ya pasó. Elegí fechas desde hoy.",
  ocupado: "Justo se ocuparon esas fechas. Probá con otras.",
  pendiente: "Alguien pidió esas fechas hace un rato y estamos esperando su confirmación. Probá con otras o volvé en unas horas.",
  minimo: "Esas fechas no llegan a la estadía mínima de este lugar.",
  maximo: "Esas fechas superan la estadía máxima de este lugar.",
  huespedes: "Este lugar no recibe tantos huéspedes. Revisá la cantidad.",
  mensual: "Las estadías de 28 noches o más se consultan: escribinos y te pasamos el precio por mes.",
  no_disponible: "Este lugar no está disponible para esas fechas. Probá con otras.",
} as const;

export type ListingErrorCode = keyof typeof LISTING_ERROR_CODES;

const LEGACY_ERROR_TEXTS: Record<string, ListingErrorCode> = {
  "Las fechas son inválidas": "fechas",
  "Esas fechas ya están reservadas": "ocupado",
  "Hay una solicitud pendiente para esas fechas. Probá con otras o esperá unas horas.": "pendiente",
  "No podés reservar fechas pasadas": "pasado",
};

const ERROR_ALIASES: Record<string, ListingErrorCode> = {
  invalid_dates: "fechas",
  dates: "fechas",
  past: "pasado",
  unavailable: "ocupado",
  taken: "ocupado",
  ocupada: "ocupado",
  ocupadas: "ocupado",
  overlap: "ocupado",
  pending: "pendiente",
  min_nights: "minimo",
  max_nights: "maximo",
  guests: "huespedes",
  guests_count: "huespedes",
  monthly: "mensual",
  not_available: "no_disponible",
};

export const LISTING_ERROR_FALLBACK =
  "No pudimos seguir con esas fechas. Revisá la disponibilidad y probá de nuevo.";

/** Texto del aviso para un `?error=`; null si no vino nada. */
export function listingErrorMessage(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const code = value.toLowerCase();
  if (code in LISTING_ERROR_CODES) return LISTING_ERROR_CODES[code as ListingErrorCode];
  if (ERROR_ALIASES[code]) return LISTING_ERROR_CODES[ERROR_ALIASES[code]];
  if (LEGACY_ERROR_TEXTS[value]) return LISTING_ERROR_CODES[LEGACY_ERROR_TEXTS[value]];
  return LISTING_ERROR_FALLBACK;
}

// ─── Texto de la ficha ───────────────────────────────────────────────────────

export type DescriptionBlock = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] };

const BULLET_RE = /^\s*(?:[•·●▪◦*\-–—]|\d{1,2}[.)])\s+/;

/**
 * Parte la descripción que carga el equipo en párrafos y listas, respetando
 * los saltos de línea y las viñetas ("•", "-", "*", "1."). Nada de HTML: el
 * texto se muestra tal cual, sólo cambia la estructura.
 */
export function descriptionBlocks(raw: string | null | undefined): DescriptionBlock[] {
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const blocks: DescriptionBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "ul", items: list });
    list = [];
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (BULLET_RE.test(line)) {
      flushPara();
      const item = line.replace(BULLET_RE, "").trim();
      if (item) list.push(item);
      continue;
    }
    flushList();
    para.push(line.replace(/\s+/g, " "));
  }
  flushPara();
  flushList();
  return blocks;
}

/** Largo "visible" de la descripción (para decidir si se colapsa con "Leer más"). */
export function descriptionWeight(blocks: DescriptionBlock[]): number {
  return blocks.reduce((sum, b) => {
    const parts = b.kind === "p" ? b.lines : b.items;
    return sum + parts.reduce((s, l) => s + l.length + 40, 0);
  }, 0);
}

// ─── Otros lugares ───────────────────────────────────────────────────────────

type SimilarCandidate = Pick<CatalogListing, "id" | "hood_slug" | "bedrooms" | "offers_short" | "offers_monthly">;

/**
 * "Otros lugares en {barrio}": primero los del mismo barrio (en el orden
 * recomendado del catálogo); si no alcanzan, se completa con los que se
 * alquilan igual (por noche / por mes) y tienen ambientes parecidos, y después
 * con el resto. `sameHoodOnly` decide el título de la sección.
 */
export function pickSimilarListings<T extends SimilarCandidate>(
  catalog: readonly T[],
  current: SimilarCandidate,
  limit = 4,
): { items: T[]; sameHoodOnly: boolean } {
  const others = catalog.filter((l) => l.id !== current.id);
  const sameHood = current.hood_slug ? others.filter((l) => l.hood_slug === current.hood_slug) : [];
  if (sameHood.length >= limit) return { items: sameHood.slice(0, limit), sameHoodOnly: true };

  const picked = new Set(sameHood.map((l) => l.id));
  const bedrooms = current.bedrooms == null ? null : Number(current.bedrooms);
  const alike = others.filter(
    (l) =>
      !picked.has(l.id) &&
      ((current.offers_short && l.offers_short) || (!current.offers_short && l.offers_monthly)) &&
      (bedrooms == null || l.bedrooms == null || Math.abs(Number(l.bedrooms) - bedrooms) <= 1),
  );
  for (const l of alike) picked.add(l.id);
  const rest = others.filter((l) => !picked.has(l.id));
  const items = [...sameHood, ...alike, ...rest].slice(0, limit);
  return { items, sameHoodOnly: items.length > 0 && items.every((l) => sameHood.includes(l)) };
}

// ─── SEO ─────────────────────────────────────────────────────────────────────

type MetaListing = Pick<CatalogListing, "display_title" | "hood" | "summary_line" | "max_guests" | "instant_book" | "offers_short">;

/** Título de la ficha (el layout agrega " · apart"): "Paraná · Nueva Córdoba". */
export function listingMetaTitle(l: Pick<CatalogListing, "display_title" | "hood">): string {
  return l.hood ? `${l.display_title} · ${l.hood}` : l.display_title;
}

/**
 * "Depto de 1 dormitorio en Nueva Córdoba para hasta 2 huéspedes. Pedí tus
 * fechas sin pagar nada." — armada con datos reales, nunca con la descripción
 * cruda del PMS.
 */
export function listingMetaDescription(l: MetaListing): string {
  const n = Number(l.max_guests);
  const guests = Number.isFinite(n) && n > 0 ? (n === 1 ? " para 1 huésped" : ` para hasta ${n} huéspedes`) : "";
  const cta = !l.offers_short
    ? "Estadías por mes: consultá precio y condiciones."
    : l.instant_book
      ? "Reservá al instante sin pagar nada por adelantado."
      : "Pedí tus fechas sin pagar nada.";
  return `${l.summary_line}${guests}. ${cta}`;
}

/** Imagen de marca para compartir (1200×630) cuando no hay portada transformable. */
export const BRAND_OG_IMAGE = {
  url: "/apart/og.jpg",
  width: 1200,
  height: 630,
  alt: "apart — Alquileres temporarios en Córdoba",
} as const;

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/**
 * La portada lista para og:image: WhatsApp y compañía no muestran vista previa
 * de un original de hasta 2 MB, así que se pide al endpoint de transformación
 * de Supabase (`render/image`) recortada a 1200×630. Devuelve null si la URL
 * no es un objeto público de Supabase (no se puede transformar): ahí va la
 * imagen de marca.
 */
export function listingOgImageUrl(coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null;
  let url: URL;
  try {
    url = new URL(coverUrl);
  } catch {
    return null;
  }
  const marker = "/storage/v1/object/public/";
  if (!url.pathname.includes(marker)) return null;
  url.pathname = url.pathname.replace(marker, "/storage/v1/render/image/public/");
  url.searchParams.set("width", String(OG_IMAGE_WIDTH));
  url.searchParams.set("height", String(OG_IMAGE_HEIGHT));
  url.searchParams.set("resize", "cover");
  url.searchParams.set("quality", "75");
  return url.toString();
}
