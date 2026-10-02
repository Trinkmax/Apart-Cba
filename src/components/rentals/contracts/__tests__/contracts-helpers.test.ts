import { describe, expect, it } from "vitest";
import { IndexSeries } from "@/lib/rentals/indices";
import { appliedMapOf, buildContractPlan, stipulatedContractValue } from "@/lib/rentals/plan";
import {
  adjustmentSummary,
  frequencyLabel,
  lagExample,
  mergeAdjustments,
  monthsUsed,
  pctLabel,
} from "../adjustment-view";
import { computeEntryBreakdown } from "../entry-breakdown";
import { buildTimelineModel } from "../timeline-model";

const BASE = {
  start_date: "2026-03-01",
  duration_months: 24,
  initial_rent: 500_000,
  adjustment_method: "indice" as const,
  index_code: "ipc" as const,
  adjustment_every_months: 3,
  index_lag_months: 2,
  fixed_pct: null,
  steps: null,
  rounding: "hundred" as const,
  cap_pct: null,
  allow_decrease: false,
  payment_window_days: 10,
};

// IPC de ejemplo: +2 % por mes desde dic 2025.
function ipc(): IndexSeries {
  const pts = [];
  let v = 100;
  for (let i = 0; i < 9; i++) {
    const y = 2025 + Math.floor((11 + i) / 12);
    const m = ((11 + i) % 12) + 1;
    pts.push({ date: `${y}-${String(m).padStart(2, "0")}-01`, value: v });
    v = v * 1.02;
  }
  return new IndexSeries(pts, "monthly");
}

describe("adjustment-view", () => {
  it("meses que entran en el ajuste según la convención", () => {
    expect(monthsUsed(6, 3, 2)).toEqual([2, 3, 4]);
    expect(monthsUsed(6, 3, 1)).toEqual([3, 4, 5]);
    expect(monthsUsed(2, 4, 2)).toEqual([9, 10, 11, 12]);
  });

  it("ejemplo en castellano", () => {
    expect(lagExample({ effectiveMonth: 6, every: 3, lag: 2 })).toBe(
      "Para el ajuste de junio se usa la inflación de febrero, marzo y abril.",
    );
    expect(lagExample({ effectiveMonth: 6, every: 12, lag: 1 })).toBe(
      "Para el ajuste de junio se usa la inflación de los 12 meses de junio a mayo.",
    );
  });

  it("frecuencias y resumen", () => {
    expect(frequencyLabel(3)).toBe("trimestral");
    expect(frequencyLabel(4)).toBe("cuatrimestral");
    expect(frequencyLabel(5)).toBe("cada 5 meses");
    expect(adjustmentSummary(BASE)).toBe("IPC · trimestral");
    expect(adjustmentSummary({ ...BASE, adjustment_method: "sin_ajuste" })).toBe("Sin ajuste");
    expect(pctLabel(8.7)).toBe("+8,7 %");
    expect(pctLabel(-1.25)).toBe("−1,25 %");
  });

  it("las filas guardadas mandan sobre la cadena", () => {
    const rows = [
      {
        sequence: 1,
        period_index: 4,
        effective_date: "2026-06-01",
        status: "aplicado" as const,
        from_key: "2026-01-01",
        to_key: "2026-04-01",
        variation_pct: 6.12,
        base_amount: 500_000,
        computed_amount: 530_600,
        applied_amount: 540_000,
        override_reason: "Acordado con el inquilino",
        notified_at: null,
      },
    ];
    const plan = buildContractPlan(BASE, { series: ipc(), applied: appliedMapOf(rows) });
    const merged = mergeAdjustments(plan.chain, rows, "2026-07-15");
    expect(merged[0]).toMatchObject({ status: "aplicado", amount: 540_000, overridden: true, variationPct: 8 });
    // El segundo se calcula sobre el monto real (540.000), no sobre el calculado.
    expect(merged[1].base).toBe(540_000);
  });
});

describe("timeline-model", () => {
  it("un tramo por ciclo, con hoy adentro", () => {
    const plan = buildContractPlan(BASE, { series: ipc() });
    const adjustments = mergeAdjustments(plan.chain, [], "2026-07-15");
    const m = buildTimelineModel({
      startDate: "2026-03-01",
      endDate: "2028-02-29",
      today: "2026-07-15",
      initialRent: 500_000,
      schedule: plan.schedule,
      adjustments,
    });
    expect(m.segments).toHaveLength(8);
    expect(m.segments[0]).toMatchObject({ certainty: "inicial", amount: 500_000, phase: "past", months: 3 });
    expect(m.segments[1].phase).toBe("current");
    expect(m.segments[1].certainty).toBe("calculado");
    expect(m.todayPhase).toBe("during");
    expect(m.todayPct).toBeGreaterThan(15);
    expect(m.todayPct).toBeLessThan(25);
    expect(m.currentPeriod?.index).toBe(5);
    const widths = m.segments.reduce((s, x) => s + x.widthPct, 0);
    expect(Math.round(widths)).toBe(100);
  });
});

