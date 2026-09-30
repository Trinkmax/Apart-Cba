import { describe, expect, it } from "vitest";
import {
  computeSena,
  depositRuleLabel,
  isSenaCovered,
  resolveBookingSena,
  restoAlLlegar,
  roundMoney,
  senaDueAt,
  senaRemaining,
} from "@/lib/marketplace/sena";

describe("senaRemaining", () => {
  it("descuenta lo ya cobrado de la seña", () => {
    expect(senaRemaining(93_000, 0)).toBe(93_000);
    expect(senaRemaining(93_000, 30_000)).toBe(63_000);
  });

  it("nunca es negativo, ni con pagos de más", () => {
    expect(senaRemaining(93_000, 93_000)).toBe(0);
    expect(senaRemaining(93_000, 150_000)).toBe(0);
  });

  it("sin seña, o con datos raros, no falta nada que no se pueda explicar", () => {
    expect(senaRemaining(null, 0)).toBe(0);
    expect(senaRemaining(0, 10_000)).toBe(0);
    expect(senaRemaining(50_000, null)).toBe(50_000);
    expect(senaRemaining(50_000, Number.NaN)).toBe(50_000);
    expect(senaRemaining(50_000, -5_000)).toBe(50_000);
  });
});

/**
 * La seña que ve el huésped al pedir, la que propone el modal de aprobación y
 * la que dice el email salen de acá. Si esto se desalinea, el huésped transfiere
 * un monto y el equipo esperaba otro.
 */
describe("computeSena", () => {
  const oneNight = { rule: "one_night" as const, percent: null };

  it("una noche = subtotal ÷ noches, sin la limpieza", () => {
    // 3 noches de 70.000 + 15.000 de limpieza
    expect(computeSena({ policy: oneNight, nights: 3, subtotal: 210_000, total: 225_000 })).toBe(70_000);
  });

  it("con reglas de precio usa el promedio por noche, redondeado a pesos", () => {
    // 2 noches: 70.000 y 85.000 (fin de semana)
    expect(computeSena({ policy: oneNight, nights: 2, subtotal: 155_000, total: 155_000 })).toBe(77_500);
    expect(computeSena({ policy: oneNight, nights: 3, subtotal: 200_000, total: 200_000 })).toBe(66_667);
  });

  it("porcentaje del total", () => {
    expect(
      computeSena({ policy: { rule: "percent", percent: 30 }, nights: 4, subtotal: 280_000, total: 300_000 }),
    ).toBe(90_000);
  });

  it("sin seña → null", () => {
    expect(computeSena({ policy: { rule: "none", percent: null }, nights: 2, subtotal: 1, total: 1 })).toBeNull();
  });

  it("nunca supera el total ni devuelve 0 o negativos", () => {
    expect(
      computeSena({ policy: { rule: "percent", percent: 150 }, nights: 1, subtotal: 50_000, total: 50_000 }),
    ).toBe(50_000);
    expect(computeSena({ policy: oneNight, nights: 0, subtotal: 1, total: 1 })).toBeNull();
    expect(computeSena({ policy: oneNight, nights: 2, subtotal: 0, total: 0 })).toBeNull();
    expect(computeSena({ policy: { rule: "percent", percent: null }, nights: 2, subtotal: 9, total: 9 })).toBeNull();
  });

  it("en USD redondea a centavos", () => {
    expect(
      computeSena({ policy: oneNight, nights: 3, subtotal: 100, total: 100, currency: "USD" }),
    ).toBe(33.33);
  });
});

describe("restoAlLlegar", () => {
  it("total menos seña, nunca negativo", () => {
    expect(restoAlLlegar(225_000, 70_000)).toBe(155_000);
    expect(restoAlLlegar(100, null)).toBe(100);
    expect(restoAlLlegar(100, 150)).toBe(0);
  });
});

describe("senaDueAt", () => {
  it("suma las horas a la confirmación", () => {
    expect(senaDueAt("2026-10-01T12:00:00.000Z", 24)).toBe("2026-10-02T12:00:00.000Z");
    expect(senaDueAt("2026-10-01T12:00:00.000Z", 0)).toBe("2026-10-02T12:00:00.000Z");
  });
});

describe("isSenaCovered", () => {
  it("cubre con lo cobrado, tolerando un peso de redondeo", () => {
    expect(isSenaCovered(70_000, 70_000)).toBe(true);
    expect(isSenaCovered(69_999, 70_000)).toBe(true);
    expect(isSenaCovered(69_000, 70_000)).toBe(false);
    expect(isSenaCovered(0, null)).toBe(true);
    expect(isSenaCovered(null, 0)).toBe(true);
    expect(isSenaCovered(undefined, 5_000)).toBe(false);
  });
});

describe("resolveBookingSena", () => {
  it("manda la del equipo; un 0 explícito es 'sin seña'", () => {
    expect(resolveBookingSena({ depositAmount: 80_000, estimate: 70_000, fallback: 60_000 })).toBe(80_000);
    expect(resolveBookingSena({ depositAmount: 0, estimate: 70_000, fallback: 60_000 })).toBeNull();
  });
  it("sin la del equipo, la estimada; sin estimada, la regla", () => {
    expect(resolveBookingSena({ depositAmount: null, estimate: 70_000, fallback: 60_000 })).toBe(70_000);
    expect(resolveBookingSena({ depositAmount: null, estimate: null, fallback: 60_000 })).toBe(60_000);
    expect(resolveBookingSena({ depositAmount: null, estimate: null, fallback: null })).toBeNull();
  });
  it("PostgREST devuelve numeric como string", () => {
    expect(resolveBookingSena({ depositAmount: "45000" as unknown as number, estimate: null, fallback: null })).toBe(45_000);
  });
});

describe("roundMoney / depositRuleLabel", () => {
  it("ARS a pesos enteros", () => {
    expect(roundMoney(66_666.67)).toBe(66_667);
    expect(roundMoney(Number.NaN)).toBe(0);
  });
  it("etiquetas", () => {
    expect(depositRuleLabel({ rule: "one_night", percent: null })).toBe("1 noche");
    expect(depositRuleLabel({ rule: "percent", percent: 30 })).toBe("30 %");
    expect(depositRuleLabel({ rule: "none", percent: null })).toBeNull();
  });
});
