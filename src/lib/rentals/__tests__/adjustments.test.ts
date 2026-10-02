import { describe, expect, it } from "vitest";
import {
  computeAdjustment,
  computeRentChain,
  rentForPeriod,
  roundAmount,
  type AdjustmentRules,
  type RoundingRule,
} from "@/lib/rentals/adjustments";
import { INDEX_CODES, INDEX_META, IndexSeries, indexFrequency, isIndexCode, type IndexPoint } from "@/lib/rentals/indices";
import { buildAdjustmentWindows, buildSchedule, type AdjustmentWindow, type IndexFrequency } from "@/lib/rentals/schedule";

/** Ventanas reales de un contrato (cronograma → ventanas), como las arma la app. */
function windowsFor(
  startDate: string,
  every: number,
  frequency: IndexFrequency | null,
  lagMonths = 2,
  durationMonths = 24,
): AdjustmentWindow[] {
  const schedule = buildSchedule({ startDate, durationMonths, adjustmentEveryMonths: every, paymentWindowDays: 10 });
  return buildAdjustmentWindows(schedule, startDate, { frequency, lagMonths });
}

function rules(over: Partial<AdjustmentRules> = {}): AdjustmentRules {
  return {
    method: "indice",
    indexCode: "ipc",
    fixedPct: null,
    steps: null,
    rounding: "none",
    capPct: null,
    allowDecrease: false,
    ...over,
  };
}

const monthly = (levels: Record<string, number>) =>
  new IndexSeries(
    Object.entries(levels).map(([date, value]) => ({ date, value })),
    "monthly",
  );

/** IPC INDEC, nivel general (base dic-2016 = 100). */
const IPC: Record<string, number> = {
  "2025-07-01": 9023.973,
  "2025-08-01": 9193.2441,
  "2025-09-01": 9384.0922,
  "2025-10-01": 9603.8623,
  "2025-11-01": 9841.3581,
  "2025-12-01": 10121.3715,
  "2026-01-01": 10413.0309,
  "2026-02-01": 10714.6255,
  "2026-03-01": 11077.0608,
  "2026-04-01": 11363.0904,
  "2026-05-01": 11607.3937,
  "2026-06-01": 11826.4103,
  "2026-07-01": 12076.3937,
  "2026-08-01": 12276.766,
};

/** Ventana mínima para probar métodos que no miran fechas. */
const W1: AdjustmentWindow = {
  sequence: 1,
  periodIndex: 4,
  effectiveDate: "2026-06-01",
  fromMonth: null,
  toMonth: null,
  fromDate: null,
  toDate: null,
};

describe("roundAmount", () => {
  it("aplica cada regla de redondeo al múltiplo más cercano", () => {
    const x = 731615.438320449;
    expect(roundAmount(x, "none")).toBe(731615.44);
    expect(roundAmount(x, "unit")).toBe(731615);
    expect(roundAmount(x, "ten")).toBe(731620);
    expect(roundAmount(x, "hundred")).toBe(731600);
    expect(roundAmount(x, "thousand")).toBe(732000);
  });

  it("la mitad sube (half up) en todas las reglas", () => {
    expect(roundAmount(1234.5, "unit")).toBe(1235);
    expect(roundAmount(1235, "ten")).toBe(1240);
    expect(roundAmount(731650, "hundred")).toBe(731700);
    expect(roundAmount(731500, "thousand")).toBe(732000);
    expect(roundAmount(650500, "thousand")).toBe(651000);
    expect(roundAmount(650050, "hundred")).toBe(650100);
  });

  it("debajo de la mitad baja", () => {
    expect(roundAmount(1234.49, "unit")).toBe(1234);
    expect(roundAmount(1234.99, "ten")).toBe(1230);
    expect(roundAmount(731649.99, "hundred")).toBe(731600);
    expect(roundAmount(731499.99, "thousand")).toBe(731000);
  });

  it("'none' deja centavos con half up real, sin el error de representación de los floats", () => {
    // Math.round(1.005 * 100) / 100 da 1 y Math.round(4.725 * 100) / 100 da 4.72.
    expect(roundAmount(1.005, "none")).toBe(1.01);
    expect(roundAmount(4.725, "none")).toBe(4.73);
    expect(roundAmount(650000, "none")).toBe(650000);
  });

  it("un múltiplo exacto queda igual y una regla desconocida no rompe (deja centavos)", () => {
    for (const r of ["unit", "ten", "hundred", "thousand"] as RoundingRule[]) {
      expect(roundAmount(650000, r)).toBe(650000);
    }
    expect(roundAmount(1234.567, "xyz" as RoundingRule)).toBe(1234.57);
  });
});

