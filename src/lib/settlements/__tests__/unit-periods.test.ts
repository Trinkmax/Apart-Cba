import { describe, it, expect } from "vitest";
import {
  describeSettlementPeriod,
  formatPeriodCycleShort,
  formatSettlementPeriodFull,
  hasUnitPeriods,
  parseUnitPeriods,
  PER_UNIT_PERIOD_LABEL,
  summarizeUnitPeriods,
} from "../labels";
import {
  buildStatementModel,
  statementInputFromRecord,
  type StatementInput,
  type StatementLineInput,
} from "../statement-model";

/**
 * Período del ciclo por departamento (migración 074). Un propietario con
 * varios deptos tiene cada contrato en un punto distinto del ciclo: el
 * documento tiene que decir cuál es el de cada uno.
 */

const DF1 = "0b6f2d7e-3c1a-4f5e-9a8b-1c2d3e4f5a61";
const DF2 = "0b6f2d7e-3c1a-4f5e-9a8b-1c2d3e4f5a62";
const PH = "0b6f2d7e-3c1a-4f5e-9a8b-1c2d3e4f5a63";

describe("parseUnitPeriods", () => {
  it("lee las entradas válidas", () => {
    expect(
      parseUnitPeriods({
        [DF1]: { index: 2, cycle: 3 },
        [DF2]: { index: 4, cycle: null },
      }),
    ).toEqual({
      [DF1]: { index: 2, cycle: 3 },
      [DF2]: { index: 4, cycle: null },
    });
  });

  it("un ciclo ausente es 'sin ciclo', no un error", () => {
    expect(parseUnitPeriods({ [DF1]: { index: 2 } })).toEqual({
      [DF1]: { index: 2, cycle: null },
    });
  });

  it("normaliza la clave a minúsculas (así la comparan las líneas)", () => {
    expect(parseUnitPeriods({ [DF1.toUpperCase()]: { index: 1, cycle: 3 } })).toEqual({
      [DF1]: { index: 1, cycle: 3 },
    });
  });

  it("descarta lo que no cumple el contrato de la 074 sin romper el resto", () => {
    expect(
      parseUnitPeriods({
        [DF1]: { index: 4, cycle: 3 }, // no existe "4/3"
        [DF2]: { index: "2", cycle: 3 }, // texto
        "DF-1": { index: 1, cycle: 3 }, // la clave no es un id
        [PH]: { index: 1, cycle: 3 },
      }),
    ).toEqual({ [PH]: { index: 1, cycle: 3 } });
    expect(parseUnitPeriods({ [DF1]: { index: 0 } })).toEqual({});
    expect(parseUnitPeriods({ [DF1]: { index: 2.5 } })).toEqual({});
    expect(parseUnitPeriods({ [DF1]: { index: 1, cycle: 37 } })).toEqual({});
    expect(parseUnitPeriods({ [DF1]: 2 })).toEqual({});
  });

  it("cualquier cosa que no sea un objeto es 'sin períodos'", () => {
    expect(parseUnitPeriods(null)).toEqual({});
    expect(parseUnitPeriods(undefined)).toEqual({});
    expect(parseUnitPeriods([])).toEqual({});
    expect(parseUnitPeriods("x")).toEqual({});
    expect(hasUnitPeriods({})).toBe(false);
    expect(hasUnitPeriods({ [DF1]: { index: 1, cycle: 3 } })).toBe(true);
  });
});

