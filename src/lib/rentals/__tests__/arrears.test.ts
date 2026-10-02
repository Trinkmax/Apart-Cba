import { describe, expect, it } from "vitest";
import { consecutiveUnpaidRun, isPeriodUnpaid, rentBalanceOf, type ArrearsPeriod } from "../arrears";

const TODAY = "2026-07-20";

function period(periodIndex: number, dueDate: string, rentOutstanding: number, over: Partial<ArrearsPeriod> = {}): ArrearsPeriod & { id: string } {
  return { id: `p${periodIndex}`, kind: "mensual", periodIndex, dueDate, rentAmount: 500_000, rentOutstanding, ...over };
}

describe("rentBalanceOf", () => {
  it("suma alquiler y diferencias de ajuste; punitorios y expensas no cuentan", () => {
    const r = rentBalanceOf([
      { kind: "alquiler", amount: "500000", paid_amount: "480000" },
      { kind: "diferencia_ajuste", amount: 30000, paid_amount: 0 },
      { kind: "punitorio", amount: 12000, paid_amount: 0 },
      { kind: "expensas", amount: 90000, paid_amount: 0 },
    ]);
    expect(r).toEqual({ rent: 530000, outstanding: 50000 });
  });

  it("lo pagado de más en un ítem no compensa lo que falta en otro", () => {
    expect(rentBalanceOf([{ kind: "alquiler", amount: 100, paid_amount: 150 }]).outstanding).toBe(0);
  });
});

describe("consecutiveUnpaidRun (art. 1219 inc. c)", () => {
  it("dos períodos seguidos sin pagar: racha de 2", () => {
    const run = consecutiveUnpaidRun([period(5, "2026-06-10", 500_000), period(6, "2026-07-10", 500_000)], { today: TODAY });
    expect(run.map((p) => p.periodIndex)).toEqual([5, 6]);
  });

  it("marzo y junio pagados tarde con saldo chico de punitorios: no es causal", () => {
    const run = consecutiveUnpaidRun(
      [period(2, "2026-03-10", 0, { rentOutstanding: 0 }), period(5, "2026-06-10", 3_000), period(6, "2026-07-10", 0)],
      { today: TODAY },
    );
    expect(run).toEqual([]);
  });

  it("dos períodos impagos que no son consecutivos: racha de 1", () => {
    const run = consecutiveUnpaidRun([period(3, "2026-04-10", 500_000), period(5, "2026-06-10", 500_000)], { today: TODAY });
    expect(run).toHaveLength(1);
    // Con empate gana la más reciente.
    expect(run[0].periodIndex).toBe(5);
  });

  it("un pago parcial cuenta según cuánto del alquiler quedó impago", () => {
    expect(isPeriodUnpaid(period(5, "2026-06-10", 300_000), { today: TODAY })).toBe(true);
    expect(isPeriodUnpaid(period(5, "2026-06-10", 200_000), { today: TODAY })).toBe(false);
    expect(isPeriodUnpaid(period(5, "2026-06-10", 200_000), { today: TODAY, minFraction: 0.25 })).toBe(true);
  });

  it("el período recién cuenta cuando pasaron el vencimiento y los días de gracia", () => {
    const p = period(6, "2026-07-10", 500_000);
    expect(isPeriodUnpaid(p, { today: "2026-07-10" })).toBe(false);
    expect(isPeriodUnpaid(p, { today: "2026-07-11" })).toBe(true);
    expect(isPeriodUnpaid(p, { today: "2026-07-14", graceDays: 5 })).toBe(false);
    expect(isPeriodUnpaid(p, { today: "2026-07-16", graceDays: 5 })).toBe(true);
  });

  it("cargos que no son mensuales o sin datos del alquiler no cuentan", () => {
    expect(isPeriodUnpaid(period(5, "2026-06-10", 500_000, { kind: "extra" }), { today: TODAY })).toBe(false);
    expect(isPeriodUnpaid(period(5, "2026-06-10", 500_000, { rentAmount: undefined }), { today: TODAY })).toBe(false);
    expect(isPeriodUnpaid({ kind: "mensual", periodIndex: 5, dueDate: "2026-06-10" }, { today: TODAY })).toBe(false);
  });

  it("devuelve la racha más larga aunque haya otra más nueva", () => {
    const run = consecutiveUnpaidRun(
      [period(1, "2026-01-10", 500_000), period(2, "2026-02-10", 500_000), period(3, "2026-03-10", 500_000), period(6, "2026-06-10", 500_000)],
      { today: TODAY },
    );
    expect(run.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});