describe("indices — metadatos", () => {
  it("cada índice declara su frecuencia (el IPC es mensual, el ICL diario)", () => {
    expect(indexFrequency("ipc")).toBe("monthly");
    expect(indexFrequency("icl")).toBe("daily");
    expect(indexFrequency("casa_propia")).toBe("monthly");
    expect(indexFrequency("uva")).toBe("daily");
    expect(indexFrequency("cer")).toBe("daily");
    expect(indexFrequency("ripte")).toBe("monthly");
    expect(INDEX_CODES.every((c) => INDEX_META[c].label.length > 0)).toBe(true);
    expect(INDEX_META.icl.publisher).toBe("BCRA");
  });

  it("isIndexCode sólo acepta códigos conocidos", () => {
    expect(isIndexCode("ipc")).toBe(true);
    expect(isIndexCode("icl")).toBe(true);
    expect(isIndexCode("IPC")).toBe(false);
    expect(isIndexCode("uvi")).toBe(false);
    expect(isIndexCode(null)).toBe(false);
  });
});

describe("IndexSeries", () => {
  const daily: IndexPoint[] = [
    { date: "2026-04-30", value: 32.05 },
    { date: "2026-05-01", value: 32.13 }, // viernes
    // sábado 02 y domingo 03 sin dato
    { date: "2026-05-04", value: 32.19 }, // lunes
  ];

  it("índice mensual: sólo el dato exacto del mes, nunca 'el más cercano'", () => {
    const s = monthly({ "2026-02-01": 10714.6255, "2026-03-01": 11077.0608 });
    expect(s.get("2026-03-01")).toBe(11077.0608);
    expect(s.get("2026-04-01")).toBeUndefined(); // abril todavía no salió
    expect(s.get("2026-03-15")).toBeUndefined(); // un mensual no se busca por día
    expect(s.lastDate).toBe("2026-03-01");
    expect(s.size).toBe(2);
  });

  it("índice diario: un fin de semana sin dato dentro del rango publicado toma el último valor anterior", () => {
    const s = new IndexSeries(daily, "daily");
    expect(s.get("2026-05-02")).toBe(32.13);
    expect(s.get("2026-05-03")).toBe(32.13);
    expect(s.get("2026-05-04")).toBe(32.19);
    expect(s.lastDate).toBe("2026-05-04");
  });

  it("índice diario: una fecha posterior al último dato es 'todavía no salió', nunca 'usá el de ayer'", () => {
    const s = new IndexSeries(daily, "daily");
    expect(s.get("2026-05-05")).toBeUndefined();
    expect(s.get("2026-06-01")).toBeUndefined();
  });

  it("índice diario: un hueco mayor a la tolerancia (7 días por defecto) no se rellena", () => {
    const pts: IndexPoint[] = [
      { date: "2026-01-01", value: 29.39 },
      { date: "2026-01-20", value: 29.9 },
    ];
    const s = new IndexSeries(pts, "daily");
    expect(s.get("2026-01-08")).toBe(29.39); // 7 días hacia atrás: entra
    expect(s.get("2026-01-09")).toBeUndefined(); // 8 días: no
    expect(new IndexSeries(pts, "daily", 10).get("2026-01-10")).toBe(29.39);
  });

  it("descarta valores inválidos (≤ 0, NaN, Infinity) sin que cuenten como último dato", () => {
    const s = new IndexSeries(
      [
        { date: "2026-01-01", value: 29.39 },
        { date: "2026-01-02", value: 0 },
        { date: "2026-01-03", value: -1 },
        { date: "2026-01-04", value: Number.NaN },
        { date: "2026-01-05", value: Number.POSITIVE_INFINITY },
      ],
      "daily",
    );
    expect(s.size).toBe(1);
    expect(s.lastDate).toBe("2026-01-01");
    expect(s.get("2026-01-02")).toBeUndefined(); // posterior al último dato válido
  });

  it("el último dato es la fecha más nueva aunque los puntos lleguen desordenados", () => {
    const s = new IndexSeries(
      [
        { date: "2026-03-01", value: 3 },
        { date: "2026-01-01", value: 1 },
        { date: "2026-02-01", value: 2 },
      ],
      "monthly",
    );
    expect(s.lastDate).toBe("2026-03-01");
  });

  it("una serie vacía no tiene último dato ni valores", () => {
    const s = new IndexSeries([], "daily");
    expect(s.lastDate).toBeNull();
    expect(s.get("2026-01-01")).toBeUndefined();
    expect(s.size).toBe(0);
  });
});