describe("etiquetas por departamento", () => {
  it("formato corto para ir después del código", () => {
    expect(formatPeriodCycleShort(2, 3)).toBe("2/3");
    expect(formatPeriodCycleShort(2, null)).toBe("período 2");
    expect(formatPeriodCycleShort(null, 3)).toBeNull();
  });

  it("el resumen sin códigos dice uno solo si todos coinciden", () => {
    expect(
      summarizeUnitPeriods({
        [DF1]: { index: 2, cycle: 3 },
        [DF2]: { index: 2, cycle: 3 },
      }),
    ).toBe("Período 2/3");
    expect(
      summarizeUnitPeriods({
        [DF1]: { index: 3, cycle: 3 },
        [DF2]: { index: 1, cycle: 3 },
        [PH]: { index: 1, cycle: 3 },
      }),
    ).toBe("Por depto · 1/3 · 3/3");
    expect(summarizeUnitPeriods({})).toBeNull();
  });

  it("con códigos nombra cada depto, ordenado como se lee", () => {
    const codes = new Map([
      [DF1, "DF-1"],
      [DF2, "DF-10"],
      [PH, "DF-2"],
    ]);
    expect(
      describeSettlementPeriod(
        {
          unit_periods: {
            [DF2]: { index: 3, cycle: 3 },
            [DF1]: { index: 1, cycle: 3 },
            [PH]: { index: 2, cycle: 6 },
          },
        },
        codes,
      ),
    ).toBe("DF-1 1/3 · DF-2 2/6 · DF-10 3/3");
  });

  it("el período uniforme (046) se sigue leyendo igual", () => {
    expect(describeSettlementPeriod({ period_index: 1, period_cycle: 3 })).toBe(
      "Período 1/3",
    );
    expect(
      formatSettlementPeriodFull({
        period_year: 2026,
        period_month: 10,
        period_index: 1,
        period_cycle: 3,
      }),
    ).toBe("Octubre 2026 · Período 1/3");
    expect(
      formatSettlementPeriodFull({ period_year: 2026, period_month: 10 }),
    ).toBe("Octubre 2026");
  });

  it("sin los códigos (unidad borrada) cae al resumen sin nombres", () => {
    expect(
      describeSettlementPeriod({
        unit_periods: {
          [DF1]: { index: 1, cycle: 3 },
          [DF2]: { index: 3, cycle: 3 },
        },
      }),
    ).toBe("Por depto · 1/3 · 3/3");
    expect(
      formatSettlementPeriodFull(
        {
          period_year: 2026,
          period_month: 10,
          unit_periods: {
            [DF1]: { index: 2, cycle: 3 },
            [DF2]: { index: 3, cycle: 3 },
          },
        },
        new Map([
          [DF1, "LIMA"],
          [DF2, "24DESEP"],
        ]),
      ),
    ).toBe("Octubre 2026 · 24DESEP 3/3 · LIMA 2/3");
  });
});

// ── Documento ───────────────────────────────────────────────────────────────

function bookingLines(
  unitId: string,
  code: string,
  refId: string,
  gross: number,
): StatementLineInput[] {
  const unit = { id: unitId, code, name: `Depto ${code}` };
  return [
    {
      id: `${refId}-rev`,
      line_type: "monthly_rent_fraction",
      ref_type: "booking",
      ref_id: refId,
      unit_id: unitId,
      description: "Renta",
      amount: gross,
      sign: "+",
      unit,
    },
    {
      id: `${refId}-com`,
      line_type: "commission",
      ref_type: "booking",
      ref_id: refId,
      unit_id: unitId,
      description: "Comisión",
      amount: gross * 0.1,
      sign: "-",
      unit,
    },
  ];
}

function docInput(over: Partial<StatementInput> = {}): StatementInput {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    period_year: 2026,
    period_month: 10,
    status: "borrador",
    currency: "ARS",
    gross_revenue: 0,
    commission_amount: 0,
    deductions_amount: 0,
    net_payable: 0,
    owner: { full_name: "Nancy Antonia Anton" },
    lines: [
      ...bookingLines(DF1, "DF-1", "b1", 500_000),
      ...bookingLines(DF2, "DF-2", "b2", 600_000),
      ...bookingLines(PH, "DF-PH", "b3", 700_000),
    ],
    ...over,
  };
}

