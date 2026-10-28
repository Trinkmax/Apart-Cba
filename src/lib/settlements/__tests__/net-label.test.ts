import { describe, expect, it } from "vitest";
import { settlementNetLabel, settlementPaidCaption } from "../labels";

describe("settlementNetLabel", () => {
  it("neto positivo o cero: la administración le paga al propietario", () => {
    expect(settlementNetLabel(120_000)).toBe("Neto por pagar");
    expect(settlementNetLabel(0)).toBe("Neto por pagar");
    expect(settlementNetLabel(120_000, "revisada")).toBe("Neto por pagar");
  });

  it("neto negativo: el propietario cobró directo y debe la diferencia", () => {
    expect(settlementNetLabel(-300_750)).toBe("A cargo del propietario");
  });

  it("pagada: ya no es una deuda", () => {
    expect(settlementNetLabel(53_875, "pagada")).toBe("Neto pagado");
  });

  it("negativa y saldada con «Registrar cobro»", () => {
    expect(settlementNetLabel(-300_750, "pagada")).toBe("Cobrado al propietario");
    expect(settlementNetLabel(-300_750, "revisada")).toBe("A cargo del propietario");
  });
});

describe("settlementPaidCaption", () => {
  it("con fecha de pago", () => {
    expect(settlementPaidCaption("2026-10-27T15:00:00Z", () => "27/10/2026")).toBe(
      "Pagado el 27/10/2026 · saldo",
    );
  });

  it("sin fecha", () => {
    expect(settlementPaidCaption(null, () => "x")).toBe("Pagado · saldo");
  });

  it("cobro al propietario", () => {
    expect(settlementPaidCaption("2026-10-28T15:00:00Z", () => "28/10/2026", true)).toBe(
      "Cobrado el 28/10/2026 · saldo",
    );
  });
});
