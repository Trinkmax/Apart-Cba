import { describe, expect, it } from "vitest";
import { computeAdjustment, type AdjustmentRules } from "@/lib/rentals/adjustments";
import {
  CoefficientSeries,
  IndexSeries,
  INDEX_CODES,
  isCoefficientIndex,
  lastMissingMonthIn,
  lookupWindow,
  missingMonths,
  monthCoverage,
  seriesFromPoints,
  type IndexPoint,
} from "@/lib/rentals/indices";
import { buildAdjustmentWindows, buildSchedule } from "@/lib/rentals/schedule";

// Coeficientes mensuales Casa Propia como los publica el Ministerio (nov-25 … abr-26).
const COEFS: Record<string, number> = {
  "2025-11-01": 1.0306,
  "2025-12-01": 1.0281,
  "2026-01-01": 1.0254,
  "2026-02-01": 1.0233,
  "2026-03-01": 1.0219,
  "2026-04-01": 1.0227,
};
const points = (rec: Record<string, number>): IndexPoint[] => Object.entries(rec).map(([date, value]) => ({ date, value }));
const product = Object.values(COEFS).reduce((p, c) => p * c, 1);

const rules: AdjustmentRules = {
  method: "indice",
  indexCode: "casa_propia",
  fixedPct: null,
  steps: null,
  rounding: "none",
  capPct: null,
  allowDecrease: false,
};

/** Contrato desde el 01/12/2025, ajuste semestral con el último dato publicado (lag 2): rige el 01/06/2026, oct-25 → abr-26. */
function juneWindow() {
  const schedule = buildSchedule({ startDate: "2025-12-01", durationMonths: 36, adjustmentEveryMonths: 6, paymentWindowDays: 10 });
  const w = buildAdjustmentWindows(schedule, "2025-12-01", { frequency: "monthly", lagMonths: 2 })[0];
  expect(w.effectiveDate).toBe("2026-06-01");
  expect([w.fromMonth, w.toMonth]).toEqual(["2025-10-01", "2026-04-01"]);
  return w;
}

describe("Casa Propia: coeficientes mensuales", () => {
  it("sólo Casa Propia se publica como coeficiente", () => {
    expect(INDEX_CODES.filter(isCoefficientIndex)).toEqual(["casa_propia"]);
    expect(seriesFromPoints("casa_propia", [])).toBeInstanceOf(CoefficientSeries);
    expect(seriesFromPoints("ipc", [])).toBeInstanceOf(IndexSeries);
  });

  it("encadena los coeficientes como nivel: el mes anterior al primero vale 1", () => {
    const s = new CoefficientSeries(points(COEFS));
    expect(s.get("2025-10-01")).toBe(1);
    expect(s.get("2025-11-01")).toBeCloseTo(1.0306, 10);
    expect(s.get("2026-04-01")).toBeCloseTo(product, 10);
    expect(s.firstDate).toBe("2025-11-01");
    expect(s.lastDate).toBe("2026-04-01");
    expect(s.get("2026-05-01")).toBeUndefined();
  });

  it("el ajuste de junio es el producto de los seis coeficientes (≈ +16 %), no el cociente de dos", () => {
    const r = computeAdjustment(1_000_000, juneWindow(), rules, seriesFromPoints("casa_propia", points(COEFS)));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.rawCoefficient).toBeCloseTo(product, 8);
    expect(r.amount).toBeCloseTo(Math.round(1_000_000 * product * 100) / 100, 2);
    expect(r.variationPct).toBeCloseTo(16.19, 1);
  });

  it("el punto de partida no cambia el resultado (más historia cargada da lo mismo)", () => {
    const longer = new CoefficientSeries(points({ "2025-08-01": 1.02, "2025-09-01": 1.03, "2025-10-01": 1.025, ...COEFS }));
    const r = computeAdjustment(1_000_000, juneWindow(), rules, longer);
    expect(r.status === "ok" && r.rawCoefficient).toBeCloseTo(product, 8);
  });

  it("con un mes faltante en la ventana queda esperando el índice: nunca se saltea un mes", () => {
    const { "2026-01-01": _gone, ...withGap } = COEFS;
    void _gone;
    const r = computeAdjustment(1_000_000, juneWindow(), rules, new CoefficientSeries(points(withGap)));
    expect(r.status).toBe("missing_index");
  });

  it("un hueco viejo no frena los ajustes posteriores: se usa el último tramo sin huecos", () => {
    const s = new CoefficientSeries(points({ "2025-06-01": 1.03, ...COEFS }));
    expect(s.firstDate).toBe("2025-11-01");
    expect(s.get("2025-06-01")).toBeUndefined();
    const r = computeAdjustment(1_000_000, juneWindow(), rules, s);
    expect(r.status === "ok" && r.rawCoefficient).toBeCloseTo(product, 8);
  });

  it("descarta valores no positivos y acepta claves con día", () => {
    const s = new CoefficientSeries([
      { date: "2026-01-15", value: 1.02 },
      { date: "2026-02-01", value: 0 },
    ]);
    expect(s.lastDate).toBe("2026-01-01");
    expect(s.get("2026-01-01")).toBeCloseTo(1.02, 10);
  });
});

describe("missingMonths", () => {
  it("lista los meses sin dato entre el primero y el último", () => {
    expect(missingMonths(["2026-04-01", "2026-01-01", "2026-02-01"])).toEqual(["2026-03-01"]);
    expect(missingMonths(["2025-12-01", "2026-01-01"])).toEqual([]);
    expect(missingMonths(["2026-01-01"])).toEqual([]);
  });
});

