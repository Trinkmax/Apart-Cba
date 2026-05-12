import type { UnitPricingRule } from "@/lib/types/database";

export type PricingNight = {
  date: string;
  price: number;
  rule_id: string | null;
  rule_name: string | null;
};

export type PricingBreakdown = {
  nights: PricingNight[];
  subtotal: number;
  cleaning_fee: number;
  total: number;
  nights_count: number;
  /** Mediana del precio por noche (más representativa que el promedio para mostrar al usuario). */
  avg_price_per_night: number;
};

/**
 * Suma N días a una fecha ISO (YYYY-MM-DD).
 * Trabajamos siempre en UTC para no tener saltos por DST.
 */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Devuelve true si dateIso (YYYY-MM-DD) cae en `start..end` (ambos inclusive, formato ISO). */
function isWithinRange(dateIso: string, start: string, end: string): boolean {
  return dateIso >= start && dateIso <= end;
}

/** Día de semana 0..6 (0=Domingo) en UTC, consistente con `extract(dow from ...)` de Postgres. */
function dayOfWeekUtc(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * Resuelve el precio de UNA noche aplicando las pricing rules.
 * Estrategia: entre todas las reglas que matchean para esa fecha,
 * gana la de mayor `priority`. Si hay empate, las de tipo "date_range" ganan
 * a las de "weekday" (más específicas).
 *
 * Soporta `price_override` (precio absoluto) o `price_multiplier` sobre base_price.
 */
export function priceForNight(
  dateIso: string,
  basePrice: number,
  rules: UnitPricingRule[]
): { price: number; rule: UnitPricingRule | null } {
  const dow = dayOfWeekUtc(dateIso);
  const matching = rules.filter((r) => {
    if (!r.active) return false;
    if (r.rule_type === "date_range") {
      return (
        r.start_date !== null &&
        r.end_date !== null &&
        isWithinRange(dateIso, r.start_date, r.end_date)
      );
    }
    // weekday
    return (r.days_of_week ?? []).includes(dow);
  });

  if (matching.length === 0) {
    return { price: basePrice, rule: null };
  }

  matching.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // empate: date_range gana a weekday
    if (a.rule_type !== b.rule_type) {
      return a.rule_type === "date_range" ? -1 : 1;
    }
    return 0;
  });

  const winner = matching[0];
  const price =
    winner.price_override !== null
      ? Number(winner.price_override)
      : Number(basePrice) * Number(winner.price_multiplier ?? 1);

  return { price: Math.round(price * 100) / 100, rule: winner };
}

/**
 * Devuelve el desglose completo del precio para un rango [checkIn, checkOut).
 * checkIn inclusive, checkOut exclusive (es noche de salida, no se cobra).
 */
export function computePricing(params: {
  checkInIso: string;
  checkOutIso: string;
  basePrice: number;
  cleaningFee: number | null;
  rules: UnitPricingRule[];
}): PricingBreakdown {
  const nights: PricingNight[] = [];
  let cursor = params.checkInIso;
  let safety = 0;
  while (cursor < params.checkOutIso && safety < 366 * 3) {
    const { price, rule } = priceForNight(cursor, params.basePrice, params.rules);
    nights.push({
      date: cursor,
      price,
      rule_id: rule?.id ?? null,
      rule_name: rule?.name ?? null,
    });
    cursor = addDaysIso(cursor, 1);
    safety++;
  }
  const subtotal = nights.reduce((acc, n) => acc + n.price, 0);
  const cleaning = Number(params.cleaningFee ?? 0);
  const total = Math.round((subtotal + cleaning) * 100) / 100;
  const avg = nights.length > 0 ? subtotal / nights.length : 0;
  return {
    nights,
    subtotal: Math.round(subtotal * 100) / 100,
    cleaning_fee: Math.round(cleaning * 100) / 100,
    total,
    nights_count: nights.length,
    avg_price_per_night: Math.round(avg * 100) / 100,
  };
}

/** Cuenta noches entre dos fechas ISO. checkOut > checkIn. */
export function countNights(checkInIso: string, checkOutIso: string): number {
  const start = new Date(`${checkInIso}T00:00:00Z`).getTime();
  const end = new Date(`${checkOutIso}T00:00:00Z`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/** Formatea moneda al locale es-AR. */
export function formatCurrency(amount: number, currency: string = "ARS"): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
  }
}
