import { round2 } from "@/lib/finance/booking-economics";
import type { ChargeItemKind, Payee } from "./allocation";
import { VAT_PCT } from "./entry-costs";

/**
 * Liquidación al propietario de alquileres tradicionales ("rendición").
 *
 * Se rinde lo COBRADO, no lo facturado: cada imputación de un pago del
 * inquilino a un ítem cuyo dueño es el propietario entra una sola vez en una
 * liquidación (la base marca qué imputaciones ya se rindieron). Así funciona
 * igual si la inmobiliaria rinde a fin de mes o cada vez que entra un pago.
 *
 *   cobrado     = Σ imputaciones a ítems del propietario × % de titularidad
 *   honorarios  = cobrado (sólo los conceptos que pagan honorarios) × % de administración
 *   IVA         = honorarios × 21 %   (si la inmobiliaria factura con IVA)
 *   gastos      = arreglos, impuestos, expensas extraordinarias… a su cargo × %
 *   neto        = cobrado − honorarios − IVA − gastos − otros descuentos + ajustes
 */

export interface CollectedEntry {
  allocationId: string;
  contractId: string;
  propertyId: string;
  /** "Dean Funes 450 · 3°B" */
  propertyLabel: string;
  kind: ChargeItemKind;
  payee: Payee;
  amount: number;
  paidAt: string;
  /** "Octubre 2026 · Período 2/3" */
  periodLabel: string;
}

export interface OwnerShare {
  propertyId: string;
  /** 0..100 */
  pct: number;
}

export interface ContractFeeRule {
  contractId: string;
  /** % de honorarios de administración (6 = 6 %). 0 = no cobra. */
  adminFeePct: number;
  adminFeeVat: boolean;
}

/** Conceptos sobre los que se cobran honorarios de administración. */
export const FEE_BASE_KINDS: ReadonlySet<ChargeItemKind> = new Set<ChargeItemKind>(["alquiler", "diferencia_ajuste"]);

export interface OwnerExpense {
  id: string;
  propertyId: string;
  date: string;
  description: string;
  /** Importe total del gasto de la propiedad (se reparte por % de titularidad). */
  amount: number;
}

export interface OwnerOneTimeCharge {
  id: string;
  contractId: string;
  propertyId: string;
  description: string;
  /** Importe total (se reparte por % de titularidad). */
  amount: number;
}

export type StatementLineType =
  | "cobro_alquiler"
  | "cobro_punitorio"
  | "cobro_otro"
  | "honorarios_administracion"
  | "iva_honorarios"
  | "comision_locacion"
  | "gasto"
  | "ajuste";

export interface StatementLineDraft {
  lineType: StatementLineType;
  /** +1 suma al propietario, −1 descuenta. */
  sign: 1 | -1;
  /** Siempre positivo; el signo va aparte. */
  amount: number;
  description: string;
  contractId: string | null;
  propertyId: string | null;
  /**
   * Qué se rinde (la base impide rendirlo dos veces al mismo propietario).
   * Los honorarios e IVA se derivan de los cobros y no llevan referencia.
   */
  refType: "allocation" | "expense" | "contract_commission" | "statement_carry" | null;
  refId: string | null;
  /** % de titularidad aplicado (100 si es único dueño). */
  sharePct: number;
}

export interface StatementTotals {
  collected: number;
  fees: number;
  vat: number;
  expenses: number;
  other: number;
  net: number;
}

/**
 * Parte de un propietario. Con un solo dueño es el importe redondeado; con
 * varios se TRUNCA al centavo: si se redondeara cada parte, dos dueños al 50 %
 * de $333.333,33 cobrarían $166.666,67 cada uno — un centavo más de lo que
 * entró. Truncando, el centavo que sobra queda en la inmobiliaria.
 */
export function ownerShare(amount: number, pct: number): number {
  if (pct >= 100) return round2(amount);
  return Math.floor(Math.round(amount * pct * 1000) / 1000) / 100;
}

function lineTypeFor(kind: ChargeItemKind): StatementLineType {
  if (kind === "alquiler" || kind === "diferencia_ajuste") return "cobro_alquiler";
  if (kind === "punitorio") return "cobro_punitorio";
  return "cobro_otro";
}

const KIND_LABEL: Partial<Record<ChargeItemKind, string>> = {
  alquiler: "Alquiler",
  diferencia_ajuste: "Diferencia por ajuste",
  punitorio: "Intereses por mora",
  rescision: "Indemnización por rescisión",
  reparacion: "Reintegro de reparación",
};