describe("computeAdjustment — casos reales (INDEC / BCRA)", () => {
  it("IPC cuatrimestral desde 01/01/2026: el ajuste del 01/05/2026 lleva $650.000 a $731.615,44", () => {
    const w = windowsFor("2026-01-01", 4, "monthly", 2)[0];
    expect([w.effectiveDate, w.fromMonth, w.toMonth]).toEqual(["2026-05-01", "2025-11-01", "2026-03-01"]);
    const r = computeAdjustment(650000, w, rules(), monthly({ "2025-11-01": 9841.3581, "2026-03-01": 11077.0608 }));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.amount).toBe(731615.44);
    expect(r.amountBeforeRounding).toBe(731615.44);
    expect(r.coefficient).toBeCloseTo(1.1255622, 7);
    expect(r.rawCoefficient).toBe(r.coefficient);
    expect(r.variationPct).toBe(12.56);
    expect(r.fromValue).toBe(9841.3581);
    expect(r.toValue).toBe(11077.0608);
    expect(r.capped).toBe(false);
    expect(r.floored).toBe(false);
  });

  it("el mismo ajuste con el redondeo pactado: centena → $731.600, mil → $732.000", () => {
    const w = windowsFor("2026-01-01", 4, "monthly", 2)[0];
    const s = monthly(IPC);
    const hundred = computeAdjustment(650000, w, rules({ rounding: "hundred" }), s);
    const thousand = computeAdjustment(650000, w, rules({ rounding: "thousand" }), s);
    expect(hundred).toMatchObject({ status: "ok", amountBeforeRounding: 731615.44, amount: 731600 });
    expect(thousand).toMatchObject({ status: "ok", amountBeforeRounding: 731615.44, amount: 732000 });
  });

  it("IPC cuatrimestral desde 01/04/2026: el ajuste del 01/08/2026 (feb → jun) da $717.446,14", () => {
    const w = windowsFor("2026-04-01", 4, "monthly", 2)[0];
    expect([w.effectiveDate, w.fromMonth, w.toMonth]).toEqual(["2026-08-01", "2026-02-01", "2026-06-01"]);
    const r = computeAdjustment(650000, w, rules(), monthly(IPC));
    expect(r).toMatchObject({ status: "ok", amount: 717446.14, variationPct: 10.38, fromValue: 10714.6255, toValue: 11826.4103 });
  });

  it("ICL (diario) desde 01/01/2026: ICL(01/05) 32,13 / ICL(01/01) 29,39 lleva $600.000 a $655.937,39", () => {
    const w = windowsFor("2026-01-01", 4, "daily")[0];
    expect([w.fromDate, w.toDate]).toEqual(["2026-01-01", "2026-05-01"]);
    const icl = new IndexSeries(
      [
        { date: "2026-01-01", value: 29.39 },
        { date: "2026-05-01", value: 32.13 },
      ],
      "daily",
    );
    const r = computeAdjustment(600000, w, rules({ indexCode: "icl" }), icl);
    expect(r).toMatchObject({ status: "ok", amount: 655937.39, variationPct: 9.32, fromValue: 29.39, toValue: 32.13 });
  });

  it("ICL: si el valor del día del ajuste todavía no se publicó, queda pendiente (no usa el de ayer)", () => {
    const w = windowsFor("2026-01-01", 4, "daily")[0];
    const icl = new IndexSeries(
      [
        { date: "2026-01-01", value: 29.39 },
        { date: "2026-04-30", value: 32.05 },
      ],
      "daily",
    );
    expect(computeAdjustment(600000, w, rules({ indexCode: "icl" }), icl)).toEqual({
      status: "missing_index",
      missing: ["2026-05-01"],
    });
  });

  it("ICL: un contrato que arranca un sábado toma el valor del viernes (hueco chico dentro de la serie)", () => {
    // 01/08/2026 es sábado; el BCRA publicó el viernes 31/07 y el lunes 03/08.
    const w = windowsFor("2026-08-01", 4, "daily")[0];
    expect([w.fromDate, w.toDate]).toEqual(["2026-08-01", "2026-12-01"]);
    const icl = new IndexSeries(
      [
        { date: "2026-07-31", value: 30 },
        { date: "2026-08-03", value: 30.1 },
        { date: "2026-12-01", value: 33 },
      ],
      "daily",
    );
    const r = computeAdjustment(600000, w, rules({ indexCode: "icl" }), icl);
    expect(r).toMatchObject({ status: "ok", fromValue: 30, toValue: 33, amount: 660000 });
  });

  it("IPC: falta el mes de llegada (todavía no lo publicó el INDEC) → missing_index con la clave faltante", () => {
    const w = windowsFor("2026-01-01", 4, "monthly", 2)[0];
    const r = computeAdjustment(650000, w, rules(), monthly({ "2025-11-01": 9841.3581 }));
    expect(r).toEqual({ status: "missing_index", missing: ["2026-03-01"] });
  });

  it("sin serie o con serie vacía faltan las dos puntas", () => {
    const w = windowsFor("2026-01-01", 4, "monthly", 2)[0];
    const both = { status: "missing_index", missing: ["2025-11-01", "2026-03-01"] };
    expect(computeAdjustment(650000, w, rules(), null)).toEqual(both);
    expect(computeAdjustment(650000, w, rules(), undefined)).toEqual(both);
    expect(computeAdjustment(650000, w, rules(), monthly({}))).toEqual(both);
  });

  it("configuración inválida: índice sin código o ventana sin fechas", () => {
    const w = windowsFor("2026-01-01", 4, "monthly", 2)[0];
    expect(computeAdjustment(650000, w, rules({ indexCode: null }), monthly(IPC))).toEqual({
      status: "invalid",
      reason: "Falta elegir el índice.",
    });
    expect(computeAdjustment(650000, W1, rules(), monthly(IPC))).toEqual({
      status: "invalid",
      reason: "La ventana del ajuste no tiene fechas.",
    });
  });
});

