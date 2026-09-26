import type { UnitDefaultMode } from "@/lib/types/database";

/**
 * Precios de una unidad (migración 063).
 *
 * `base_price` es el precio por noche de cualquier unidad. `monthly_price` es
 * el de un mes completo y sólo existe para las mixtas: el servidor lo guarda en
 * NULL para cualquier otra vocación, pero igual se filtra acá — un lector que
 * olvide mirar `default_mode` no tiene que poder mostrar un precio mensual
 * viejo de una unidad que dejó de ser mixta.
 */

/** Días de un mes a efectos de precio: la misma base que la renta (renta ÷ 30 × noches). */
export const DAYS_PER_MONTH = 30;

type UnitWithMonthlyPrice = {
  default_mode?: UnitDefaultMode | string | null;
  /** PostgREST puede devolver `numeric` como string. */
  monthly_price?: number | string | null;
};

/** Precio mensual vigente: sólo unidades mixtas y sólo si es > 0. Si no, null. */
export function unitMonthlyPrice(
  unit: UnitWithMonthlyPrice | null | undefined,
): number | null {
  if (!unit || unit.default_mode !== "mixto" || unit.monthly_price == null) return null;
  const n = Number(unit.monthly_price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Precio de lista tipeado a mano → número. Vacío, sin cifras o ambiguo → null.
 *
 * Un precio se escribe con separadores de miles ("1.100.000" en es-AR,
 * "1,100,000" copiado de algo en inglés) y ningún precio lleva tres decimales,
 * así que un grupo de tres cifras después de un separador es SIEMPRE miles:
 * "45.000" son cuarenta y cinco mil (parseMoneyInput lo lee como 45). Con los
 * dos separadores manda el último: "1.100.000,50" (es-AR) y "1,100,000.50"
 * (en-US) son el mismo precio. Lo que no encaja en ninguna forma
 * ("1.100.000.50", "1,2,3") no se adivina: es null y la pantalla lo marca.
 */
export function parsePriceInput(text: string): number | null {
  const t = text.replace(/\s/g, "");
  if (!/\d/.test(t)) return null;
  let normal: string | null = null;
  if (/^\d+$/.test(t)) normal = t;
  // Miles agrupados, sin decimales: "45.000", "1.100.000", "1,100,000". El
  // primer grupo no empieza en 0: "0.500" no son quinientos.
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(t) || /^[1-9]\d{0,2}(,\d{3})+$/.test(t)) {
    normal = t.replace(/[.,]/g, "");
  }
  // Miles es-AR con centavos: "1.100.000,50".
  else if (/^[1-9]\d{0,2}(\.\d{3})+,\d{1,2}$/.test(t)) normal = t.replace(/\./g, "").replace(",", ".");
  // Miles en-US con centavos: "1,100,000.50".
  else if (/^[1-9]\d{0,2}(,\d{3})+\.\d{1,2}$/.test(t)) normal = t.replace(/,/g, "");
  // Un solo separador decimal, con centavos: "45,5", "45.5", "1100000,50".
  // Tres o más cifras después ("1100.000", "1.100000") no son centavos ni
  // miles bien escritos: ambiguo.
  else if (/^\d*[.,]\d{1,2}$/.test(t)) normal = t.replace(",", ".");
  // Separador colgando mientras se tipea: "1100000," → 1100000, y también
  // sobre miles ya agrupados ("1.100." camino a "1.100.000", "78.000," camino
  // a "78.000,50"): sin esto el campo parpadeaba en rojo a mitad de tipeo.
  else if (/[.,]$/.test(t)) {
    const sin = t.slice(0, -1);
    if (/^\d+$/.test(sin)) normal = sin;
    else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(sin) || /^[1-9]\d{0,2}(,\d{3})+$/.test(sin)) {
      normal = sin.replace(/[.,]/g, "");
    }
  }
  if (normal === null) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
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
