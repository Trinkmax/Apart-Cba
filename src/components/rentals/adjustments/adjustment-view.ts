import type { RentalAdjustmentMethod, RentalAdjustmentStatus } from "@/lib/types/database";

/**
 * Lo que necesita una tarjeta de ajuste (serializable: viaja del server al
 * cliente). Lo arman las actions de `rentals-adjustments.ts` y lo pintan
 * `AdjustmentCard` en /ajustes y en la ficha del contrato.
 */
export interface AdjustmentView {
  id: string;
  contractId: string;
  contractNumber: number;
  contractStatus: string;
  address: string;
  tenantName: string | null;
  tenantEmail: string | null;
  tenantPhone: string | null;
  currency: string;
  sequence: number;
  /** Cuántos ajustes tiene el contrato en total ("Ajuste 2 de 7"). */
  totalAdjustments: number;
  effectiveDate: string;
  status: RentalAdjustmentStatus;
  method: RentalAdjustmentMethod;
  indexCode: string | null;
  every: number | null;
  fixedPct: number | null;
  fromKey: string | null;
  toKey: string | null;
  fromValue: number | null;
  toValue: number | null;
  coefficient: number | null;
  variationPct: number | null;
  baseAmount: number | null;
  computedAmount: number | null;
  appliedAmount: number | null;
  /** Motivo de la corrección a mano o de por qué no se aplicó. */
  overrideReason: string | null;
  appliedAt: string | null;
  notifiedAt: string | null;
  /**
   * Día del aviso en la zona de la organización (YYYY-MM-DD). `notifiedAt` es
   * un timestamptz: cortarlo en UTC muestra el día siguiente a la noche.
   */
  notifiedOn: string | null;
  notifiedVia: string | null;
}

/** Monto que rige (o regiría) desde el ajuste: el aplicado manda sobre el calculado. */
export function newAmountOf(a: Pick<AdjustmentView, "appliedAmount" | "computedAmount" | "status">): number | null {
  if (a.status === "omitido") return null;
  return a.appliedAmount ?? a.computedAmount;
}

/** true si el monto aplicado no es el del cálculo (alguien lo corrigió a mano). */
export function isOverridden(a: Pick<AdjustmentView, "status" | "appliedAmount" | "computedAmount" | "overrideReason">): boolean {
  if (a.status !== "aplicado") return false;
  if (a.overrideReason) return true;
  return a.appliedAmount != null && a.computedAmount != null && Math.abs(a.appliedAmount - a.computedAmount) > 0.004;
}

/** Variación real: la del monto que rige contra el anterior (difiere del índice si se corrigió). */
export function effectiveVariation(a: Pick<AdjustmentView, "status" | "appliedAmount" | "computedAmount" | "baseAmount" | "variationPct" | "overrideReason">): number | null {
  const amount = newAmountOf(a);
  if (amount == null) return null;
  if (isOverridden(a) && a.baseAmount && a.baseAmount > 0) {
    return Math.round((amount / a.baseAmount - 1) * 10000) / 100;
  }
  return a.variationPct;
}

/** Qué puede hacer una persona con el ajuste según su estado. */
export function adjustmentActions(a: Pick<AdjustmentView, "status" | "appliedAmount" | "computedAmount" | "overrideReason" | "contractStatus">) {
  const open = a.contractStatus === "vigente";
  return {
    apply: open && a.status === "calculado",
    override: open && a.status !== "omitido",
    skip: open && a.status !== "aplicado" && a.status !== "omitido",
    reopen: open && (a.status === "omitido" || isOverridden(a)),
    notify: open && a.status === "aplicado",
  };
}
