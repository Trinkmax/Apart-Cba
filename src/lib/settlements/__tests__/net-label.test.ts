import { describe, expect, it } from "vitest";
import { settlementNetLabel } from "../labels";

describe("settlementNetLabel", () => {
  it("neto positivo o cero: la administración le paga al propietario", () => {
    expect(settlementNetLabel(120_000)).toBe("Neto por pagar");
    expect(settlementNetLabel(0)).toBe("Neto por pagar");
  });

  it("neto negativo: el propietario cobró directo y debe la diferencia", () => {
    expect(settlementNetLabel(-300_750)).toBe("A cargo del propietario");
  });
});
