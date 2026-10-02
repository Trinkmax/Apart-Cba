import { round2 } from "@/lib/finance/booking-economics";
import { computeEntryCosts, type CommissionRule, type EntryCostLine } from "@/lib/rentals/entry-costs";
import { computeStampTax, type StampTaxResult } from "@/lib/rentals/termination";
import type { RentalStampTaxStatus } from "@/lib/types/database";

/**
 * "¿Cuánto paga el inquilino para entrar?" con el desglose, y los ítems del
 * cargo de ingreso que se genera al activar el contrato.
 *
 * El primer mes figura en el costo de entrada (es plata que pone el día de la
 * firma) pero NO va al cargo de ingreso: lo cubre el cargo mensual del
 * período 1, que el sistema genera solo. Si se sumara acá, se cobraría dos
 * veces.
 */

export type EntryChargeKind = "deposito" | "honorarios" | "sellado" | "otro";

export interface EntryChargeItemDraft {
  kind: EntryChargeKind;
  description: string;
  amount: number;
}

export interface EntryBreakdownInput {
  currency: string;
  monthlyRent: number;
  durationMonths: number;
  /**
   * Valor del contrato según los montos estipulados: base del sellado y de los
   * honorarios "% del total". Sale de `stipulatedContractValue` (plan.ts), que
   * mira el método de ajuste; acá sólo llega el alquiler inicial. Sin él,
   * alquiler inicial × meses, que se queda corto en un escalonado o un % fijo.
   */
  contractValue?: number | null;
  deposit: number;
  depositCurrency: string | null;
  tenantCommission: CommissionRule | null;
  ownerCommission: CommissionRule | null;
  stamp: {
    status: RentalStampTaxStatus;
    /** Monto total del sellado cargado a mano (gana sobre el cálculo). */
    manualAmount: number | null;
    ratePct: number;
    /** Tope mensual de exención de la Ley Impositiva. Está en PESOS, sea cual sea la moneda del contrato. */
    exemptMonthly: number | null;
    tenantSharePct: number;
    /**
     * Contrato en otra moneda: dólar BNA vendedor del día hábil anterior a la
     * firma, para comparar el promedio contra el tope en pesos. Sin él no se
     * puede decidir la exención (ver `needsRate`).
     */
    exchangeRateArs?: number | null;
  };
}

export interface EntryBreakdown {
  lines: EntryCostLine[];
  tenantTotal: number;
  ownerTotal: number;
  /**
   * Base de sellos y honorarios "% del total": la suma de los montos pactados
   * (escalonado, % fijo) o el alquiler a la firma × meses (índice, manual, sin ajuste).
   */
  contractValue: number;
  stamp: StampTaxResult & {
    applies: boolean;
    manual: boolean;
    total: number;
    /** Promedio mensual en pesos (lo que se compara contra el tope); null si el contrato no es en pesos y no hay cotización. */
    averageMonthlyArs: number | null;
    /**
     * Contrato en otra moneda sin cotización cargada: la exención queda "a
     * revisar" (nunca se da por exento) y el sellado se calcula como si correspondiera.
     */
    needsRate: boolean;
  };
  /** Depósito en otra moneda: no se suma ni entra al cargo. */
  separateDeposit: { amount: number; currency: string } | null;
  chargeItems: EntryChargeItemDraft[];
}

export function computeEntryBreakdown(input: EntryBreakdownInput): EntryBreakdown {
  const rent = Math.max(0, input.monthlyRent || 0);
  const months = Math.max(0, Math.floor(input.durationMonths || 0));
  const sameCurrency = !input.depositCurrency || input.depositCurrency === input.currency;
  const base = computeEntryCosts({
    monthlyRent: rent,
    durationMonths: months,
    contractValue: input.contractValue,
    includeFirstMonth: true,
    deposit: sameCurrency ? Math.max(0, input.deposit || 0) : 0,
    tenantCommission: input.tenantCommission,
    ownerCommission: input.ownerCommission,
    stampTax: null,
  });
  // El sellado mide el mismo valor que los honorarios "% del total" (el
  // estipulado, ya saneado por computeEntryCosts; sin él, alquiler × meses).
  const contractValue = base.contractValue;

  // El tope de exención es en pesos (Ley Impositiva de Córdoba) y Rentas
  // convierte un contrato en moneda extranjera al dólar BNA vendedor del día
  // hábil anterior a la firma. Comparar US$ 1.000 contra $ 1.230.000 daba
  // "Exento" a cualquier contrato en dólares: sin cotización no se exime nunca;
  // con ella, el tope se lleva a la moneda del contrato (equivale a promedio ×
  // TC ≤ tope). El sellado queda en la moneda del contrato, como el resto del
  // cargo de ingreso.
  const isArs = input.currency === "ARS";
  const fx = input.stamp.exchangeRateArs != null && input.stamp.exchangeRateArs > 0 ? input.stamp.exchangeRateArs : null;
  const threshold = input.stamp.exemptMonthly;
  const st = computeStampTax({
    totalContractValue: contractValue,
    durationMonths: Math.max(1, months),
    ratePct: input.stamp.ratePct,
    exemptMonthlyThreshold: threshold == null ? null : isArs ? threshold : fx ? threshold / fx : null,
    tenantSharePct: input.stamp.tenantSharePct,
  });
  const averageMonthlyArs = isArs ? st.averageMonthly : fx ? round2(st.averageMonthly * fx) : null;
  const needsRate = !isArs && threshold != null && fx == null;
  const applies = input.stamp.status === "pendiente";
  const manual = applies && input.stamp.manualAmount != null && input.stamp.manualAmount > 0;
  const total = applies ? round2(manual ? (input.stamp.manualAmount as number) : st.tax) : 0;
  const share = Math.min(100, Math.max(0, input.stamp.tenantSharePct));
  const tenantPart = round2((total * share) / 100);
  const ownerPart = round2(total - tenantPart);

  const lines: EntryCostLine[] = [...base.lines];
  if (tenantPart > 0) lines.push({ kind: "sellado", concept: "Sellado del contrato (parte inquilino)", amount: tenantPart, payer: "inquilino" });
  if (ownerPart > 0) lines.push({ kind: "sellado", concept: "Sellado del contrato (parte propietario)", amount: ownerPart, payer: "propietario" });

  const sum = (payer: "inquilino" | "propietario") => round2(lines.filter((l) => l.payer === payer).reduce((s, l) => s + l.amount, 0));
  const chargeItems: EntryChargeItemDraft[] = lines
    .filter((l) => l.payer === "inquilino" && l.kind !== "primer_mes" && l.amount > 0)
    .map((l) => ({ kind: l.kind === "primer_mes" ? "otro" : l.kind, description: l.concept, amount: l.amount }));

  return {
    lines,
    tenantTotal: sum("inquilino"),
    ownerTotal: sum("propietario"),
    contractValue,
    stamp: { ...st, applies, manual, total, tenantPart, ownerPart, averageMonthlyArs, needsRate },
    separateDeposit: !sameCurrency && input.deposit > 0 ? { amount: round2(input.deposit), currency: input.depositCurrency as string } : null,
    chargeItems,
  };
}
