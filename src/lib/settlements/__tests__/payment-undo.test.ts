import { describe, it, expect } from "vitest";
import {
  hasPaymentUndoNetGap,
  parsePaymentUndoRpcMovements,
  paymentMovementKind,
  paymentUndoBalanceText,
  paymentUndoErrorMessage,
  paymentUndoMovementLabel,
  paymentUndoNetGap,
  paymentUndoNetGapText,
  paymentUndoSuccessText,
  samePaymentMovementSet,
  settlementLockedMessage,
  settlementLockHint,
  settlementRegenerateHint,
  sortPaymentUndoMovements,
  summarizePaymentUndo,
  type PaymentUndoMovement,
} from "../payment-undo";

function mov(over: Partial<PaymentUndoMovement>): PaymentUndoMovement {
  return {
    id: "m1",
    kind: "pago",
    account_id: "acc-banco",
    account_name: "Banco",
    direction: "out",
    amount: 100,
    currency: "ARS",
    occurred_at: "2026-09-16T15:00:00Z",
    description: null,
    ...over,
  };
}

describe("paymentMovementKind", () => {
  it("los egresos del pago (también los de un pago dividido) son 'pago'", () => {
    expect(paymentMovementKind({ id: "a", ref_type: "settlement_payment" }, "a")).toBe("pago");
    expect(paymentMovementKind({ id: "b", ref_type: "settlement_payment" }, "a")).toBe("pago");
  });

  it("los asientos de ediciones posteriores al pago son 'ajuste'", () => {
    expect(paymentMovementKind({ id: "c", ref_type: "settlement_adjustment" }, "a")).toBe("ajuste");
  });

  it("el de paid_movement_id es el pago aunque no esté etiquetado (pagos viejos)", () => {
    expect(paymentMovementKind({ id: "a", ref_type: null }, "a")).toBe("pago");
  });
});

describe("summarizePaymentUndo", () => {
  it("borrar egresos devuelve la plata a cada cuenta (pago dividido)", () => {
    const s = summarizePaymentUndo([
      mov({ id: "1", account_id: "efectivo", account_name: "Efectivo", amount: 40000 }),
      mov({ id: "2", account_id: "banco", account_name: "Banco", amount: 110000.5 }),
    ]);
    expect(s.count).toBe(2);
    expect(s.totalOut).toBe(150000.5);
    expect(s.totalIn).toBe(0);
    expect(s.net).toBe(150000.5);
    expect(s.byAccount).toEqual([
      { account_id: "efectivo", account_name: "Efectivo", currency: "ARS", net: 40000 },
      { account_id: "banco", account_name: "Banco", currency: "ARS", net: 110000.5 },
    ]);
  });

  it("un ingreso de ajuste borrado RESTA en su cuenta", () => {
    // Pagó 150.000, después una edición bajó el neto 20.000 y Caja registró
    // un ingreso de ajuste: anular el pago devuelve 130.000 en neto.
    const s = summarizePaymentUndo([
      mov({ id: "1", amount: 150000 }),
      mov({ id: "2", kind: "ajuste", direction: "in", amount: 20000 }),
    ]);
    expect(s.totalOut).toBe(150000);
    expect(s.totalIn).toBe(20000);
    expect(s.net).toBe(130000);
    expect(s.byAccount).toHaveLength(1);
    expect(s.byAccount[0].net).toBe(130000);
  });

  it("sin movimientos (pagada sin egreso en Caja) no inventa importes", () => {
    const s = summarizePaymentUndo([]);
    expect(s).toEqual({ count: 0, totalOut: 0, totalIn: 0, net: 0, byAccount: [] });
  });

  it("redondea a centavos sin arrastrar error de coma flotante", () => {
    const s = summarizePaymentUndo([
      mov({ id: "1", amount: 0.1 }),
      mov({ id: "2", amount: 0.2 }),
    ]);
    expect(s.net).toBe(0.3);
    expect(s.byAccount[0].net).toBe(0.3);
  });
});

