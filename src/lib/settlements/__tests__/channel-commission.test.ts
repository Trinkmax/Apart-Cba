import { describe, it, expect } from "vitest";
import {
  buildStatementModel,
  type StatementInput,
  type StatementLineInput,
} from "../statement-model";

/**
 * Comisión del canal (migración 058): la línea `channel_commission` tiene su
 * propia columna en la planilla y NO se mezcla con "Gastos". El neto no
 * cambia. Sin esa línea, el modelo tiene que ser el de siempre (documentos
 * anteriores idénticos).
 */

const UNIT = { id: "u1", code: "DEP1", name: "Depto 1" };
const REF = "b1";

function line(
  over: Partial<StatementLineInput> & Pick<StatementLineInput, "id" | "line_type" | "amount" | "sign">,
): StatementLineInput {
  return {
    ref_type: "booking",
    ref_id: REF,
    unit_id: UNIT.id,
    description: over.line_type,
    currency: "ARS",
    unit: UNIT,
    ...over,
  };
}

function baseInput(lines: StatementLineInput[], over: Partial<StatementInput> = {}): StatementInput {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    period_year: 2026,
    period_month: 8,
    status: "borrador",
    currency: "ARS",
    gross_revenue: 0,
    commission_amount: 0,
    deductions_amount: 0,
    net_payable: 0,
    owner: { full_name: "Juan Pérez" },
    lines,
    ...over,
  };
}

// Reserva Booking de $100.000 con limpieza $10.000, canal 15 % y comisión de
// administración 20 % sobre lo que queda después del canal:
//   canal    = 15.000
//   comisión = (100.000 − 15.000) × 20 % = 17.000
//   neto     = 100.000 − 15.000 − 17.000 − 10.000 = 58.000
const WITH_CHANNEL: StatementLineInput[] = [
  line({
    id: "l1",
    line_type: "booking_revenue",
    amount: 100_000,
    sign: "+",
    display_order: 0,
    meta: {
      guest_name: "Ana",
      nights: 4,
      check_in: "2026-08-01",
      check_out: "2026-08-05",
      source: "booking",
      mode: "temporario",
      commission_pct: 20,
      channel_commission_pct: 15,
      commission_base: "net_of_channel",
    },
  }),
  line({ id: "l2", line_type: "channel_commission", amount: 15_000, sign: "-", display_order: 1 }),
  line({ id: "l3", line_type: "commission", amount: 17_000, sign: "-", display_order: 2 }),
  line({ id: "l4", line_type: "cleaning_charge", amount: 10_000, sign: "-", display_order: 3 }),
];

describe("buildStatementModel · comisión del canal", () => {
  it("separa el canal de los gastos y deja el neto igual", () => {
    const m = buildStatementModel(baseInput(WITH_CHANNEL));
    expect(m.units).toHaveLength(1);
    const row = m.units[0].rows[0];
    expect(row.gross).toBe(100_000);
    expect(row.channelCommission).toBe(15_000);
    expect(row.commission).toBe(17_000);
    expect(row.expenses).toBe(10_000); // sólo la limpieza
    expect(row.net).toBe(58_000);
    expect(row.commissionBase).toBe("net_of_channel");
    expect(row.commissionPct).toBe(20);
  });

  it("suma el canal en el subtotal de la unidad y en los totales", () => {
    const m = buildStatementModel(baseInput(WITH_CHANNEL));
    expect(m.units[0].subtotal).toEqual({
      gross: 100_000,
      commission: 17_000,
      channelCommission: 15_000,
      expenses: 10_000,
      net: 58_000,
    });
    expect(m.totals).toEqual({
      gross: 100_000,
      commission: 17_000,
      channelCommission: 15_000,
      deductions: 10_000,
      net: 58_000,
    });
    expect(m.hasChannelCommission).toBe(true);
  });

  it("deductions + channelCommission es lo que persiste deductions_amount", () => {
    // owner_settlements no tiene columna para el canal: el backend lo guarda
    // dentro de deductions_amount y el modelo lo separa sólo para mostrar.
    const m = buildStatementModel(baseInput(WITH_CHANNEL));
    expect(m.totals.deductions + m.totals.channelCommission).toBe(25_000);
  });

  it("sin línea de canal el modelo es el de siempre", () => {
    const sinCanal = WITH_CHANNEL.filter((l) => l.line_type !== "channel_commission");
    const m = buildStatementModel(baseInput(sinCanal));
    const row = m.units[0].rows[0];
    expect(row.channelCommission).toBe(0);
    expect(row.expenses).toBe(10_000);
    expect(row.net).toBe(73_000);
    expect(m.totals.channelCommission).toBe(0);
    expect(m.totals.deductions).toBe(10_000);
    expect(m.hasChannelCommission).toBe(false);
  });

  it("una línea de canal en 0 no enciende la columna", () => {
    const cero = WITH_CHANNEL.map((l) =>
      l.line_type === "channel_commission" ? { ...l, amount: 0 } : l,
    );
    const m = buildStatementModel(baseInput(cero));
    expect(m.hasChannelCommission).toBe(false);
  });

  it("convierte el canal a moneda base con el TC del documento", () => {
    const usd = WITH_CHANNEL.map((l) => ({ ...l, currency: "USD" }));
    const m = buildStatementModel(
      baseInput(usd, { exchange_rates: { USD: 1000 } }),
    );
    expect(m.units[0].subtotal.channelCommission).toBe(15_000_000);
    expect(m.totals.channelCommission).toBe(15_000_000);
    expect(m.totals.net).toBe(58_000_000);
  });

  it("sin TC la reserva no suma al total pero la columna sigue encendida", () => {
    const usd = WITH_CHANNEL.map((l) => ({ ...l, currency: "USD" }));
    const m = buildStatementModel(baseInput(usd));
    expect(m.totals.channelCommission).toBe(0);
    expect(m.units[0].rows[0].channelCommission).toBe(15_000);
    expect(m.hasChannelCommission).toBe(true);
    expect(m.missingRates).toEqual(["USD"]);
  });
});