describe("computeAdjustment — tope y piso", () => {
  const w = windowsFor("2026-01-01", 4, "monthly", 2)[0];

  it("con tope del 10 % un IPC de +12,56 % se corta en +10 % ($715.000)", () => {
    const r = computeAdjustment(650000, w, rules({ capPct: 10 }), monthly(IPC));
    expect(r).toMatchObject({ status: "ok", amount: 715000, variationPct: 10, capped: true, floored: false });
    if (r.status !== "ok") return;
    expect(r.coefficient).toBeCloseTo(1.1, 12);
    expect(r.rawCoefficient).toBeCloseTo(1.1255622, 7); // el crudo se conserva para mostrarlo
  });

  it("un tope que el índice no alcanza no cambia nada", () => {
    const r = computeAdjustment(650000, w, rules({ capPct: 15 }), monthly(IPC));
    expect(r).toMatchObject({ status: "ok", amount: 731615.44, capped: false });
  });

  it("tope 0 % congela el precio", () => {
    const r = computeAdjustment(650000, w, rules({ capPct: 0 }), monthly(IPC));
    expect(r).toMatchObject({ status: "ok", amount: 650000, capped: true, variationPct: 0 });
  });

  it("si el índice baja y el contrato no permite bajar, el precio queda igual (piso)", () => {
    const s = monthly({ "2025-11-01": 100, "2026-03-01": 95 });
    const r = computeAdjustment(650000, w, rules(), s);
    expect(r).toMatchObject({ status: "ok", amount: 650000, coefficient: 1, variationPct: 0, floored: true, capped: false });
    if (r.status !== "ok") return;
    expect(r.rawCoefficient).toBe(0.95);
  });

  it("si el contrato permite bajar, el precio acompaña al índice (y el tope no interviene)", () => {
    const s = monthly({ "2025-11-01": 100, "2026-03-01": 95 });
    const r = computeAdjustment(650000, w, rules({ allowDecrease: true, capPct: 10 }), s);
    expect(r).toMatchObject({ status: "ok", amount: 617500, variationPct: -5, floored: false, capped: false });
  });

  it("índice sin variación: coeficiente 1, sin tope ni piso", () => {
    const s = monthly({ "2025-11-01": 100, "2026-03-01": 100 });
    expect(computeAdjustment(650000, w, rules(), s)).toMatchObject({ amount: 650000, capped: false, floored: false });
  });
});

describe("computeAdjustment — porcentaje fijo", () => {
  it("+10 % por ajuste, sin mirar índices ni fechas", () => {
    const r = computeAdjustment(650000, W1, rules({ method: "porcentaje_fijo", indexCode: null, fixedPct: 10 }));
    expect(r).toMatchObject({ status: "ok", amount: 715000, variationPct: 10, fromValue: null, toValue: null });
    if (r.status !== "ok") return;
    expect(r.coefficient).toBeCloseTo(1.1, 12);
  });

  it("redondea igual que un índice (655.937,39 × 1,10 = 721.531,13 → $722.000)", () => {
    const r = computeAdjustment(655937.39, W1, rules({ method: "porcentaje_fijo", fixedPct: 10, rounding: "thousand" }));
    expect(r).toMatchObject({ status: "ok", amountBeforeRounding: 721531.13, amount: 722000 });
  });

  it("respeta el tope y el piso", () => {
    const capped = computeAdjustment(650000, W1, rules({ method: "porcentaje_fijo", fixedPct: 15, capPct: 10 }));
    expect(capped).toMatchObject({ status: "ok", amount: 715000, capped: true });
    const neg = computeAdjustment(650000, W1, rules({ method: "porcentaje_fijo", fixedPct: -5 }));
    expect(neg).toMatchObject({ status: "ok", amount: 650000, floored: true });
    const zero = computeAdjustment(650000, W1, rules({ method: "porcentaje_fijo", fixedPct: 0 }));
    expect(zero).toMatchObject({ status: "ok", amount: 650000, floored: false, capped: false });
  });

  it("sin porcentaje es una configuración inválida", () => {
    const invalid = { status: "invalid", reason: "Falta el porcentaje de cada ajuste." };
    expect(computeAdjustment(650000, W1, rules({ method: "porcentaje_fijo", fixedPct: null }))).toEqual(invalid);
    expect(computeAdjustment(650000, W1, rules({ method: "porcentaje_fijo", fixedPct: Number.NaN }))).toEqual(invalid);
  });
});

