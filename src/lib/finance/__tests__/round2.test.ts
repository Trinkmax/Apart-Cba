import { describe, expect, it } from "vitest";
import { round2 } from "@/lib/finance/booking-economics";

/**
 * round2 redondea por notación exponencial ("4.725e2") para coincidir con
 * Postgres numeric(14,2). Debajo de 1e-6 String(n) ya viene en exponencial y
 * el truco daba NaN: el residuo de una resta de floats volvía NaN un neto que
 * cuadraba.
 */
describe("round2", () => {
  it("un residuo de float por debajo de 1e-6 es 0, no NaN", () => {
    expect(round2(1e-7)).toBe(0);
    expect(round2(-1e-9)).toBe(0);
    expect(round2(9.99e-7)).toBe(0);
    expect(round2(0.1 + 0.2 - 0.3)).toBe(0);
  });

  it("nunca devuelve -0", () => {
    // toBe usa Object.is: distingue -0 de 0.
    expect(round2(-0)).toBe(0);
    expect(round2(-0.004)).toBe(0);
    expect(round2(-1e-9)).toBe(0);
  });

  it("los casos de siempre no cambian", () => {
    expect(round2(0)).toBe(0);
    expect(round2(1e-6)).toBe(0);
    expect(round2(0.004)).toBe(0);
    expect(round2(0.005)).toBe(0.01);
    expect(round2(-0.005)).toBe(-0.01);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(4.725)).toBe(4.73);
    expect(round2(-4.725)).toBe(-4.73);
    expect(round2(27 * 0.175)).toBe(4.73);
    expect(round2(150000)).toBe(150000);
    expect(round2(1499.8999999999999)).toBe(1499.9);
  });

  it("lo no finito es 0", () => {
    expect(round2(Number.NaN)).toBe(0);
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
