import type { UnitPricingRule } from "@/lib/types/database";
import { computePricing, countNights, type PricingBreakdown } from "@/lib/marketplace/pricing";
import { effectiveMinNights, isValidIsoDate } from "@/lib/marketplace/reservation-view";
import { isMonthlyStay } from "@/lib/marketplace/stay";

/**
 * Qué puede mostrar el checkout ANTES de pintar el formulario: si la estadía
 * que llega por URL no se puede pedir, el huésped vuelve a la ficha con un
 * aviso claro (`/u/<slug>?error=<código>`, whitelist de la ficha) en vez de
 * completar sus datos para chocar recién al enviar.
 */

/** Códigos de la whitelist de avisos de la ficha (`listingErrorMessage`). */
export type CheckoutRedirectCode =
  | "fechas"
  | "pasado"
  | "ocupado"
  | "pendiente"
  | "minimo"
  | "maximo"
  | "huespedes"
  | "mensual"
  | "no_disponible";

export interface CheckoutGuardListing {
  base_price: number;
  cleaning_fee: number | null;
  pricing_rules: UnitPricingRule[];
  min_nights: number | null;
  max_nights: number | null;
  max_guests: number | null;
}

export type CheckoutGuardResult =
  | {
      ok: true;
      checkIn: string;
      checkOut: string;
      guests: number;
      nights: number;
      pricing: PricingBreakdown;
    }
  | {
      ok: false;
      /** null = no vino ninguna fecha: volver a la ficha sin aviso. */
      code: CheckoutRedirectCode | null;
      /** Qué parámetros conviene conservar al volver a la ficha. */
      keep: { checkIn: string | null; checkOut: string | null; guests: number | null };
    };

const first = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Huéspedes de la URL: entero ≥ 1 (lo raro, 1). */
export function parseGuests(raw: string | string[] | null | undefined): number {
  const n = Number.parseInt(first(raw) ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : 1;
}

export function evaluateCheckoutStay(p: {
  checkIn: string | string[] | null | undefined;
  checkOut: string | string[] | null | undefined;
  guests: string | string[] | null | undefined;
  todayIso: string;
  listing: CheckoutGuardListing;
}): CheckoutGuardResult {
  const checkIn = first(p.checkIn);
  const checkOut = first(p.checkOut);
  const guests = parseGuests(p.guests);

  if (!checkIn && !checkOut) return { ok: false, code: null, keep: { checkIn: null, checkOut: null, guests } };
  if (!isValidIsoDate(checkIn) || !isValidIsoDate(checkOut) || checkOut! <= checkIn!) {
    return { ok: false, code: "fechas", keep: { checkIn: null, checkOut: null, guests } };
  }
  const keep = { checkIn, checkOut, guests };
  if (checkIn! < p.todayIso) return { ok: false, code: "pasado", keep: { checkIn: null, checkOut: null, guests } };

  const nights = countNights(checkIn!, checkOut!);
  if (nights < 1) return { ok: false, code: "fechas", keep: { checkIn: null, checkOut: null, guests } };
  if (isMonthlyStay(nights)) return { ok: false, code: "mensual", keep };

  const { listing } = p;
  if (listing.max_guests && guests > listing.max_guests) return { ok: false, code: "huespedes", keep };

  const pricing = computePricing({
    checkInIso: checkIn!,
    checkOutIso: checkOut!,
    basePrice: Number(listing.base_price ?? 0),
    cleaningFee: listing.cleaning_fee,
    rules: listing.pricing_rules ?? [],
  });
  const minNights = effectiveMinNights({
    unitMinNights: listing.min_nights,
    rules: listing.pricing_rules ?? [],
    pricedNights: pricing.nights,
  });
  if (nights < minNights) return { ok: false, code: "minimo", keep };
  if (listing.max_nights && nights > listing.max_nights) return { ok: false, code: "maximo", keep };
  if (!(pricing.total > 0)) return { ok: false, code: "no_disponible", keep };

  return { ok: true, checkIn: checkIn!, checkOut: checkOut!, guests, nights, pricing };
}

/**
 * Motivo de `checkUnitAvailability` → código de aviso. `null` = no se pudo
 * verificar (error de lectura): el checkout sigue y `submitCheckout` vuelve a
 * chequear al enviar.
 */
export function availabilityRedirectCode(reason: string | null | undefined): CheckoutRedirectCode | null {
  const r = (reason ?? "").trim();
  if (!r || r.startsWith("Error")) return null;
  if (/inv[aá]lid/i.test(r)) return "fechas";
  if (/solicitud pendiente/i.test(r)) return "pendiente";
  if (/reservad|ocupad/i.test(r)) return "ocupado";
  return "no_disponible";
}

/** `/u/<slug>?checkin&checkout&huespedes&error` para volver a la ficha. */
export function listingReturnPath(
  slug: string,
  keep: { checkIn: string | null; checkOut: string | null; guests: number | null },
  code: CheckoutRedirectCode | null,
): string {
  const q = new URLSearchParams();
  if (keep.checkIn && keep.checkOut) {
    q.set("checkin", keep.checkIn);
    q.set("checkout", keep.checkOut);
  }
  if (keep.guests && keep.guests > 1) q.set("huespedes", String(keep.guests));
  if (code) q.set("error", code);
  const s = q.toString();
  return `/u/${encodeURIComponent(slug)}${s ? `?${s}` : ""}`;
}