describe("computeAdjustment — escalonado, manual y sin ajuste", () => {
  const W2: AdjustmentWindow = { ...W1, sequence: 2, periodIndex: 7, effectiveDate: "2026-09-01" };
  const W3: AdjustmentWindow = { ...W1, sequence: 3, periodIndex: 10, effectiveDate: "2026-12-01" };
  const escalonado = (steps: number[] | null, over: Partial<AdjustmentRules> = {}) =>
    rules({ method: "escalonado", indexCode: null, steps, ...over });

  it("escalonado: usa el monto pactado de cada ajuste tal cual (posición 0 = ajuste 1)", () => {
    const r1 = computeAdjustment(650000, W1, escalonado([700000, 760000.555]));
    expect(r1).toMatchObject({ status: "ok", amount: 700000, amountBeforeRounding: 700000, variationPct: 7.69 });
    if (r1.status !== "ok") return;
    expect(r1.coefficient).toBeCloseTo(700000 / 650000, 12);
    expect(r1.rawCoefficient).toBe(r1.coefficient);
    // Sólo se llevan los centavos a 2 decimales.
    expect(computeAdjustment(700000, W2, escalonado([700000, 760000.555]))).toMatchObject({ amount: 760000.56 });
  });

  it("escalonado: el monto pactado no se redondea, no se topa y puede bajar", () => {
    expect(computeAdjustment(650000, W1, escalonado([700500], { rounding: "thousand" }))).toMatchObject({ amount: 700500 });
    expect(computeAdjustment(650000, W1, escalonado([700000], { capPct: 5 }))).toMatchObject({ amount: 700000, capped: false });
    expect(computeAdjustment(800000, W1, escalonado([700000]))).toMatchObject({
      amount: 700000,
      floored: false,
      variationPct: -12.5,
    });
  });

  it("escalonado: si no hay monto para ese ajuste (o es 0, negativo o NaN) alguien lo tiene que cargar", () => {
    expect(computeAdjustment(650000, W3, escalonado([700000, 760000]))).toEqual({ status: "needs_manual" });
    expect(computeAdjustment(650000, W1, escalonado(null))).toEqual({ status: "needs_manual" });
    expect(computeAdjustment(650000, W1, escalonado([0]))).toEqual({ status: "needs_manual" });
    expect(computeAdjustment(650000, W1, escalonado([-1]))).toEqual({ status: "needs_manual" });
    expect(computeAdjustment(650000, W1, escalonado([Number.NaN]))).toEqual({ status: "needs_manual" });
  });

  it("escalonado con base 0 no divide por cero (coeficiente 1)", () => {
    expect(computeAdjustment(0, W1, escalonado([500000]))).toMatchObject({ status: "ok", amount: 500000, coefficient: 1 });
  });

  it("manual: siempre pide que alguien cargue el monto, aunque haya índice publicado", () => {
    const w = windowsFor("2026-01-01", 4, "monthly", 2)[0];
    expect(computeAdjustment(650000, w, rules({ method: "manual" }), monthly(IPC))).toEqual({ status: "needs_manual" });
  });

  it("sin ajuste: coeficiente 1, el precio no cambia (ni con tope negativo)", () => {
    const r = computeAdjustment(650000, W1, rules({ method: "sin_ajuste", indexCode: null, capPct: -10 }));
    expect(r).toMatchObject({
      status: "ok",
      coefficient: 1,
      rawCoefficient: 1,
      variationPct: 0,
      amount: 650000,
      capped: false,
      floored: false,
    });
  });

  // Regresión: sin_ajuste pasaba por finish(), que aplica el redondeo del
  // contrato. Con frecuencia cargada (el schema la permite y
  // rental_settings.default_adjustment_every vale 3) y un precio que no es
  // múltiplo del redondeo (default 'hundred'), cada "ajuste" de un precio FIJO
  // lo movía: 650.050 → 650.100.
  it("sin ajuste: un precio fijo no se redondea en cada ventana (650.050 sigue siendo 650.050)", () => {
    const r = computeAdjustment(650050, W1, rules({ method: "sin_ajuste", indexCode: null, rounding: "hundred" }));
    expect(r).toMatchObject({ status: "ok", amount: 650050 });
  });
});

