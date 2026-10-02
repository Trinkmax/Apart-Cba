import { describe, expect, it } from "vitest";
import {
  FEE_BASE_KINDS,
  buildOwnerStatementLines,
  totalsOf,
  type CollectedEntry,
  type ContractFeeRule,
  type OwnerExpense,
  type OwnerOneTimeCharge,
  type StatementLineDraft,
} from "@/lib/rentals/owner-statement";

const P1 = "Dean Funes 450 · 3°B";
const OCT = "Octubre 2026 · Período 2/3";

function entry(over: Partial<CollectedEntry> & Pick<CollectedEntry, "allocationId" | "kind" | "amount">): CollectedEntry {
  return {
    contractId: "c1",
    propertyId: "p1",
    propertyLabel: P1,
    payee: "propietario",
    paidAt: "2026-10-05",
    periodLabel: OCT,
    ...over,
  };
}

/** Lo que pagó el inquilino de octubre: alquiler + punitorio + expensas (al consorcio) + honorarios (a la inmobiliaria). */
const COLLECTED: CollectedEntry[] = [
  entry({ allocationId: "a1", kind: "alquiler", amount: 500000 }),
  entry({ allocationId: "a2", kind: "punitorio", amount: 12500, paidAt: "2026-10-06" }),
  entry({ allocationId: "a3", kind: "expensas", amount: 80000, payee: "consorcio" }),
  entry({ allocationId: "a4", kind: "honorarios", amount: 20000, payee: "inmobiliaria" }),
];
const FEE_10_IVA: ContractFeeRule[] = [{ contractId: "c1", adminFeePct: 10, adminFeeVat: true }];
const EXPENSES: OwnerExpense[] = [
  { id: "x1", propertyId: "p1", date: "2026-10-12", description: "Cambio de canilla", amount: 30000 },
];
const ONE_TIME: OwnerOneTimeCharge[] = [
  { id: "ot1", contractId: "c1", propertyId: "p1", description: "Comisión por la locación", amount: 290400 },
];

describe("buildOwnerStatementLines — un dueño al 100 %", () => {
  it("rinde lo cobrado del propietario y descuenta 10 % de honorarios + IVA", () => {
    const { lines, totals } = buildOwnerStatementLines({
      collected: COLLECTED,
      shares: [{ propertyId: "p1", pct: 100 }],
      feeRules: FEE_10_IVA,
    });
    expect(lines).toEqual<StatementLineDraft[]>([
      {
        lineType: "cobro_alquiler",
        sign: 1,
        amount: 500000,
        description: `Alquiler ${OCT} — ${P1}`,
        contractId: "c1",
        propertyId: "p1",
        refType: "allocation",
        refId: "a1",
        sharePct: 100,
      },
      {
        lineType: "cobro_punitorio",
        sign: 1,
        amount: 12500,
        description: `Intereses por mora ${OCT} — ${P1}`,
        contractId: "c1",
        propertyId: "p1",
        refType: "allocation",
        refId: "a2",
        sharePct: 100,
      },
      {
        lineType: "honorarios_administracion",
        sign: -1,
        amount: 50000,
        description: `Honorarios de administración 10 % — ${P1}`,
        contractId: "c1",
        propertyId: "p1",
        refType: null,
        refId: null,
        sharePct: 100,
      },
      {
        lineType: "iva_honorarios",
        sign: -1,
        amount: 10500,
        description: `IVA 21 % sobre honorarios — ${P1}`,
        contractId: "c1",
        propertyId: "p1",
        refType: null,
        refId: null,
        sharePct: 100,
      },
    ]);
    expect(totals).toEqual({ collected: 512500, fees: 50000, vat: 10500, expenses: 0, other: 0, net: 452000 });
  });

  it("sólo llegan al propietario los ítems cuyo dueño es el propietario (expensas → consorcio, honorarios → inmobiliaria)", () => {
    const { lines } = buildOwnerStatementLines({
      collected: COLLECTED,
      shares: [{ propertyId: "p1", pct: 100 }],
      feeRules: FEE_10_IVA,
    });
    const refs = lines.filter((l) => l.refType === "allocation").map((l) => l.refId);
    expect(refs).toEqual(["a1", "a2"]);
  });

  it("el punitorio cobrado es ingreso del propietario pero NO paga honorarios de administración", () => {
    expect(FEE_BASE_KINDS.has("punitorio")).toBe(false);
    expect([...FEE_BASE_KINDS].sort()).toEqual(["alquiler", "diferencia_ajuste"]);
    const { totals } = buildOwnerStatementLines({
      collected: [entry({ allocationId: "p", kind: "punitorio", amount: 12500 })],
      shares: [{ propertyId: "p1", pct: 100 }],
      feeRules: FEE_10_IVA,
    });
    expect(totals).toEqual({ collected: 12500, fees: 0, vat: 0, expenses: 0, other: 0, net: 12500 });
  });

  it("gastos a cargo del propietario y la comisión única por la locación se descuentan", () => {
    const { lines, totals } = buildOwnerStatementLines({
      collected: COLLECTED,
      shares: [{ propertyId: "p1", pct: 100 }],
      feeRules: FEE_10_IVA,
      expenses: EXPENSES,
      oneTime: ONE_TIME,
    });
    expect(lines.slice(4)).toEqual<StatementLineDraft[]>([
      {
        lineType: "comision_locacion",
        sign: -1,
        amount: 290400,
        description: "Comisión por la locación",
        contractId: "c1",
        propertyId: "p1",
        refType: "contract_commission",
        refId: "ot1",
        sharePct: 100,
      },
      {
        lineType: "gasto",
        sign: -1,
        amount: 30000,
        description: "Cambio de canilla",
        contractId: null,
        propertyId: "p1",
        refType: "expense",
        refId: "x1",
        sharePct: 100,
      },
    ]);
    // 512.500 − 50.000 − 10.500 − 30.000 − 290.400
    expect(totals).toEqual({ collected: 512500, fees: 50000, vat: 10500, expenses: 30000, other: -290400, net: 131600 });
  });
});

