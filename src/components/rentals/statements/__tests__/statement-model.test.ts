import { describe, expect, it } from "vitest";
import {
  buildStatementDoc,
  statementWhatsappText,
  stripPropertySuffix,
  validateSplits,
  type StatementHeaderInput,
  type StatementLineInput,
} from "../statement-model";

const header: StatementHeaderInput = {
  id: "s1",
  number: 12,
  status: "emitida",
  currency: "ARS",
  cutoff_date: "2026-10-31",
  collected_amount: 600000,
  fees_amount: 60000,
  vat_amount: 12600,
  expenses_amount: 20000,
  other_amount: 0,
  net_amount: 507400,
  generated_at: "2026-10-31T15:00:00Z",
  sent_at: null,
  sent_to: null,
  paid_at: null,
  voided_at: null,
  void_reason: null,
  notes: null,
};

const owner = { full_name: "Juan Carlos Pérez", email: "juan@example.com", phone: "3515551234", bank_name: null, cbu: null, alias_cbu: "juan.perez" };

function line(p: Partial<StatementLineInput> & Pick<StatementLineInput, "id" | "line_type" | "amount" | "description">): StatementLineInput {
  return { sign: p.line_type.startsWith("cobro_") ? 1 : -1, contract_id: "c1", property_id: "p1", share_pct: 100, sort_order: 0, ...p };
}

describe("stripPropertySuffix", () => {
  it("saca la dirección repetida con guion largo o punto medio", () => {
    expect(stripPropertySuffix("Alquiler Octubre 2026 — Dean Funes 450 · 3°B", "Dean Funes 450 · 3°B")).toBe("Alquiler Octubre 2026");
    expect(stripPropertySuffix("Honorarios por la locación · C-0007 · Dean Funes 450 · 3°B", "Dean Funes 450 · 3°B")).toBe(
      "Honorarios por la locación · C-0007",
    );
  });
  it("no toca descripciones sin la dirección ni deja el texto vacío", () => {
    expect(stripPropertySuffix("Gasto: canilla", "Dean Funes 450")).toBe("Gasto: canilla");
    expect(stripPropertySuffix(" — Dean Funes 450", "Dean Funes 450")).toBe(" — Dean Funes 450");
    expect(stripPropertySuffix("Algo", null)).toBe("Algo");
  });
});

describe("buildStatementDoc", () => {
  const lines: StatementLineInput[] = [
    line({ id: "l3", line_type: "gasto", amount: 20000, description: "Gasto: canilla", contract_id: null, sort_order: 4 }),
    line({ id: "l2", line_type: "honorarios_administracion", amount: 60000, description: "Honorarios de administración 10 % — Dean Funes 450 · 3°B", sort_order: 2 }),
    line({ id: "l1", line_type: "cobro_alquiler", amount: 600000, description: "Alquiler Octubre 2026 · Período 2/3 — Dean Funes 450 · 3°B", sort_order: 1 }),
    line({ id: "l4", line_type: "iva_honorarios", amount: 12600, description: "IVA 21 % sobre honorarios — Dean Funes 450 · 3°B", sort_order: 3 }),
    line({ id: "l5", line_type: "cobro_alquiler", amount: 150000, description: "Alquiler Octubre 2026 — Bv. San Juan 100", property_id: "p2", contract_id: "c2", share_pct: 50, sort_order: 5 }),
  ];
  const model = buildStatementDoc({
    header,
    lines,
    owner,
    properties: [
      { id: "p1", label: "Dean Funes 450 · 3°B", code: "DF450" },
      { id: "p2", label: "Bv. San Juan 100", code: null },
    ],
    contracts: [
      { id: "c1", number: 7, tenantName: "Ana Gómez" },
      { id: "c2", number: 9, tenantName: null },
    ],
  });

  it("agrupa por propiedad, ordenado por dirección, con cobros primero", () => {
    expect(model.groups.map((g) => g.label)).toEqual(["Bv. San Juan 100", "Dean Funes 450 · 3°B"]);
    const df = model.groups[1];
    expect(df.lines.map((l) => l.id)).toEqual(["l1", "l2", "l4", "l3"]);
    expect(df.lines[0].description).toBe("Alquiler Octubre 2026 · Período 2/3");
    expect(df.contracts).toEqual([{ number: "C-0007", tenantName: "Ana Gómez" }]);
  });

  it("calcula subtotales por propiedad y marca el % de titularidad", () => {
    const df = model.groups[1];
    expect(df.subtotal).toEqual({ collected: 600000, deductions: 92600, net: 507400 });
    expect(df.sharePct).toBeNull();
    expect(model.groups[0].sharePct).toBe(50);
  });

  it("usa los totales de la cabecera y formatea número, período y estado", () => {
    expect(model.number).toBe("0012");
    expect(model.periodLabel).toBe("Octubre 2026");
    expect(model.statusLabel).toBe("Emitida");
    expect(model.totals.net).toBe(507400);
    expect(model.collectedCount).toBe(2);
  });

  it("los renglones sin propiedad van a 'Otros conceptos' al final", () => {
    const m = buildStatementDoc({
      header,
      lines: [line({ id: "x", line_type: "ajuste", amount: 100, description: "Ajuste manual", property_id: null, contract_id: null }), lines[2]],
      owner,
      properties: [{ id: "p1", label: "Dean Funes 450 · 3°B", code: null }],
      contracts: [],
    });
    expect(m.groups.map((g) => g.key)).toEqual(["p1", "general"]);
    expect(m.groups[1].label).toBe("Otros conceptos");
  });
});