describe("documentos exportables · columna del canal", () => {
  const branding = {
    name: "Apart Cba",
    legal_name: null,
    tax_id: null,
    logo_url: null,
    primary_color: "#0F766E",
  };

  it("el Excel agrega la columna sólo cuando hay canal", async () => {
    const { buildSettlementWorkbook } = await import("@/lib/excel/settlement-xlsx");

    const con = buildSettlementWorkbook(
      buildStatementModel(baseInput(WITH_CHANNEL)),
      branding,
    ).getWorksheet("Liquidación")!;
    const sin = buildSettlementWorkbook(
      buildStatementModel(
        baseInput(WITH_CHANNEL.filter((l) => l.line_type !== "channel_commission")),
      ),
      branding,
    ).getWorksheet("Liquidación")!;

    // Filas 1-3 encabezado, 4 spacer, 5 bloque de unidad, 6 encabezado de
    // columnas, 7 primera reserva.
    const headersCon = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => con.getCell(6, c).value);
    const headersSin = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => sin.getCell(6, c).value);
    expect(headersCon).toEqual([
      "Ingreso", "Egreso", "Huésped", "Noches", "Bruto", "Com. canal", "Comisión", "Gastos", "Neto",
    ]);
    expect(headersSin.slice(0, 8)).toEqual([
      "Ingreso", "Egreso", "Huésped", "Noches", "Bruto", "Comisión", "Gastos", "Neto",
    ]);
    expect(headersSin[8]).toBeNull();

    // La fórmula del neto suma las cuatro columnas de importe (canal en negativo).
    const netCon = con.getCell(7, 9).value as { formula: string; result?: number };
    expect(netCon.formula).toBe("E7+F7+G7+H7");
    expect(netCon.result).toBe(58_000);
    expect(con.getCell(7, 6).value).toBe(-15_000);
    const netSin = sin.getCell(7, 8).value as { formula: string; result?: number };
    expect(netSin.formula).toBe("E7+F7+G7");
  });

  it("el PDF se genera con y sin canal", async () => {
    const { buildSettlementDoc } = await import("@/lib/pdf/settlement-pdf");
    const con = await buildSettlementDoc(
      buildStatementModel(baseInput(WITH_CHANNEL)),
      branding,
    );
    const sin = await buildSettlementDoc(
      buildStatementModel(
        baseInput(WITH_CHANNEL.filter((l) => l.line_type !== "channel_commission")),
      ),
      branding,
    );
    const conBytes = con.output("arraybuffer").byteLength;
    const sinBytes = sin.output("arraybuffer").byteLength;
    expect(conBytes).toBeGreaterThan(1000);
    // Una columna y una línea de totales más → pesa más.
    expect(conBytes).toBeGreaterThan(sinBytes);
  });
});
