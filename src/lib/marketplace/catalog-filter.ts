import type { CatalogListing } from "./contracts";
import { addDaysIso, countNights } from "./pricing";
import { headlinePrice, isMonthlyStay, quoteStay } from "./stay";
import { effectiveMinNights } from "./widget-quote";

/**
 * Búsqueda de la web (/buscar): el catálogo entero (~45 unidades) llega
 * cacheado y se filtra en el cliente. Todo lo de acá es puro y testeado:
 * lectura/escritura de la URL (contrato de SPEC 20), filtros, orden, conteo
 * por barrio y el precio que muestra cada tarjeta.
 */

export type SearchMode = "noche" | "mes";
export type SearchSort = "recomendado" | "precio_asc" | "precio_desc";

export const MAX_GUESTS_FILTER = 12;
export const MAX_MONTHS = 12;
/** Dormitorios: 0 = monoambiente, 3 = "3 o más". */
export const BEDROOM_OPTIONS = [0, 1, 2, 3] as const;

export interface SearchState {
  /** Pestaña pedida en la URL (`modo`). La vista real puede pasar a "mes" (28+ noches). */
  mode: SearchMode;
  checkIn: string | null;
  /** Salida (modo noche). En modo mes se deriva de `months`. */
  checkOut: string | null;
  /** Cantidad de meses (modo mes). */
  months: number | null;
  guests: number | null;
  /** Slug del barrio ("nueva-cordoba"). */
  hood: string | null;
  bedrooms: number | null;
  priceMax: number | null;
  instant: boolean;
  sort: SearchSort;
}

export const EMPTY_SEARCH: SearchState = {
  mode: "noche",
  checkIn: null,
  checkOut: null,
  months: null,
  guests: null,
  hood: null,
  bedrooms: null,
  priceMax: null,
  instant: false,
  sort: "recomendado",
};

// ─── Fechas ──────────────────────────────────────────────────────────────────

/** YYYY-MM-DD que además es una fecha real (nada de 2026-02-31). */
export function isIsoDate(raw: string | null | undefined): raw is string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Suma meses calendario; si el día no existe (31 → feb) queda en el último del mes. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Rango [llegada, salida) de la búsqueda, o null si está incompleto. */
export function searchRange(state: SearchState): { checkIn: string; checkOut: string; nights: number } | null {
  if (!state.checkIn) return null;
  const checkOut =
    state.mode === "mes"
      ? state.months
        ? addMonthsIso(state.checkIn, state.months)
        : null
      : state.checkOut;
  if (!checkOut || checkOut <= state.checkIn) return null;
  return { checkIn: state.checkIn, checkOut, nights: countNights(state.checkIn, checkOut) };
}

/**
 * La vista que se muestra: una búsqueda por noches de 28+ noches pasa a "mes"
 * (esas estadías se consultan). `autoMonthly` activa el aviso.
 */
export function effectiveView(state: SearchState): { view: SearchMode; autoMonthly: boolean } {
  if (state.mode === "mes") return { view: "mes", autoMonthly: false };
  const range = searchRange(state);
  if (range && isMonthlyStay(range.nights)) return { view: "mes", autoMonthly: true };
  return { view: "noche", autoMonthly: false };
}

// ─── URL ─────────────────────────────────────────────────────────────────────

type ParamReader = { get(key: string): string | null };

function readInt(raw: string | null, min: number, max: number): number | null {
  if (raw == null || !/^\d{1,9}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : null;
}

/** Lee `/buscar?…` (SPEC 20 · D8). Todo lo inválido se ignora en silencio. */
export function parseSearchState(params: ParamReader): SearchState {
  const modoRaw = (params.get("modo") ?? "").toLowerCase();
  const mode: SearchMode = modoRaw === "mes" || modoRaw === "mensual" ? "mes" : "noche";

  const checkInRaw = params.get("checkin");
  const checkIn = isIsoDate(checkInRaw) ? checkInRaw : null;
  const checkOutRaw = params.get("checkout");
  let checkOut = isIsoDate(checkOutRaw) && checkIn && checkOutRaw > checkIn ? checkOutRaw : null;

  let months = readInt(params.get("meses"), 1, MAX_MONTHS);
  if (mode === "mes") {
    // Un link viejo de "mensual" puede traer checkout en vez de meses.
    if (!months && checkIn && checkOut) {
      months = Math.min(MAX_MONTHS, Math.max(1, Math.round(countNights(checkIn, checkOut) / 30)));
    }
    if (checkIn && !months) months = 1;
    checkOut = null;
  } else {
    months = null;
  }

  const hoodRaw = (params.get("barrio") ?? "").trim().toLowerCase();
  const orderRaw = params.get("orden");
  const sort: SearchSort =
    orderRaw === "precio_asc" || orderRaw === "precio_desc" ? orderRaw : "recomendado";

  return {
    mode,
    checkIn,
    checkOut,
    months: checkIn ? months : null,
    guests: readInt(params.get("huespedes"), 1, 30),
    hood: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hoodRaw) ? hoodRaw : null,
    bedrooms: readInt(params.get("dormitorios"), 0, 3),
    priceMax: readInt((params.get("precio_max") ?? "").replace(/\./g, ""), 1, 999_999_999),
    instant: params.get("inmediata") === "1",
    sort,
  };
}

