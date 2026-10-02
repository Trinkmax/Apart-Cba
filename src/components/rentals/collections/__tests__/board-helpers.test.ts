import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";
import {
  buildRunningBalance,
  collectedPct,
  groupRows,
  matchesSearch,
  monthEnd,
  monthParam,
  multiMoney,
  parseBoardMonth,
  relativeMonthLabel,
  rowStateOf,
  shiftBoardMonth,
  totalsByCurrency,
} from "@/components/rentals/collections/board-helpers";

const TODAY = "2026-10-15";

describe("mes del tablero", () => {
  it("lee ?mes=YYYY-MM y cae al mes de hoy con basura", () => {
    expect(parseBoardMonth("2026-11", TODAY)).toBe("2026-11-01");
    expect(parseBoardMonth("2026-13", TODAY)).toBe("2026-10-01");
    expect(parseBoardMonth(undefined, TODAY)).toBe("2026-10-01");
    expect(parseBoardMonth(["2025-02"], TODAY)).toBe("2025-02-01");
  });
  it("navega meses y conoce el último día (bisiesto incluido)", () => {
    expect(shiftBoardMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftBoardMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(monthEnd("2028-02-01")).toBe("2028-02-29");
    expect(monthEnd("2026-04-01")).toBe("2026-04-30");
    expect(monthParam("2026-11-01")).toBe("2026-11");
  });
});

describe("rowStateOf", () => {
  const c = (over: Partial<{ status: string; due_date: string; subtotal: number; paid_amount: number; voided_at: string | null }>) => ({
    status: "pendiente",
    due_date: "2026-10-20",
    subtotal: 100,
    paid_amount: 0,
    voided_at: null,
    ...over,
  });
  it("gana lo vencido aunque tenga un pago parcial", () => {
    expect(rowStateOf([c({ due_date: "2026-10-10", status: "parcial", paid_amount: 50 }), c({})], TODAY)).toBe("vencido");
  });
  it("parcial antes que pendiente; todo pagado es pagado", () => {
    expect(rowStateOf([c({ status: "parcial", paid_amount: 40 }), c({})], TODAY)).toBe("parcial");
    expect(rowStateOf([c({})], TODAY)).toBe("pendiente");
    expect(rowStateOf([c({ status: "pagado", paid_amount: 100 })], TODAY)).toBe("pagado");
  });
  it("lo anulado no cuenta", () => {
    expect(rowStateOf([c({ status: "anulado", voided_at: "2026-10-01", due_date: "2026-10-01" }), c({ status: "pagado", paid_amount: 100 })], TODAY)).toBe("pagado");
  });
});

describe("totalsByCurrency", () => {
  it("parte el saldo en vencido y por vencer, por moneda", () => {
    const t = totalsByCurrency(
      [
        { currency: "ARS", status: "parcial", due_date: "2026-10-10", subtotal: 500000, paid_amount: 200000 },
        { currency: "ARS", status: "pendiente", due_date: "2026-10-20", subtotal: 300000, paid_amount: 0 },
        { currency: "ARS", status: "anulado", due_date: "2026-10-05", subtotal: 999, paid_amount: 0, voided_at: "x" },
        { currency: "USD", status: "pagado", due_date: "2026-10-10", subtotal: 800, paid_amount: 800 },
      ],
      TODAY,
    );
    expect(t[0]).toEqual({ currency: "ARS", expected: 800000, collected: 200000, pending: 300000, overdue: 300000 });
    expect(t[1]).toEqual({ currency: "USD", expected: 800, collected: 800, pending: 0, overdue: 0 });
    expect(collectedPct(t[0])).toBe(25);
    expect(collectedPct({ expected: 0, collected: 0 })).toBe(0);
  });
});

describe("groupRows", () => {
  it("vencidos primero y, adentro, lo más viejo y la deuda más grande arriba", () => {
    const rows = [
      { id: "a", state: "pagado" as const, dueDate: "2026-10-10", outstanding: 0, tenantName: "A" },
      { id: "b", state: "vencido" as const, dueDate: "2026-10-10", outstanding: 100, tenantName: "B" },
      { id: "c", state: "vencido" as const, dueDate: "2026-10-05", outstanding: 50, tenantName: "C" },
      { id: "d", state: "vencido" as const, dueDate: "2026-10-10", outstanding: 300, tenantName: "D" },
      { id: "e", state: "pendiente" as const, dueDate: null, outstanding: 10, tenantName: "E" },
    ];
    const groups = groupRows(rows);
    expect(groups.map((g) => g.key)).toEqual(["vencido", "pendiente", "pagado"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["c", "d", "b"]);
  });
});

describe("matchesSearch", () => {
  it("ignora tildes, mayúsculas y orden de las palabras", () => {
    expect(matchesSearch(["Lucía Gómez", "Dean Funes 450"], "gomez dean")).toBe(true);
    expect(matchesSearch(["Lucía Gómez"], "perez")).toBe(false);
    expect(matchesSearch(["x"], "  ")).toBe(true);
  });
});

describe("buildRunningBalance", () => {
  it("lleva el saldo corrido: cargos suman, pagos restan, lo anulado no mueve", () => {
    const m = buildRunningBalance(
      [
        { id: "c1", date: "2026-09-10", createdAt: "1", subtotal: 500000, voided: false },
        { id: "c2", date: "2026-10-10", createdAt: "2", subtotal: 520000, voided: false },
        { id: "c3", date: "2026-10-10", createdAt: "3", subtotal: 999, voided: true },
      ],
      [
        { id: "p1", date: "2026-09-10", createdAt: "4", amount: 500000, voided: false },
        { id: "p2", date: "2026-10-12", createdAt: "5", amount: 600000, voided: false },
        { id: "p3", date: "2026-10-13", createdAt: "6", amount: 1000, voided: true },
      ],
    );
    expect(m.map((x) => x.id)).toEqual(["c1", "p1", "c2", "c3", "p2", "p3"]);
    expect(m.map((x) => x.balance)).toEqual([500000, 0, 520000, 520000, -80000, -80000]);
  });
});

describe("multiMoney", () => {
  it("nunca suma pesos con dólares: un total por moneda", () => {
    expect(
      multiMoney([
        { amount: 100000, currency: "ARS" },
        { amount: 100, currency: "USD" },
        { amount: 50000, currency: "ARS" },
      ]),
    ).toBe(`${formatMoney(150000, "ARS")} · ${formatMoney(100, "USD")}`);
  });

  it("redondea cada moneda a centavos", () => {
    expect(multiMoney([{ amount: 0.1, currency: "ARS" }, { amount: 0.2, currency: "ARS" }])).toBe(formatMoney(0.3, "ARS"));
  });

  it("una moneda que suma 0 no aparece", () => {
    expect(multiMoney([{ amount: 150000, currency: "ARS" }, { amount: 0, currency: "USD" }])).toBe(formatMoney(150000, "ARS"));
  });

  it("todo en 0 (o lista vacía): $ 0 en la primera moneda o la de respaldo", () => {
    expect(multiMoney([{ amount: 0, currency: "USD" }, { amount: 0, currency: "ARS" }])).toBe(formatMoney(0, "USD"));
    expect(multiMoney([])).toBe(formatMoney(0, "ARS"));
    expect(multiMoney([], "USD")).toBe(formatMoney(0, "USD"));
  });

  it("ignora importes que no son números", () => {
    expect(multiMoney([{ amount: Number.NaN, currency: "ARS" }, { amount: 10, currency: "ARS" }])).toBe(formatMoney(10, "ARS"));
  });
});

describe("relativeMonthLabel", () => {
  const OCT = "2026-10-01";

  it("este mes y los contiguos llevan rótulo relativo", () => {
    expect(relativeMonthLabel(OCT, OCT)).toBe("Este mes");
    expect(relativeMonthLabel("2026-09-01", OCT)).toBe("Mes pasado");
    expect(relativeMonthLabel("2026-11-01", OCT)).toBe("Mes que viene");
  });

  it("un mes no contiguo no es 'el mes pasado' ni 'el que viene'", () => {
    expect(relativeMonthLabel("2026-07-01", OCT)).toBeNull();
    expect(relativeMonthLabel("2027-01-01", OCT)).toBeNull();
    expect(relativeMonthLabel("2025-10-01", OCT)).toBeNull();
  });

  it("cruza el cambio de año", () => {
    expect(relativeMonthLabel("2025-12-01", "2026-01-01")).toBe("Mes pasado");
    expect(relativeMonthLabel("2027-01-01", "2026-12-01")).toBe("Mes que viene");
  });

  it("acepta fechas completas (usa sólo el mes)", () => {
    expect(relativeMonthLabel("2026-09-30", "2026-10-02")).toBe("Mes pasado");
    expect(relativeMonthLabel("2026-10-31", "2026-10-02")).toBe("Este mes");
  });
});
