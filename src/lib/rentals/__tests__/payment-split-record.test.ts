import { describe, expect, it } from "vitest";
import { splitDirectPayment, type SplitOwner } from "../payment-split";
import {
  agencyFeePart,
  agencyMovementLabel,
  directPaymentGuide,
  isPaymentRoute,
  ledgerSplitFromSnapshot,
  passThroughMovementLabel,
  paymentRouteText,
  receiptSplitRows,
  splitLinesFromAllocations,
  splitSnapshot,
  type SplitItemRef,
  type SplitOwnerBank,
} from "../payment-split-record";

const items = new Map<string, SplitItemRef>([
  ["alq", { kind: "alquiler", payee: "propietario" }],
  ["exp", { kind: "expensas", payee: "consorcio" }],
  ["hon", { kind: "honorarios", payee: "inmobiliaria" }],
]);

const owners: SplitOwnerBank[] = [
  { ownerId: "o1", name: "Ulises Rojas", pct: 60, isPrimary: true, bankName: "Galicia", cbu: " 0070000000000000000001 ", alias: "ulises.rojas" },
  { ownerId: "o2", name: "Marta Paz", pct: 40, isPrimary: false, bankName: null, cbu: "", alias: null },
];

describe("splitLinesFromAllocations", () => {
  it("toma tipo y destinatario de cada ítem; los punitorios nuevos son de quien diga el contrato", () => {
    const lines = splitLinesFromAllocations(
      [
        { itemId: null, newItemIndex: 0, amount: 1_500 },
        { itemId: "alq", newItemIndex: null, amount: 100_000 },
        { itemId: "exp", newItemIndex: null, amount: 20_000.004 },
        { itemId: "hon", newItemIndex: null, amount: 0 },
      ],
      items,
      "inmobiliaria",
    );
    expect(lines).toEqual([
      { kind: "punitorio", payee: "inmobiliaria", amount: 1_500 },
      { kind: "alquiler", payee: "propietario", amount: 100_000 },
      { kind: "expensas", payee: "consorcio", amount: 20_000 },
    ]);
  });

  it("el depósito va a la parte del propietario aunque su renglón sea de 'tercero' (lo guarda la inmobiliaria)", () => {
    // Gastos de ingreso de un contrato que cobra el propietario: depósito (renglón de
    // 'tercero' porque el contrato dice que lo guarda la inmobiliaria) + honorarios de
    // locación + el primer alquiler. El módulo del depósito da por hecho que lo tiene
    // el propietario: si fuera a la inmobiliaria quedaría en Caja y su cierre no lo devolvería.
    const withDeposit = new Map<string, SplitItemRef>([...items, ["dep", { kind: "deposito", payee: "tercero" }]]);
    const lines = splitLinesFromAllocations(
      [
        { itemId: "dep", newItemIndex: null, amount: 500_000 },
        { itemId: "hon", newItemIndex: null, amount: 300_000 },
        { itemId: "alq", newItemIndex: null, amount: 1_000_000 },
      ],
      withDeposit,
      "propietario",
    );
    expect(lines[0]).toEqual({ kind: "deposito", payee: "propietario", amount: 500_000 });
    const s = splitDirectPayment({ total: 1_800_000, lines, rule: { adminFeePct: 8, adminFeeVat: false }, owners: owners as SplitOwner[] });
    // Honorarios sólo sobre el alquiler (el depósito no es base); nada de "pagos a terceros".
    expect(s.agency).toEqual({ total: 380_000, feeBase: 1_000_000, feePct: 8, fee: 80_000, vat: 0, own: 300_000, passThrough: 0 });
    expect(s.owner.total).toBe(1_420_000);
  });

  it("un ítem que no aparece queda del propietario y sin honorarios", () => {
    const lines = splitLinesFromAllocations([{ itemId: "x", newItemIndex: null, amount: 500 }], items, "propietario");
    expect(lines).toEqual([{ kind: "otro", payee: "propietario", amount: 500 }]);
    const s = splitDirectPayment({ total: 500, lines, rule: { adminFeePct: 8, adminFeeVat: false }, owners: owners as SplitOwner[] });
    expect(s.agency.total).toBe(0);
    expect(s.owner.total).toBe(500);
  });
});

