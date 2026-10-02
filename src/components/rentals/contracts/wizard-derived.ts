import { stipulatedContractValue } from "@/lib/rentals/plan";
import { computeEntryBreakdown, type EntryBreakdown } from "./entry-breakdown";
import type { ContractFormSettings } from "./types";
import { previewInputOf, type WizardState } from "./wizard-state";

/**
 * Cálculos instantáneos del asistente (sin ir al servidor): el costo de
 * entrada sale de los mismos datos que el servidor usa al activar. El valor
 * del contrato (base del sellado y de los honorarios "% del total") se arma
 * con el plan, que es puro: es lo que va al cargo de ingreso al activar.
 */
export function entryOf(state: WizardState, settings: Pick<ContractFormSettings, "stamp_tax_rate_pct" | "stamp_tax_exempt_monthly" | "stamp_tax_tenant_share_pct">): EntryBreakdown | null {
  const p = previewInputOf(state);
  if (!p) return null;
  return computeEntryBreakdown({
    currency: p.currency,
    monthlyRent: p.initial_rent,
    durationMonths: p.duration_months,
    contractValue: stipulatedContractValue(p),
    deposit: p.deposit_amount,
    depositCurrency: p.deposit_currency,
    tenantCommission: p.tenant_commission,
    ownerCommission: p.owner_commission,
    stamp: {
      status: p.stamp_tax_status,
      manualAmount: p.stamp_tax_amount,
      ratePct: settings.stamp_tax_rate_pct,
      exemptMonthly: settings.stamp_tax_exempt_monthly,
      tenantSharePct: settings.stamp_tax_tenant_share_pct,
    },
  });
}