describe("statementWhatsappText", () => {
  it("saluda por el nombre, dice el neto y pega el link, sin emojis", () => {
    const m = buildStatementDoc({ header, lines: [], owner, properties: [], contracts: [] });
    const text = statementWhatsappText(m, "https://x.test/rendicion/abc", "Inmobiliaria Centro");
    expect(text).toContain("Hola Juan,");
    expect(text).toContain("N° 0012");
    expect(text).toContain("Neto a transferirte");
    expect(text).toContain("https://x.test/rendicion/abc");
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });
  it("no promete transferencia cuando el neto es negativo o cero", () => {
    const neg = buildStatementDoc({ header: { ...header, net_amount: -5000 }, lines: [], owner, properties: [], contracts: [] });
    const negText = statementWhatsappText(neg, "u", "Org");
    expect(negText).toContain("a tu cargo");
    expect(negText).toContain("próxima rendición");
    expect(negText).not.toContain("transferido");
    const zero = buildStatementDoc({ header: { ...header, net_amount: 0 }, lines: [], owner, properties: [], contracts: [] });
    expect(statementWhatsappText(zero, "u", "Org")).toContain("no hay saldo");
  });
  it("una rendición cerrada con saldo a cuenta se muestra «Cerrada», nunca «Pagada»", () => {
    const closed = buildStatementDoc({ header: { ...header, status: "pagada", net_amount: -5000 }, lines: [], owner, properties: [], contracts: [] });
    expect(closed.statusLabel).toBe("Cerrada");
    const closedZero = buildStatementDoc({ header: { ...header, status: "pagada", net_amount: 0 }, lines: [], owner, properties: [], contracts: [] });
    expect(closedZero.statusLabel).toBe("Cerrada");
    const paid = buildStatementDoc({ header: { ...header, status: "pagada", net_amount: 1000 }, lines: [], owner, properties: [], contracts: [] });
    expect(paid.statusLabel).toBe("Pagada");
    const open = buildStatementDoc({ header: { ...header, status: "emitida", net_amount: -5000 }, lines: [], owner, properties: [], contracts: [] });
    expect(open.statusLabel).toBe("Emitida");
  });
});

describe("validateSplits", () => {
  it("acepta un pago dividido que suma el neto (tolerancia de un centavo)", () => {
    expect(validateSplits([{ accountId: "a", amount: 300000 }, { accountId: "b", amount: 207400.005 }], 507400).ok).toBe(true);
  });
  it("rechaza cuentas repetidas, importes vacíos y sumas distintas", () => {
    expect(validateSplits([], 100).ok).toBe(false);
    expect(validateSplits([{ accountId: "a", amount: 50 }, { accountId: "a", amount: 50 }], 100)).toMatchObject({ ok: false });
    expect(validateSplits([{ accountId: "a", amount: null }], 100)).toMatchObject({ ok: false });
    expect(validateSplits([{ accountId: "", amount: 100 }], 100)).toMatchObject({ ok: false });
    const short = validateSplits([{ accountId: "a", amount: 90 }], 100);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toContain("Faltan asignar");
    const over = validateSplits([{ accountId: "a", amount: 120 }], 100);
    if (!over.ok) expect(over.error).toContain("Te pasaste");
  });
});