describe("computeRentChain — IPC trimestral real a 24 meses (7 ajustes)", () => {
  // Contrato del 01/09/2025, IPC trimestral, rezago 2, redondeo a mil, $500.000.
  // Hoy (oct-2026) el INDEC publicó hasta agosto: el ajuste de dic-2026 necesita
  // octubre → queda pendiente y los dos siguientes bloqueados.
  const windows = windowsFor("2025-09-01", 3, "monthly", 2);
  const thousand = rules({ rounding: "thousand" });

  it("las 7 ventanas son las esperadas (rezago 2: cada ajuste usa el último dato publicado)", () => {
    expect(windows.map((w) => [w.sequence, w.periodIndex, w.effectiveDate, w.fromMonth, w.toMonth])).toEqual([
      [1, 4, "2025-12-01", "2025-07-01", "2025-10-01"],
      [2, 7, "2026-03-01", "2025-10-01", "2026-01-01"],
      [3, 10, "2026-06-01", "2026-01-01", "2026-04-01"],
      [4, 13, "2026-09-01", "2026-04-01", "2026-07-01"],
      [5, 16, "2026-12-01", "2026-07-01", "2026-10-01"],
      [6, 19, "2027-03-01", "2026-10-01", "2027-01-01"],
      [7, 22, "2027-06-01", "2027-01-01", "2027-04-01"],
    ]);
  });

  it("encadena sobre el monto REDONDEADO del ajuste anterior (lo que de verdad paga el inquilino)", () => {
    const chain = computeRentChain({ initialRent: 500000, windows, rules: thousand, series: monthly(IPC) });
    expect(chain.map((s) => s.status)).toEqual([
      "calculado",
      "calculado",
      "calculado",
      "calculado",
      "pendiente_indice",
      "bloqueado",
      "bloqueado",
    ]);
    expect(chain.map((s) => s.base)).toEqual([500000, 532000, 577000, 630000, 670000, null, null]);
    expect(chain.map((s) => s.amount)).toEqual([532000, 577000, 630000, 670000, null, null, null]);
    // 532.000 × 10413,0309 / 9603,8623 = 576.823,39 — encadenando sin redondear daría 576.964,88.
    expect(chain.slice(0, 4).map((s) => (s.result?.status === "ok" ? s.result.amountBeforeRounding : null))).toEqual([
      532130.49, 576823.39, 629644.07, 669547.44,
    ]);
  });

  it("el primer ajuste sin dato queda pendiente_indice (con la clave que falta) y los siguientes bloqueados", () => {
    const chain = computeRentChain({ initialRent: 500000, windows, rules: thousand, series: monthly(IPC) });
    expect(chain[4].result).toEqual({ status: "missing_index", missing: ["2026-10-01"] });
    expect(chain[5]).toMatchObject({ base: null, result: null, amount: null, status: "bloqueado" });
    expect(chain[6]).toMatchObject({ base: null, result: null, amount: null, status: "bloqueado" });
  });

  it("sin redondeo, la cadena reproduce el cociente total del índice (jul-2025 → jul-2026)", () => {
    const chain = computeRentChain({ initialRent: 500000, windows, rules: rules(), series: monthly(IPC) });
    expect(chain.slice(0, 4).map((s) => s.amount)).toEqual([532130.49, 576964.88, 629605.75, 669128.44]);
    expect(chain[3].amount).toBeCloseTo((500000 * IPC["2026-07-01"]) / IPC["2025-07-01"], 1);
  });

  it("un monto ya aplicado manda sobre el cálculo y es la base del ajuste siguiente", () => {
    const applied = new Map([[2, 640000]]);
    const chain = computeRentChain({ initialRent: 500000, windows, rules: thousand, series: monthly(IPC), applied });
    expect(chain.map((s) => s.status).slice(0, 5)).toEqual([
      "calculado",
      "aplicado",
      "calculado",
      "calculado",
      "pendiente_indice",
    ]);
    // El cálculo se conserva para mostrar la diferencia contra lo aplicado.
    expect(chain[1]).toMatchObject({ base: 532000, amount: 640000, result: { status: "ok", amount: 577000 } });
    expect(chain[2]).toMatchObject({ base: 640000, amount: 698000, result: { amountBeforeRounding: 698392.04 } });
    expect(chain[3]).toMatchObject({ base: 698000, amount: 742000, result: { amountBeforeRounding: 741816.05 } });
    expect(chain[4].base).toBe(742000);
  });

  it("aplicar a mano el ajuste pendiente desbloquea el siguiente", () => {
    const applied = new Map([[5, 700000]]);
    const chain = computeRentChain({ initialRent: 500000, windows, rules: thousand, series: monthly(IPC), applied });
    expect(chain[4]).toMatchObject({ status: "aplicado", base: 670000, amount: 700000, result: { status: "missing_index" } });
    expect(chain[5]).toMatchObject({
      status: "pendiente_indice",
      base: 700000,
      result: { status: "missing_index", missing: ["2026-10-01", "2027-01-01"] },
    });
    expect(chain[6].status).toBe("bloqueado");
  });

  it("un aplicado sobre un ajuste bloqueado no tiene base calculada pero sirve de base al siguiente", () => {
    const applied = new Map([[6, 720000]]);
    const chain = computeRentChain({ initialRent: 500000, windows, rules: thousand, series: monthly(IPC), applied });
    expect(chain[4].status).toBe("pendiente_indice");
    expect(chain[5]).toMatchObject({ status: "aplicado", base: null, result: null, amount: 720000 });
    expect(chain[6]).toMatchObject({ status: "pendiente_indice", base: 720000 });
  });
});