describe("lookupWindow: las dos puntas de un ajuste", () => {
  it("índice de nivel: lee cada punta y avisa cuál falta", () => {
    const ipc = new IndexSeries([{ date: "2026-01-01", value: 100 }, { date: "2026-04-01", value: 110 }], "monthly");
    expect(lookupWindow(ipc, "2026-01-01", "2026-04-01")).toEqual({ ok: true, fromValue: 100, toValue: 110 });
    expect(lookupWindow(ipc, "2026-01-01", "2026-05-01")).toEqual({ ok: false, missing: ["2026-05-01"] });
    expect(lookupWindow(null, "2026-01-01", "2026-04-01")).toEqual({ ok: false, missing: ["2026-01-01", "2026-04-01"] });
  });

  it("Casa Propia: cargar un mes salteado (junio antes que mayo) no traba la ventana oct-25 → abr-26", () => {
    const s = new CoefficientSeries(points({ ...COEFS, "2026-06-01": 1.02 }));
    // get() sigue mostrando sólo el último tramo (gráfico y tarjeta)…
    expect(s.get("2025-10-01")).toBeUndefined();
    // …pero la ventana cae entera antes del hueco: se calcula igual.
    const w = lookupWindow(s, "2025-10-01", "2026-04-01");
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.toValue / w.fromValue).toBeCloseTo(product, 10);
  });

  it("Casa Propia: un mes futuro tipeado de más tampoco frena los ajustes de antes", () => {
    const s = new CoefficientSeries(points({ ...COEFS, "2027-04-01": 1.03 }));
    const w = lookupWindow(s, "2025-10-01", "2026-04-01");
    expect(w.ok && w.toValue / w.fromValue).toBeCloseTo(product, 10);
  });

  it("Casa Propia: la ventana que cruza el hueco espera, y dice qué meses faltan adentro", () => {
    const s = new CoefficientSeries(points({ ...COEFS, "2026-06-01": 1.02, "2026-07-01": 1.01 }));
    expect(lookupWindow(s, "2026-02-01", "2026-07-01")).toEqual({ ok: false, missing: ["2026-05-01"] });
    expect(lookupWindow(s, "2026-02-01", "2026-09-01")).toEqual({ ok: false, missing: ["2026-05-01", "2026-08-01", "2026-09-01"] });
    // Desde el mes del hueco (ancla del tramo nuevo) no hace falta su coeficiente.
    const w = lookupWindow(s, "2026-05-01", "2026-07-01");
    expect(w.ok && w.toValue / w.fromValue).toBeCloseTo(1.02 * 1.01, 10);
  });

  it("el motor usa los tramos: junio cargado antes que mayo no traba el ajuste oct-25 → abr-26", () => {
    const s = new CoefficientSeries(points({ ...COEFS, "2026-06-01": 1.02 }));
    const r = computeAdjustment(1_000_000, juneWindow(), rules, s);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.rawCoefficient).toBeCloseTo(product, 8);
    // La ventana siguiente (feb → jul) sí cruza el hueco: espera mayo, no julio.
    const next = { ...juneWindow(), fromMonth: "2026-02-01", toMonth: "2026-07-01" };
    const withJuly = new CoefficientSeries(points({ ...COEFS, "2026-06-01": 1.02, "2026-07-01": 1.01 }));
    expect(computeAdjustment(1_000_000, next, rules, withJuly)).toEqual({ status: "missing_index", missing: ["2026-05-01"] });
  });

  it("Casa Propia: con la serie vacía o una ventana antes de los datos, faltan los meses de la ventana", () => {
    expect(lookupWindow(new CoefficientSeries([]), "2026-01-01", "2026-03-01")).toEqual({ ok: false, missing: ["2026-02-01", "2026-03-01"] });
    const s = new CoefficientSeries(points(COEFS));
    expect(lookupWindow(s, "2025-07-01", "2025-12-01")).toEqual({ ok: false, missing: ["2025-08-01", "2025-09-01", "2025-10-01"] });
  });
});

describe("lastMissingMonthIn: qué mes nombrar en un ajuste que espera Casa Propia", () => {
  const cov = monthCoverage(["2025-11-01", "2025-12-01", "2026-02-01", "2026-03-01", "2026-04-01"]);

  it("resume lo cargado: primero, último y huecos", () => {
    expect(cov).toEqual({ first: "2025-11-01", last: "2026-04-01", gaps: ["2026-01-01"] });
    expect(monthCoverage([])).toBeNull();
  });

  it("si el último mes de la ventana no está, es ése", () => {
    expect(lastMissingMonthIn("2026-01-01", "2026-06-01", cov)).toBe("2026-06-01");
    expect(lastMissingMonthIn(null, "2025-09-01", cov)).toBe("2025-09-01");
    expect(lastMissingMonthIn("2026-01-01", "2026-06-01", null)).toBe("2026-06-01");
  });

  it("si está, nombra el hueco del medio y no un mes que ya se cargó", () => {
    expect(lastMissingMonthIn("2025-10-01", "2026-04-01", cov)).toBe("2026-01-01");
    expect(lastMissingMonthIn(null, "2026-04-01", cov)).toBe("2026-01-01");
  });

  it("null cuando a la ventana no le falta nada (el ajuste se recalcula solo)", () => {
    expect(lastMissingMonthIn("2026-01-01", "2026-04-01", cov)).toBeNull();
    expect(lastMissingMonthIn(null, "2025-12-01", cov)).toBeNull();
  });

  it("con la ventana arrancando antes de lo cargado, falta el mes anterior al primero", () => {
    expect(lastMissingMonthIn("2025-07-01", "2025-12-01", cov)).toBe("2025-10-01");
  });
});
