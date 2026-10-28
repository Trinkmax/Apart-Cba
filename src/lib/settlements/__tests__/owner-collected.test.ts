import { describe, it, expect } from "vitest";
import {
  buildStatementModel,
  type StatementInput,
  type StatementLineInput,
} from "../statement-model";
import { buildOwnerSettlementEmail } from "../owner-email";

/**
 * "Cobrado por el propietario" (migración 077): el propietario cobró él (o le
 * pagó la OTA). Resta del neto como cualquier descuento, pero NO es un gasto:
 * el resumen la separa para que se vea cuánto ganó en el mes (Habitana,
 * 28/10/2026 — "ve como gastos lo que cobró más la limpieza").
 */

const UNIT = { id: "u1", code: "DEP1", name: "Depto 1" };

function line(
  over: Partial<StatementLineInput> & Pick<StatementLineInput, "id" | "line_type" | "amount" | "sign">,
): StatementLineInput {
  return {
    ref_type: "booking",
    ref_id: "b1",
    unit_id: UNIT.id,
    description: over.line_type,
    currency: "ARS",
    unit: UNIT,
    ...over,
  };
}

function input(lines: StatementLineInput[]): StatementInput {
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
    owner: { full_name: "Adrián García" },
    lines,
  };
}

// Reserva Booking de $100.000: canal 15.000, comisión 17.000, limpieza 10.000
// → el propietario gana 58.000. Booking le depositó a él 85.000 (100.000 −
// canal), así que debe 27.000 = comisión + limpieza.
const BOOKING: StatementLineInput[] = [
  line({
    id: "l1",
    line_type: "booking_revenue",
    amount: 100_000,
    sign: "+",
    display_order: 0,
    meta: { guest_name: "Ana", nights: 4, check_in: "2026-10-01", check_out: "2026-10-05", source: "booking" },
  }),
  line({ id: "l2", line_type: "channel_commission", amount: 15_000, sign: "-", display_order: 1 }),
  line({ id: "l3", line_type: "commission", amount: 17_000, sign: "-", display_order: 2 }),
  line({ id: "l4", line_type: "cleaning_charge", amount: 10_000, sign: "-", display_order: 3 }),
];
const COLLECTED = line({
  id: "l5",
  ref_type: "manual",
  ref_id: null,
  line_type: "owner_collected",
  description: "Ana, 1 al 5/10 (le pagó Booking)",
  amount: 85_000,
  sign: "-",
  display_order: 4,
});

describe("buildStatementModel · cobrado por el propietario", () => {
  it("no lo suma a Gastos y muestra la ganancia del propietario", () => {
    const m = buildStatementModel(input([...BOOKING, COLLECTED]));
    expect(m.totals.deductions).toBe(10_000);
    expect(m.totals.ownerCollected).toBe(85_000);
    expect(m.totals.ownerEarnings).toBe(58_000);
    expect(m.totals.net).toBe(-27_000);
  });

  it("aparece en Otros cargos con su tipo", () => {
    const m = buildStatementModel(input([...BOOKING, COLLECTED]));
    expect(m.otros).toHaveLength(1);
    expect(m.otros[0]).toMatchObject({ line_type: "owner_collected", sign: "-", amount: 85_000 });
  });

  it("sin esas líneas el documento es el de siempre", () => {
    const m = buildStatementModel(input(BOOKING));
    expect(m.totals.ownerCollected).toBe(0);
    expect(m.totals.ownerEarnings).toBe(m.totals.net);
    expect(m.totals.deductions).toBe(10_000);
  });
});

describe("mail al propietario · cobrado por el propietario", () => {
  const mail = (lines: StatementLineInput[], net: string) =>
    buildOwnerSettlementEmail({
      model: buildStatementModel(input(lines)),
      ownerName: "Adrián García",
      net,
      link: "https://example.test/l/x",
      branding: { name: "Habitana" },
    });

  it("dice cuánto ganó y cuánto ya cobró", () => {
    const m = mail([...BOOKING, COLLECTED], "-$ 27.000,00");
    expect(m.text).toContain("A cargo del propietario: $ 27.000,00");
    expect(m.text).toMatch(/Tu ganancia del mes: \$\s?58\.000,00 · Ya cobraste vos: \$\s?85\.000,00/);
  });

  it("sin cobros del propietario no agrega nada", () => {
    const m = mail(BOOKING, "$ 58.000,00");
    expect(m.text).not.toContain("Tu ganancia del mes");
  });
});