describe("computeRentChain — otras configuraciones", () => {
  it("rezago 1 (contrato del 01/10/2025): 3 ajustes calculados y el de oct-2026 espera el IPC de septiembre", () => {
    const windows = windowsFor("2025-10-01", 3, "monthly", 1);
    expect(windows[0]).toMatchObject({ effectiveDate: "2026-01-01", fromMonth: "2025-09-01", toMonth: "2025-12-01" });
    const chain = computeRentChain({ initialRent: 500000, windows, rules: rules(), series: monthly(IPC) });
    expect(chain.map((s) => s.status)).toEqual([
      "calculado",
      "calculado",
      "calculado",
      "pendiente_indice",
      "bloqueado",
      "bloqueado",
      "bloqueado",
    ]);
    expect(chain.slice(0, 3).map((s) => s.amount)).toEqual([539283.46, 590204.17, 630130.75]);
    expect(chain[3].result).toEqual({ status: "missing_index", missing: ["2026-09-01"] });
    const hundred = computeRentChain({ initialRent: 500000, windows, rules: rules({ rounding: "hundred" }), series: monthly(IPC) });
    expect(hundred.slice(0, 3).map((s) => s.amount)).toEqual([539300, 590200, 630100]);
    expect(hundred[1].result).toMatchObject({ amountBeforeRounding: 590222.27 }); // 539.300 × coef, no 539.283,46 × coef
  });

  it("porcentaje fijo: +5 % trimestral compuesto sobre el monto redondeado a la centena", () => {
    const windows = windowsFor("2026-03-01", 3, null);
    const chain = computeRentChain({
      initialRent: 500000,
      windows,
      rules: rules({ method: "porcentaje_fijo", indexCode: null, fixedPct: 5, rounding: "hundred" }),
    });
    expect(chain.every((s) => s.status === "calculado")).toBe(true);
    // 551.250 → 551.300 (la mitad sube) y el siguiente se calcula sobre 551.300.
    expect(chain.map((s) => s.amount)).toEqual([525000, 551300, 578900, 607800, 638200, 670100, 703600]);
  });

  it("manual: el primer ajuste queda pendiente_manual y bloquea el resto hasta que se cargue", () => {
    const windows = windowsFor("2026-03-01", 4, null);
    const manual = rules({ method: "manual", indexCode: null });
    const chain = computeRentChain({ initialRent: 500000, windows, rules: manual });
    expect(chain.map((s) => s.status)).toEqual(["pendiente_manual", "bloqueado", "bloqueado", "bloqueado", "bloqueado"]);
    const withFirst = computeRentChain({ initialRent: 500000, windows, rules: manual, applied: new Map([[1, 560000]]) });
    expect(withFirst.map((s) => s.status)).toEqual(["aplicado", "pendiente_manual", "bloqueado", "bloqueado", "bloqueado"]);
    expect(withFirst[1].base).toBe(560000);
  });

  it("escalonado: los montos pactados se encadenan y el que falta pide carga manual", () => {
    const windows = windowsFor("2026-03-01", 6, null);
    const chain = computeRentChain({
      initialRent: 500000,
      windows,
      rules: rules({ method: "escalonado", indexCode: null, steps: [560000, 630000] }),
    });
    expect(chain.map((s) => [s.status, s.base, s.amount])).toEqual([
      ["calculado", 500000, 560000],
      ["calculado", 560000, 630000],
      ["pendiente_manual", 630000, null],
    ]);
  });

  it("configuración inválida: el primer ajuste queda invalido y el resto bloqueado", () => {
    const windows = windowsFor("2026-03-01", 6, "monthly", 1);
    const chain = computeRentChain({ initialRent: 500000, windows, rules: rules({ indexCode: null }), series: monthly(IPC) });
    expect(chain.map((s) => s.status)).toEqual(["invalido", "bloqueado", "bloqueado"]);
    expect(chain[0].result).toEqual({ status: "invalid", reason: "Falta elegir el índice." });
  });

  it("sin ajuste con ventanas: todos calculados al mismo precio", () => {
    const windows = windowsFor("2026-03-01", 3, null);
    const chain = computeRentChain({ initialRent: 500000, windows, rules: rules({ method: "sin_ajuste", indexCode: null }) });
    expect(chain.every((s) => s.status === "calculado" && s.amount === 500000)).toBe(true);
  });

  it("sin ventanas no hay pasos", () => {
    expect(computeRentChain({ initialRent: 500000, windows: [], rules: rules() })).toEqual([]);
  });
});

