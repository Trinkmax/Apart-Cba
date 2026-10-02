import { describe, expect, it } from "vitest";
import {
  IMPUTATION_PRIORITY,
  allocatePayment,
  chargeStatusOf,
  sortForImputation,
  type ChargeItemKind,
  type OpenItem,
} from "@/lib/rentals/allocation";

/** Septiembre debe alquiler + expensas + punitorio; octubre, alquiler + expensas. */
const SEPT: OpenItem[] = [
  { itemId: "sep-exp", chargeId: "sep", dueDate: "2026-09-10", kind: "expensas", outstanding: 80000 },
  { itemId: "sep-alq", chargeId: "sep", dueDate: "2026-09-10", kind: "alquiler", outstanding: 500000 },
  { itemId: "sep-pun", chargeId: "sep", dueDate: "2026-09-10", kind: "punitorio", outstanding: 12500 },
];
const OCT: OpenItem[] = [
  { itemId: "oct-exp", chargeId: "oct", dueDate: "2026-10-10", kind: "expensas", outstanding: 85000 },
  { itemId: "oct-alq", chargeId: "oct", dueDate: "2026-10-10", kind: "alquiler", outstanding: 500000 },
];
const ALL = [...OCT, ...SEPT]; // desordenado a propósito

describe("IMPUTATION_PRIORITY", () => {
  it("dentro de un cargo: punitorios → alquiler → diferencia de ajuste → expensas → … → depósito → otro", () => {
    const order = (Object.keys(IMPUTATION_PRIORITY) as ChargeItemKind[]).sort(
      (a, b) => IMPUTATION_PRIORITY[a] - IMPUTATION_PRIORITY[b],
    );
    expect(order).toEqual([
      "punitorio",
      "alquiler",
      "diferencia_ajuste",
      "expensas",
      "servicio",
      "reparacion",
      "rescision",
      "honorarios",
      "sellado",
      "deposito",
      "otro",
    ]);
  });
});

describe("sortForImputation", () => {
  it("primero el cargo de vencimiento más viejo (art. 902) y, dentro, intereses antes que capital (art. 903)", () => {
    expect(sortForImputation(ALL).map((i) => i.itemId)).toEqual(["sep-pun", "sep-alq", "sep-exp", "oct-alq", "oct-exp"]);
  });

  it("el inquilino puede elegir qué cargo paga (art. 900): los preferidos van primero, en el orden pedido", () => {
    expect(sortForImputation(ALL, ["oct"]).map((i) => i.itemId)).toEqual([
      "oct-alq",
      "oct-exp",
      "sep-pun",
      "sep-alq",
      "sep-exp",
    ]);
    const nov: OpenItem = { itemId: "nov-alq", chargeId: "nov", dueDate: "2026-11-10", kind: "alquiler", outstanding: 1 };
    expect(sortForImputation([...ALL, nov], ["nov", "oct"]).map((i) => i.chargeId)).toEqual([
      "nov",
      "oct",
      "oct",
      "sep",
      "sep",
      "sep",
    ]);
  });

  it("un id preferido que no existe no altera el orden por defecto", () => {
    expect(sortForImputation(ALL, ["no-existe"]).map((i) => i.itemId)).toEqual(
      sortForImputation(ALL).map((i) => i.itemId),
    );
  });

  it("dos cargos con el mismo vencimiento no se mezclan; dentro del mismo tipo desempata sortOrder", () => {
    const items: OpenItem[] = [
      { itemId: "b-alq", chargeId: "b", dueDate: "2026-10-10", kind: "alquiler", outstanding: 1 },
      { itemId: "a-srv2", chargeId: "a", dueDate: "2026-10-10", kind: "servicio", outstanding: 1, sortOrder: 2 },
      { itemId: "a-srv1", chargeId: "a", dueDate: "2026-10-10", kind: "servicio", outstanding: 1, sortOrder: 1 },
      { itemId: "a-alq", chargeId: "a", dueDate: "2026-10-10", kind: "alquiler", outstanding: 1 },
    ];
    expect(sortForImputation(items).map((i) => i.itemId)).toEqual(["a-alq", "a-srv1", "a-srv2", "b-alq"]);
  });

  it("no muta el arreglo recibido", () => {
    const copy = ALL.map((i) => i.itemId);
    sortForImputation(ALL, ["oct"]);
    expect(ALL.map((i) => i.itemId)).toEqual(copy);
  });
});