describe("entry-breakdown", () => {
  const input = {
    currency: "ARS",
    monthlyRent: 500_000,
    durationMonths: 24,
    deposit: 500_000,
    depositCurrency: "ARS",
    tenantCommission: { basis: "pct_total_contrato" as const, value: 5, vat: false },
    ownerCommission: null,
    stamp: { status: "pendiente" as const, manualAmount: null, ratePct: 0.5, exemptMonthly: 1_230_000, tenantSharePct: 50 },
  };

  it("el primer mes suma al costo de entrada pero no va al cargo de ingreso", () => {
    const r = computeEntryBreakdown(input);
    expect(r.tenantTotal).toBe(500_000 + 500_000 + 600_000);
    expect(r.chargeItems.map((i) => i.kind)).toEqual(["deposito", "honorarios"]);
    expect(r.stamp.exempt).toBe(true);
    expect(r.stamp.total).toBe(0);
  });

  it("sellado cuando no está exento, mitad y mitad", () => {
    const r = computeEntryBreakdown({ ...input, monthlyRent: 2_000_000 });
    expect(r.stamp.total).toBe(240_000);
    expect(r.chargeItems.find((i) => i.kind === "sellado")?.amount).toBe(120_000);
  });

  it("depósito en otra moneda queda aparte", () => {
    const r = computeEntryBreakdown({ ...input, depositCurrency: "USD", deposit: 500 });
    expect(r.separateDeposit).toEqual({ amount: 500, currency: "USD" });
    expect(r.chargeItems.some((i) => i.kind === "deposito")).toBe(false);
  });

  describe("sellado de un contrato en dólares (el tope es en pesos)", () => {
    const usd = { ...input, currency: "USD", monthlyRent: 1_000, deposit: 1_000, depositCurrency: "USD" };

    it("sin cotización nunca lo da por exento: queda a revisar y se calcula el sellado", () => {
      const r = computeEntryBreakdown(usd);
      expect(r.stamp.exempt).toBe(false);
      expect(r.stamp.needsRate).toBe(true);
      expect(r.stamp.averageMonthlyArs).toBeNull();
      expect(r.stamp.total).toBe(120); // 0,5 % de US$ 24.000
      expect(r.chargeItems.find((i) => i.kind === "sellado")?.amount).toBe(60);
    });

    it("con cotización compara en pesos: US$ 1.000 × 1.400 = $ 1.400.000 supera el tope", () => {
      const r = computeEntryBreakdown({ ...usd, stamp: { ...usd.stamp, exchangeRateArs: 1_400 } });
      expect(r.stamp.exempt).toBe(false);
      expect(r.stamp.needsRate).toBe(false);
      expect(r.stamp.averageMonthlyArs).toBe(1_400_000);
      expect(r.stamp.total).toBe(120);
    });

    it("con cotización y debajo del tope en pesos, exento", () => {
      const r = computeEntryBreakdown({ ...usd, monthlyRent: 800, stamp: { ...usd.stamp, exchangeRateArs: 1_400 } });
      expect(r.stamp.averageMonthlyArs).toBe(1_120_000);
      expect(r.stamp.exempt).toBe(true);
      expect(r.stamp.total).toBe(0);
    });

    it("sin tope configurado no pide cotización", () => {
      const r = computeEntryBreakdown({ ...usd, stamp: { ...usd.stamp, exemptMonthly: null } });
      expect(r.stamp.needsRate).toBe(false);
      expect(r.stamp.exempt).toBe(false);
    });

    it("en pesos el promedio en pesos es el mismo y no pide cotización", () => {
      const r = computeEntryBreakdown(input);
      expect(r.stamp.averageMonthlyArs).toBe(500_000);
      expect(r.stamp.needsRate).toBe(false);
    });
  });
});

describe("entry-breakdown — escalonado: sellado y honorarios sobre los montos pactados", () => {
  // 1,0 / 1,2 / 1,4 / 1,6 M, seis meses cada uno: promedio 1,3 M, por encima del tope.
  const escalonado = {
    ...BASE,
    initial_rent: 1_000_000,
    adjustment_method: "escalonado" as const,
    index_code: null,
    adjustment_every_months: 6,
    steps: [1_200_000, 1_400_000, 1_600_000],
    rounding: "none" as const,
  };
  const input = {
    currency: "ARS",
    monthlyRent: 1_000_000,
    durationMonths: 24,
    contractValue: stipulatedContractValue(escalonado),
    deposit: 0,
    depositCurrency: "ARS",
    tenantCommission: { basis: "pct_total_contrato" as const, value: 5, vat: false },
    ownerCommission: null,
    stamp: { status: "pendiente" as const, manualAmount: null, ratePct: 0.5, exemptMonthly: 1_230_000, tenantSharePct: 50 },
  };

  it("no es exento: el promedio de lo pactado (1,3 M) supera el tope", () => {
    const r = computeEntryBreakdown(input);
    expect(r.contractValue).toBe(31_200_000);
    expect(r.stamp.base).toBe(31_200_000);
    expect(r.stamp.averageMonthly).toBe(1_300_000);
    expect(r.stamp.exempt).toBe(false);
    expect(r.stamp.total).toBe(156_000);
  });

  it("el 5 % del total del contrato y la parte del sellado van al cargo de ingreso", () => {
    expect(computeEntryBreakdown(input).chargeItems).toEqual([
      { kind: "honorarios", description: "Honorarios inmobiliarios", amount: 1_560_000 },
      { kind: "sellado", description: "Sellado del contrato (parte inquilino)", amount: 78_000 },
    ]);
  });

  it("sin valor estipulado queda alquiler inicial × meses", () => {
    const r = computeEntryBreakdown({ ...input, contractValue: undefined });
    expect(r.stamp.exempt).toBe(true);
    expect(r.chargeItems.find((i) => i.kind === "honorarios")?.amount).toBe(1_200_000);
  });
});