/** Escribe el estado en la URL: sólo lo que no es default, en un orden estable. */
export function searchStateToParams(state: SearchState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.mode === "mes") p.set("modo", "mes");
  if (state.checkIn) {
    if (state.mode === "mes") {
      p.set("checkin", state.checkIn);
      p.set("meses", String(state.months ?? 1));
    } else if (state.checkOut && state.checkOut > state.checkIn) {
      p.set("checkin", state.checkIn);
      p.set("checkout", state.checkOut);
    } else {
      p.set("checkin", state.checkIn);
    }
  }
  if (state.guests) p.set("huespedes", String(state.guests));
  if (state.hood) p.set("barrio", state.hood);
  if (state.bedrooms != null) p.set("dormitorios", String(state.bedrooms));
  if (state.priceMax) p.set("precio_max", String(state.priceMax));
  if (state.instant) p.set("inmediata", "1");
  if (state.sort !== "recomendado") p.set("orden", state.sort);
  return p;
}

export function searchHref(state: SearchState): string {
  const qs = searchStateToParams(state).toString();
  return qs ? `/buscar?${qs}` : "/buscar";
}

// ─── Precio de una tarjeta ───────────────────────────────────────────────────

export type StayInput = { checkIn: string; checkOut: string; guests?: number } | null | undefined;

export type CardPrice =
  | { kind: "total"; total: number; nights: number; nightly: number; currency: string }
  | { kind: "amount"; amount: number; per: "noche" | "mes"; currency: string }
  | { kind: "consult" };

/**
 * Lo que muestra la tarjeta: con fechas (vista noche, < 28 noches) el total de
 * la estadía con `quoteStay` (misma cuenta que el checkout); si no, el precio
 * titular de la pestaña (`headlinePrice`).
 * El catálogo trae las reglas de precio activas (`pricing_rules`): sin ellas
 * la cuenta es con la tarifa base.
 */
export function cardPrice(listing: CatalogListing, view: SearchMode, stay?: StayInput): CardPrice {
  const currency = listing.marketplace_currency || "ARS";
  if (stay && view === "noche" && listing.offers_short && isIsoDate(stay.checkIn) && isIsoDate(stay.checkOut)) {
    const nights = stay.checkOut > stay.checkIn ? countNights(stay.checkIn, stay.checkOut) : 0;
    if (nights >= 1 && !isMonthlyStay(nights) && Number(listing.base_price) > 0) {
      const rules = listing.pricing_rules ?? [];
      const quote = quoteStay({
        checkInIso: stay.checkIn,
        checkOutIso: stay.checkOut,
        basePrice: Number(listing.base_price),
        cleaningFee: listing.cleaning_fee,
        monthlyPrice: listing.monthly_price,
        pricingRules: rules,
        currency,
      });
      if (quote.kind === "nightly" && quote.total > 0) {
        return { kind: "total", total: quote.total, nights: quote.nights, nightly: quote.avgNightly, currency };
      }
    }
  }
  const headline = headlinePrice(listing, view);
  return headline.kind === "amount" ? { ...headline, currency } : headline;
}

/** Monto para ordenar/filtrar por precio (null = "a consultar"). */
export function priceKey(listing: CatalogListing, view: SearchMode, stay?: StayInput): number | null {
  const p = cardPrice(listing, view, stay);
  if (p.kind === "total") return p.total;
  if (p.kind === "amount") return p.amount;
  return null;
}

/** /u/<slug> con las fechas y huéspedes de la búsqueda (si hay). */
export function listingHref(slug: string, stay?: StayInput): string {
  const base = `/u/${encodeURIComponent(slug)}`;
  if (!stay || !isIsoDate(stay.checkIn) || !isIsoDate(stay.checkOut) || stay.checkOut <= stay.checkIn) {
    return base;
  }
  const p = new URLSearchParams({ checkin: stay.checkIn, checkout: stay.checkOut });
  if (stay.guests && stay.guests > 0) p.set("huespedes", String(stay.guests));
  return `${base}?${p.toString()}`;
}

// ─── Filtros ─────────────────────────────────────────────────────────────────

export type FilterOptions = {
  /** Ids ocupados en el rango (getCatalogAvailability); null = sin chequear. */
  unavailable?: ReadonlySet<string> | null;
  /** Ignorar el barrio (para contar por barrio). */
  ignoreHood?: boolean;
};