describe("sortPaymentUndoMovements", () => {
  it("ordena cronológicamente y desempata por id", () => {
    const out = sortPaymentUndoMovements([
      mov({ id: "b", occurred_at: "2026-09-16T15:00:00Z" }),
      mov({ id: "c", occurred_at: "2026-09-10T10:00:00Z" }),
      mov({ id: "a", occurred_at: "2026-09-16T15:00:00Z" }),
    ]);
    expect(out.map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("no muta el arreglo original", () => {
    const input = [mov({ id: "b" }), mov({ id: "a" })];
    sortPaymentUndoMovements(input);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("parsePaymentUndoRpcMovements", () => {
  it("lee lo que devuelve el RPC y lo ordena", () => {
    const out = parsePaymentUndoRpcMovements([
      {
        id: "b",
        kind: "ajuste",
        account_id: "acc",
        account_name: "Banco",
        direction: "in",
        amount: 2000,
        currency: "ARS",
        occurred_at: "2026-09-20T12:00:00+00:00",
        description: "Ajuste liquidación",
        ref_type: "settlement_adjustment",
      },
      {
        id: "a",
        kind: "pago",
        account_id: "acc",
        account_name: "Banco",
        direction: "out",
        amount: "150000.00",
        currency: "ARS",
        occurred_at: "2026-09-16T15:00:00+00:00",
        description: null,
      },
    ]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ kind: "pago", direction: "out", amount: 150000 });
    expect(out[1]).toMatchObject({ kind: "ajuste", direction: "in", amount: 2000 });
  });

  it("no se cae con basura: lo confirmado en la base no puede romper la respuesta", () => {
    expect(parsePaymentUndoRpcMovements(null)).toEqual([]);
    expect(parsePaymentUndoRpcMovements({})).toEqual([]);
    const out = parsePaymentUndoRpcMovements([null, 3, { sin: "id" }, { id: "x" }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "x",
      kind: "pago",
      direction: "out",
      amount: 0,
      account_name: "Cuenta sin nombre",
    });
  });
});

describe("textos de la confirmación", () => {
  // formatMoney usa Intl (separa con espacio duro): se compara sin espacios.
  const flat = (s: string | null) => (s ?? "").replace(/\s/g, " ");

  it("nombra cada movimiento por lo que fue", () => {
    expect(paymentUndoMovementLabel({ kind: "pago", direction: "out" })).toBe("Egreso del pago");
    expect(paymentUndoMovementLabel({ kind: "ajuste", direction: "out" })).toBe("Egreso de ajuste");
    expect(paymentUndoMovementLabel({ kind: "ajuste", direction: "in" })).toBe("Ingreso de ajuste");
  });

  it("dice cuánto sube el saldo de la cuenta", () => {
    const s = summarizePaymentUndo([mov({ amount: 150000, account_name: "Banco Galicia" })]);
    expect(flat(paymentUndoBalanceText(s))).toBe(
      "Al borrarlo, el saldo de Banco Galicia sube $ 150.000,00.",
    );
  });

  it("con varias cuentas detalla cada una (y si alguna baja, lo dice)", () => {
    const s = summarizePaymentUndo([
      mov({ id: "1", account_id: "e", account_name: "Efectivo", amount: 40000 }),
      mov({ id: "2", account_id: "b", account_name: "Banco", amount: 110000 }),
      mov({ id: "3", account_id: "u", account_name: "Mercado Pago", kind: "ajuste", direction: "in", amount: 5000 }),
    ]);
    expect(flat(paymentUndoBalanceText(s))).toBe(
      "Al borrarlos: Efectivo sube $ 40.000,00 · Banco sube $ 110.000,00 · Mercado Pago baja $ 5.000,00.",
    );
  });

  it("sin movimientos no hay efecto que contar", () => {
    expect(paymentUndoBalanceText(summarizePaymentUndo([]))).toBeNull();
  });

  it("el aviso de éxito dice qué se borró y que volvió a Revisada", () => {
    const one = [mov({ amount: 150000, account_name: "Banco" })];
    expect(flat(paymentUndoSuccessText({ ...summarizePaymentUndo(one), movements: one }))).toBe(
      "Se borró de Caja el egreso del pago de $ 150.000,00 (Banco). La liquidación volvió a Revisada.",
    );
    const two = [mov({ id: "1", amount: 100 }), mov({ id: "2", amount: 50 })];
    expect(flat(paymentUndoSuccessText({ ...summarizePaymentUndo(two), movements: two }))).toBe(
      "Se borraron 2 movimientos de Caja ($ 150,00 en neto). La liquidación volvió a Revisada.",
    );
    expect(paymentUndoSuccessText({ ...summarizePaymentUndo([]), movements: [] })).toBe(
      "No había movimientos del pago en Caja. La liquidación volvió a Revisada.",
    );
  });
});

describe("samePaymentMovementSet", () => {
  it("ignora orden y repetidos", () => {
    expect(samePaymentMovementSet(["a", "b"], ["b", "a", "a"])).toBe(true);
  });

  it("un ajuste nuevo hace que no coincida (no se borra lo que nadie vio)", () => {
    expect(samePaymentMovementSet(["a"], ["a", "nuevo-ajuste"])).toBe(false);
    expect(samePaymentMovementSet(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("dos listas vacías coinciden", () => {
    expect(samePaymentMovementSet([], [])).toBe(true);
  });
});

describe("paymentUndoErrorMessage", () => {
  it("traduce cada código del RPC", () => {
    expect(paymentUndoErrorMessage("MOTIVO_REQUERIDO: contá por qué")).toMatch(/Contá por qué/);
    expect(paymentUndoErrorMessage("MOTIVO_LARGO: …")).toMatch(/300/);
    expect(paymentUndoErrorMessage("LIQUIDACION_NO_ENCONTRADA: …")).toMatch(/No encontramos/);
    expect(paymentUndoErrorMessage("NO_PAGADA: la liquidación está en estado revisada")).toMatch(
      /ya no figura como pagada/,
    );
    expect(paymentUndoErrorMessage("PAGO_CAMBIO: …")).toMatch(/No se borró nada/);
    expect(paymentUndoErrorMessage("MOVIMIENTO_INESPERADO: …")).toMatch(/revisalo en Caja/);
  });

  it("lo desconocido pasa tal cual", () => {
    expect(paymentUndoErrorMessage("timeout")).toBe("timeout");
  });
});

describe("settlementLockHint / settlementLockedMessage", () => {
  it("una liquidación pagada apunta a «Anular el pago», no a anular la liquidación", () => {
    const hint = settlementLockHint("pagada");
    expect(hint).toMatch(/Anular el pago/);
    expect(hint).not.toMatch(/Anulá la liquidación/);
    // No promete volver a registrar "lo mismo": se paga por el neto de ese momento.
    expect(hint).toMatch(/neto que dé en ese momento/);
    expect(hint).not.toMatch(/registrar el pago bien/);
  });

  it("revisada / enviada sin pago se destraban volviendo a Borrador", () => {
    expect(settlementLockHint("revisada")).toMatch(/Borrador/);
    expect(settlementLockHint("enviada")).toMatch(/Borrador/);
  });

  it("arma el aviso de Caja con el período del RPC", () => {
    const msg = settlementLockedMessage(
      "SETTLEMENT_LOCKED: liquidación 9/2026 en estado pagada",
    );
    expect(msg).toMatch(/liquidación 09\/2026/);
    expect(msg).toMatch(/Anular el pago/);
  });

  it("sin el formato esperado igual da una salida", () => {
    const msg = settlementLockedMessage("SETTLEMENT_LOCKED");
    expect(msg).toMatch(/Anular el pago/);
    expect(msg).toMatch(/Borrador/);
  });
});

describe("settlementRegenerateHint: cómo rehacer una liquidación cerrada", () => {
  it("pagada: «Anular el pago» → Revisada → Borrador, sin mandar a Caja ni al detalle a eliminar", () => {
    const hint = settlementRegenerateHint("pagada");
    expect(hint).toMatch(/Anular el pago/);
    expect(hint).toMatch(/Revisada/);
    expect(hint).toMatch(/Borrador/);
    expect(hint).toMatch(/lista de Liquidaciones/);
    // Los dos caminos circulares de antes.
    expect(hint).not.toMatch(/en Caja/);
    expect(hint).not.toMatch(/desde su detalle/);
  });

  it("revisada / enviada / disputada: Borrador desde su estado o eliminarla desde la lista", () => {
    for (const status of ["revisada", "enviada", "disputada"]) {
      const hint = settlementRegenerateHint(status);
      expect(hint).toMatch(/Borrador desde su estado/);
      expect(hint).toMatch(/lista de Liquidaciones/);
      expect(hint).not.toMatch(/Anular el pago/);
      expect(hint).not.toMatch(/desde su detalle/);
    }
  });

  it("anulada: no ofrece pasos que no existen (no está en la lista ni se reabre)", () => {
    const hint = settlementRegenerateHint("anulada");
    expect(hint).not.toMatch(/Borrador/);
    expect(hint).not.toMatch(/eliminala/);
  });
});

describe("paymentUndoNetGap: lo que salió según Caja contra el neto de hoy", () => {
  const flat = (s: string) => s.replace(/\s/g, " ");
  const preview = (net_payable: number, movements: PaymentUndoMovement[], currency = "ARS") => ({
    net_payable,
    currency,
    movements,
  });

  it("detecta un neto editado con «Solo visual» después de pagar (caso real 16/09)", () => {
    const g = paymentUndoNetGap(preview(764400, [mov({ amount: 640000 })]));
    expect(g).toEqual({ paidNet: 640000, net: 764400, gap: 124400 });
    expect(hasPaymentUndoNetGap(g)).toBe(true);
  });

  it("pago dividido + ajustes que impactaron en Caja: no hay diferencia", () => {
    const g = paymentUndoNetGap(
      preview(152000, [
        mov({ id: "1", account_id: "e", amount: 40000 }),
        mov({ id: "2", account_id: "b", amount: 110000 }),
        mov({ id: "3", account_id: "b", kind: "ajuste", amount: 5000 }),
        mov({ id: "4", account_id: "b", kind: "ajuste", direction: "in", amount: 3000 }),
      ]),
    );
    expect(g).toEqual({ paidNet: 152000, net: 152000, gap: 0 });
    expect(hasPaymentUndoNetGap(g)).toBe(false);
  });

  it("si hoy da menos de lo que salió, la diferencia es negativa", () => {
    const g = paymentUndoNetGap(preview(600000, [mov({ amount: 640000 })]));
    expect(g?.gap).toBe(-40000);
    expect(hasPaymentUndoNetGap(g)).toBe(true);
  });

  it("un centavo ya es diferencia; el error de coma flotante no", () => {
    expect(hasPaymentUndoNetGap(paymentUndoNetGap(preview(100.01, [mov({ amount: 100 })])))).toBe(true);
    const g = paymentUndoNetGap(
      preview(0.3, [mov({ id: "1", amount: 0.1 }), mov({ id: "2", amount: 0.2 })]),
    );
    expect(g?.gap).toBe(0);
    expect(hasPaymentUndoNetGap(g)).toBe(false);
  });

  it("sin movimientos en Caja u otra moneda no hay con qué comparar", () => {
    expect(paymentUndoNetGap(preview(764400, []))).toBeNull();
    expect(paymentUndoNetGap(preview(1000, [mov({ amount: 1000, currency: "USD" })]))).toBeNull();
    expect(hasPaymentUndoNetGap(null)).toBe(false);
  });

  it("el aviso dice cuánto salió, cuánto da hoy y qué se registraría al pagar de nuevo", () => {
    const text = flat(paymentUndoNetGapText({ paidNet: 640000, net: 764400, gap: 124400 }, "ARS"));
    expect(text).toContain("En Caja el pago suma $ 640.000,00, pero la liquidación hoy da $ 764.400,00");
    expect(text).toContain("«Registrar pago» te va a pedir $ 764.400,00");
    expect(text).toContain("Caja registraría $ 124.400,00 que no salieron");
    expect(text).toContain("«Solo visual»");
  });

  it("si hoy da menos, avisa que Caja registraría menos de lo que salió", () => {
    const text = flat(paymentUndoNetGapText({ paidNet: 640000, net: 600000, gap: -40000 }, "ARS"));
    expect(text).toContain("Caja registraría $ 40.000,00 menos de lo que salió");
  });

  it("con neto cero o negativo avisa que no se va a poder volver a pagar", () => {
    const text = paymentUndoNetGapText({ paidNet: 640000, net: 0, gap: -640000 }, "ARS");
    expect(text).toMatch(/no se puede volver a pagar/);
    expect(text).not.toMatch(/te va a pedir/);
  });
});
