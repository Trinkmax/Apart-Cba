import { describe, expect, it } from "vitest";
import { effectiveSena } from "../booking-confirmation";

describe("effectiveSena", () => {
  it("la seña explícita manda sobre lo cobrado y sobre 1 noche", () => {
    expect(effectiveSena(30000, 50000, 20000)).toBe(30000);
  });

  it("sin seña cargada (null) cae a lo cobrado y después a 1 noche", () => {
    expect(effectiveSena(null, 50000, 20000)).toBe(50000);
    expect(effectiveSena(undefined, 0, 20000)).toBe(20000);
    expect(effectiveSena(null, null, 20000)).toBe(20000);
    expect(effectiveSena(null, null)).toBeNull();
    expect(effectiveSena(null, 0, 0)).toBeNull();
  });

  it("0 explícito es 'Sin seña': null, sin caer a lo cobrado ni a 1 noche", () => {
    expect(effectiveSena(0, 50000, 20000)).toBeNull();
    expect(effectiveSena(0, null, 20000)).toBeNull();
    expect(effectiveSena(0, 0)).toBeNull();
  });
});
