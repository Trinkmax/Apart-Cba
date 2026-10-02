import { describe, expect, it } from "vitest";
import { computeLateFee, lateFeeAlreadyBilled, waivedAmountOf, type LateFeeRules } from "@/lib/rentals/late-fees";

const DUE = "2026-10-10";
const daily05: LateFeeRules = { type: "diario_pct", value: 0.5, graceDays: 0 };

describe("computeLateFee — diario %", () => {
  it("vence el 10, paga el 15 al 0,5 % diario sobre $500.000 → 5 días = $12.500", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-15",
      baseAmount: 500000,
      payments: [{ date: "2026-10-15", amount: 500000 }],
      rules: daily05,
    });
    expect(r).toEqual({
      daysLate: 5,
      amount: 12500,
      segments: [{ from: "2026-10-10", to: "2026-10-15", days: 5, base: 500000, amount: 12500 }],
      withinGrace: false,
    });
  });

  it("una vez pagado, el punitorio no sigue corriendo aunque el corte sea posterior", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-31",
      baseAmount: 500000,
      payments: [{ date: "2026-10-15", amount: 500000 }],
      rules: daily05,
    });
    expect(r).toMatchObject({ daysLate: 5, amount: 12500 });
  });

  it("impago al corte: devenga lo que pagaría si pagara ese día (corte el 15 → 5 días)", () => {
    const r = computeLateFee({ dueDate: DUE, asOf: "2026-10-15", baseAmount: 500000, rules: daily05 });
    expect(r).toMatchObject({ daysLate: 5, amount: 12500, withinGrace: false });
    expect(r.segments).toEqual([{ from: "2026-10-10", to: "2026-10-15", days: 5, base: 500000, amount: 12500 }]);
  });

  it("la mora es automática: pagar el día siguiente al vencimiento ya cuenta 1 día", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-11",
      baseAmount: 500000,
      payments: [{ date: "2026-10-11", amount: 500000 }],
      rules: daily05,
    });
    expect(r).toMatchObject({ daysLate: 1, amount: 2500 });
  });

  it("pagar el día del vencimiento o antes no genera punitorio", () => {
    for (const date of ["2026-10-10", "2026-10-05"]) {
      const r = computeLateFee({
        dueDate: DUE,
        asOf: "2026-10-20",
        baseAmount: 500000,
        payments: [{ date, amount: 500000 }],
        rules: daily05,
      });
      expect(r).toEqual({ daysLate: 0, amount: 0, segments: [], withinGrace: false });
    }
  });

  it("cruza fin de mes: vence el 10/10, corte el 10/11 → 31 días", () => {
    const r = computeLateFee({ dueDate: DUE, asOf: "2026-11-10", baseAmount: 500000, rules: daily05 });
    expect(r).toMatchObject({ daysLate: 31, amount: 77500 });
  });
});

describe("computeLateFee — días de gracia", () => {
  const grace3: LateFeeRules = { ...daily05, graceDays: 3 }; // la gracia termina el 13

  it("pagando dentro de la gracia no hay punitorio", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-20",
      baseAmount: 500000,
      payments: [{ date: "2026-10-13", amount: 500000 }],
      rules: grace3,
    });
    expect(r).toEqual({ daysLate: 0, amount: 0, segments: [], withinGrace: false });
  });

  it("con el corte dentro de la gracia todavía no corresponde punitorio (withinGrace)", () => {
    for (const asOf of ["2026-10-11", "2026-10-13"]) {
      const r = computeLateFee({ dueDate: DUE, asOf, baseAmount: 500000, rules: grace3 });
      expect(r).toEqual({ daysLate: 0, amount: 0, segments: [], withinGrace: true });
    }
  });

  it("pagando después de la gracia se cuenta desde el vencimiento, no desde el fin de la gracia", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-14",
      baseAmount: 500000,
      payments: [{ date: "2026-10-14", amount: 500000 }],
      rules: grace3,
    });
    expect(r).toMatchObject({ daysLate: 4, amount: 10000, withinGrace: false });
    expect(r.segments[0].from).toBe("2026-10-10");
  });

  it("countFrom 'fin_gracia': el contrato dice que corre desde el fin de la gracia", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-15",
      baseAmount: 500000,
      payments: [{ date: "2026-10-15", amount: 500000 }],
      rules: { ...grace3, countFrom: "fin_gracia" },
    });
    expect(r).toMatchObject({ daysLate: 2, amount: 5000 });
    expect(r.segments).toEqual([{ from: "2026-10-13", to: "2026-10-15", days: 2, base: 500000, amount: 5000 }]);
  });

  it("gracia negativa o fraccionaria se normaliza (−2 → 0; 3,9 → 3)", () => {
    const neg = computeLateFee({ dueDate: DUE, asOf: "2026-10-11", baseAmount: 500000, rules: { ...daily05, graceDays: -2 } });
    expect(neg).toMatchObject({ daysLate: 1, withinGrace: false });
    const frac = computeLateFee({ dueDate: DUE, asOf: "2026-10-13", baseAmount: 500000, rules: { ...daily05, graceDays: 3.9 } });
    expect(frac.withinGrace).toBe(true);
    const after = computeLateFee({ dueDate: DUE, asOf: "2026-10-14", baseAmount: 500000, rules: { ...daily05, graceDays: 3.9 } });
    expect(after).toMatchObject({ withinGrace: false, daysLate: 4 });
  });
});