describe("allocatePayment", () => {
  it("paga lo más viejo primero y lo que sobra va al cargo siguiente", () => {
    const r = allocatePayment(600000, ALL);
    expect(r.allocations).toEqual([
      { itemId: "sep-pun", chargeId: "sep", amount: 12500 },
      { itemId: "sep-alq", chargeId: "sep", amount: 500000 },
      { itemId: "sep-exp", chargeId: "sep", amount: 80000 },
      { itemId: "oct-alq", chargeId: "oct", amount: 7500 },
    ]);
    expect(r.remainder).toBe(0);
  });

  it("un pago que no alcanza cubre primero el punitorio y después el alquiler", () => {
    const r = allocatePayment(300000, ALL);
    expect(r.allocations).toEqual([
      { itemId: "sep-pun", chargeId: "sep", amount: 12500 },
      { itemId: "sep-alq", chargeId: "sep", amount: 287500 },
    ]);
    expect(r.remainder).toBe(0);
  });

  it("lo que sobra después de cubrir todo es saldo a favor del inquilino", () => {
    const r = allocatePayment(1500000, ALL);
    expect(r.allocations.reduce((s, a) => s + a.amount, 0)).toBe(1177500);
    expect(r.allocations).toHaveLength(5);
    expect(r.remainder).toBe(322500);
  });

  it("'pago octubre aunque deba septiembre': la elección del inquilino manda", () => {
    const r = allocatePayment(585000, ALL, ["oct"]);
    expect(r.allocations).toEqual([
      { itemId: "oct-alq", chargeId: "oct", amount: 500000 },
      { itemId: "oct-exp", chargeId: "oct", amount: 85000 },
    ]);
    expect(r.remainder).toBe(0);
  });

  it("ignora los ítems sin saldo (0 o negativo, p. ej. una nota de crédito)", () => {
    const items: OpenItem[] = [
      { itemId: "pagado", chargeId: "sep", dueDate: "2026-09-10", kind: "alquiler", outstanding: 0 },
      { itemId: "credito", chargeId: "sep", dueDate: "2026-09-10", kind: "punitorio", outstanding: -500 },
      { itemId: "exp", chargeId: "sep", dueDate: "2026-09-10", kind: "expensas", outstanding: 80000 },
    ];
    const r = allocatePayment(100000, items);
    expect(r.allocations).toEqual([{ itemId: "exp", chargeId: "sep", amount: 80000 }]);
    expect(r.remainder).toBe(20000);
  });

  it("trabaja en centavos: sin residuos de punto flotante", () => {
    const items: OpenItem[] = [
      { itemId: "a", chargeId: "c", dueDate: "2026-10-10", kind: "otro", outstanding: 0.1, sortOrder: 1 },
      { itemId: "b", chargeId: "c", dueDate: "2026-10-10", kind: "otro", outstanding: 0.2, sortOrder: 2 },
    ];
    const r = allocatePayment(0.3, items);
    expect(r.allocations.map((a) => a.amount)).toEqual([0.1, 0.2]);
    expect(r.remainder).toBe(0); // no 5,55e-17
  });

  it("redondea montos y saldos a 2 decimales (half up)", () => {
    const items: OpenItem[] = ["a", "b", "c"].map((id, i) => ({
      itemId: id,
      chargeId: "c",
      dueDate: "2026-10-10",
      kind: "otro" as const,
      outstanding: 33.333,
      sortOrder: i,
    }));
    const r = allocatePayment(100, items);
    expect(r.allocations.map((a) => a.amount)).toEqual([33.33, 33.33, 33.33]);
    expect(r.remainder).toBe(0.01);
    expect(allocatePayment(100.005, []).remainder).toBe(100.01);
  });

  it("un pago de 0 o negativo no imputa nada", () => {
    expect(allocatePayment(0, ALL)).toEqual({ allocations: [], remainder: 0 });
    expect(allocatePayment(-100, ALL)).toEqual({ allocations: [], remainder: 0 });
  });

  it("sin deudas, todo el pago queda a favor", () => {
    expect(allocatePayment(500000, [])).toEqual({ allocations: [], remainder: 500000 });
  });
});

describe("chargeStatusOf", () => {
  const due = "2026-10-10";

  it("pendiente / parcial hasta el vencimiento inclusive", () => {
    expect(chargeStatusOf({ total: 500000, paid: 0, dueDate: due, today: "2026-10-05" })).toBe("pendiente");
    expect(chargeStatusOf({ total: 500000, paid: 0, dueDate: due, today: due })).toBe("pendiente");
    expect(chargeStatusOf({ total: 500000, paid: 100000, dueDate: due, today: due })).toBe("parcial");
  });

  it("vencido al día siguiente del vencimiento, aunque haya un pago parcial", () => {
    expect(chargeStatusOf({ total: 500000, paid: 0, dueDate: due, today: "2026-10-11" })).toBe("vencido");
    expect(chargeStatusOf({ total: 500000, paid: 499999.99, dueDate: due, today: "2026-10-11" })).toBe("vencido");
  });

  it("pagado cuando lo cobrado cubre el total, aunque se haya pagado tarde o de más", () => {
    expect(chargeStatusOf({ total: 500000, paid: 500000, dueDate: due, today: "2026-11-30" })).toBe("pagado");
    expect(chargeStatusOf({ total: 500000, paid: 600000, dueDate: due, today: due })).toBe("pagado");
    // Diferencias por debajo del centavo no dejan un cargo "parcial".
    expect(chargeStatusOf({ total: 500000.004, paid: 500000, dueDate: due, today: "2026-11-30" })).toBe("pagado");
  });

  it("un cargo de total 0 está pagado", () => {
    expect(chargeStatusOf({ total: 0, paid: 0, dueDate: due, today: "2026-12-01" })).toBe("pagado");
  });

  it("anulado gana sobre todo lo demás", () => {
    expect(chargeStatusOf({ total: 500000, paid: 500000, dueDate: due, today: due, voided: true })).toBe("anulado");
    expect(chargeStatusOf({ total: 500000, paid: 0, dueDate: due, today: "2026-12-01", voided: true })).toBe("anulado");
  });
});
