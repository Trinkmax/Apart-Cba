import { describe, expect, it } from "vitest";
import {
  VAT_PCT,
  commissionAmount,
  computeEntryCosts,
  contractTotalValue,
  type CommissionRule,
  type EntryCostInput,
} from "@/lib/rentals/entry-costs";

const ctx = { monthlyRent: 500000, durationMonths: 24 };
/** Córdoba: honorarios del 5 % del total del contrato, más IVA. */
const cordoba: CommissionRule = { basis: "pct_total_contrato", value: 5, vat: true };

describe("contractTotalValue", () => {
  it("es alquiler × meses a precio inicial (24 × $500.000 = $12.000.000)", () => {
    expect(contractTotalValue(500000, 24)).toBe(12000000);
    expect(contractTotalValue(333333.33, 24)).toBe(7999999.92);
  });

  it("meses fraccionarios se truncan y negativos valen 0", () => {
    expect(contractTotalValue(500000, 24.9)).toBe(12000000);
    expect(contractTotalValue(500000, -3)).toBe(0);
  });
});

describe("commissionAmount", () => {
  it("Córdoba: 5 % de $12.000.000 = $600.000 + IVA 21 % ($126.000) = $726.000", () => {
    expect(VAT_PCT).toBe(21);
    expect(commissionAmount(cordoba, ctx)).toEqual({ net: 600000, vat: 126000, total: 726000 });
  });

  it("sin IVA el total es el neto", () => {
    expect(commissionAmount({ ...cordoba, vat: false }, ctx)).toEqual({ net: 600000, vat: 0, total: 600000 });
  });

  it("porcentajes con decimales (4,15 %) sin error de punto flotante", () => {
    expect(commissionAmount({ basis: "pct_total_contrato", value: 4.15, vat: false }, ctx).net).toBe(498000);
  });

  it("'meses': N meses de alquiler (1,5 meses + IVA)", () => {
    expect(commissionAmount({ basis: "meses", value: 1, vat: false }, ctx)).toEqual({ net: 500000, vat: 0, total: 500000 });
    expect(commissionAmount({ basis: "meses", value: 1.5, vat: true }, ctx)).toEqual({
      net: 750000,
      vat: 157500,
      total: 907500,
    });
  });

  it("'monto_fijo': el importe pactado, con o sin IVA", () => {
    expect(commissionAmount({ basis: "monto_fijo", value: 350000, vat: true }, ctx)).toEqual({
      net: 350000,
      vat: 73500,
      total: 423500,
    });
  });

  it("el IVA se redondea a centavos (333.333,33 × 21 % = 69.999,9993 → 70.000)", () => {
    expect(commissionAmount({ basis: "monto_fijo", value: 333333.33, vat: true }, ctx)).toEqual({
      net: 333333.33,
      vat: 70000,
      total: 403333.33,
    });
  });

  it("sin regla, 'ninguna' o valor 0/negativo: no hay honorarios", () => {
    const zero = { net: 0, vat: 0, total: 0 };
    expect(commissionAmount(null, ctx)).toEqual(zero);
    expect(commissionAmount(undefined, ctx)).toEqual(zero);
    expect(commissionAmount({ basis: "ninguna", value: 5, vat: true }, ctx)).toEqual(zero);
    expect(commissionAmount({ ...cordoba, value: 0 }, ctx)).toEqual(zero);
    expect(commissionAmount({ ...cordoba, value: -5 }, ctx)).toEqual(zero);
  });
});

describe("computeEntryCosts — ¿cuánto tengo que pagar para entrar?", () => {
  const full: EntryCostInput = {
    monthlyRent: 500000,
    durationMonths: 24,
    includeFirstMonth: true,
    deposit: 500000,
    tenantCommission: cordoba,
    ownerCommission: { basis: "pct_total_contrato", value: 2, vat: true },
    stampTax: { ratePct: 0.5, tenantSharePct: 50 },
    otherCosts: [
      { concept: "Certificación de firmas", amount: 15000, payer: "inquilino" },
      { concept: "  Informe de garantía  ", amount: 25000, payer: "inquilino" },
    ],
  };

  it("arma todas las líneas en orden: primer mes, depósito, honorarios, sellado y gastos", () => {
    const r = computeEntryCosts(full);
    expect(r.lines).toEqual([
      { kind: "primer_mes", concept: "Primer mes de alquiler", amount: 500000, payer: "inquilino" },
      { kind: "deposito", concept: "Depósito en garantía", amount: 500000, payer: "inquilino" },
      { kind: "honorarios", concept: "Honorarios inmobiliarios (con IVA)", amount: 726000, payer: "inquilino" },
      { kind: "honorarios", concept: "Honorarios por la locación (con IVA)", amount: 290400, payer: "propietario" },
      { kind: "sellado", concept: "Sellado del contrato (parte inquilino)", amount: 30000, payer: "inquilino" },
      { kind: "sellado", concept: "Sellado del contrato (parte propietario)", amount: 30000, payer: "propietario" },
      { kind: "otro", concept: "Certificación de firmas", amount: 15000, payer: "inquilino" },
      { kind: "otro", concept: "Informe de garantía", amount: 25000, payer: "inquilino" },
    ]);
    expect(r.contractValue).toBe(12000000);
  });

  it("totaliza por quién paga: inquilino $1.796.000, propietario $320.400", () => {
    const r = computeEntryCosts(full);
    expect(r.tenantTotal).toBe(1796000);
    expect(r.ownerTotal).toBe(320400);
  });

  it("el sellado del 0,5 % sobre el valor del contrato se parte mitad y mitad ($60.000 → $30.000 c/u)", () => {
    const r = computeEntryCosts(full);
    const sellado = r.lines.filter((l) => l.kind === "sellado");
    expect(sellado.map((l) => [l.payer, l.amount])).toEqual([
      ["inquilino", 30000],
      ["propietario", 30000],
    ]);
  });
});

