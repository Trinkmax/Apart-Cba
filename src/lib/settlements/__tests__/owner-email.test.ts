import { describe, it, expect } from "vitest";
import { buildOwnerSettlementEmail } from "../owner-email";
import { buildStatementModel, type StatementInput } from "../statement-model";

/**
 * El mail al propietario: lo primero que lee el dueño. El período del ciclo
 * tiene que estar a la vista, y por depto cuando difieren (migración 074).
 */

const A = "0b6f2d7e-3c1a-4f5e-9a8b-1c2d3e4f5a61";
const B = "0b6f2d7e-3c1a-4f5e-9a8b-1c2d3e4f5a62";

function input(over: Partial<StatementInput> = {}): StatementInput {
  const line = (unitId: string, code: string, name: string, ref: string) => ({
    id: `${ref}-rev`,
    line_type: "monthly_rent_fraction" as const,
    ref_type: "booking",
    ref_id: ref,
    unit_id: unitId,
    description: "Renta",
    amount: 500_000,
    sign: "+" as const,
    unit: { id: unitId, code, name },
  });
  return {
    id: "11111111-2222-3333-4444-555555555555",
    period_year: 2026,
    period_month: 10,
    status: "revisada",
    currency: "ARS",
    gross_revenue: 1_000_000,
    commission_amount: 0,
    deductions_amount: 0,
    net_payable: 1_000_000,
    owner: { full_name: "Carla Alejandra Del Vecchio" },
    lines: [
      line(A, "LIMA", "LIMA", "b1"),
      line(B, "24DESEP", "24 DE SEPTIEMBRE", "b2"),
    ],
    ...over,
  };
}

const base = {
  ownerName: "Carla Alejandra Del Vecchio ",
  net: "$ 1.000.000,00",
  link: "https://www.apartcba.com/liquidacion/abc",
  branding: { name: "Apart CBA", legal_name: null, primary_color: "#0F766E" },
};

describe("buildOwnerSettlementEmail", () => {
  it("por depto: el cuerpo lista el período de cada uno", () => {
    const mail = buildOwnerSettlementEmail({
      ...base,
      model: buildStatementModel(
        input({
          unit_periods: {
            [A]: { index: 2, cycle: 3 },
            [B]: { index: 1, cycle: 3 },
          },
        }),
      ),
    });
    // Sin un período común, el asunto queda con el mes.
    expect(mail.subject).toBe("Liquidación Octubre 2026 · Apart CBA");
    expect(mail.html).toContain("Período por departamento");
    expect(mail.html).toContain("Período del ciclo de ajuste");
    expect(mail.html).toMatch(/<strong>24DESEP<\/strong>.*24 DE SEPTIEMBRE.*Período 1\/3/);
    // Código y nombre iguales ("LIMA · LIMA") no se repiten.
    expect(mail.html).not.toContain("· LIMA</span>");
    expect(mail.html).toContain("Hola Carla,");
    // En el orden del documento (alfabético si nadie lo reordenó).
    expect(mail.text).toContain(
      "Período del ciclo de ajuste:\n  24DESEP: Período 1/3\n  LIMA: Período 2/3",
    );
  });

  it("un período para todo: va en el asunto y no se lista por depto", () => {
    const mail = buildOwnerSettlementEmail({
      ...base,
      model: buildStatementModel(input({ period_index: 3, period_cycle: 3 })),
    });
    expect(mail.subject).toBe("Liquidación Octubre 2026 · Período 3/3 · Apart CBA");
    expect(mail.html).toContain("Período 3/3");
    expect(mail.html).not.toContain("Período del ciclo de ajuste");
    expect(mail.text).not.toContain("Período del ciclo de ajuste");
  });

  it("escapa lo que tipea el staff", () => {
    const mail = buildOwnerSettlementEmail({
      ...base,
      ownerName: "<b>Carla</b>",
      model: (() => {
        const i = input({
          period_note: 'incluye "expensas" & <luz>',
          unit_periods: {
            [A]: { index: 2, cycle: 3 },
            [B]: { index: 1, cycle: 3 },
          },
        });
        i.lines = i.lines.map((l) =>
          l.unit_id === A && l.unit
            ? { ...l, unit: { ...l.unit, code: "<img src=x>" } }
            : l,
        );
        return buildStatementModel(i);
      })(),
    });
    expect(mail.html).not.toContain("<img src=x>");
    expect(mail.html).not.toContain("<b>Carla</b>");
    expect(mail.html).toContain("&lt;img src=x&gt;");
    expect(mail.html).toContain("incluye &quot;expensas&quot; &amp; &lt;luz&gt;");
  });

  it("sin período no muestra chip ni lista", () => {
    const mail = buildOwnerSettlementEmail({
      ...base,
      model: buildStatementModel(input()),
    });
    expect(mail.subject).toBe("Liquidación Octubre 2026 · Apart CBA");
    expect(mail.html).not.toContain("Período");
  });
});
