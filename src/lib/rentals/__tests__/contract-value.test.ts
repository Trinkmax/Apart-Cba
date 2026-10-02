import { describe, expect, it } from "vitest";
import { commissionAmount, computeEntryCosts } from "../entry-costs";
import { hasStipulatedAmounts, stipulatedContractValue, type PlanContract } from "../plan";

// 24 meses desde el 01/03/2026, escalonado semestral: 1,0 / 1,2 / 1,4 / 1,6 M
// (seis meses cada uno → promedio 1,3 M, por encima del tope de $ 1.230.000).
const ESCALONADO: PlanContract = {
  start_date: "2026-03-01",
  duration_months: 24,
  initial_rent: 1_000_000,
  adjustment_method: "escalonado",
  index_code: null,
  adjustment_every_months: 6,
  index_lag_months: 2,
  fixed_pct: null,
  steps: [1_200_000, 1_400_000, 1_600_000],
  rounding: "none",
  cap_pct: null,
  allow_decrease: false,
  payment_window_days: 10,
};

describe("stipulatedContractValue — base de sellos y honorarios", () => {
  it("escalonado: suma de los montos pactados, no alquiler inicial × meses", () => {
    expect(stipulatedContractValue(ESCALONADO)).toBe(31_200_000);
  });

  it("% fijo: la aritmética del contrato, con su redondeo", () => {
    const c: PlanContract = { ...ESCALONADO, duration_months: 12, initial_rent: 100_000, adjustment_method: "porcentaje_fijo", adjustment_every_months: 3, fixed_pct: 10, steps: null };
    // 3 × (100.000 + 110.000 + 121.000 + 133.100)
    expect(stipulatedContractValue(c)).toBe(1_392_300);
    // Con redondeo a mil, el tercer ajuste cobra 133.000 (y es la base del siguiente).
    expect(stipulatedContractValue({ ...c, rounding: "thousand" })).toBe(1_392_000);
  });

  it("índice: precio a la firma, aunque el contrato ya haya tenido ajustes", () => {
    const c: PlanContract = { ...ESCALONADO, initial_rent: 500_000, adjustment_method: "indice", index_code: "ipc", adjustment_every_months: 3, steps: null };
    expect(stipulatedContractValue(c)).toBe(12_000_000);
  });

  it("manual y sin ajuste: alquiler inicial × meses", () => {
    expect(stipulatedContractValue({ ...ESCALONADO, adjustment_method: "manual", steps: null })).toBe(24_000_000);
    expect(stipulatedContractValue({ ...ESCALONADO, adjustment_method: "sin_ajuste", adjustment_every_months: null, steps: null })).toBe(24_000_000);
  });

  it("escalonado sin frecuencia: no hay ajustes, queda el inicial", () => {
    expect(stipulatedContractValue({ ...ESCALONADO, adjustment_every_months: null })).toBe(24_000_000);
  });

  it("sólo escalonado y % fijo tienen montos pactados", () => {
    expect(hasStipulatedAmounts("escalonado")).toBe(true);
    expect(hasStipulatedAmounts("porcentaje_fijo")).toBe(true);
    expect(hasStipulatedAmounts("indice")).toBe(false);
    expect(hasStipulatedAmounts("manual")).toBe(false);
    expect(hasStipulatedAmounts("sin_ajuste")).toBe(false);
  });
});

describe("honorarios y sellado sobre el valor estipulado", () => {
  const ctx = { monthlyRent: 1_000_000, durationMonths: 24, contractValue: 31_200_000 };

  it("% del total del contrato usa el valor estipulado", () => {
    expect(commissionAmount({ basis: "pct_total_contrato", value: 5, vat: false }, ctx)).toEqual({ net: 1_560_000, vat: 0, total: 1_560_000 });
  });

  it("meses de alquiler sigue sobre el alquiler inicial", () => {
    expect(commissionAmount({ basis: "meses", value: 1, vat: false }, ctx).net).toBe(1_000_000);
  });

  it("sin valor estipulado, alquiler inicial × meses (como antes)", () => {
    expect(commissionAmount({ basis: "pct_total_contrato", value: 5, vat: false }, { monthlyRent: 1_000_000, durationMonths: 24 }).net).toBe(1_200_000);
  });

  it("un valor inválido no contamina el cálculo: vuelve a inicial × meses", () => {
    expect(commissionAmount({ basis: "pct_total_contrato", value: 5, vat: false }, { ...ctx, contractValue: Number.NaN }).net).toBe(1_200_000);
  });

  it("computeEntryCosts: sellado y honorarios sobre la misma base", () => {
    const r = computeEntryCosts({
      monthlyRent: 1_000_000,
      durationMonths: 24,
      contractValue: 31_200_000,
      includeFirstMonth: false,
      deposit: 0,
      tenantCommission: { basis: "pct_total_contrato", value: 5, vat: false },
      ownerCommission: null,
      stampTax: { ratePct: 0.5, tenantSharePct: 50 },
    });
    expect(r.contractValue).toBe(31_200_000);
    expect(r.lines.map((l) => [l.kind, l.payer, l.amount])).toEqual([
      ["honorarios", "inquilino", 1_560_000],
      ["sellado", "inquilino", 78_000],
      ["sellado", "propietario", 78_000],
    ]);
  });
});
