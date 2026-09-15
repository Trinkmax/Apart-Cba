import { describe, expect, it } from "vitest";
import {
  groupBookingLines,
  pieceRevenueTotal,
  type GroupableLine,
  type GroupableSettlement,
} from "@/lib/settlements/line-groups";

let seq = 0;
function line(over: Partial<GroupableLine> & Pick<GroupableLine, "line_type" | "amount" | "sign">): GroupableLine {
  seq += 1;
  return {
    id: `l${seq}`,
    currency: "ARS",
    unit_id: "u1",
    ref_type: "booking",
    ref_id: "b1",
    is_manual: false,
    meta: null,
    ...over,
  };
}

function doc(lines: GroupableLine[], over: Partial<GroupableSettlement> = {}): GroupableSettlement {
  return {
    id: "s1",
    owner_id: "o1",
    owner_name: "Juan Pérez",
    status: "revisada",
    period_year: 2026,
    period_month: 8,
    currency: "ARS",
    generated_at: "2026-09-01T12:00:00Z",
    paid_at: null,
    net_payable: 0,
    exchange_rates: {},
    lines,
    ...over,
  };
}

describe("groupBookingLines", () => {
  it("agrupa por ref_id y separa tarifa, reintegros, comisiones y gastos por signo", () => {
    const pieces = groupBookingLines(
      doc([
        line({ line_type: "booking_revenue", amount: 240_000, sign: "+", meta: { check_in: "2026-08-10", check_out: "2026-08-13", guest_name: "Ana" } }),
        line({ line_type: "commission", amount: 48_000, sign: "-" }),
        line({ line_type: "channel_commission", amount: 10_000, sign: "-" }),
        line({ line_type: "cleaning_charge", amount: 5_000, sign: "-" }),
        line({ line_type: "expenses_fraction", amount: 3_000, sign: "+" }), // LUZ reembolsada
        line({ line_type: "maintenance_charge", amount: 50_000, sign: "-", ref_type: "maintenance", ref_id: "t1" }),
      ]),
    );
    expect(pieces).toHaveLength(1);
    const p = pieces[0];
    expect(p.key).toBe("s1:b1");
    expect(p.revenue).toEqual({ ARS: 240_000 });
    expect(p.reimbursements).toBe(3_000);
    expect(p.commission).toBe(48_000);
    expect(p.channel).toBe(10_000);
    expect(p.expenses).toBe(5_000);
    expect(p.net).toBe(180_000);
    expect(p.meta_check_in).toBe("2026-08-10");
    expect(p.guest_name).toBe("Ana");
    expect(p.all_auto).toBe(true);
    expect(p.synthetic).toBe(false);
  });

  it("sintética = meta.source 'manual'; is_manual sólo quita all_auto", () => {
    const [edited] = groupBookingLines(
      doc([line({ line_type: "booking_revenue", amount: 1, sign: "+", is_manual: true, meta: { source: "directo" } })]),
    );
    expect(edited.all_auto).toBe(false);
    expect(edited.synthetic).toBe(false);
    const [manual] = groupBookingLines(
      doc([line({ line_type: "booking_revenue", amount: 1, sign: "+", is_manual: true, meta: { source: "manual" } })]),
    );
    expect(manual.synthetic).toBe(true);
  });

  it("la tarifa queda en moneda nativa; los descuentos se convierten a la moneda de la porción", () => {
    const [p] = groupBookingLines(
      doc(
        [
          line({ line_type: "booking_revenue", amount: 100, sign: "+", currency: "USD" }),
          line({ line_type: "commission", amount: 26_000, sign: "-", currency: "ARS" }),
        ],
        { exchange_rates: { USD: 1300 } },
      ),
    );
    expect(p.currency).toBe("USD");
    expect(p.revenue).toEqual({ USD: 100 });
    expect(p.commission).toBe(20);
    expect(p.net).toBe(80);
    expect(p.missing_rate).toBe(false);
  });

  it("sin tipo de cambio el descuento cuenta 0 y lo marca", () => {
    const [p] = groupBookingLines(
      doc([
        line({ line_type: "booking_revenue", amount: 100, sign: "+", currency: "USD" }),
        line({ line_type: "commission", amount: 26_000, sign: "-", currency: "ARS" }),
      ]),
    );
    expect(p.commission).toBe(0);
    expect(p.missing_rate).toBe(true);
  });

  it("pieceRevenueTotal suma todas las monedas en valor absoluto", () => {
    const [p] = groupBookingLines(
      doc([
        line({ line_type: "booking_revenue", amount: 100, sign: "+", currency: "USD" }),
        line({ line_type: "booking_revenue", amount: 50, sign: "+", currency: "ARS" }),
      ]),
    );
    expect(pieceRevenueTotal(p)).toBe(150);
    const [zero] = groupBookingLines(doc([line({ line_type: "booking_revenue", amount: 0, sign: "+" })]));
    expect(pieceRevenueTotal(zero)).toBe(0);
  });
});
