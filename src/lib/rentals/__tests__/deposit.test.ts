import { describe, expect, it } from "vitest";
import {
  checkDepositSettlement,
  depositAllocationBlocker,
  depositHeldAmount,
  depositItemBlocker,
  depositItemPayee,
  depositPlace,
  depositStatusHint,
  isDepositSettled,
  suggestDepositSplit,
} from "../deposit";

const place = { currency: "ARS", deposit_currency: "ARS", deposit_holder: "inmobiliaria" as const, collector: "inmobiliaria" as const };

describe("depositAllocationBlocker", () => {
  it("imputa cuando la plata está donde entran los cobros", () => {
    expect(depositAllocationBlocker(place)).toBeNull();
    expect(depositAllocationBlocker({ ...place, deposit_holder: "propietario", collector: "propietario" })).toBeNull();
  });

  it("no imputa si el propietario lo tiene y los cobros pasan por la inmobiliaria (se le rendiría dos veces)", () => {
    expect(depositAllocationBlocker({ ...place, deposit_holder: "propietario" })).toMatch(/rendirían otra vez/);
  });

  it("no imputa si el alquiler lo cobra el propietario y el depósito lo tiene la inmobiliaria", () => {
    expect(depositAllocationBlocker({ ...place, collector: "propietario" })).toMatch(/lo cobra el propietario/);
  });

  it("no imputa un depósito en otra moneda", () => {
    expect(depositAllocationBlocker({ ...place, deposit_currency: "USD" })).toMatch(/USD/);
  });

  it("sin moneda propia, el depósito es en la del contrato", () => {
    expect(depositAllocationBlocker({ ...place, deposit_currency: null })).toBeNull();
  });

  it("manda dónde está la plata, no lo que dice el contrato", () => {
    // Contrato «lo guarda la inmobiliaria», pero se cobró para el propietario: ya se le rindió.
    expect(depositAllocationBlocker(place, "propietario")).toMatch(/se cobró para el propietario.*rendirían otra vez/);
    // Contrato «lo guarda el propietario», pero quedó en la Caja de la inmobiliaria: se puede imputar.
    expect(depositAllocationBlocker({ ...place, deposit_holder: "propietario" }, "inmobiliaria")).toBeNull();
  });
});

describe("depositPlace", () => {
  const contract = { collector: "inmobiliaria" as const, deposit_holder: "inmobiliaria" as const, deposit_meta: {} };

  it("sin renglón en la cuenta, lo que dice el contrato", () => {
    expect(depositPlace(contract, [])).toEqual({ heldBy: "inmobiliaria", note: null });
    expect(depositPlace({ ...contract, deposit_holder: "propietario" }, [])).toEqual({ heldBy: "propietario", note: null });
  });

  it("cobrado para un tercero con la inmobiliaria cobrando: queda en su Caja", () => {
    expect(depositPlace(contract, [{ payee: "tercero", amount: 480000 }])).toEqual({ heldBy: "inmobiliaria", note: null });
  });

  it("cobrado «para el propietario»: se le rinde, lo tiene él aunque el contrato diga inmobiliaria", () => {
    const r = depositPlace(contract, [{ payee: "propietario", amount: 480000 }]);
    expect(r.heldBy).toBe("propietario");
    expect(r.note).toMatch(/se le rinde con los cobros/);
  });

  it("con que una parte haya ido al propietario, se toma como suyo", () => {
    expect(depositPlace(contract, [{ payee: "tercero", amount: 480000 }, { payee: "propietario", amount: 100000 }]).heldBy).toBe("propietario");
  });

  it("si los cobros los recibe el propietario, el depósito cobrado por la cuenta lo tiene él", () => {
    const r = depositPlace({ ...contract, collector: "propietario" }, [{ payee: "tercero", amount: 480000 }]);
    expect(r.heldBy).toBe("propietario");
    expect(r.note).toMatch(/los recibe el propietario/);
  });

  it("contrato «propietario» pero cobrado sin rendírselo: está en la Caja de la inmobiliaria", () => {
    const r = depositPlace({ ...contract, deposit_holder: "propietario" }, [{ payee: "tercero", amount: 480000 }]);
    expect(r.heldBy).toBe("inmobiliaria");
    expect(r.note).toMatch(/Caja de la inmobiliaria/);
  });

  it("un renglón bonificado entero (importe 0) no cuenta", () => {
    expect(depositPlace(contract, [{ payee: "propietario", amount: 0 }])).toEqual({ heldBy: "inmobiliaria", note: null });
  });

  it("el depósito heredado de la renovación trae dónde estaba", () => {
    const inherited = { ...contract, deposit_meta: { inherited: { held_by: "propietario" } } };
    const r = depositPlace(inherited, []);
    expect(r.heldBy).toBe("propietario");
    expect(r.note).toMatch(/contrato anterior/);
    // Heredado en Caja + diferencia cobrada para el propietario: se toma como suyo.
    expect(depositPlace({ ...contract, deposit_meta: { inherited: { held_by: "inmobiliaria" } } }, [{ payee: "propietario", amount: 50000 }]).heldBy).toBe("propietario");
    // Un traspaso sin el dato (anterior a la 068j) cae en lo que dice el contrato.
    expect(depositPlace({ ...contract, deposit_meta: { inherited: { from_number: 12 } } }, [])).toEqual({ heldBy: "inmobiliaria", note: null });
  });
});