describe("buildStatementModel · período por departamento", () => {
  it("cada bloque lleva su período y el encabezado avisa que van por depto", () => {
    const m = buildStatementModel(
      docInput({
        unit_periods: {
          [DF1]: { index: 2, cycle: 3 },
          [DF2]: { index: 3, cycle: 3 },
          [PH]: { index: 1, cycle: 6 },
        },
      }),
    );
    expect(m.periodMode).toBe("per_unit");
    expect(m.units.map((u) => [u.code, u.period?.label])).toEqual([
      ["DF-1", "Período 2/3"],
      ["DF-2", "Período 3/3"],
      ["DF-PH", "Período 1/6"],
    ]);
    expect(m.unitPeriods.map((p) => `${p.code} ${p.short}`)).toEqual([
      "DF-1 2/3",
      "DF-2 3/3",
      "DF-PH 1/6",
    ]);
    // Distintos: el documento no tiene UN período — el detalle va por bloque.
    expect(m.periodCycleLabel).toBeNull();
    expect(m.periodBadgeLabel).toBe(PER_UNIT_PERIOD_LABEL);
    expect(m.periodFullLabel).toBe("Octubre 2026");
    expect(m.periodIndex).toBeNull();
  });

  it("un depto que no aplica queda sin período (y el resto sigue)", () => {
    const m = buildStatementModel(
      docInput({
        unit_periods: {
          [DF1]: { index: 1, cycle: 3 },
          [PH]: { index: 1, cycle: 3 },
        },
      }),
    );
    expect(m.units.find((u) => u.code === "DF-2")?.period).toBeNull();
    expect(m.unitPeriods.map((p) => p.code)).toEqual(["DF-1", "DF-PH"]);
    // Coinciden, pero DF-2 no aplica: decir "Período 1/3" para todo mentiría.
    expect(m.periodCycleLabel).toBeNull();
    expect(m.periodBadgeLabel).toBe(PER_UNIT_PERIOD_LABEL);
  });

  it("todos los deptos en el mismo período se leen como uno solo", () => {
    const m = buildStatementModel(
      docInput({
        unit_periods: {
          [DF1]: { index: 2, cycle: 3 },
          [DF2]: { index: 2, cycle: 3 },
          [PH]: { index: 2, cycle: 3 },
        },
      }),
    );
    expect(m.periodCycleLabel).toBe("Período 2/3");
    expect(m.periodBadgeLabel).toBe("Período 2/3");
    expect(m.periodFullLabel).toBe("Octubre 2026 · Período 2/3");
  });

  it("respeta el orden de unidades del documento", () => {
    const m = buildStatementModel(
      docInput({
        unit_order: [PH, DF1, DF2],
        unit_periods: {
          [DF1]: { index: 2, cycle: 3 },
          [DF2]: { index: 3, cycle: 3 },
          [PH]: { index: 1, cycle: 3 },
        },
      }),
    );
    expect(m.unitPeriods.map((p) => p.code)).toEqual(["DF-PH", "DF-1", "DF-2"]);
  });

  it("una entrada de una unidad que ya no está en el documento no se muestra", () => {
    const otra = "0b6f2d7e-3c1a-4f5e-9a8b-1c2d3e4f5a69";
    const m = buildStatementModel(
      docInput({ unit_periods: { [otra]: { index: 1, cycle: 3 } } }),
    );
    expect(m.periodMode).toBe("per_unit");
    expect(m.unitPeriods).toEqual([]);
    expect(m.periodBadgeLabel).toBeNull();
    expect(m.periodFullLabel).toBe("Octubre 2026");
  });

  it("el modo uniforme no pinta períodos en los bloques (documentos de siempre)", () => {
    const m = buildStatementModel(docInput({ period_index: 1, period_cycle: 3 }));
    expect(m.periodMode).toBe("uniform");
    expect(m.units.every((u) => u.period === null)).toBe(true);
    expect(m.unitPeriods).toEqual([]);
    expect(m.periodBadgeLabel).toBe("Período 1/3");
  });

  it("si llegaran los dos modos, gana el uniforme (la base no los admite juntos)", () => {
    const m = buildStatementModel(
      docInput({
        period_index: 1,
        period_cycle: 3,
        unit_periods: { [DF1]: { index: 3, cycle: 3 } },
      }),
    );
    expect(m.periodMode).toBe("uniform");
    expect(m.units.every((u) => u.period === null)).toBe(true);
  });

  it("sin período no cambia nada", () => {
    const m = buildStatementModel(docInput());
    expect(m.periodMode).toBe("none");
    expect(m.periodBadgeLabel).toBeNull();
    expect(m.unitPeriods).toEqual([]);
  });
});

describe("statementInputFromRecord", () => {
  it("trae el orden de unidades, los TC y el período por depto (el mail los perdía)", () => {
    const input = statementInputFromRecord({
      id: "11111111-2222-3333-4444-555555555555",
      period_year: 2026,
      period_month: 10,
      period_index: null,
      period_cycle: null,
      period_note: null,
      unit_periods: { [DF1.toUpperCase()]: { index: 2, cycle: 3 }, basura: 1 },
      status: "enviada",
      currency: "ARS",
      gross_revenue: "1000",
      commission_amount: "100",
      deductions_amount: 0,
      net_payable: "900",
      unit_order: [DF2, 7, DF1],
      exchange_rates: { USD: "1300", EUR: 0, X: "abc" },
      owner: { full_name: "Nancy" },
      lines: [
        {
          id: "l1",
          line_type: "booking_revenue",
          ref_type: "booking",
          ref_id: "b1",
          unit_id: DF1,
          description: "Reserva",
          amount: "1000",
          sign: "+",
          currency: "USD",
          is_manual: false,
          meta: null,
          display_order: 0,
          unit: { id: DF1, code: "DF-1", name: "Dean Funes 1" },
        },
      ],
    });
    expect(input.unit_periods).toEqual({ [DF1]: { index: 2, cycle: 3 } });
    expect(input.unit_order).toEqual([DF2, DF1]);
    expect(input.exchange_rates).toEqual({ USD: 1300 });
    expect(input.net_payable).toBe(900);
    expect(input.lines[0].amount).toBe(1000);
    expect(input.owner).toEqual({
      full_name: "Nancy",
      bank_name: null,
      cbu: null,
      alias_cbu: null,
    });
    // Con el TC, la línea en USD suma al neto en vez de quedar en cero.
    expect(buildStatementModel(input).totals.gross).toBe(1_300_000);
  });
});

