import { describe, expect, it } from "vitest";
import {
  commissionSummary,
  formatCommissionPct,
  ownerCommissionWarning,
  parseOwnerCommission,
  unitCommissionLabel,
} from "@/lib/finance/commission-summary";

describe("commissionSummary", () => {
  it("con comisión por canal dice lo que rige de verdad (Habitana, AI)", () => {
    expect(
      commissionSummary({ bySource: { booking: 20, directo: 27.5 }, unitPct: 0, orgPct: 20 }),
    ).toBe("Directo 27,5% · Booking 20% · otros canales 0%");
  });

  it("sin comisión por canal es la de la unidad", () => {
    expect(commissionSummary({ bySource: {}, unitPct: 18, orgPct: 20 })).toBe("18%");
    expect(commissionSummary({ bySource: null, unitPct: 12.5 })).toBe("12,5%");
  });

  it("sin nada cae a la de la organización y después a 20", () => {
    expect(commissionSummary({ unitPct: null, orgPct: 15 })).toBe("15%");
    expect(commissionSummary({})).toBe("20%");
  });

  it("un 0 explícito se respeta: no es 'sin configurar'", () => {
    expect(commissionSummary({ bySource: { directo: 0 }, unitPct: 10 })).toBe(
      "Directo 0% · otros canales 10%",
    );
    expect(commissionSummary({ unitPct: 0, orgPct: 20 })).toBe("0%");
  });
});

describe("unitCommissionLabel", () => {
  const summary = "Directo 27,5% · otros canales 0%";

  it("sin acuerdos, la normal", () => {
    expect(unitCommissionLabel({ owners: [{ name: "Nadia", override: null }], summary })).toBe(summary);
    expect(unitCommissionLabel({ owners: [], summary })).toBe(summary);
  });

  it("el acuerdo manda y se dice con quién: el caso que no se veía", () => {
    expect(unitCommissionLabel({ owners: [{ name: "Nadia Badiali ", override: 100 }], summary })).toBe(
      "100% (acordada con Nadia Badiali)",
    );
  });

  it("un acuerdo en 0 también es un acuerdo", () => {
    expect(unitCommissionLabel({ owners: [{ name: "Nadia", override: 0 }], summary })).toBe(
      "0% (acordada con Nadia)",
    );
  });

  it("con co-propietarios muestra a los dos", () => {
    expect(
      unitCommissionLabel({
        owners: [
          { name: "Ana", override: 10 },
          { name: "Beto", override: null },
        ],
        summary: "20%",
      }),
    ).toBe("10% (acordada con Ana) · los demás: 20%");
  });
});

describe("parseOwnerCommission", () => {
  it("vacío es sin acuerdo", () => {
    expect(parseOwnerCommission("")).toEqual({ ok: true, value: null });
    expect(parseOwnerCommission("   ")).toEqual({ ok: true, value: null });
  });

  it("acepta coma y punto", () => {
    expect(parseOwnerCommission("27,5")).toEqual({ ok: true, value: 27.5 });
    expect(parseOwnerCommission("27.5")).toEqual({ ok: true, value: 27.5 });
    expect(parseOwnerCommission("0")).toEqual({ ok: true, value: 0 });
  });

  it("rechaza lo que no es un porcentaje", () => {
    expect(parseOwnerCommission("abc").ok).toBe(false);
    expect(parseOwnerCommission("-1").ok).toBe(false);
    expect(parseOwnerCommission("101").ok).toBe(false);
  });
});

describe("ownerCommissionWarning", () => {
  it("no molesta con un acuerdo normal", () => {
    expect(ownerCommissionWarning(null)).toBeNull();
    expect(ownerCommissionWarning(0)).toBeNull();
    expect(ownerCommissionWarning(27.5)).toBeNull();
    expect(ownerCommissionWarning(49.99)).toBeNull();
  });

  it("con 100 dice que el dueño no cobra y dónde va el % de propiedad", () => {
    const warning = ownerCommissionWarning(100);
    expect(warning).toContain("no cobra nada");
    expect(warning).toContain("% de propiedad");
  });

  it("con un valor alto dice cuánto le queda", () => {
    expect(ownerCommissionWarning(50)).toContain("sólo el 50%");
    expect(ownerCommissionWarning(72.5)).toContain("sólo el 27,5%");
  });
});

describe("formatCommissionPct", () => {
  it("usa coma y no arrastra ceros de la base", () => {
    expect(formatCommissionPct(27.5)).toBe("27,5%");
    expect(formatCommissionPct(100)).toBe("100%");
    expect(formatCommissionPct(Number("10.00"))).toBe("10%");
  });
});