describe("rentForPeriod", () => {
  // Misma cadena real: ajustes en los períodos 4, 7, 10, 13 (calculados), 16 (pendiente), 19 y 22 (bloqueados).
  const windows = windowsFor("2025-09-01", 3, "monthly", 2);
  const thousand = rules({ rounding: "thousand" });
  const chain = computeRentChain({ initialRent: 500000, windows, rules: thousand, series: monthly(IPC) });

  it("antes del primer ajuste rige el precio inicial", () => {
    for (const p of [1, 2, 3]) {
      expect(rentForPeriod(500000, chain, p)).toEqual({ amount: 500000, fromSequence: null, pendingSequence: null });
    }
  });

  it("desde el período del ajuste rige el precio nuevo, durante todo el ciclo", () => {
    expect(rentForPeriod(500000, chain, 4)).toEqual({ amount: 532000, fromSequence: 1, pendingSequence: null });
    expect(rentForPeriod(500000, chain, 6)).toEqual({ amount: 532000, fromSequence: 1, pendingSequence: null });
    expect(rentForPeriod(500000, chain, 7)).toEqual({ amount: 577000, fromSequence: 2, pendingSequence: null });
    expect(rentForPeriod(500000, chain, 15)).toEqual({ amount: 670000, fromSequence: 4, pendingSequence: null });
  });

  it("con el ajuste pendiente se cobra el último precio conocido y se marca cuál falta (diferencia de ajuste después)", () => {
    expect(rentForPeriod(500000, chain, 16)).toEqual({ amount: 670000, fromSequence: 4, pendingSequence: 5 });
    // Más adelante sigue marcando el PRIMER pendiente (el 5), no el último bloqueado.
    expect(rentForPeriod(500000, chain, 24)).toEqual({ amount: 670000, fromSequence: 4, pendingSequence: 5 });
  });

  it("onlyApplied: sólo cuentan los ajustes confirmados; uno calculado pero no aplicado queda pendiente", () => {
    const applied = new Map([
      [1, 532000],
      [2, 577000],
    ]);
    const c = computeRentChain({ initialRent: 500000, windows, rules: thousand, series: monthly(IPC), applied });
    expect(rentForPeriod(500000, c, 10, { onlyApplied: true })).toEqual({
      amount: 577000,
      fromSequence: 2,
      pendingSequence: 3,
    });
    // Sin onlyApplied el calculado sí rige.
    expect(rentForPeriod(500000, c, 10)).toEqual({ amount: 630000, fromSequence: 3, pendingSequence: null });
    expect(rentForPeriod(500000, c, 3, { onlyApplied: true })).toEqual({
      amount: 500000,
      fromSequence: null,
      pendingSequence: null,
    });
  });

  it("onlyApplied sin nada aplicado: precio inicial y el ajuste 1 pendiente", () => {
    expect(rentForPeriod(500000, chain, 5, { onlyApplied: true })).toEqual({
      amount: 500000,
      fromSequence: null,
      pendingSequence: 1,
    });
  });

  it("un aplicado posterior limpia el pendiente anterior", () => {
    const c = computeRentChain({
      initialRent: 500000,
      windows,
      rules: thousand,
      series: monthly(IPC),
      applied: new Map([[2, 600000]]),
    });
    expect(rentForPeriod(500000, c, 8, { onlyApplied: true })).toEqual({
      amount: 600000,
      fromSequence: 2,
      pendingSequence: null,
    });
  });

  it("sin cadena rige siempre el precio inicial", () => {
    expect(rentForPeriod(450000, [], 12)).toEqual({ amount: 450000, fromSequence: null, pendingSequence: null });
  });
});

describe("computeRentChain — ajustes omitidos (se decidió no aplicarlos)", () => {
  const windows = windowsFor("2025-09-01", 3, "monthly", 2);
  const thousand = rules({ rounding: "thousand" });

  it("un ajuste omitido deja el precio igual y la cadena sigue desde ahí", () => {
    const chain = computeRentChain({
      initialRent: 500000,
      windows,
      rules: thousand,
      series: monthly(IPC),
      skipped: new Set([2]),
    });
    expect(chain[1]).toMatchObject({ status: "omitido", base: 532000, amount: 532000, result: null });
    // El ajuste 3 compara ene-2026 → abr-2026 sobre 532.000 (no recupera lo que no se aplicó).
    expect(chain[2]).toMatchObject({ status: "calculado", base: 532000, amount: 581000, result: { amountBeforeRounding: 580538.38 } });
    expect(chain[3]).toMatchObject({ status: "calculado", base: 581000, amount: 617000 });
  });

  it("omitir el ajuste que espera el índice desbloquea los siguientes", () => {
    const chain = computeRentChain({
      initialRent: 500000,
      windows,
      rules: thousand,
      series: monthly(IPC),
      skipped: new Set([5]),
    });
    expect(chain[4]).toMatchObject({ status: "omitido", amount: 670000 });
    expect(chain[5]).toMatchObject({ status: "pendiente_indice", base: 670000 });
    expect(chain[6].status).toBe("bloqueado");
  });

  it("un omitido detrás de un pendiente queda bloqueado (no hay precio del que partir)", () => {
    const chain = computeRentChain({
      initialRent: 500000,
      windows,
      rules: thousand,
      series: monthly(IPC),
      skipped: new Set([6]),
    });
    expect(chain.map((s) => s.status).slice(4)).toEqual(["pendiente_indice", "bloqueado", "bloqueado"]);
  });

  it("rentForPeriod con onlyApplied cuenta el omitido como decisión tomada", () => {
    const chain = computeRentChain({
      initialRent: 500000,
      windows,
      rules: thousand,
      series: monthly(IPC),
      applied: new Map([[1, 532000]]),
      skipped: new Set([2]),
    });
    expect(rentForPeriod(500000, chain, 8, { onlyApplied: true })).toEqual({
      amount: 532000,
      fromSequence: 2,
      pendingSequence: null,
    });
    expect(rentForPeriod(500000, chain, 10, { onlyApplied: true })).toEqual({
      amount: 532000,
      fromSequence: 2,
      pendingSequence: 3,
    });
  });
});
