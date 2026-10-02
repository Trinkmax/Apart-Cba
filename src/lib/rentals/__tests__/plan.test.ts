import { describe, expect, it } from "vitest";
import { rentForPeriod } from "../adjustments";
import { buildMonthlyCharge, periodsDueForCharging } from "../charges";
import { buildContractPlan, chargingSchedule, type PlanContract } from "../plan";
import { contractEndDate } from "../schedule";

// Contrato de 24 meses del 01/11/2024 al 31/10/2026, ajuste trimestral (7 ajustes).
const CONTRACT: PlanContract = {
  start_date: "2024-11-01",
  duration_months: 24,
  initial_rent: 100_000,
  adjustment_method: "porcentaje_fijo",
  index_code: null,
  adjustment_every_months: 3,
  index_lag_months: 2,
  fixed_pct: 10,
  steps: null,
  rounding: "none",
  cap_pct: null,
  allow_decrease: false,
  payment_window_days: 10,
};

const APPLIED = new Map([
  [1, 110_000],
  [2, 121_000],
  [3, 133_100],
  [4, 146_410],
  [5, 161_051],
  [6, 177_156],
  [7, 194_872],
]);

describe("chargingSchedule (continuación, art. 1218)", () => {
  const plan = buildContractPlan(CONTRACT, { applied: APPLIED });

  it("sin el cobro de continuación encendido no agrega nada después del fin", () => {
    expect(contractEndDate(CONTRACT.start_date, CONTRACT.duration_months)).toBe("2026-10-31");
    const s = chargingSchedule(plan.schedule, { ...CONTRACT, status: "vigente", continuation_billing: false }, "2027-02-01");
    expect(s).toHaveLength(24);
    expect(s).toBe(plan.schedule);
  });

  it("con el flag, el período 25 arranca el 01/11 al último alquiler aplicado y sin ajuste nuevo", () => {
    const s = chargingSchedule(plan.schedule, { ...CONTRACT, status: "vigente", continuation_billing: true }, "2026-11-07");
    expect(s).toHaveLength(25);
    const p25 = s[24];
    expect(p25).toMatchObject({ index: 25, start: "2026-11-01", end: "2026-11-30", dueDate: "2026-11-10", continuation: true, adjustsHere: false });
    // Ninguna ventana de ajuste nueva: siguen siendo las 7 del contrato.
    expect(plan.windows).toHaveLength(7);
    const rent = rentForPeriod(Number(CONTRACT.initial_rent), plan.chain, p25.index, { onlyApplied: true });
    expect(rent).toEqual({ amount: 194_872, fromSequence: 7, pendingSequence: null });
  });

  it("arma los meses de continuación hasta el horizonte (inclusive)", () => {
    const s = chargingSchedule(plan.schedule, { ...CONTRACT, status: "vigente", continuation_billing: true }, "2027-01-01");
    expect(s.slice(24).map((p) => [p.index, p.start])).toEqual([
      [25, "2026-11-01"],
      [26, "2026-12-01"],
      [27, "2027-01-01"],
    ]);
  });

  it("un contrato que no está vigente nunca factura continuación", () => {
    const s = chargingSchedule(plan.schedule, { ...CONTRACT, status: "finalizado", continuation_billing: true }, "2027-01-01");
    expect(s).toHaveLength(24);
  });

  it("la salida anticipada corta la continuación y el cargo se rotula como continuación", () => {
    const s = chargingSchedule(plan.schedule, { ...CONTRACT, status: "vigente", continuation_billing: true }, "2027-01-07");
    const due = periodsDueForCharging(s, {
      today: "2026-12-31",
      leadDays: 7,
      terminatedAt: "2026-12-15",
      existing: new Set(Array.from({ length: 25 }, (_, i) => i + 1)),
    });
    expect(due.map((p) => p.index)).toEqual([26]);
    const draft = buildMonthlyCharge({
      period: due[0],
      rent: rentForPeriod(Number(CONTRACT.initial_rent), plan.chain, 26, { onlyApplied: true }),
      currency: "ARS",
    });
    expect(draft).toMatchObject({ label: "Diciembre 2026 · Continuación", period_index: 26, cycle: null, index_in_cycle: null, cycle_length: null });
    expect(draft.items[0]).toMatchObject({ kind: "alquiler", amount: 194_872, description: "Alquiler Diciembre 2026 (continuación, art. 1218 CCyC)" });
  });
});