/** ¿La unidad entra en la búsqueda? (sin mirar disponibilidad ni barrio si se pide). */
export function matchesSearch(listing: CatalogListing, state: SearchState, opts: FilterOptions = {}): boolean {
  const { view } = effectiveView(state);
  if (view === "noche" ? !listing.offers_short : !listing.offers_monthly) return false;
  if (!opts.ignoreHood && state.hood && listing.hood_slug !== state.hood) return false;
  if (state.guests && listing.max_guests != null && listing.max_guests < state.guests) return false;

  if (state.bedrooms != null) {
    const b = listing.bedrooms;
    if (b == null) return false;
    if (state.bedrooms >= 3 ? b < 3 : b !== state.bedrooms) return false;
  }

  if (view === "noche" && state.instant && !listing.instant_book) return false;

  const range = searchRange(state);
  if (range && view === "noche") {
    // Mismo mínimo que la ficha y el checkout: el de la unidad o el de una regla
    // de precio (finde largo, temporada) que tarifa alguna noche del rango.
    const min = effectiveMinNights(listing, range.checkIn, range.checkOut);
    if (range.nights < min) return false;
    if (listing.max_nights != null && listing.max_nights > 0 && range.nights > listing.max_nights) return false;
  }

  if (state.priceMax) {
    const stay = range && view === "noche" ? { checkIn: range.checkIn, checkOut: range.checkOut } : null;
    // El tope es por noche (o por mes): con fechas comparamos el promedio por noche.
    const p = cardPrice(listing, view, stay);
    const amount = p.kind === "total" ? p.nightly : p.kind === "amount" ? p.amount : null;
    if (amount == null || amount > state.priceMax) return false;
  }

  if (range && opts.unavailable?.has(listing.id)) return false;
  return true;
}

export function filterCatalog(
  listings: readonly CatalogListing[],
  state: SearchState,
  opts: FilterOptions = {},
): CatalogListing[] {
  return listings.filter((l) => matchesSearch(l, state, opts));
}

/** Ordena sin mutar. "recomendado" respeta el orden del catálogo; "a consultar" va al final. */
export function sortListings(
  listings: readonly CatalogListing[],
  state: SearchState,
): CatalogListing[] {
  if (state.sort === "recomendado") return [...listings];
  const { view } = effectiveView(state);
  const range = searchRange(state);
  const stay = range && view === "noche" ? { checkIn: range.checkIn, checkOut: range.checkOut } : null;
  const dir = state.sort === "precio_asc" ? 1 : -1;
  return listings
    .map((l, i) => ({ l, i, k: priceKey(l, view, stay) }))
    .sort((a, b) => {
      if (a.k == null && b.k == null) return a.i - b.i;
      if (a.k == null) return 1;
      if (b.k == null) return -1;
      return a.k === b.k ? a.i - b.i : (a.k - b.k) * dir;
    })
    .map((x) => x.l);
}

/** Conteo por barrio con los demás filtros aplicados (chips). */
export function hoodCounts(
  listings: readonly CatalogListing[],
  state: SearchState,
  unavailable?: ReadonlySet<string> | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of listings) {
    if (!l.hood_slug) continue;
    if (!matchesSearch(l, state, { unavailable, ignoreHood: true })) continue;
    counts.set(l.hood_slug, (counts.get(l.hood_slug) ?? 0) + 1);
  }
  return counts;
}

/** Cuántos filtros del panel "Filtros" están activos (dormitorios, precio, inmediata). */
export function activeFilterCount(state: SearchState): number {
  const { view } = effectiveView(state);
  return (
    (state.bedrooms != null ? 1 : 0) +
    (state.priceMax ? 1 : 0) +
    (state.instant && view === "noche" ? 1 : 0)
  );
}

// ─── Etiquetas es-AR (deterministas: no dependen del ICU del navegador) ──────

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function isoParts(iso: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "3 oct" (o "vie 3 oct" con `weekday`). */
export function shortDateLabel(iso: string, opts: { weekday?: boolean } = {}): string {
  const { m, d, dow } = isoParts(iso);
  const base = `${d} ${MONTHS_SHORT[m - 1]}`;
  return opts.weekday ? `${WEEKDAYS_SHORT[dow]} ${base}` : base;
}

/** "3–6 oct", "30 sep – 2 oct", "28 dic – 3 ene". */
export function rangeLabel(checkIn: string, checkOut: string): string {
  const a = isoParts(checkIn);
  const b = isoParts(checkOut);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_SHORT[b.m - 1]}`;
  return `${shortDateLabel(checkIn)} – ${shortDateLabel(checkOut)}`;
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

/** Resumen de la búsqueda para la píldora de /buscar ("3–6 oct · 2 huéspedes"). */
export function stayLabel(state: SearchState): { dates: string | null; guests: string | null } {
  let dates: string | null = null;
  if (state.checkIn) {
    if (state.mode === "mes") {
      dates = `Desde ${shortDateLabel(state.checkIn)} · ${monthsLabel(state.months ?? 1)}`;
    } else if (state.checkOut && state.checkOut > state.checkIn) {
      dates = rangeLabel(state.checkIn, state.checkOut);
    } else {
      dates = `Desde ${shortDateLabel(state.checkIn)}`;
    }
  }
  return { dates, guests: state.guests ? guestsCountLabel(state.guests) : null };
}

/** Mañana (AR) como sugerencia de llegada cuando no se eligió nada. */
export function nextDayIso(iso: string): string {
  return addDaysIso(iso, 1);
}