describe("splitSnapshot", () => {
  const split = splitDirectPayment({
    total: 130_000,
    lines: [
      { kind: "alquiler", payee: "propietario", amount: 100_000 },
      { kind: "expensas", payee: "consorcio", amount: 20_000 },
    ],
    rule: { adminFeePct: 8, adminFeeVat: true },
    owners,
  });

  it("guarda el reparto con los datos bancarios de cada titular (limpios)", () => {
    const snap = splitSnapshot(split, owners);
    expect(snap.v).toBe(1);
    expect(snap.route).toBe("cada_uno");
    expect(snap.total).toBe(130_000);
    expect(snap.agency).toEqual({
      total: 29_680,
      fee_base: 100_000,
      fee_pct: 8,
      fee: 8_000,
      vat: 1_680,
      own: 0,
      pass_through: 20_000,
      label: "honorarios 8 % + IVA y pagos a terceros (consorcio, servicios)",
    });
    expect(snap.owner.total).toBe(100_320);
    expect(snap.owner.shares).toEqual([
      { owner_id: "o1", name: "Ulises Rojas", pct: 60, amount: 60_192, bank_name: "Galicia", cbu: "0070000000000000000001", alias: "ulises.rojas" },
      { owner_id: "o2", name: "Marta Paz", pct: 40, amount: 40_128, bank_name: null, cbu: null, alias: null },
    ]);
    expect(snap.remainder).toBe(10_000);
    // Lo que guarda la base tiene que cerrar: propietario + inmobiliaria = lo cobrado.
    expect(snap.owner.total + snap.agency.total).toBe(snap.total);
  });

  it("guarda cómo le llegó la plata a cada uno", () => {
    expect(splitSnapshot(split, owners, "todo_inmobiliaria").route).toBe("todo_inmobiliaria");
    expect(isPaymentRoute("todo_propietario")).toBe(true);
    expect(isPaymentRoute("otro")).toBe(false);
  });

  it("sin parte de la inmobiliaria no guarda la etiqueta \"nada\"", () => {
    const all = splitDirectPayment({ total: 1_000, lines: [{ kind: "alquiler", payee: "propietario", amount: 1_000 }], rule: { adminFeePct: 0, adminFeeVat: false }, owners });
    expect(splitSnapshot(all, owners).agency.label).toBe("");
  });
});

describe("agencyMovementLabel", () => {
  it("texto corto del ingreso en Caja", () => {
    const only = splitDirectPayment({ total: 100_000, lines: [{ kind: "alquiler", payee: "propietario", amount: 100_000 }], rule: { adminFeePct: 8, adminFeeVat: false }, owners });
    expect(agencyMovementLabel(only)).toBe("Honorarios 8 %");
    const none = splitDirectPayment({ total: 100, lines: [], rule: { adminFeePct: 8, adminFeeVat: false }, owners });
    expect(agencyMovementLabel(none)).toBe("Honorarios de administración");
  });

  it("sólo nombra lo que es plata de la inmobiliaria: lo del consorcio entra aparte", () => {
    const lines = [
      { kind: "alquiler", payee: "propietario", amount: 100_000 },
      { kind: "expensas", payee: "consorcio", amount: 20_000 },
      { kind: "honorarios", payee: "inmobiliaria", amount: 5_000 },
    ] as const;
    const s = splitDirectPayment({ total: 125_000, lines, rule: { adminFeePct: 8, adminFeeVat: true }, owners });
    expect(agencyMovementLabel(s)).toBe("Honorarios 8 % + IVA y conceptos de la inmobiliaria");
    // 8.000 + 1.680 de IVA + 5.000 propios; los 20.000 del consorcio no son honorarios.
    expect(s.agency.total).toBe(34_680);
    expect(agencyFeePart(s)).toBe(14_680);
  });
});

describe("passThroughMovementLabel", () => {
  it("dice para quién es la plata que la inmobiliaria recibe para pagarle a otro", () => {
    expect(passThroughMovementLabel([{ kind: "expensas", payee: "consorcio", amount: 20_000 }])).toBe("Expensas para el consorcio");
    expect(passThroughMovementLabel([{ kind: "otro", payee: "consorcio", amount: 1_000 }])).toBe("Para pagarle al consorcio");
    expect(passThroughMovementLabel([{ kind: "sellado", payee: "tercero", amount: 3_000 }])).toBe("Para pagarle a terceros");
    expect(
      passThroughMovementLabel([
        { kind: "expensas", payee: "consorcio", amount: 20_000 },
        { kind: "sellado", payee: "tercero", amount: 3_000 },
        { kind: "alquiler", payee: "propietario", amount: 100_000 },
      ]),
    ).toBe("Para pagarle al consorcio y a terceros");
  });
});