describe("documentos exportables · período por departamento", () => {
  const branding = {
    name: "Apart Cba",
    legal_name: null,
    tax_id: null,
    logo_url: null,
    primary_color: "#0F766E",
  };
  const porDepto = {
    [DF1]: { index: 2, cycle: 3 },
    [DF2]: { index: 3, cycle: 3 },
    [PH]: { index: 1, cycle: 6 },
  };

  it("el Excel lista el período de cada depto arriba y en cada bloque", async () => {
    const { buildSettlementWorkbook } = await import("@/lib/excel/settlement-xlsx");
    const wb = buildSettlementWorkbook(
      buildStatementModel(docInput({ unit_periods: porDepto })),
      branding,
    );
    const ws = wb.getWorksheet("Liquidación")!;
    expect(String(ws.getCell(2, 1).value)).toBe(
      "LIQUIDACIÓN A PROPIETARIO · Octubre 2026",
    );
    expect(String(ws.getCell(4, 1).value)).toBe(
      "Período del ciclo de ajuste:   DF-1 2/3   ·   DF-2 3/3   ·   DF-PH 1/6",
    );
    // La fila extra corre el panel congelado (3 de encabezado + esta + spacer).
    expect(ws.views[0]).toMatchObject({ ySplit: 5 });
    const blockTitles: string[] = [];
    ws.eachRow((row) => {
      const v = String(row.getCell(1).value ?? "");
      if (v.startsWith("▌")) blockTitles.push(v);
    });
    expect(blockTitles).toEqual([
      "▌  DF-1 — Depto DF-1   ·   Período 2/3",
      "▌  DF-2 — Depto DF-2   ·   Período 3/3",
      "▌  DF-PH — Depto DF-PH   ·   Período 1/6",
    ]);
  });

  it("con aclaración, el Excel suma las dos filas al encabezado", async () => {
    const { buildSettlementWorkbook } = await import("@/lib/excel/settlement-xlsx");
    const wb = buildSettlementWorkbook(
      buildStatementModel(
        docInput({ unit_periods: porDepto, period_note: "incluye expensas" }),
      ),
      branding,
    );
    const ws = wb.getWorksheet("Liquidación")!;
    expect(String(ws.getCell(5, 1).value)).toBe("incluye expensas");
    expect(ws.views[0]).toMatchObject({ ySplit: 6 });
  });

  it("todos en el mismo período: el Excel queda como un uniforme", async () => {
    const { buildSettlementWorkbook } = await import("@/lib/excel/settlement-xlsx");
    const wb = buildSettlementWorkbook(
      buildStatementModel(
        docInput({
          unit_periods: {
            [DF1]: { index: 2, cycle: 3 },
            [DF2]: { index: 2, cycle: 3 },
            [PH]: { index: 2, cycle: 3 },
          },
        }),
      ),
      branding,
    );
    const ws = wb.getWorksheet("Liquidación")!;
    expect(String(ws.getCell(2, 1).value)).toContain("Período 2/3");
    expect(ws.views[0]).toMatchObject({ ySplit: 4 });
  });

  it("el PDF imprime el período de cada depto (también con nombres largos)", async () => {
    const { buildSettlementDoc } = await import("@/lib/pdf/settlement-pdf");
    const largo = "DEAN FUNES PH TRADICIONAL CON UN NOMBRE MUY LARGO ".repeat(3);
    const input = docInput({ unit_periods: porDepto });
    input.lines = input.lines.map((l) =>
      l.unit_id === PH && l.unit ? { ...l, unit: { ...l.unit, name: largo } } : l,
    );
    const doc = await buildSettlementDoc(buildStatementModel(input), branding);
    const out = doc.output();
    expect(out).toContain("DF-1: Per");
    expect(out).toContain("DF-PH: Per");
    // La barra del bloque largo se corta antes de pisar el período.
    expect(out).toContain("...");
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