describe("computeEntryCosts — variantes", () => {
  const minimal: EntryCostInput = {
    monthlyRent: 500000,
    durationMonths: 24,
    includeFirstMonth: false,
    deposit: 0,
    tenantCommission: null,
    ownerCommission: null,
    stampTax: null,
  };

  it("sin nada que cobrar a la firma no hay líneas", () => {
    expect(computeEntryCosts(minimal)).toEqual({ lines: [], tenantTotal: 0, ownerTotal: 0, contractValue: 12000000 });
  });

  it("primer mes + depósito: lo típico que pide el inquilino", () => {
    const r = computeEntryCosts({ ...minimal, includeFirstMonth: true, deposit: 500000 });
    expect(r.lines.map((l) => l.kind)).toEqual(["primer_mes", "deposito"]);
    expect(r.tenantTotal).toBe(1000000);
    expect(r.ownerTotal).toBe(0);
  });

  it("sin alquiler no hay primer mes aunque se pida", () => {
    const r = computeEntryCosts({ ...minimal, monthlyRent: 0, includeFirstMonth: true });
    expect(r.lines).toEqual([]);
  });

  it("honorarios sin IVA llevan la leyenda sin '(con IVA)'", () => {
    const r = computeEntryCosts({
      ...minimal,
      tenantCommission: { basis: "meses", value: 1, vat: false },
      ownerCommission: { basis: "monto_fijo", value: 100000, vat: false },
    });
    expect(r.lines.map((l) => [l.concept, l.amount, l.payer])).toEqual([
      ["Honorarios inmobiliarios", 500000, "inquilino"],
      ["Honorarios por la locación", 100000, "propietario"],
    ]);
  });

  it("sellado: 100 % inquilino o 100 % propietario genera una sola línea; fuera de rango se acota", () => {
    const at = (tenantSharePct: number) =>
      computeEntryCosts({ ...minimal, stampTax: { ratePct: 0.5, tenantSharePct } }).lines.map((l) => [l.payer, l.amount]);
    expect(at(100)).toEqual([["inquilino", 60000]]);
    expect(at(0)).toEqual([["propietario", 60000]]);
    expect(at(150)).toEqual([["inquilino", 60000]]);
    expect(at(-20)).toEqual([["propietario", 60000]]);
  });

  it("sellado partido: las dos partes suman exactamente el impuesto (el centavo impar va al inquilino)", () => {
    const r = computeEntryCosts({ ...minimal, monthlyRent: 12000002, durationMonths: 1, stampTax: { ratePct: 0.5, tenantSharePct: 50 } });
    const [tenant, owner] = r.lines;
    expect([tenant.amount, owner.amount]).toEqual([30000.01, 30000]);
    expect(tenant.amount + owner.amount).toBeCloseTo(60000.01, 6); // la suma en JS arrastra el error del float
    expect([r.tenantTotal, r.ownerTotal]).toEqual([30000.01, 30000]);
  });

  it("alícuota 0 o sin sellado: no hay líneas de sellado", () => {
    expect(computeEntryCosts({ ...minimal, stampTax: { ratePct: 0, tenantSharePct: 50 } }).lines).toEqual([]);
  });

  it("gastos sueltos: se ignoran los vacíos o en 0, y los del propietario suman a su total", () => {
    const r = computeEntryCosts({
      ...minimal,
      otherCosts: [
        { concept: "   ", amount: 5000, payer: "inquilino" },
        { concept: "Gastos de escribanía", amount: 0, payer: "inquilino" },
        { concept: "Informe de dominio", amount: 18000.555, payer: "propietario" },
      ],
    });
    expect(r.lines).toEqual([{ kind: "otro", concept: "Informe de dominio", amount: 18000.56, payer: "propietario" }]);
    expect(r.ownerTotal).toBe(18000.56);
    expect(r.tenantTotal).toBe(0);
  });
});