describe("buildOwnerStatementLines — condominio 60/40", () => {
  const build = (pct: number) =>
    buildOwnerStatementLines({
      collected: COLLECTED,
      shares: [{ propertyId: "p1", pct }],
      feeRules: FEE_10_IVA,
      expenses: EXPENSES,
      oneTime: ONE_TIME,
    });

  it("cada dueño recibe su % de lo cobrado y paga su % de honorarios, IVA, gastos y comisión", () => {
    const a = build(60);
    const b = build(40);
    expect(a.lines.map((l) => [l.lineType, l.amount, l.sharePct])).toEqual([
      ["cobro_alquiler", 300000, 60],
      ["cobro_punitorio", 7500, 60],
      ["honorarios_administracion", 30000, 60],
      ["iva_honorarios", 6300, 60],
      ["comision_locacion", 174240, 60],
      ["gasto", 18000, 60],
    ]);
    expect(b.lines.map((l) => [l.lineType, l.amount, l.sharePct])).toEqual([
      ["cobro_alquiler", 200000, 40],
      ["cobro_punitorio", 5000, 40],
      ["honorarios_administracion", 20000, 40],
      ["iva_honorarios", 4200, 40],
      ["comision_locacion", 116160, 40],
      ["gasto", 12000, 40],
    ]);
    expect(a.totals).toEqual({ collected: 307500, fees: 30000, vat: 6300, expenses: 18000, other: -174240, net: 78960 });
    expect(b.totals).toEqual({ collected: 205000, fees: 20000, vat: 4200, expenses: 12000, other: -116160, net: 52640 });
  });

  it("las dos rendiciones suman lo mismo que si hubiera un único dueño", () => {
    const single = build(100).totals;
    const a = build(60).totals;
    const b = build(40).totals;
    for (const k of ["collected", "fees", "vat", "expenses", "other", "net"] as const) {
      expect(a[k] + b[k]).toBeCloseTo(single[k], 6);
    }
  });
});

describe("buildOwnerStatementLines — filtros y conceptos", () => {
  it("ignora propiedades que no son del dueño (o con 0 %) y cobros en 0", () => {
    const { lines } = buildOwnerStatementLines({
      collected: [
        entry({ allocationId: "otra", kind: "alquiler", amount: 400000, propertyId: "p9" }),
        entry({ allocationId: "cero", kind: "alquiler", amount: 0 }),
        entry({ allocationId: "p2", kind: "alquiler", amount: 400000, propertyId: "p2" }),
      ],
      shares: [
        { propertyId: "p1", pct: 100 },
        { propertyId: "p2", pct: 0 },
      ],
      feeRules: FEE_10_IVA,
      expenses: [{ id: "x9", propertyId: "p9", date: "2026-10-01", description: "Ajeno", amount: 1000 }],
    });
    expect(lines).toEqual([]);
  });

  it("la diferencia por ajuste es alquiler: paga honorarios; rescisión y reparación son 'otros cobros' sin honorarios", () => {
    const { lines, totals } = buildOwnerStatementLines({
      collected: [
        entry({ allocationId: "d", kind: "diferencia_ajuste", amount: 40000 }),
        entry({ allocationId: "r", kind: "rescision", amount: 100000, paidAt: "2026-10-07" }),
        entry({ allocationId: "rep", kind: "reparacion", amount: 15000, paidAt: "2026-10-08" }),
        entry({ allocationId: "o", kind: "otro", amount: 5000, paidAt: "2026-10-09" }),
      ],
      shares: [{ propertyId: "p1", pct: 100 }],
      feeRules: [{ contractId: "c1", adminFeePct: 10, adminFeeVat: false }],
    });
    expect(lines.map((l) => [l.lineType, l.description])).toEqual([
      ["cobro_alquiler", `Diferencia por ajuste ${OCT} — ${P1}`],
      ["cobro_otro", `Indemnización por rescisión ${OCT} — ${P1}`],
      ["cobro_otro", `Reintegro de reparación ${OCT} — ${P1}`],
      ["cobro_otro", `Cobro ${OCT} — ${P1}`],
      ["honorarios_administracion", `Honorarios de administración 10 % — ${P1}`],
    ]);
    expect(totals).toMatchObject({ collected: 160000, fees: 4000, vat: 0, net: 156000 });
  });

  it("sin regla de honorarios, con 0 % o sin IVA: no hay líneas de honorarios / IVA", () => {
    const one = [entry({ allocationId: "a1", kind: "alquiler", amount: 500000 })];
    const shares = [{ propertyId: "p1", pct: 100 }];
    const types = (feeRules: ContractFeeRule[]) =>
      buildOwnerStatementLines({ collected: one, shares, feeRules }).lines.map((l) => l.lineType);
    expect(types([])).toEqual(["cobro_alquiler"]);
    expect(types([{ contractId: "c1", adminFeePct: 0, adminFeeVat: true }])).toEqual(["cobro_alquiler"]);
    expect(types([{ contractId: "c1", adminFeePct: 6, adminFeeVat: false }])).toEqual([
      "cobro_alquiler",
      "honorarios_administracion",
    ]);
  });

  it("un porcentaje con decimales se muestra en formato argentino (6,5 %)", () => {
    const { lines } = buildOwnerStatementLines({
      collected: [entry({ allocationId: "a1", kind: "alquiler", amount: 500000 })],
      shares: [{ propertyId: "p1", pct: 100 }],
      feeRules: [{ contractId: "c1", adminFeePct: 6.5, adminFeeVat: false }],
    });
    expect(lines[1]).toMatchObject({ amount: 32500, description: `Honorarios de administración 6,5 % — ${P1}` });
  });
});