describe("depositHeldAmount", () => {
  const c = { deposit_amount: 480000, deposit_meta: {} };

  it("sin renglones en la cuenta, el monto del contrato (marcado a mano)", () => {
    expect(depositHeldAmount(c, [])).toBe(480000);
  });

  it("en cuotas con las impagas anuladas: sólo lo cobrado", () => {
    const items = [
      { payee: "tercero", amount: 80000, paid: 80000 },
      { payee: "tercero", amount: 80000, paid: 80000 },
      { payee: "tercero", amount: 80000, paid: 80000 },
    ];
    expect(depositHeldAmount(c, items)).toBe(240000);
  });

  it("no cuenta de más lo pagado por encima del renglón ni los renglones en cero", () => {
    expect(depositHeldAmount(c, [{ payee: "tercero", amount: 100000, paid: 120000 }, { payee: "tercero", amount: 0, paid: 0 }])).toBe(100000);
  });

  it("renovación: lo heredado más la diferencia cobrada por la cuenta", () => {
    const renewal = { deposit_amount: 580000, deposit_meta: { inherited: { amount: 480000 } } };
    expect(depositHeldAmount(renewal, [{ payee: "tercero", amount: 100000, paid: 100000 }])).toBe(580000);
    // Sin renglones, lo que pasó: la diferencia de 100.000 nunca se cobró y no sale de Caja.
    expect(depositHeldAmount(renewal, [])).toBe(480000);
    // Pasado antes de que se guardara el monto: el del contrato.
    expect(depositHeldAmount({ deposit_amount: 580000, deposit_meta: { inherited: { from_number: 3 } } }, [])).toBe(580000);
    // Con una marca a mano (datos viejos), la marca entró por el monto del contrato.
    expect(depositHeldAmount({ ...renewal, deposit_meta: { ...renewal.deposit_meta, received: { on: "2026-09-01" } } }, [])).toBe(580000);
  });
});

describe("renglón de depósito en la cuenta", () => {
  const gate = { currency: "ARS", deposit_currency: "ARS", deposit_amount: 480000, deposit_status: "pendiente" as const, deposit_meta: {} };

  it("va para quien lo guarda, como al activar el contrato", () => {
    expect(depositItemPayee("propietario")).toBe("propietario");
    expect(depositItemPayee("inmobiliaria")).toBe("tercero");
  });

  it("se puede cargar con el depósito a cobrar o cobrado por la cuenta", () => {
    expect(depositItemBlocker(gate)).toBeNull();
    expect(depositItemBlocker({ ...gate, deposit_status: "retenido" })).toBeNull();
  });

  it("no sin depósito en el contrato", () => {
    expect(depositItemBlocker({ ...gate, deposit_amount: 0, deposit_status: "no_aplica" })).toMatch(/no tiene depósito/);
  });

  it("no en otra moneda (al activar tampoco entra al cargo de ingreso)", () => {
    expect(depositItemBlocker({ ...gate, deposit_currency: "USD" })).toMatch(/USD.*ARS.*Marcar depósito como cobrado/);
    expect(depositItemBlocker({ ...gate, deposit_currency: null })).toBeNull();
  });

  it("no con el depósito ya cerrado", () => {
    expect(depositItemBlocker({ ...gate, deposit_status: "devuelto" })).toMatch(/ya se cerró/);
  });

  it("no con el depósito marcado cobrado a mano (se contaría dos veces)", () => {
    const msg = depositItemBlocker({ ...gate, deposit_status: "retenido", deposit_meta: { received: { on: "2026-09-01", movement_id: null } } });
    expect(msg).toMatch(/cobrado a mano el 01\/09\/2026/);
    expect(msg).toMatch(/Desmarcar depósito cobrado/);
  });
});

describe("suggestDepositSplit", () => {
  it("primero la deuda, el resto se devuelve", () => {
    expect(suggestDepositSplit(480000, 120000.5)).toEqual({ applied: 120000.5, returned: 359999.5 });
  });

  it("la deuda mayor que el depósito se lo come entero", () => {
    expect(suggestDepositSplit(480000, 900000)).toEqual({ applied: 480000, returned: 0 });
  });

  it("sin deuda imputable, se devuelve todo", () => {
    expect(suggestDepositSplit(480000, null)).toEqual({ applied: 0, returned: 480000 });
    expect(suggestDepositSplit(480000, 0)).toEqual({ applied: 0, returned: 480000 });
  });
});

