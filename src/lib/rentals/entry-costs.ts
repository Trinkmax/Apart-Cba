import { round2 } from "@/lib/finance/booking-economics";

/**
 * Honorarios de la inmobiliaria y costo de entrada de un contrato.
 *
 * "¿Cuánto tengo que pagar para entrar?" es la primera pregunta de todo
 * inquilino, y la respuesta se arma con piezas que cada inmobiliaria combina
 * distinto: primer mes, depósito, honorarios (un % del total del contrato, N
 * meses de alquiler o un monto fijo, con o sin IVA), la parte del sellado que
 * le toca y gastos sueltos (certificación de firmas, informe de garantía).
 */

export type CommissionBasis = "pct_total_contrato" | "meses" | "monto_fijo" | "ninguna";

export interface CommissionRule {
  basis: CommissionBasis;
  /** pct_total_contrato: % (4,15 = 4,15 %) · meses: cantidad de meses · monto_fijo: importe. */
  value: number;
  /** Suma IVA (21 %) sobre el honorario. */
  vat: boolean;
}

export const VAT_PCT = 21;

/**
 * Alquiler × meses: el valor del contrato al precio de la firma. Es la base de
 * sellos y honorarios "% del total" cuando el precio se ajusta por índice, a
 * mano o no se ajusta. Con montos pactados (escalonado, % fijo) la base es la
 * suma de esos montos: usá `stipulatedContractValue` (plan.ts), que elige.
 */
export function contractTotalValue(monthlyRent: number, durationMonths: number): number {
  return round2(monthlyRent * Math.max(0, Math.floor(durationMonths)));
}

export interface CommissionAmount {
  net: number;
  vat: number;
  total: number;
}

export interface CommissionContext {
  /** Alquiler inicial: base de los honorarios en "meses de alquiler". */
  monthlyRent: number;
  durationMonths: number;
  /**
   * Valor del contrato según los montos estipulados (`stipulatedContractValue`):
   * base del "% del total del contrato". Sin él, alquiler inicial × meses, que
   * se queda corto en un escalonado o un % fijo.
   */
  contractValue?: number | null;
}

/** Base de lo que se calcula sobre el total del contrato (honorarios en %, sellado). */
function contractValueOf(ctx: CommissionContext): number {
  return ctx.contractValue != null && Number.isFinite(ctx.contractValue)
    ? round2(Math.max(0, ctx.contractValue))
    : contractTotalValue(ctx.monthlyRent, ctx.durationMonths);
}

export function commissionAmount(rule: CommissionRule | null | undefined, ctx: CommissionContext): CommissionAmount {
  if (!rule || rule.basis === "ninguna" || !(rule.value > 0)) return { net: 0, vat: 0, total: 0 };
  let net = 0;
  if (rule.basis === "pct_total_contrato") {
    net = (contractValueOf(ctx) * rule.value) / 100;
  } else if (rule.basis === "meses") {
    net = ctx.monthlyRent * rule.value;
  } else {
    net = rule.value;
  }
  net = round2(net);
  const vat = rule.vat ? round2((net * VAT_PCT) / 100) : 0;
  return { net, vat, total: round2(net + vat) };
}

export type EntryCostPayer = "inquilino" | "propietario";

export type EntryCostKind = "primer_mes" | "deposito" | "honorarios" | "sellado" | "otro";

export interface EntryCostLine {
  kind: EntryCostKind;
  concept: string;
  amount: number;
  payer: EntryCostPayer;
}

export interface EntryCostInput {
  monthlyRent: number;
  durationMonths: number;
  /** Base de honorarios "% del total" y sellado (ver `CommissionContext.contractValue`). */
  contractValue?: number | null;
  /** El primer mes se paga a la firma (lo habitual). */
  includeFirstMonth: boolean;
  deposit: number;
  tenantCommission: CommissionRule | null;
  ownerCommission: CommissionRule | null;
  /**
   * Impuesto de sellos: alícuota sobre el valor del contrato y qué parte paga
   * el inquilino (50 = mitad y mitad). null = no se sella o no se registra.
   */
  stampTax: { ratePct: number; tenantSharePct: number } | null;
  otherCosts?: { concept: string; amount: number; payer: EntryCostPayer }[];
}

export interface EntryCostResult {
  lines: EntryCostLine[];
  tenantTotal: number;
  ownerTotal: number;
  contractValue: number;
}

export function computeEntryCosts(input: EntryCostInput): EntryCostResult {
  const contractValue = contractValueOf(input);
  const ctx: CommissionContext = { monthlyRent: input.monthlyRent, durationMonths: input.durationMonths, contractValue };
  const lines: EntryCostLine[] = [];

  if (input.includeFirstMonth && input.monthlyRent > 0) {
    lines.push({ kind: "primer_mes", concept: "Primer mes de alquiler", amount: round2(input.monthlyRent), payer: "inquilino" });
  }
  if (input.deposit > 0) {
    lines.push({ kind: "deposito", concept: "Depósito en garantía", amount: round2(input.deposit), payer: "inquilino" });
  }
  const tc = commissionAmount(input.tenantCommission, ctx);
  if (tc.total > 0) {
    lines.push({
      kind: "honorarios",
      concept: tc.vat ? "Honorarios inmobiliarios (con IVA)" : "Honorarios inmobiliarios",
      amount: tc.total,
      payer: "inquilino",
    });
  }
  const oc = commissionAmount(input.ownerCommission, ctx);
  if (oc.total > 0) {
    lines.push({
      kind: "honorarios",
      concept: oc.vat ? "Honorarios por la locación (con IVA)" : "Honorarios por la locación",
      amount: oc.total,
      payer: "propietario",
    });
  }
  if (input.stampTax && input.stampTax.ratePct > 0) {
    const tax = round2((contractValue * input.stampTax.ratePct) / 100);
    const share = Math.min(100, Math.max(0, input.stampTax.tenantSharePct));
    const tenantPart = round2((tax * share) / 100);
    const ownerPart = round2(tax - tenantPart);
    if (tenantPart > 0) lines.push({ kind: "sellado", concept: "Sellado del contrato (parte inquilino)", amount: tenantPart, payer: "inquilino" });
    if (ownerPart > 0) lines.push({ kind: "sellado", concept: "Sellado del contrato (parte propietario)", amount: ownerPart, payer: "propietario" });
  }
  for (const c of input.otherCosts ?? []) {
    if (c.amount > 0 && c.concept.trim()) {
      lines.push({ kind: "otro", concept: c.concept.trim(), amount: round2(c.amount), payer: c.payer });
    }
  }

  const sum = (payer: EntryCostPayer) => round2(lines.filter((l) => l.payer === payer).reduce((s, l) => s + l.amount, 0));
  return { lines, tenantTotal: sum("inquilino"), ownerTotal: sum("propietario"), contractValue };
}