describe("buildOwnerStatementLines — dueño con varias propiedades", () => {
  const P2 = "Ituzaingó 1000 · PB";

  it("ordena por propiedad y fecha de cobro, y calcula honorarios por contrato con su propia regla", () => {
    const { lines, totals } = buildOwnerStatementLines({
      collected: [
        entry({ allocationId: "b1", kind: "alquiler", amount: 400000, contractId: "c2", propertyId: "p2", propertyLabel: P2 }),
        entry({ allocationId: "a2", kind: "alquiler", amount: 100000, paidAt: "2026-10-20" }),
        entry({ allocationId: "a1", kind: "alquiler", amount: 400000, paidAt: "2026-10-03" }),
      ],
      shares: [
        { propertyId: "p1", pct: 100 },
        { propertyId: "p2", pct: 50 },
      ],
      feeRules: [
        { contractId: "c1", adminFeePct: 10, adminFeeVat: true },
        { contractId: "c2", adminFeePct: 8, adminFeeVat: false },
      ],
    });
    expect(lines.map((l) => [l.lineType, l.refId ?? l.contractId, l.amount, l.sharePct])).toEqual([
      ["cobro_alquiler", "a1", 400000, 100],
      ["cobro_alquiler", "a2", 100000, 100],
      ["cobro_alquiler", "b1", 200000, 50],
      ["honorarios_administracion", "c1", 50000, 100], // 10 % de 500.000 (los dos cobros del contrato)
      ["iva_honorarios", "c1", 10500, 100],
      ["honorarios_administracion", "c2", 16000, 50], // 8 % de su mitad (200.000)
    ]);
    expect(lines[5].description).toBe(`Honorarios de administración 8 % — ${P2}`);
    expect(totals).toEqual({ collected: 700000, fees: 66000, vat: 10500, expenses: 0, other: 0, net: 623500 });
  });
});

describe("totalsOf", () => {
  it("cobros con signo; honorarios, IVA y gastos en positivo; el resto (comisión, ajustes) con signo", () => {
    const t = totalsOf([
      { lineType: "cobro_alquiler", sign: 1, amount: 100 },
      { lineType: "cobro_punitorio", sign: 1, amount: 10 },
      { lineType: "cobro_otro", sign: 1, amount: 5 },
      { lineType: "honorarios_administracion", sign: -1, amount: 10 },
      { lineType: "iva_honorarios", sign: -1, amount: 2.1 },
      { lineType: "gasto", sign: -1, amount: 30 },
      { lineType: "comision_locacion", sign: -1, amount: 20 },
      { lineType: "ajuste", sign: 1, amount: 7 },
      { lineType: "ajuste", sign: -1, amount: 3 },
    ]);
    expect(t).toEqual({ collected: 115, fees: 10, vat: 2.1, expenses: 30, other: -16, net: 56.9 });
    // neto = cobrado − honorarios − IVA − gastos + otros
    expect(t.net).toBeCloseTo(t.collected - t.fees - t.vat - t.expenses + t.other, 6);
  });

  it("redondea a centavos sin residuos de punto flotante", () => {
    const t = totalsOf([
      { lineType: "cobro_alquiler", sign: 1, amount: 0.1 },
      { lineType: "cobro_alquiler", sign: 1, amount: 0.2 },
    ]);
    expect(t.collected).toBe(0.3);
    expect(t.net).toBe(0.3);
  });

  it("sin líneas todo vale 0", () => {
    expect(totalsOf([])).toEqual({ collected: 0, fees: 0, vat: 0, expenses: 0, other: 0, net: 0 });
  });
});