describe("checkDepositSettlement", () => {
  const base = { depositAmount: 480000, currency: "ARS", applied: 0, returned: 480000, debt: 0, note: "" };

  it("devolución completa", () => {
    expect(checkDepositSettlement(base)).toEqual({ ok: true, status: "devuelto", difference: 0 });
  });

  it("aplicado entero a deudas", () => {
    expect(checkDepositSettlement({ ...base, applied: 480000, returned: 0, debt: 500000 })).toEqual({ ok: true, status: "aplicado", difference: 0 });
  });

  it("parte a deudas y el resto devuelto queda como devuelto", () => {
    expect(checkDepositSettlement({ ...base, applied: 100000, returned: 380000, debt: 100000 })).toMatchObject({ ok: true, status: "devuelto" });
  });

  it("pide algún importe", () => {
    expect(checkDepositSettlement({ ...base, returned: 0 })).toMatchObject({ ok: false, field: "returned" });
  });

  it("no deja aplicar más que el depósito ni más que la deuda", () => {
    expect(checkDepositSettlement({ ...base, applied: 500000, returned: 0, debt: 900000 })).toMatchObject({ ok: false, field: "applied" });
    expect(checkDepositSettlement({ ...base, applied: 200000, returned: 280000, debt: 150000 })).toMatchObject({ ok: false, field: "applied" });
  });

  it("si lo aplicado no se imputa (debt null) no lo limita la deuda", () => {
    expect(checkDepositSettlement({ ...base, applied: 200000, returned: 280000, debt: null })).toMatchObject({ ok: true, status: "devuelto" });
  });

  it("si la suma no da el depósito exige una nota (un cero de más no sale de Caja sin explicación)", () => {
    const typo = checkDepositSettlement({ ...base, returned: 4800000 });
    expect(typo).toMatchObject({ ok: false, field: "note", difference: 4320000 });
    expect(checkDepositSettlement({ ...base, returned: 612400, note: "Se devuelve al valor del último mes" })).toMatchObject({ ok: true, difference: 132400 });
  });

  it("rechaza negativos", () => {
    expect(checkDepositSettlement({ ...base, applied: -1 })).toMatchObject({ ok: false, field: "applied" });
    expect(checkDepositSettlement({ ...base, returned: -5 })).toMatchObject({ ok: false, field: "returned" });
  });
});

describe("estado del depósito", () => {
  const card = {
    status: "vigente" as const,
    currency: "ARS",
    deposit_amount: 480000,
    deposit_currency: "ARS",
    deposit_holder: "inmobiliaria" as const,
    deposit_status: "pendiente" as const,
    deposit_returned_amount: null,
    deposit_returned_at: null,
  };

  it("cerrado = devuelto, aplicado o pasado a la renovación", () => {
    expect(isDepositSettled("devuelto")).toBe(true);
    expect(isDepositSettled("aplicado")).toBe(true);
    expect(isDepositSettled("trasladado")).toBe(true);
    expect(isDepositSettled("retenido")).toBe(false);
    expect(isDepositSettled("pendiente")).toBe(false);
  });

  it("vigente: a cobrar / cobrado", () => {
    expect(depositStatusHint(card)).toBe("A cobrar · lo guarda la inmobiliaria");
    expect(depositStatusHint({ ...card, deposit_status: "retenido" })).toBe("Cobrado · lo guarda la inmobiliaria");
  });

  it("dice quién tiene la plata de verdad si se le pasa", () => {
    expect(depositStatusHint({ ...card, deposit_status: "retenido" }, "propietario")).toBe("Cobrado · lo guarda el propietario");
    expect(depositStatusHint({ ...card, deposit_status: "retenido" }, null)).toBe("Cobrado · lo guarda la inmobiliaria");
  });

  it("terminado sin cobrar no dice 'a cobrar'", () => {
    expect(depositStatusHint({ ...card, status: "finalizado" })).toBe("No figura cobrado · lo guarda la inmobiliaria");
  });

  it("devuelto con importe y fecha", () => {
    expect(depositStatusHint({ ...card, status: "finalizado", deposit_status: "devuelto", deposit_returned_amount: 380000, deposit_returned_at: "2026-10-12" })).toMatch(
      /^Devuelto .*380\.000.* el 12\/10\/2026$/,
    );
  });

  it("sin depósito", () => {
    expect(depositStatusHint({ ...card, deposit_amount: 0, deposit_status: "no_aplica" })).toBe("El contrato no tiene depósito");
  });
});
