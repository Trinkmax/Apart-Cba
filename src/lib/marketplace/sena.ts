import type { DepositRule } from "@/lib/types/database";

/**
 * La seña de las reservas de la web.
 *
 * Así cobra Apart: el equipo confirma la reserva, el huésped transfiere una
 * seña (por defecto, el valor de una noche) y el resto se paga al llegar.
 * La seña NO se registra sola en Caja: la registra una persona cuando entra la
 * transferencia (addBookingPayment), y recién ahí sube `bookings.paid_amount`.
 *
 * Tres números tienen que coincidir en todos lados —lo que ve el huésped al
 * pedir, lo que propone el modal de aprobación y lo que dice el email—, por eso
 * la cuenta vive acá y no en cada pantalla.
 */

export interface DepositPolicy {
  rule: DepositRule;
  /** Sólo para rule = "percent" (1–100). */
  percent: number | null;
  /** Horas para transferir la seña desde la confirmación. */
  dueHours: number;
}

export const DEFAULT_DEPOSIT_POLICY: DepositPolicy = {
  rule: "one_night",
  percent: null,
  dueHours: 24,
};

/** Pesos enteros para ARS; centavos para el resto de las monedas. */
export function roundMoney(amount: number, currency: string = "ARS"): number {
  if (!Number.isFinite(amount)) return 0;
  if (currency.toUpperCase() === "ARS") return Math.round(amount);
  return Math.round(amount * 100) / 100;
}

/**
 * Seña que corresponde a una estadía según la política de la organización.
 *
 * - one_night: subtotal ÷ noches — el valor de una noche SIN la limpieza. Con
 *   reglas de precio (fines de semana, temporada) es el promedio por noche.
 * - percent:   el % del total.
 * - none:      null — no se pide seña.
 *
 * Nunca supera el total. Devuelve null cuando no hay nada que pedir.
 */
export function computeSena(params: {
  policy: Pick<DepositPolicy, "rule" | "percent">;
  nights: number;
  subtotal: number;
  total: number;
  currency?: string;
}): number | null {
  const { policy, nights, subtotal, total } = params;
  const currency = params.currency ?? "ARS";
  if (!Number.isFinite(total) || total <= 0) return null;

  let raw: number;
  switch (policy.rule) {
    case "none":
      return null;
    case "percent": {
      const pct = Number(policy.percent);
      if (!Number.isFinite(pct) || pct <= 0) return null;
      raw = (total * Math.min(pct, 100)) / 100;
      break;
    }
    case "one_night":
    default: {
      if (!Number.isFinite(nights) || nights <= 0) return null;
      const base = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : total;
      raw = base / nights;
      break;
    }
  }

  const sena = roundMoney(Math.min(raw, total), currency);
  return sena > 0 ? sena : null;
}

/** Lo que queda para pagar al llegar. Nunca negativo. */
export function restoAlLlegar(total: number, sena: number | null): number {
  const t = Number.isFinite(total) ? total : 0;
  const s = sena != null && Number.isFinite(sena) ? sena : 0;
  return Math.max(0, t - s);
}

/** Vencimiento de la seña: momento de la confirmación + `dueHours` horas. */
export function senaDueAt(confirmedAtIso: string, dueHours: number): string {
  const base = Date.parse(confirmedAtIso);
  const hours = Number.isFinite(dueHours) && dueHours > 0 ? dueHours : DEFAULT_DEPOSIT_POLICY.dueHours;
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Lo que falta transferir de la seña, descontando lo ya cobrado en Caja
 * (un pago parcial registrado por el equipo). Nunca negativo; sin seña → 0.
 */
export function senaRemaining(sena: number | null | undefined, paid: number | null | undefined): number {
  const s = sena != null && Number.isFinite(sena) ? sena : 0;
  const p = paid != null && Number.isFinite(paid) ? Math.max(0, paid) : 0;
  return Math.max(0, s - p);
}

/**
 * ¿Lo cobrado ya cubre la seña? Sin seña (null o 0) → cubierta. Se tolera un
 * peso de diferencia por redondeos entre lo pedido y lo transferido.
 */
export function isSenaCovered(paid: number | null | undefined, sena: number | null | undefined): boolean {
  const s = sena != null && Number.isFinite(sena) ? sena : 0;
  if (s <= 0) return true;
  const p = paid != null && Number.isFinite(paid) ? paid : 0;
  return p >= s - 1;
}

/**
 * Seña vigente de una reserva de la web: la que fijó el equipo al confirmar
 * (`bookings.deposit_amount`) manda; si no hay, la estimada al pedir
 * (`booking_requests.deposit_estimate`); si tampoco, la que da la regla.
 * Un 0 explícito del equipo significa "sin seña".
 */
export function resolveBookingSena(params: {
  depositAmount: number | null | undefined;
  estimate: number | null | undefined;
  fallback: number | null | undefined;
}): number | null {
  const pick = (v: number | null | undefined) =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  const deposit = pick(params.depositAmount);
  if (deposit != null) return deposit > 0 ? deposit : null;
  const estimate = pick(params.estimate);
  if (estimate != null) return estimate > 0 ? estimate : null;
  const fallback = pick(params.fallback);
  return fallback != null && fallback > 0 ? fallback : null;
}

/** Texto corto de la regla para mostrar al huésped ("1 noche", "30 %"). */
export function depositRuleLabel(policy: Pick<DepositPolicy, "rule" | "percent">): string | null {
  switch (policy.rule) {
    case "none":
      return null;
    case "percent":
      return policy.percent ? `${Number(policy.percent).toLocaleString("es-AR")} %` : null;
    case "one_night":
    default:
      return "1 noche";
  }
}
