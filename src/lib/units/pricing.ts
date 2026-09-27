import { splitTypedAmount, typedAmountToNumber } from "@/lib/format";
import type { UnitDefaultMode } from "@/lib/types/database";

/**
 * Precios de una unidad (migraciones 063 y 066).
 *
 * Cada vocación tiene los suyos: temporario → por noche (`base_price`),
 * mensual → por mes (`monthly_price`), mixto → los dos. El servidor guarda
 * `monthly_price` en NULL para una temporaria, pero igual se filtra acá — un
 * lector que olvide mirar `default_mode` no tiene que poder mostrar un precio
 * mensual viejo de una unidad que dejó de alquilarse por mes.
 *
 * `base_price` de una mensual queda en la base (la web pública calcula su
 * "≈ por mes" desde ahí), pero el panel no lo muestra: no describe la unidad.
 */

/** Días de un mes a efectos de precio: la misma base que la renta (renta ÷ 30 × noches). */
export const DAYS_PER_MONTH = 30;

type UnitWithMonthlyPrice = {
  default_mode?: UnitDefaultMode | string | null;
  /** PostgREST puede devolver `numeric` como string. */
  monthly_price?: number | string | null;
};

/** Qué precios lleva cada vocación en el panel. */
export function unitPriceKinds(mode: UnitDefaultMode | string | null | undefined): {
  nightly: boolean;
  monthly: boolean;
} {
  return {
    nightly: mode !== "mensual",
    monthly: mode === "mensual" || mode === "mixto",
  };
}

/** Precio mensual vigente: sólo unidades mensuales o mixtas y sólo si es > 0. Si no, null. */
export function unitMonthlyPrice(
  unit: UnitWithMonthlyPrice | null | undefined,
): number | null {
  if (!unit || !unitPriceKinds(unit.default_mode).monthly || unit.monthly_price == null) return null;
  const n = Number(unit.monthly_price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Precio de lista tipeado a mano → número. Vacío, sin cifras o ambiguo → null.
 *
 * Los separadores se leen con las reglas compartidas de splitTypedAmount (las
 * mismas que parseAmountInput / parseMoneyInput): un grupo de tres cifras
 * después de un separador es miles — "45.000" son cuarenta y cinco mil — y con
 * los dos separadores manda el último: "1.100.000,50" (es-AR) y
 * "1,100,000.50" (en-US) son el mismo precio.
 *
 * Esta versión es la estricta: el campo tiene aviso de "no se entiende" en
 * línea, así que lo dudoso no se adivina. Ningún precio lleva tres decimales
 * ni es negativo: "1100.000", "1.100000" o "-5" son null y la pantalla lo
 * marca (el parser permisivo leería 1100 y 1,1).
 */
export function parsePriceInput(text: string): number | null {
  const a = splitTypedAmount(text);
  if (!a || a.negative) return null;
  if (a.frac !== null && a.frac.length > 2) return null;
  return typedAmountToNumber(a);
}

/** Número → texto editable en es-AR: "1.100.000" o, con centavos, "1.100.000,50". */
export function formatPriceInput(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  const decimales = Number.isInteger(n) ? 0 : 2;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: 2,
  });
}

export interface MonthlyVsNightly {
  /** Lo que salen 30 noches sueltas a la tarifa por noche. */
  thirtyNights: number;
  /** El mes llevado a una noche (mes ÷ 30). */
  perNight: number;
  /**
   * Cuánto más barato sale el mes que 30 noches sueltas, en %. Negativo si el
   * mes sale más caro.
   */
  savingsPct: number;
}

/**
 * El mes contra 30 noches sueltas: es la cuenta que se hace el dueño al poner
 * un precio mensual ("¿cuánto descuento estoy dando por quedarse un mes?").
 */
export function compareMonthlyToNightly(
  monthly: number | null | undefined,
  nightly: number | null | undefined,
): MonthlyVsNightly | null {
  const m = Number(monthly);
  const n = Number(nightly);
  if (!Number.isFinite(m) || !Number.isFinite(n) || m <= 0 || n <= 0) return null;
  const thirtyNights = n * DAYS_PER_MONTH;
  return {
    thirtyNights,
    perNight: m / DAYS_PER_MONTH,
    savingsPct: (1 - m / thirtyNights) * 100,
  };
}
