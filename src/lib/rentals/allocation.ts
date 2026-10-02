import { round2 } from "@/lib/finance/booking-economics";

/**
 * Imputación de un pago del inquilino a lo que debe.
 *
 * Reglas del Código Civil y Comercial:
 *   - art. 900: el deudor puede elegir a qué deuda imputa el pago
 *     (`preferChargeIds`: "paga octubre aunque deba septiembre").
 *   - art. 903: si hay capital e intereses, el pago va primero a intereses.
 *   - art. 902: sin elección, primero la deuda de plazo vencido más antigua.
 *
 * Por eso el orden por defecto es: cargo con vencimiento más viejo primero y,
 * dentro de cada cargo, punitorios → alquiler → resto.
 */

export type ChargeItemKind =
  | "alquiler"
  | "diferencia_ajuste"
  | "expensas"
  | "servicio"
  | "punitorio"
  | "honorarios"
  | "deposito"
  | "sellado"
  | "reparacion"
  | "rescision"
  | "otro";

/** A quién pertenece la plata de cada ítem cuando se cobra. */
export type Payee = "propietario" | "inmobiliaria" | "consorcio" | "tercero";

export const IMPUTATION_PRIORITY: Record<ChargeItemKind, number> = {
  punitorio: 0,
  alquiler: 1,
  diferencia_ajuste: 2,
  expensas: 3,
  servicio: 4,
  reparacion: 5,
  rescision: 6,
  honorarios: 7,
  sellado: 8,
  deposito: 9,
  otro: 10,
};

export interface OpenItem {
  itemId: string;
  chargeId: string;
  /** Vencimiento del cargo al que pertenece. */
  dueDate: string;
  kind: ChargeItemKind;
  /** Saldo impago del ítem. Los ≤ 0 se ignoran. */
  outstanding: number;
  /** Desempate dentro del cargo. */
  sortOrder?: number;
}

export interface Allocation {
  itemId: string;
  chargeId: string;
  amount: number;
}

export function sortForImputation(items: OpenItem[], preferChargeIds: readonly string[] = []): OpenItem[] {
  const preferred = new Map(preferChargeIds.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const pa = preferred.get(a.chargeId);
    const pb = preferred.get(b.chargeId);
    if (pa !== undefined || pb !== undefined) {
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      if (pa !== pb) return pa - pb;
    }
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.chargeId !== b.chargeId) return a.chargeId < b.chargeId ? -1 : 1;
    const ka = IMPUTATION_PRIORITY[a.kind] ?? 99;
    const kb = IMPUTATION_PRIORITY[b.kind] ?? 99;
    if (ka !== kb) return ka - kb;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
}

/**
 * Reparte `amount` entre los ítems abiertos. Lo que sobra (`remainder`) es
 * saldo a favor del inquilino: queda sin imputar en el pago y se aplica al
 * próximo cargo.
 */
export function allocatePayment(
  amount: number,
  items: OpenItem[],
  preferChargeIds: readonly string[] = [],
): { allocations: Allocation[]; remainder: number } {
  let left = round2(amount);
  const allocations: Allocation[] = [];
  for (const item of sortForImputation(items, preferChargeIds)) {
    if (left <= 0) break;
    const open = round2(item.outstanding);
    if (open <= 0) continue;
    const take = round2(Math.min(open, left));
    allocations.push({ itemId: item.itemId, chargeId: item.chargeId, amount: take });
    left = round2(left - take);
  }
  return { allocations, remainder: Math.max(0, left) };
}

export type ChargeStatus = "pendiente" | "parcial" | "pagado" | "vencido" | "anulado";

/** Estado de un cargo a partir de lo pagado y la fecha. */
export function chargeStatusOf(params: {
  total: number;
  paid: number;
  dueDate: string;
  today: string;
  voided?: boolean;
}): ChargeStatus {
  if (params.voided) return "anulado";
  const total = round2(params.total);
  const paid = round2(params.paid);
  if (total <= 0 || paid >= total) return "pagado";
  if (params.today > params.dueDate) return "vencido";
  return paid > 0 ? "parcial" : "pendiente";
}