describe("computeLateFee — pagos parciales", () => {
  it("un pago parcial baja la base desde el día en que entra (tramos)", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-25",
      baseAmount: 500000,
      payments: [
        { date: "2026-10-15", amount: 200000 },
        { date: "2026-10-20", amount: 300000 },
      ],
      rules: daily05,
    });
    expect(r.segments).toEqual([
      { from: "2026-10-10", to: "2026-10-15", days: 5, base: 500000, amount: 12500 },
      { from: "2026-10-15", to: "2026-10-20", days: 5, base: 300000, amount: 7500 },
    ]);
    expect(r).toMatchObject({ amount: 20000, daysLate: 10 });
  });

  it("parcial y saldo impago al corte: el último tramo llega hasta el corte", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-20",
      baseAmount: 500000,
      payments: [{ date: "2026-10-15", amount: 200000 }],
      rules: daily05,
    });
    expect(r.segments.map((s) => [s.from, s.to, s.base, s.amount])).toEqual([
      ["2026-10-10", "2026-10-15", 500000, 12500],
      ["2026-10-15", "2026-10-20", 300000, 7500],
    ]);
    expect(r).toMatchObject({ amount: 20000, daysLate: 10 });
  });

  it("ordena los pagos por fecha aunque lleguen desordenados", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-25",
      baseAmount: 500000,
      payments: [
        { date: "2026-10-20", amount: 300000 },
        { date: "2026-10-15", amount: 200000 },
      ],
      rules: daily05,
    });
    expect(r).toMatchObject({ amount: 20000, daysLate: 10 });
  });

  it("un pago posterior al corte no cuenta: al corte la deuda sigue entera", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-20",
      baseAmount: 500000,
      payments: [{ date: "2026-10-25", amount: 500000 }],
      rules: daily05,
    });
    expect(r).toMatchObject({ amount: 25000, daysLate: 10 });
    expect(r.segments).toHaveLength(1);
  });

  it("un parcial dentro de la gracia no evita la mora del saldo: corre desde el vencimiento sobre lo que se debía cada día", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-20",
      baseAmount: 500000,
      payments: [
        { date: "2026-10-12", amount: 200000 },
        { date: "2026-10-20", amount: 300000 },
      ],
      rules: { ...daily05, graceDays: 3 },
    });
    expect(r.segments.map((s) => [s.from, s.to, s.days, s.base, s.amount])).toEqual([
      ["2026-10-10", "2026-10-12", 2, 500000, 5000],
      ["2026-10-12", "2026-10-20", 8, 300000, 12000],
    ]);
    expect(r).toMatchObject({ amount: 17000, daysLate: 10 });
  });

  it("con 'fin_gracia', lo pagado dentro de la gracia baja la base antes de empezar a contar", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-20",
      baseAmount: 500000,
      payments: [
        { date: "2026-10-12", amount: 200000 },
        { date: "2026-10-20", amount: 300000 },
      ],
      rules: { ...daily05, graceDays: 3, countFrom: "fin_gracia" },
    });
    expect(r.segments).toEqual([{ from: "2026-10-13", to: "2026-10-20", days: 7, base: 300000, amount: 10500 }]);
    expect(r).toMatchObject({ amount: 10500, daysLate: 7 });
  });

  it("los pagos de importe 0 o negativo se ignoran", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-15",
      baseAmount: 500000,
      payments: [
        { date: "2026-10-12", amount: 0 },
        { date: "2026-10-13", amount: -100 },
      ],
      rules: daily05,
    });
    expect(r).toMatchObject({ amount: 12500, daysLate: 5 });
    expect(r.segments).toHaveLength(1);
  });

  it("pagar de más dentro de la gracia también cancela", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-20",
      baseAmount: 500000,
      payments: [{ date: "2026-10-10", amount: 600000 }],
      rules: daily05,
    });
    expect(r.amount).toBe(0);
  });
});

describe("computeLateFee — otros tipos de interés", () => {
  it("mensual %: el 3 % mensual se prorratea /30 (0,1 % diario) → 5 días = $2.500", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-15",
      baseAmount: 500000,
      rules: { type: "mensual_pct", value: 3, graceDays: 0 },
    });
    expect(r).toMatchObject({ amount: 2500, daysLate: 5 });
  });

  it("fijo diario: un monto por día de atraso, sin importar el saldo", () => {
    const rules: LateFeeRules = { type: "fijo_diario", value: 1000, graceDays: 0 };
    expect(computeLateFee({ dueDate: DUE, asOf: "2026-10-15", baseAmount: 500000, rules })).toMatchObject({
      amount: 5000,
      daysLate: 5,
    });
    const partial = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-25",
      baseAmount: 500000,
      payments: [
        { date: "2026-10-15", amount: 200000 },
        { date: "2026-10-20", amount: 300000 },
      ],
      rules,
    });
    expect(partial.segments.map((s) => s.amount)).toEqual([5000, 5000]);
    expect(partial).toMatchObject({ amount: 10000, daysLate: 10 });
  });

  it("'ninguno', valor 0/negativo o base 0: no hay punitorio aunque esté vencido", () => {
    const empty = { daysLate: 0, amount: 0, segments: [], withinGrace: false };
    const late = { dueDate: DUE, asOf: "2026-11-30", baseAmount: 500000 };
    expect(computeLateFee({ ...late, rules: { type: "ninguno", value: 0.5, graceDays: 0 } })).toEqual(empty);
    expect(computeLateFee({ ...late, rules: { ...daily05, value: 0 } })).toEqual(empty);
    expect(computeLateFee({ ...late, rules: { ...daily05, value: -1 } })).toEqual(empty);
    expect(computeLateFee({ ...late, baseAmount: 0, rules: daily05 })).toEqual(empty);
  });
});

