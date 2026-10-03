import { describe, expect, it } from "vitest";
import { buildAgenda, relativeDays, type AgendaContract, type AgendaInput } from "@/components/rentals/dashboard/agenda";

const TODAY = "2026-10-15";

function contract(id: string, over: Partial<AgendaContract> = {}): AgendaContract {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    status: "vigente",
    address: `Calle ${id}`,
    tenantName: `Inquilino ${id}`,
    endDate: "2028-03-31",
    terminatedAt: null,
    currency: "ARS",
    insuranceRequired: false,
    insuranceExpiresAt: null,
    depositStatus: "retenido",
    depositAmount: 0,
    depositCurrency: null,
    ...over,
  };
}

function input(over: Partial<AgendaInput> = {}): AgendaInput {
  return {
    today: TODAY,
    contracts: [],
    overdue: [],
    adjustments: [],
    paymentReports: [],
    proofsInReview: 0,
    unpaidStatements: [],
    ...over,
  };
}

describe("agenda", () => {
  it("vacía cuando no hay nada", () => {
    const a = buildAgenda(input());
    expect(a.items).toEqual([]);
    expect(a.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it("dos períodos consecutivos impagos es crítico y va primero; una fila por contrato", () => {
    const a = buildAgenda(
      input({
        contracts: [contract("c1"), contract("c2")],
        overdue: [
          { contractId: "c2", kind: "mensual", label: "Octubre 2026", dueDate: "2026-10-10", outstanding: 100, currency: "ARS", periodIndex: 8, rentAmount: 500, rentOutstanding: 100 },
          { contractId: "c1", kind: "mensual", label: "Septiembre 2026", dueDate: "2026-09-10", outstanding: 500, currency: "ARS", periodIndex: 7, rentAmount: 500, rentOutstanding: 500 },
          { contractId: "c1", kind: "mensual", label: "Octubre 2026", dueDate: "2026-10-10", outstanding: 500, currency: "ARS", periodIndex: 8, rentAmount: 500, rentOutstanding: 500 },
        ],
      }),
    );
    expect(a.items.map((i) => i.kind)).toEqual(["two_unpaid", "overdue"]);
    expect(a.items[0]).toMatchObject({ urgency: "critical", amount: 1000, contractId: "c1", href: "/dashboard/alquileres/contratos/c1?tab=cuenta" });
    expect(a.items[0].title).toBe("2 períodos seguidos sin pagar · Inquilino c1");
    expect(a.items[1].detail).toContain("venció el 10/10/2026 (hace 5 días)");
  });

  it("art. 1219: dos cargos vencidos que no son períodos consecutivos (o un resto de punitorios) no son causal", () => {
    const a = buildAgenda(
      input({
        contracts: [contract("c1"), contract("c2")],
        overdue: [
          // c1: marzo y junio impagos, no consecutivos.
          { contractId: "c1", kind: "mensual", label: "Marzo 2026", dueDate: "2026-03-10", outstanding: 500, currency: "ARS", periodIndex: 1, rentAmount: 500, rentOutstanding: 500 },
          { contractId: "c1", kind: "mensual", label: "Junio 2026", dueDate: "2026-06-10", outstanding: 500, currency: "ARS", periodIndex: 4, rentAmount: 500, rentOutstanding: 500 },
          // c2: pagó tarde dos meses seguidos y quedó un saldo chico (punitorios imputados primero).
          { contractId: "c2", kind: "mensual", label: "Agosto 2026", dueDate: "2026-08-10", outstanding: 12, currency: "ARS", periodIndex: 6, rentAmount: 500, rentOutstanding: 12 },
          { contractId: "c2", kind: "mensual", label: "Septiembre 2026", dueDate: "2026-09-10", outstanding: 9, currency: "ARS", periodIndex: 7, rentAmount: 500, rentOutstanding: 9 },
        ],
      }),
    );
    expect(a.items.map((i) => i.kind)).toEqual(["overdue", "overdue"]);
    expect(a.items.some((i) => i.detail.includes("1219"))).toBe(false);
  });

  it("sin el detalle del alquiler por período no afirma la causal", () => {
    const a = buildAgenda(
      input({
        contracts: [contract("c1")],
        overdue: [
          { contractId: "c1", kind: "mensual", label: "Septiembre 2026", dueDate: "2026-09-10", outstanding: 500, currency: "ARS" },
          { contractId: "c1", kind: "mensual", label: "Octubre 2026", dueDate: "2026-10-10", outstanding: 500, currency: "ARS" },
        ],
      }),
    );
    expect(a.items.map((i) => i.kind)).toEqual(["overdue"]);
  });

  it("ajustes: trabado sólo después de 5 días, listo y sin monto según la fecha", () => {
    const a = buildAgenda(
      input({
        contracts: [contract("c1")],
        adjustments: [
          { id: "a1", contractId: "c1", status: "pendiente_indice", effectiveDate: "2026-10-12", baseAmount: 100, computedAmount: null, variationPct: null, indexCode: "ipc", toKey: "2026-08-01" },
          { id: "a2", contractId: "c1", status: "pendiente_indice", effectiveDate: "2026-10-01", baseAmount: 100, computedAmount: null, variationPct: null, indexCode: "ipc", toKey: "2026-08-01" },
          { id: "a3", contractId: "c1", status: "calculado", effectiveDate: "2026-10-01", baseAmount: 500000, computedAmount: 543500, variationPct: 8.7, indexCode: "ipc", toKey: "2026-08-01" },
          { id: "a4", contractId: "c1", status: "pendiente_manual", effectiveDate: "2026-12-01", baseAmount: 100, computedAmount: null, variationPct: null, indexCode: null, toKey: null },
        ],
      }),
    );
    const keys = a.items.map((i) => i.key);
    expect(keys).toContain("adjustment_stuck:a2");
    expect(keys).not.toContain("adjustment_stuck:a1");
    // a4 rige en más de 15 días: todavía no molesta.
    expect(keys).not.toContain("adjustment_manual:a4");
    const ready = a.items.find((i) => i.key === "adjustment_ready:a3");
    expect(ready?.urgency).toBe("high");
    expect(ready?.detail.replace(/\s/g, " ")).toContain("$ 500.000 → $ 543.500 (+8,7 %)");
  });

  it("Casa Propia trabado: con la cobertura nombra el mes que de verdad falta, no el final de la ventana (P20)", () => {
    const stuck = {
      id: "cp1",
      contractId: "c1",
      status: "pendiente_indice",
      effectiveDate: "2026-06-01",
      baseAmount: 100,
      computedAmount: null,
      variationPct: null,
      indexCode: "casa_propia",
      toKey: "2026-04-01",
      fromKey: "2025-10-01",
    };
    const detailOf = (over: Partial<AgendaInput>) =>
      buildAgenda(input({ contracts: [contract("c1")], adjustments: [stuck], ...over })).items.find((i) => i.key === "adjustment_stuck:cp1")?.detail;
    const coverage = { first: "2025-11-01", last: "2026-04-01", gaps: ["2026-01-01"] };
    expect(detailOf({ indices: [{ code: "casa_propia", coverage }] })).toContain("Casa Propia de enero de 2026");
    // Sin el resumen del índice, como antes: el final de la ventana.
    expect(detailOf({})).toContain("Casa Propia de abril de 2026");
  });

  it("agrupa cuando hay muchos ajustes del mismo tipo", () => {
    const adjustments = ["a", "b", "c", "d"].map((id) => ({
      id,
      contractId: "c1",
      status: "calculado",
      effectiveDate: "2026-10-25",
      baseAmount: 1,
      computedAmount: 2,
      variationPct: 100,
      indexCode: "ipc",
      toKey: null,
    }));
    const a = buildAgenda(input({ contracts: [contract("c1")], adjustments }));
    expect(a.items).toHaveLength(1);
    expect(a.items[0]).toMatchObject({ key: "adjustment_ready:many", title: "4 ajustes listos para aplicar", urgency: "medium" });
  });

  it("vencimientos, seguro, depósito y borradores", () => {
    const a = buildAgenda(
      input({
        contracts: [
          contract("c1", { endDate: "2026-10-01" }),
          contract("c2", { endDate: "2026-11-04" }),
          contract("c3", { endDate: "2027-01-01", insuranceRequired: true, insuranceExpiresAt: "2026-10-20" }),
          contract("c4", { status: "finalizado", terminatedAt: "2026-09-30", depositAmount: 300000 }),
          contract("c5", { status: "borrador" }),
          contract("c6", { status: "borrador" }),
        ],
      }),
    );
    const byKey = Object.fromEntries(a.items.map((i) => [i.key, i]));
    expect(byKey["expired_open:c1"].urgency).toBe("high");
    expect(byKey["expiring:c2"]).toMatchObject({ urgency: "high", title: "Vence en 20 días · Inquilino c2" });
    expect(byKey["expiring:c3"].urgency).toBe("low");
    expect(byKey["insurance:c3"].urgency).toBe("medium");
    expect(byKey["deposit_return:c4"].amount).toBe(300000);
    expect(byKey["draft:many"].title).toBe("2 contratos en borrador");
    expect(a.items[a.items.length - 1].urgency).toBe("low");
  });

  it("avisos de pago, comprobantes y rendiciones", () => {
    const a = buildAgenda(
      input({
        contracts: [contract("c1")],
        paymentReports: [{ id: "r1", contractId: "c1", amount: 450000, currency: "ARS", createdAt: "2026-10-14T12:00:00Z" }],
        proofsInReview: 3,
        unpaidStatements: [{ id: "s1", number: 12, ownerName: "Ana", net: 900000, currency: "ARS", date: "2026-10-05" }],
      }),
    );
    expect(a.items.map((i) => i.kind)).toEqual(["payment_report", "statement_unpaid", "proof_review"]);
    expect(a.items[1].title).toBe("Rendición N° 0012 sin pagar · Ana");
    expect(a.counts).toEqual({ critical: 0, high: 1, medium: 2, low: 0 });
  });

  it("salida registrada: aviso de entrega en lugar de 'vence' o 'vencido sin cerrar'", () => {
    const a = buildAgenda(
      input({
        contracts: [
          contract("c1", { endDate: "2026-11-04", terminatedAt: "2026-10-20" }),
          contract("c2", { endDate: "2026-10-01", terminatedAt: "2026-10-31" }),
          contract("c3", { endDate: "2027-06-30", terminatedAt: "2026-12-31" }),
        ],
      }),
    );
    const keys = a.items.map((i) => i.key);
    expect(keys).toEqual(["exit:c1", "exit:c2"]);
    expect(a.items[0]).toMatchObject({ urgency: "high", title: "Desocupa en 5 días · Inquilino c1" });
    expect(a.items[1].urgency).toBe("medium");
    expect(keys).not.toContain("expired_open:c2");
  });

  it("vencido sin cerrar avisa que sin el cobro de la continuación no se genera nada", () => {
    const a = buildAgenda(input({ contracts: [contract("c1", { endDate: "2026-09-30" })] }));
    expect(a.items[0].kind).toBe("expired_open");
    expect(a.items[0].detail).toContain("hasta entonces no se genera ningún cargo");
  });

  it("salida registrada que ya pasó con el contrato abierto: no desaparece, pide revisarlo (P12)", () => {
    const a = buildAgenda(input({ contracts: [contract("c1", { endDate: "2027-03-31", terminatedAt: "2026-10-12" })] }));
    expect(a.items).toHaveLength(1);
    expect(a.items[0]).toMatchObject({ key: "exit_overdue:c1", urgency: "high", title: "Salida del 12/10/2026 sin cerrar · Inquilino c1", cta: "Revisar" });
  });

  it("ajustes que rigen después de la salida registrada no se piden ni se avisan (P11)", () => {
    const adj = { baseAmount: 100, computedAmount: 110, variationPct: 10, indexCode: "ipc", toKey: "2026-09" };
    const a = buildAgenda(
      input({
        contracts: [contract("c1", { terminatedAt: "2026-10-25" })],
        adjustments: [
          { id: "a1", contractId: "c1", status: "calculado", effectiveDate: "2026-10-20", ...adj },
          { id: "a2", contractId: "c1", status: "calculado", effectiveDate: "2026-10-26", ...adj },
        ],
      }),
    );
    const keys = a.items.map((i) => i.key);
    expect(keys).toContain("adjustment_ready:a1");
    expect(keys).not.toContain("adjustment_ready:a2");
  });

  it("renovación: con la renovación activa el anterior no pide decidir nada y el depósito se pasa (P8)", () => {
    const a = buildAgenda(
      input({
        contracts: [
          // Vence en 16 días pero ya tiene la renovación activa.
          contract("c1", { endDate: "2026-10-31" }),
          contract("c2", { renewedFromId: "c1", endDate: "2028-10-31" }),
          // Vencido con la renovación en borrador: lleva a la renovación.
          contract("c3", { endDate: "2026-09-30" }),
          contract("c4", { status: "borrador", renewedFromId: "c3" }),
          // Terminado, renovado, con el depósito retenido.
          contract("c5", { status: "finalizado", terminatedAt: "2026-09-30", depositAmount: 300000 }),
          contract("c6", { renewedFromId: "c5", endDate: "2028-09-30" }),
        ],
      }),
    );
    const byKey = Object.fromEntries(a.items.map((i) => [i.key, i]));
    expect(byKey["expiring:c1"]).toBeUndefined();
    expect(byKey["expired_open:c3"]).toMatchObject({ cta: "Ver renovación", href: "/dashboard/alquileres/contratos/c4" });
    expect(byKey["expired_open:c3"].detail).toContain("La renovación C-0004 está en borrador");
    expect(byKey["deposit_return:c5"]).toMatchObject({ title: "Depósito para pasar a la renovación · Inquilino c5", cta: "Pasar el depósito" });
  });

  it("rendición con neto negativo o cero: se cierra con saldo a cuenta, nunca 'Registrar pago'", () => {
    const a = buildAgenda(
      input({
        unpaidStatements: [
          { id: "s1", number: 7, ownerName: "Ana", net: -80000, currency: "ARS", date: "2026-10-05" },
          { id: "s2", number: 8, ownerName: "Beto", net: 0, currency: "ARS", date: "2026-10-06" },
          { id: "s3", number: 9, ownerName: "Caro", net: 50000, currency: "ARS", date: "2026-10-07" },
        ],
      }),
    );
    const byKey = Object.fromEntries(a.items.map((i) => [i.key, i]));
    expect(byKey["statement_close:s1"]).toMatchObject({ cta: "Cerrar rendición", amount: 80000, title: "Rendición N° 0007 para cerrar · Ana" });
    expect(byKey["statement_close:s1"].detail.replace(/\s/g, " ")).toContain("Quedó debiendo $ 80.000: cerrala con saldo a cuenta");
    expect(byKey["statement_close:s2"]).toMatchObject({ cta: "Cerrar rendición", amount: null });
    expect(byKey["statement_close:s2"].detail).toContain("Neto cero");
    expect(byKey["statement_unpaid:s3"].cta).toBe("Registrar pago");
  });

  it("muchas rendiciones para cerrar se agrupan aparte de las que hay que pagar", () => {
    const unpaidStatements = [1, 2, 3, 4].map((n) => ({ id: `s${n}`, number: n, ownerName: `P${n}`, net: -n * 1000, currency: "ARS", date: `2026-10-0${n}` }));
    const a = buildAgenda(input({ unpaidStatements: [...unpaidStatements, { id: "s9", number: 9, ownerName: "Ana", net: 900000, currency: "ARS", date: "2026-10-09" }] }));
    expect(a.items.map((i) => i.key)).toEqual(["statement_close:many", "statement_unpaid:s9"]);
    expect(a.items[0]).toMatchObject({ title: "4 rendiciones para cerrar", cta: "Ver rendiciones" });
  });

  it("días relativos", () => {
    expect(relativeDays(TODAY, TODAY)).toBe("hoy");
    expect(relativeDays(TODAY, "2026-10-16")).toBe("mañana");
    expect(relativeDays(TODAY, "2026-10-10")).toBe("hace 5 días");
    expect(relativeDays(TODAY, "2026-10-25")).toBe("en 10 días");
  });
});