describe("ledgerSplitFromSnapshot", () => {
  it("de la foto guardada a lo que muestra la cuenta corriente", () => {
    const split = splitDirectPayment({ total: 100_000, lines: [{ kind: "alquiler", payee: "propietario", amount: 100_000 }], rule: { adminFeePct: 8, adminFeeVat: false }, owners });
    // Pasa por JSON como sale de la base (jsonb).
    const stored: unknown = JSON.parse(JSON.stringify(splitSnapshot(split, owners)));
    expect(ledgerSplitFromSnapshot(stored, "Banco Galicia")).toEqual({
      ownerTotal: 92_000,
      agencyTotal: 8_000,
      agencyAccountName: "Banco Galicia",
      agencyLabel: "honorarios 8 %",
      owners: [
        { name: "Ulises Rojas", amount: 55_200 },
        { name: "Marta Paz", amount: 36_800 },
      ],
      route: "cada_uno",
    });
    const viaAgency: unknown = JSON.parse(JSON.stringify(splitSnapshot(split, owners, "todo_inmobiliaria")));
    expect(ledgerSplitFromSnapshot(viaAgency, null)?.route).toBe("todo_inmobiliaria");
  });

  it("null si no hay foto o la versión no es conocida; tolera datos incompletos", () => {
    expect(ledgerSplitFromSnapshot(null, null)).toBeNull();
    expect(ledgerSplitFromSnapshot([], null)).toBeNull();
    expect(ledgerSplitFromSnapshot({ v: 2, total: 1 }, null)).toBeNull();
    expect(ledgerSplitFromSnapshot({ v: 1, owner: { total: "500.5", shares: [{ name: "", amount: "500.5" }] }, agency: { total: 0, label: "" } }, null)).toEqual({
      ownerTotal: 500.5,
      agencyTotal: 0,
      agencyAccountName: null,
      agencyLabel: "sin honorarios",
      owners: [{ name: "Propietario", amount: 500.5 }],
      route: "cada_uno",
    });
    expect(ledgerSplitFromSnapshot({ v: 1, route: "raro", owner: { total: 1, shares: [] }, agency: { total: 0 } }, null)?.route).toBe("cada_uno");
  });
});

describe("cómo le llegó la plata a cada uno (recibo y historial)", () => {
  const base = {
    ownerTotal: 92_000,
    agencyTotal: 8_000,
    agencyAccountName: "Banco Galicia",
    agencyLabel: "honorarios 8 %",
    owners: [{ name: "Ulises Rojas", amount: 92_000 }],
  };

  it("a cada uno su parte: una fila por titular y la de la inmobiliaria", () => {
    expect(receiptSplitRows(base, "Apart CBA")).toEqual([
      { label: "Al propietario · Ulises Rojas", amount: 92_000 },
      { label: "A Apart CBA · honorarios 8 % · Banco Galicia", amount: 8_000 },
    ]);
    expect(receiptSplitRows({ ...base, route: "cada_uno" }, "Apart CBA")).toHaveLength(2);
  });

  it("todo a uno: una sola fila por el total, a quien le pagó", () => {
    expect(receiptSplitRows({ ...base, route: "todo_propietario" }, "Apart CBA")).toEqual([{ label: "Todo al propietario · Ulises Rojas", amount: 100_000 }]);
    expect(receiptSplitRows({ ...base, route: "todo_inmobiliaria" }, "Apart CBA")).toEqual([{ label: "Todo a Apart CBA · Banco Galicia", amount: 100_000 }]);
    const two = { ...base, owners: [{ name: "Ulises Rojas", amount: 55_200 }, { name: "Marta Paz", amount: 36_800 }], route: "todo_propietario" as const };
    expect(receiptSplitRows(two, "")).toEqual([{ label: "Todo a los propietarios", amount: 100_000 }]);
  });

  it("texto para el historial", () => {
    expect(paymentRouteText("cada_uno", "Apart CBA")).toBe("");
    expect(paymentRouteText(undefined, "Apart CBA")).toBe("");
    expect(paymentRouteText("todo_propietario", "Apart CBA")).toBe("el inquilino le pagó todo al propietario");
    expect(paymentRouteText("todo_inmobiliaria", " ")).toBe("el inquilino le pagó todo a la inmobiliaria");
  });
});

describe("directPaymentGuide (aviso de pago cuando cobra el propietario)", () => {
  it("cuánto le transfiere a cada uno si paga todo lo que debe, con los datos bancarios", () => {
    const g = directPaymentGuide({
      items: [
        { itemId: "alq", kind: "alquiler", payee: "propietario", outstanding: 600_000 },
        { itemId: "exp", kind: "expensas", payee: "consorcio", outstanding: 80_000 },
        { itemId: "dep", kind: "deposito", payee: "tercero", outstanding: 100_000 },
        { itemId: "ok", kind: "alquiler", payee: "propietario", outstanding: 0 },
      ],
      rule: { adminFeePct: 8, adminFeeVat: false },
      owners,
    });
    // Inmobiliaria: 48.000 de honorarios + 80.000 de expensas. El depósito va con el propietario.
    expect(g?.agency).toEqual({ total: 128_000, label: "honorarios 8 % y pagos a terceros (consorcio, servicios)" });
    expect(g?.owner.total).toBe(652_000);
    expect(g?.owner.shares).toEqual([
      { name: "Ulises Rojas", pct: 60, amount: 391_200, bankName: "Galicia", cbu: "0070000000000000000001", alias: "ulises.rojas" },
      { name: "Marta Paz", pct: 40, amount: 260_800, bankName: null, cbu: null, alias: null },
    ]);
    expect(g?.total).toBe(780_000);
  });

  it("null si no debe nada", () => {
    expect(directPaymentGuide({ items: [], rule: { adminFeePct: 8, adminFeeVat: false }, owners })).toBeNull();
  });
});