describe("computeLateFee — bordes", () => {
  it("dos pagos el mismo día cierran la deuda en un solo tramo", () => {
    const r = computeLateFee({
      dueDate: DUE,
      asOf: "2026-10-25",
      baseAmount: 500000,
      payments: [
        { date: "2026-10-15", amount: 200000 },
        { date: "2026-10-15", amount: 300000 },
      ],
      rules: daily05,
    });
    expect(r.segments).toEqual([{ from: "2026-10-10", to: "2026-10-15", days: 5, base: 500000, amount: 12500 }]);
    expect(r).toMatchObject({ amount: 12500, daysLate: 5 });
  });

  it("el total se redondea a centavos (half up)", () => {
    // 333.333,33 × 0,5 % × 3 = 4.999,99995 → 5.000,00
    const r = computeLateFee({ dueDate: DUE, asOf: "2026-10-13", baseAmount: 333333.33, rules: daily05 });
    expect(r.amount).toBe(5000);
  });
});

describe("punitorio ya facturado (bonificado o condonado)", () => {
  // Cargo de septiembre: $100.000, vence el 10/09, 0,1 % diario sin gracia.
  const SEP = "2026-09-10";
  const daily01: LateFeeRules = { type: "diario_pct", value: 0.1, graceDays: 0 };

  it("condonado el 10/10 al cobrar la mitad: el 20/10 se cobran sólo los $500 nuevos, no los $3.500", () => {
    // 10/10: paga $50.000 y se condonan los intereses → marca en $0 por lo que correspondía.
    const first = computeLateFee({ dueDate: SEP, asOf: "2026-10-10", baseAmount: 100000, rules: daily01 });
    expect(first).toMatchObject({ amount: 3000, daysLate: 30 });
    const marker = { amount: 0, originalAmount: null, meta: { waived: true, waived_amount: first.amount, days_late: 30 } };

    // 20/10: paga los otros $50.000. Acumulado: 30 días × 100.000 + 10 días × 50.000 = $3.500.
    const second = computeLateFee({
      dueDate: SEP,
      asOf: "2026-10-20",
      baseAmount: 100000,
      payments: [{ date: "2026-10-10", amount: 50000 }],
      rules: daily01,
    });
    expect(second.amount).toBe(3500);
    expect(lateFeeAlreadyBilled([marker])).toBe(3000);
    expect(second.amount - lateFeeAlreadyBilled([marker])).toBe(500);
  });

  it("sin la marca, lo condonado volvía en el cobro siguiente (la regresión)", () => {
    const second = computeLateFee({
      dueDate: SEP,
      asOf: "2026-10-20",
      baseAmount: 100000,
      payments: [{ date: "2026-10-10", amount: 50000 }],
      rules: daily01,
    });
    expect(second.amount - lateFeeAlreadyBilled([])).toBe(3500);
  });

  it("un punitorio bonificado cuenta por lo que se cargó antes del descuento", () => {
    expect(lateFeeAlreadyBilled([{ amount: 400, originalAmount: 1000 }])).toBe(1000);
    expect(lateFeeAlreadyBilled([{ amount: 0, originalAmount: 1000 }])).toBe(1000);
  });

  it("suma punitorios cobrados, bonificados y marcas de varias condonaciones", () => {
    expect(
      lateFeeAlreadyBilled([
        { amount: 1250.5 },
        { amount: 300, originalAmount: 500 },
        { amount: 0, meta: { waived: true, waived_amount: 3000 } },
        { amount: 0, meta: { waived: true, waived_amount: 500 } },
      ]),
    ).toBe(5250.5);
  });

  it("waivedAmountOf ignora metas sin marca o con datos raros", () => {
    expect(waivedAmountOf(undefined)).toBe(0);
    expect(waivedAmountOf(null)).toBe(0);
    expect(waivedAmountOf({ days_late: 5, base: 100000 })).toBe(0);
    expect(waivedAmountOf({ waived_amount: "abc" })).toBe(0);
    expect(waivedAmountOf({ waived_amount: -10 })).toBe(0);
    expect(waivedAmountOf({ waived_amount: "1500.25" })).toBe(1500.25);
    expect(waivedAmountOf({ waived_amount: 3000 })).toBe(3000);
  });
});
