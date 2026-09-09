import { describe, it, expect } from "vitest";
import {
  buildSettledResults,
  type SettledLineInput,
  type SettledSettlementInput,
} from "../settled-model";

/**
 * Los casos de acá salieron de los datos de producción, no de la imaginación:
 * cada uno reproduce una forma real que tienen las liquidaciones y que una
 * implementación "obvia" clasificaría mal.
 */

const UNIT_A = { id: "u-a", code: "BRASIL", name: "Brasil 1" };
const UNIT_B = { id: "u-b", code: "COLON", name: "Colón 4" };

function line(
  over: Partial<SettledLineInput> & Pick<SettledLineInput, "line_type" | "amount" | "sign">,
): SettledLineInput {
  return { unit_id: null, unit: null, currency: null, ...over };
}

function doc(over: Partial<SettledSettlementInput> = {}): SettledSettlementInput {
  return {
    id: "s1",
    status: "revisada",
    currency: "ARS",
    exchange_rates: {},
    paid_at: null,
    owner: { id: "o1", full_name: "Juan Pérez" },
    lines: [],
    ...over,
  };
}

describe("buildSettledResults", () => {
  it("los servicios reembolsados (expenses_fraction con signo +) SUMAN, no se descuentan", () => {
    // En producción hay 198 líneas así — "LUZ", "AGUA", "GAS", "MUNICIPALIDAD":
    // el inquilino las reembolsa y se le giran al dueño. Clasificar por
    // line_type las restaría y el neto saldría ~$11,7M abajo.
    const r = buildSettledResults([
      doc({
        lines: [
          line({ line_type: "monthly_rent_fraction", amount: 972_000, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "commission", amount: 147_000, sign: "-", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "expenses_fraction", amount: 58_714, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "expenses_fraction", amount: 30_814, sign: "+", unit_id: "u-a", unit: UNIT_A }),
        ],
      }),
    ]);
    const u = r.by_unit[0];
    expect(u.gross).toBe(1_061_528); // 972.000 + 58.714 + 30.814
    expect(u.expenses).toBe(0); // ninguna es un gasto
    expect(u.commission).toBe(147_000);
    expect(u.net).toBe(914_528);
  });

  it("el mismo line_type con signo '-' SÍ es gasto", () => {
    const r = buildSettledResults([
      doc({
        lines: [
          line({ line_type: "monthly_rent_fraction", amount: 100_000, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "expenses_fraction", amount: 10_000, sign: "-", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "maintenance_charge", amount: 5_000, sign: "-", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "cleaning_charge", amount: 2_000, sign: "-", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "adjustment", amount: 1_000, sign: "-", unit_id: "u-a", unit: UNIT_A }),
        ],
      }),
    ]);
    expect(r.by_unit[0].expenses).toBe(18_000);
    expect(r.by_unit[0].net).toBe(82_000);
  });

  it("separa comisión de administración y comisión de plataforma en columnas distintas", () => {
    const r = buildSettledResults([
      doc({
        lines: [
          line({ line_type: "booking_revenue", amount: 200_000, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "commission", amount: 40_000, sign: "-", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "channel_commission", amount: 30_000, sign: "-", unit_id: "u-a", unit: UNIT_A }),
        ],
      }),
    ]);
    const u = r.by_unit[0];
    expect(u.commission).toBe(40_000);
    expect(u.channel).toBe(30_000);
    expect(u.expenses).toBe(0); // ninguna de las dos es "gasto"
    expect(u.net).toBe(130_000);
  });

  it("imputa a la única unidad del documento el cargo cargado sin departamento", () => {
    // 44 de las 307 líneas de agosto llegan así; como el documento tiene una
    // sola unidad no hay ambigüedad y adivinarlo es correcto.
    const r = buildSettledResults([
      doc({
        lines: [
          line({ line_type: "booking_revenue", amount: 500_000, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "maintenance_charge", amount: 80_000, sign: "-" }), // sin unit_id
        ],
      }),
    ]);
    expect(r.by_unit).toHaveLength(1);
    expect(r.by_unit[0].unit_id).toBe("u-a");
    expect(r.by_unit[0].expenses).toBe(80_000);
    expect(r.by_unit[0].inferred).toBe(true);
    expect(r.unassigned_net).toBe(0);
  });

  it("con dos unidades NO reparte: el cargo sin departamento queda 'Sin asignar'", () => {
    // Inventar el prorrateo de un gasto entre deptos del mismo dueño es peor
    // que decir que no se sabe.
    const r = buildSettledResults([
      doc({
        lines: [
          line({ line_type: "booking_revenue", amount: 500_000, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "booking_revenue", amount: 300_000, sign: "+", unit_id: "u-b", unit: UNIT_B }),
          line({ line_type: "maintenance_charge", amount: 90_000, sign: "-" }),
        ],
      }),
    ]);
    const sinAsignar = r.by_unit.find((u) => u.unit_id === null);
    expect(sinAsignar).toBeDefined();
    expect(sinAsignar!.expenses).toBe(90_000);
    expect(r.by_unit.find((u) => u.unit_id === "u-a")!.expenses).toBe(0);
    expect(r.by_unit.find((u) => u.unit_id === "u-b")!.expenses).toBe(0);
    expect(r.unassigned_net).toBe(-90_000);
    expect(r.unassigned_settlements).toBe(1);
  });

  it("un depto con dos dueños es UNA fila con los dos nombres", () => {
    // La copropiedad se liquida en un documento por cabeza, pero "cuánto
    // produjo el depto" no depende de entre cuántos se reparta.
    const r = buildSettledResults([
      doc({
        id: "s1",
        owner: { id: "o1", full_name: "Juan Pérez" },
        lines: [line({ line_type: "booking_revenue", amount: 300_000, sign: "+", unit_id: "u-a", unit: UNIT_A })],
      }),
      doc({
        id: "s2",
        owner: { id: "o2", full_name: "Ana Gómez" },
        lines: [line({ line_type: "booking_revenue", amount: 200_000, sign: "+", unit_id: "u-a", unit: UNIT_A })],
      }),
    ]);
    expect(r.by_unit).toHaveLength(1);
    expect(r.by_unit[0].gross).toBe(500_000);
    expect(r.by_unit[0].owners.map((o) => o.owner_name).sort()).toEqual(["Ana Gómez", "Juan Pérez"]);
    expect(r.by_unit[0].settlement_ids).toHaveLength(2);
    // Por propietario siguen siendo dos filas: son dos pagos distintos.
    expect(r.by_owner).toHaveLength(2);
  });

  it("convierte con el tipo de cambio del documento", () => {
    const r = buildSettledResults([
      doc({
        exchange_rates: { USD: 1300 },
        lines: [
          line({ line_type: "booking_revenue", amount: 100, sign: "+", currency: "USD", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "commission", amount: 20, sign: "-", currency: "USD", unit_id: "u-a", unit: UNIT_A }),
        ],
      }),
    ]);
    expect(r.by_unit[0].gross).toBe(130_000);
    expect(r.by_unit[0].commission).toBe(26_000);
    expect(r.missing_rates).toEqual([]);
  });

  it("sin tipo de cambio cuenta 0 pero lo denuncia (el silent-zero no se esconde)", () => {
    const r = buildSettledResults([
      doc({
        exchange_rates: {},
        lines: [
          line({ line_type: "booking_revenue", amount: 500_000, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "booking_revenue", amount: 100, sign: "+", currency: "USD", unit_id: "u-a", unit: UNIT_A }),
        ],
      }),
    ]);
    expect(r.by_unit[0].gross).toBe(500_000); // los USD suman 0
    expect(r.missing_rates).toEqual(["USD"]);
    expect(r.by_owner[0].missing_rates).toEqual(["USD"]);
  });

  it("los totales por moneda cierran con la suma de los propietarios", () => {
    const r = buildSettledResults([
      doc({
        id: "s1",
        paid_at: "2026-09-01T12:00:00Z",
        lines: [
          line({ line_type: "booking_revenue", amount: 400_000, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "commission", amount: 80_000, sign: "-", unit_id: "u-a", unit: UNIT_A }),
        ],
      }),
      doc({
        id: "s2",
        owner: { id: "o2", full_name: "Ana Gómez" },
        lines: [
          line({ line_type: "booking_revenue", amount: 600_000, sign: "+", unit_id: "u-b", unit: UNIT_B }),
          line({ line_type: "cleaning_charge", amount: 20_000, sign: "-", unit_id: "u-b", unit: UNIT_B }),
        ],
      }),
    ]);
    expect(r.totals).toHaveLength(1);
    const t = r.totals[0];
    expect(t.settlements).toBe(2);
    expect(t.paid).toBe(1);
    expect(t.gross).toBe(1_000_000);
    expect(t.commission).toBe(80_000);
    expect(t.expenses).toBe(20_000);
    expect(t.net).toBe(900_000);
    expect(t.net).toBe(r.by_owner.reduce((a, o) => a + o.net, 0));
    expect(t.net).toBe(r.by_unit.reduce((a, u) => a + u.net, 0));
  });

  it("separa los reintegros del alquiler dentro del bruto", () => {
    // El bruto tiene que seguir cuadrando con el `gross_revenue` del documento
    // (divergir del PDF del propietario sería la peor confusión), pero la parte
    // que no es alquiler se informa aparte para no inflar el "produjo".
    const r = buildSettledResults([
      doc({
        lines: [
          line({ line_type: "monthly_rent_fraction", amount: 900_000, sign: "+", unit_id: "u-a", unit: UNIT_A }),
          line({ line_type: "expenses_fraction", amount: 58_714, sign: "+", unit_id: "u-a", unit: UNIT_A }), // LUZ
          line({ line_type: "adjustment", amount: 21_500, sign: "+", unit_id: "u-a", unit: UNIT_A }), // GAS
        ],
      }),
    ]);
    expect(r.by_unit[0].gross).toBe(980_214);
    expect(r.by_unit[0].reimbursements).toBe(80_214);
    expect(r.totals[0].reimbursements).toBe(80_214);
  });

  it("distingue lo ya girado de lo que falta girar", () => {
    // En producción 55 de 56 liquidaciones del mes están en 'revisada': llamar
    // "transferido" al total sería falso en casi todas.
    const r = buildSettledResults([
      doc({
        id: "s1",
        status: "pagada",
        paid_at: "2026-09-01T12:00:00Z",
        lines: [line({ line_type: "booking_revenue", amount: 300_000, sign: "+", unit_id: "u-a", unit: UNIT_A })],
      }),
      doc({
        id: "s2",
        status: "revisada",
        owner: { id: "o2", full_name: "Ana Gómez" },
        lines: [line({ line_type: "booking_revenue", amount: 700_000, sign: "+", unit_id: "u-b", unit: UNIT_B })],
      }),
    ]);
    expect(r.totals[0].net).toBe(1_000_000); // total a girar
    expect(r.totals[0].net_paid).toBe(300_000); // lo que ya salió
    expect(r.totals[0].paid).toBe(1);
    expect(r.totals[0].settlements).toBe(2);
  });

  it("sin liquidaciones devuelve todo vacío, no explota", () => {
    const r = buildSettledResults([]);
    expect(r.totals).toEqual([]);
    expect(r.by_unit).toEqual([]);
    expect(r.by_owner).toEqual([]);
    expect(r.unassigned_net).toBe(0);
  });
});