export function buildOwnerStatementLines(params: {
  collected: CollectedEntry[];
  shares: OwnerShare[];
  feeRules: ContractFeeRule[];
  expenses?: OwnerExpense[];
  oneTime?: OwnerOneTimeCharge[];
}): { lines: StatementLineDraft[]; totals: StatementTotals } {
  const shareOf = new Map(params.shares.map((s) => [s.propertyId, s.pct]));
  const feeOf = new Map(params.feeRules.map((f) => [f.contractId, f]));
  const lines: StatementLineDraft[] = [];
  const feeBaseByContract = new Map<string, { base: number; propertyId: string; label: string; pct: number }>();

  const entries = params.collected
    .filter((e) => e.payee === "propietario" && e.amount > 0 && (shareOf.get(e.propertyId) ?? 0) > 0)
    .sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel) || a.paidAt.localeCompare(b.paidAt));

  for (const e of entries) {
    const pct = shareOf.get(e.propertyId) ?? 0;
    const amount = ownerShare(e.amount, pct);
    if (amount <= 0) continue;
    const label = KIND_LABEL[e.kind] ?? "Cobro";
    lines.push({
      lineType: lineTypeFor(e.kind),
      sign: 1,
      amount,
      description: `${label} ${e.periodLabel} — ${e.propertyLabel}`,
      contractId: e.contractId,
      propertyId: e.propertyId,
      refType: "allocation",
      refId: e.allocationId,
      sharePct: pct,
    });
    if (FEE_BASE_KINDS.has(e.kind)) {
      const acc = feeBaseByContract.get(e.contractId) ?? { base: 0, propertyId: e.propertyId, label: e.propertyLabel, pct };
      acc.base = round2(acc.base + amount);
      feeBaseByContract.set(e.contractId, acc);
    }
  }

  for (const [contractId, acc] of feeBaseByContract) {
    const rule = feeOf.get(contractId);
    if (!rule || !(rule.adminFeePct > 0) || acc.base <= 0) continue;
    const fee = round2((acc.base * rule.adminFeePct) / 100);
    if (fee <= 0) continue;
    lines.push({
      lineType: "honorarios_administracion",
      sign: -1,
      amount: fee,
      description: `Honorarios de administración ${rule.adminFeePct.toLocaleString("es-AR")} % — ${acc.label}`,
      contractId,
      propertyId: acc.propertyId,
      refType: null,
      refId: null,
      sharePct: acc.pct,
    });
    if (rule.adminFeeVat) {
      const vat = round2((fee * VAT_PCT) / 100);
      if (vat > 0) {
        lines.push({
          lineType: "iva_honorarios",
          sign: -1,
          amount: vat,
          description: `IVA ${VAT_PCT} % sobre honorarios — ${acc.label}`,
          contractId,
          propertyId: acc.propertyId,
          refType: null,
          refId: null,
          sharePct: acc.pct,
        });
      }
    }
  }

  for (const c of params.oneTime ?? []) {
    const pct = shareOf.get(c.propertyId) ?? 0;
    const amount = ownerShare(c.amount, pct);
    if (amount <= 0) continue;
    lines.push({
      lineType: "comision_locacion",
      sign: -1,
      amount,
      description: c.description,
      contractId: c.contractId,
      propertyId: c.propertyId,
      refType: "contract_commission",
      refId: c.id,
      sharePct: pct,
    });
  }

  for (const x of params.expenses ?? []) {
    const pct = shareOf.get(x.propertyId) ?? 0;
    const amount = ownerShare(x.amount, pct);
    if (amount <= 0) continue;
    lines.push({
      lineType: "gasto",
      sign: -1,
      amount,
      description: x.description,
      contractId: null,
      propertyId: x.propertyId,
      refType: "expense",
      refId: x.id,
      sharePct: pct,
    });
  }

  return { lines, totals: totalsOf(lines) };
}

export function totalsOf(lines: Pick<StatementLineDraft, "lineType" | "sign" | "amount">[]): StatementTotals {
  const t: StatementTotals = { collected: 0, fees: 0, vat: 0, expenses: 0, other: 0, net: 0 };
  for (const l of lines) {
    const signed = l.sign * l.amount;
    if (l.lineType.startsWith("cobro_")) t.collected += signed;
    else if (l.lineType === "honorarios_administracion") t.fees += l.amount;
    else if (l.lineType === "iva_honorarios") t.vat += l.amount;
    else if (l.lineType === "gasto") t.expenses += l.amount;
    else t.other += signed;
    t.net += signed;
  }
  return {
    collected: round2(t.collected),
    fees: round2(t.fees),
    vat: round2(t.vat),
    expenses: round2(t.expenses),
    other: round2(t.other),
    net: round2(t.net),
  };
}
