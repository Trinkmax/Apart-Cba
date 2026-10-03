import { describe, expect, it } from "vitest";
import { IndexSeries, type IndexPoint } from "@/lib/rentals/indices";
import { addDays, addMonthsToMonth } from "@/lib/rentals/ymd";
import { summarizeIndex, summaryRange } from "@/components/rentals/indices/index-model";
import {
  buildCalculatorPlan,
  calculatorKeyRange,
  calculatorSummaryText,
  type CalculatorInput,
} from "@/components/rentals/indices/calculator-model";

/** IPC sintético: +2 % por mes desde enero 2025 hasta agosto 2026. */
function monthlyPoints(): IndexPoint[] {
  const out: IndexPoint[] = [];
  for (let i = 0; i < 20; i++) out.push({ date: addMonthsToMonth("2025-01-01", i), value: 100 * 1.02 ** i });
  return out;
}

/** ICL sintético: +0,1 % por día, publicado hasta el 16/10/2026 (adelantado). */
function dailyPoints(): IndexPoint[] {
  const out: IndexPoint[] = [];
  let d = "2025-01-01";
  for (let i = 0; d <= "2026-10-16"; i++, d = addDays(d, 1)) out.push({ date: d, value: 10 * 1.001 ** i });
  return out;
}

describe("summarizeIndex · mensual", () => {
  const s = summarizeIndex("ipc", monthlyPoints(), "2026-10-02");

  it("último dato y variaciones", () => {
    expect(s.refDate).toBe("2026-08-01");
    expect(s.monthlyPct).toBe(2);
    expect(s.quarterPct).toBe(6.12);
    expect(s.yearlyPct).toBe(26.82);
    expect(s.monthly).toHaveLength(12);
    expect(s.monthly[11]).toEqual({ month: "2026-08-01", pct: 2 });
  });

  it("al día a principio de mes, atrasado si pasó mediados sin el dato nuevo", () => {
    expect(s.freshness).toBe("ok");
    expect(summarizeIndex("ipc", monthlyPoints(), "2026-10-20").freshness).toBe("late");
  });

  it("serie vacía", () => {
    const e = summarizeIndex("casa_propia", [], "2026-10-02");
    expect(e.freshness).toBe("empty");
    expect(e.refValue).toBeNull();
    expect(e.monthly).toEqual([]);
  });

  it("Casa Propia: los coeficientes mensuales se leen como variación del mes, no como nivel", () => {
    // 14 meses de coeficientes, +2 % y +3 % alternados (ago-25 … sep-26).
    const pts: IndexPoint[] = [];
    for (let i = 0; i < 14; i++) pts.push({ date: addMonthsToMonth("2025-08-01", i), value: i % 2 ? 1.03 : 1.02 });
    const cp = summarizeIndex("casa_propia", pts, "2026-10-20");
    expect(cp.refDate).toBe("2026-09-01");
    expect(cp.monthlyPct).toBe(3);
    expect(cp.quarterPct).toBeCloseTo((1.03 * 1.02 * 1.03 - 1) * 100, 1); // jul × ago × sep
    expect(cp.freshness).toBe("ok");
    expect(cp.yearlyPct).toBeCloseTo((1.02 ** 6 * 1.03 ** 6 - 1) * 100, 1);
    expect(cp.monthly.length).toBe(12);
    expect(cp.monthly.every((m) => m.pct === 2 || m.pct === 3)).toBe(true);
  });

  it("Casa Propia trae qué meses hay cargados (para nombrar el que falta); los demás índices, no", () => {
    const pts: IndexPoint[] = [
      { date: "2026-01-01", value: 1.02 },
      { date: "2026-03-01", value: 1.03 },
      { date: "2026-04-01", value: 0 },
      { date: "2026-05-01", value: 1.01 },
    ];
    expect(summarizeIndex("casa_propia", pts, "2026-06-02").coverage).toEqual({
      first: "2026-01-01",
      last: "2026-05-01",
      gaps: ["2026-02-01", "2026-04-01"],
    });
    expect(summarizeIndex("casa_propia", [], "2026-06-02").coverage).toBeNull();
    expect(s.coverage).toBeNull();
  });
});

describe("summarizeIndex · diario", () => {
  const s = summarizeIndex("icl", dailyPoints(), "2026-10-02");

  it("muestra el valor de hoy aunque esté publicado por adelantado", () => {
    expect(s.refDate).toBe("2026-10-02");
    expect(s.lastPublished).toBe("2026-10-16");
    expect(s.freshness).toBe("ok");
    expect(s.monthlyPct).toBeCloseTo((1.001 ** 30 - 1) * 100, 1);
    expect(s.monthly.length).toBe(12);
  });

  it("atrasado si el último dato quedó lejos", () => {
    expect(summarizeIndex("icl", dailyPoints(), "2026-10-30").freshness).toBe("late");
  });

  it("rango de lectura", () => {
    expect(summaryRange("ipc", "2026-10-02")).toEqual(["2025-06-01", "2026-10-01"]);
    expect(summaryRange("icl", "2026-10-02")[1]).toBe("2026-12-01");
  });
});

describe("calculadora", () => {
  const input: CalculatorInput = {
    amount: 500000,
    startDate: "2026-03-01",
    every: 3,
    indexCode: "ipc",
    lagMonths: 2,
    rounding: "hundred",
    today: "2026-10-02",
  };
  const series = new IndexSeries(monthlyPoints(), "monthly");

  it("encadena los ajustes hasta el próximo que no rige", () => {
    const r = buildCalculatorPlan(input, series);
    expect(r.steps.map((s) => s.effectiveDate)).toEqual(["2026-06-01", "2026-09-01", "2026-12-01"]);
    expect(r.steps[0]).toMatchObject({ fromKey: "2026-01-01", toKey: "2026-04-01", amount: 530600, status: "calculado" });
    expect(r.steps[1].amount).toBe(563100);
    expect(r.steps[2]).toMatchObject({ status: "pendiente_indice", missing: ["2026-10-01"], inForce: false });
    expect(r.currentAmount).toBe(563100);
    expect(r.next?.effectiveDate).toBe("2026-12-01");
    expect(r.pendingNow).toBeNull();
    expect(r.totalVariationPct).toBe(12.62);
  });

  it("precio provisorio si un ajuste que ya rige no tiene índice", () => {
    const r = buildCalculatorPlan({ ...input, today: "2026-12-15" }, series);
    expect(r.pendingNow?.effectiveDate).toBe("2026-12-01");
    expect(r.currentAmount).toBe(563100);
    expect(r.next?.status).toBe("bloqueado");
  });

  it("convención meses del ciclo (lag 1)", () => {
    const r = buildCalculatorPlan({ ...input, lagMonths: 1 }, series);
    expect(r.steps[0]).toMatchObject({ fromKey: "2026-02-01", toKey: "2026-05-01" });
  });

  it("rango de claves a leer", () => {
    expect(calculatorKeyRange(input)).toEqual(["2026-01-01", "2026-10-01"]);
  });

  it("texto para copiar", () => {
    const r = buildCalculatorPlan(input, series);
    const text = calculatorSummaryText(input, r).replace(/\s/g, " ");
    expect(text).toContain("ajuste trimestral por IPC (último dato publicado)");
    expect(text).toContain("- 1 de junio de 2026: $ 530.600 (+6,12 %, meses: feb–abr)");
    expect(text).toContain("Esperando el IPC de octubre");
    expect(text).toContain("Hoy rige $ 563.100 (+12,62 % desde el inicio).");
  });
});
