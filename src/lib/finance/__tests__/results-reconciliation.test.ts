import { describe, expect, it } from "vitest";
import {
  collectLookups,
  extraChargePeriod,
  reconcileMonth,
  settlementWindow,
  type ReconcileInput,
  type ReconciledMonth,
  type ReconciledRow,
  type ResultBookingInput,
  type UnitInput,
} from "@/lib/finance/results-reconciliation";
import { periodIndex } from "@/lib/finance/prorate";
import type { GroupableLine, GroupableSettlement } from "@/lib/settlements/line-groups";
import { buildSettledResults } from "@/lib/settlements/settled-model";

/**
 * Casos de la spec §6. Los nombres (SAL525, VEL727, TREJO2…) son las reservas
 * reales del forense de Apart CBA jun–sep 2026: cada caso reproduce una forma
 * que tienen los datos y que una conciliación ingenua clasificaría mal.
 * "ref" = porción emparejada por `ref_id`; "sint." = fila creada a mano
 * (`meta.source='manual'`, `ref_id` aleatorio).
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

function booking(over: Partial<ResultBookingInput> & Pick<ResultBookingInput, "id" | "check_in_date" | "check_out_date">): ResultBookingInput {
  return {
    unit_id: "u1",
    lease_group_id: null,
    guest_name: "Huésped",
    source: "directo",
    status: "confirmada",
    mode: "temporario",
    currency: "ARS",
    total_amount: 0,
    paid_amount: 0,
    cleaning_fee: null,
    commission_pct: null,
    channel_commission_pct: null,
    monthly_rent: null,
    monthly_expenses: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function unit(id: string, code: string, owners: Array<[string, number | null]> = [["o1", 100]]): UnitInput {
  return {
    id,
    code,
    name: `Depto ${code}`,
    owners: owners.map(([owner_id, pct]) => ({ owner_id, owner_name: `Dueño ${owner_id}`, ownership_pct: pct })),
  };
}

let lineSeq = 0;
interface LineOpts {
  /** null = línea sin unidad (gasto cargado a mano sin departamento). */
  unit?: string | null;
  currency?: string;
  manual?: boolean;
  /** Fila sintética con estas fechas de meta. */
  synthetic?: { ci: string | null; co: string | null };
  /** Fechas en `meta` de una fila NO sintética (p. ej. reescritas en el editor). */
  dates?: { ci: string; co: string };
  prorate?: number;
  type?: GroupableLine["line_type"];
}

function rev(ref: string, amount: number, o: LineOpts = {}): GroupableLine {
  lineSeq += 1;
  return {
    id: `l${lineSeq}`,
    line_type: o.type ?? "booking_revenue",
    amount,
    sign: "+",
    currency: o.currency ?? "ARS",
    unit_id: o.unit ?? "u1",
    ref_type: "booking",
    ref_id: ref,
    is_manual: !!o.manual || !!o.synthetic,
    meta: o.synthetic
      ? { source: "manual", check_in: o.synthetic.ci, check_out: o.synthetic.co, guest_name: "Fila manual" }
      : {
          source: "directo",
          prorate_days: o.prorate ?? null,
          ...(o.dates ? { check_in: o.dates.ci, check_out: o.dates.co } : {}),
        },
  };
}

function ded(ref: string | null, amount: number, o: LineOpts & { refType?: string | null } = {}): GroupableLine {
  lineSeq += 1;
  return {
    id: `l${lineSeq}`,
    line_type: o.type ?? "commission",
    amount,
    sign: "-",
    currency: o.currency ?? "ARS",
    unit_id: o.unit === undefined ? "u1" : o.unit,
    ref_type: o.refType === undefined ? "booking" : o.refType,
    ref_id: ref,
    is_manual: !!o.manual || !!o.synthetic,
    meta: null,
  };
}

function sdoc(
  id: string,
  owner: string,
  year: number,
  month: number,
  lines: GroupableLine[],
  over: Partial<GroupableSettlement> = {},
): GroupableSettlement {
  return {
    id,
    owner_id: owner,
    owner_name: `Dueño ${owner}`,
    status: "revisada",
    period_year: year,
    period_month: month,
    currency: "ARS",
    generated_at: `${year}-${String(month).padStart(2, "0")}-28T12:00:00Z`,
    paid_at: null,
    net_payable: 0,
    exchange_rates: {},
    lines,
    ...over,
  };
}

function input(over: Partial<ReconcileInput> & Pick<ReconcileInput, "year" | "month">): ReconcileInput {
  return {
    mode: "todos",
    org: {
      base_currency: "ARS",
      commission_base: "gross",
      channel_commissions: {},
      commission_by_source: {},
      default_commission_pct: 20,
    },
    bookings: [],
    candidates: [],
    refLookups: [],
    units: [unit("u1", "U1")],
    settlements: [],
    extraCharges: [],
    firstSettlementPeriod: null,
    ...over,
  };
}

function rowOf(res: ReconciledMonth, bookingId: string): ReconciledRow {
  const r = res.rows.find((x) => x.primary_booking_id === bookingId || x.booking_ids.includes(bookingId));
  if (!r) throw new Error(`sin fila para ${bookingId}`);
  return r;
}

const codes = (r: ReconciledRow) => r.issues.map((i) => i.code);

// ── Mensuales ────────────────────────────────────────────────────────────────

describe("mensual", () => {
  it("P2: tramo consistente de 31 noches → G desde la renta, coincide sin 3,3% falso", () => {
    const b = booking({
      id: "m1",
      mode: "mensual",
      check_in_date: "2026-08-01",
      check_out_date: "2026-09-01",
      monthly_rent: 900_000,
      total_amount: 930_000, // 900.000 / 30 × 31
    });
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [b],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("m1", 900_000, { type: "monthly_rent_fraction", prorate: 31 }), ded("m1", 180_000)])],
      }),
    );
    const r = rowOf(res, "m1");
    expect(r.guest_total).toBe(900_000);
    expect(r.outcome).toBe("coincide");
    expect(r.settled?.rate_diff).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.prorate).toEqual({ nights: 31, of: 31 });
  });

  it("P3: porción automática con prorate_days 29 en un mes de 30 noches → prorrateo_viejo; en borrador, regenerala (la generación ya cuenta bien)", () => {
    const b = booking({
      id: "m1",
      mode: "mensual",
      check_in_date: "2026-09-01",
      check_out_date: "2026-10-01",
      monthly_rent: 900_000,
      total_amount: 900_000,
    });
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        bookings: [b],
        settlements: [sdoc("s9", "o1", 2026, 9, [rev("m1", 870_000, { type: "monthly_rent_fraction", prorate: 29 })], { status: "borrador" })],
      }),
    );
    const r = rowOf(res, "m1");
    expect(codes(r)).toContain("prorrateo_viejo");
    const issue = r.issues.find((i) => i.code === "prorrateo_viejo")!;
    expect(issue.detail).toBe("Se liquidaron 29 días y el mes tiene 30 noches ocupadas. Está en borrador: regenerala.");
    expect(issue.group).toBe("prorrateo_mensual");
    expect(r.settled?.rate_diff).toBeNull();
    expect(r.outcome).toBe("sin_conciliar");
    expect(r.parts.unreconciled).toBe(900_000);
  });

  it("P3b: prorrateo mal contado + reserva editada después de generar → solo prorrateo_viejo (no 'desactualizada')", () => {
    const b = booking({
      id: "m1",
      mode: "mensual",
      check_in_date: "2026-09-01",
      check_out_date: "2026-10-01",
      monthly_rent: 900_000,
      total_amount: 900_000,
      updated_at: "2026-09-10T12:00:00Z",
    });
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        bookings: [b],
        settlements: [
          sdoc("s9", "o1", 2026, 9, [rev("m1", 870_000, { type: "monthly_rent_fraction", prorate: 29 })], {
            status: "borrador",
            generated_at: "2026-09-02T12:00:00Z",
          }),
        ],
      }),
    );
    const r = rowOf(res, "m1");
    expect(codes(r)).toContain("prorrateo_viejo");
    expect(codes(r)).not.toContain("liquidacion_vieja");
    expect(r.issues[0].code).toBe("prorrateo_viejo");
    expect(r.issues[0].detail.endsWith("Está en borrador: regenerala.")).toBe(true);
    expect(res.review.map((i) => i.id)).not.toContain("liquidacion_desactualizada");
  });

  it("R19 BSAS1: renta 1,00 contra total 1.415.700 → G desde el total, renta_inconsistente, sin importe_sospechoso", () => {
    const b = booking({
      id: "bsas1",
      mode: "mensual",
      check_in_date: "2026-09-01",
      check_out_date: "2026-10-01",
      monthly_rent: 1,
      total_amount: 1_415_700,
    });
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        bookings: [b],
        settlements: [sdoc("s9", "o1", 2026, 9, [rev("bsas1", 0.97, { type: "monthly_rent_fraction", prorate: 30 })])],
      }),
    );
    const r = rowOf(res, "bsas1");
    expect(r.guest_total).toBe(1_415_700); // × 30/30
    expect(codes(r)).toContain("renta_inconsistente");
    expect(codes(r)).not.toContain("importe_sospechoso"); // 47.190 por noche
    expect(r.settled?.rate_diff).toBeNull();
  });

  it("R20 ORO: 214 noches con 30 en septiembre → G prorrateado del total y Cobrado con tope en G", () => {
    const b = booking({
      id: "oro",
      mode: "mensual",
      check_in_date: "2026-06-01",
      check_out_date: "2027-01-01", // 214 noches
      monthly_rent: 1_039_000,
      total_amount: 1_039_000,
      paid_amount: 3_117_000,
    });
    const res = reconcileMonth(input({ year: 2026, month: 9, bookings: [b] }));
    const r = rowOf(res, "oro");
    expect(codes(r)).toContain("renta_inconsistente");
    expect(r.guest_total).toBe(145_654.21);
    expect(r.paid).toBe(145_654.21); // min(145.654,21; 436.962,62)
    expect(r.pending).toBe(0);
  });
});

// ── Temporarios: conciliados ─────────────────────────────────────────────────

describe("temporario conciliado", () => {
  it("R1 pedido del dueño: paga 80.000, se rinde sobre 70.000", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [booking({ id: "b1", check_in_date: "2026-08-10", check_out_date: "2026-08-12", total_amount: 80_000, paid_amount: 80_000 })],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("b1", 70_000, { manual: true }), ded("b1", 14_000, { manual: true })])],
      }),
    );
    const r = rowOf(res, "b1");
    const s = r.settled!;
    expect(s.rate_diff).toBe(10_000);
    expect(s.rate_diff_pct).toBe(12.5);
    expect(s.owner_net).toBe(56_000);
    const t = res.totals[0];
    expect(t.admin_income).toBe(24_000);
    // Tarifa del propietario en el flujo: C + (E − Reint) + N = R − P_liq
    expect(t.settled.commission + t.settled.expenses_net + t.settled.owner_net).toBe(70_000);
    // Identidad: G_cov = P_cov + D + C + (E − Reint) + N
    expect(s.channel + s.rate_diff! + s.commission + (s.expenses - s.reimbursements) + s.owner_net).toBe(80_000);
  });

  it("R2 SAL525: 270.000 → 240.000 es diferencia de tarifa, no un aviso", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        units: [unit("u1", "SAL525")],
        bookings: [booking({ id: "sal", check_in_date: "2026-08-10", check_out_date: "2026-08-13", total_amount: 270_000, paid_amount: 270_000 })],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("sal", 240_000, { manual: true }), ded("sal", 48_000, { manual: true })])],
      }),
    );
    const r = rowOf(res, "sal");
    expect(r.outcome).toBe("diferencia");
    expect(r.settled?.rate_diff).toBe(30_000);
    expect(r.settled?.rate_diff_pct).toBeCloseTo(11.1, 1);
    expect(r.level).toBe("ok");
  });

  it("V3 CAS1083: 3.060.000 liquidada sobre 900.000 (71%) queda para revisar y no suma al margen", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        units: [unit("u1", "CAS1083")],
        bookings: [booking({ id: "cas", check_in_date: "2026-08-01", check_out_date: "2026-08-18", total_amount: 3_060_000, paid_amount: 3_060_000 })],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("cas", 900_000, { manual: true }), ded("cas", 180_000, { manual: true })])],
      }),
    );
    const r = rowOf(res, "cas");
    expect(codes(r)).toEqual(["diferencia_alta"]);
    expect(r.outcome).toBe("sin_conciliar");
    expect(r.settled?.rate_diff).toBeNull();
    expect(r.issues[0].at_stake).toBe(2_160_000);
    expect(r.issues[0].detail).toContain("71%");
    const t = res.totals.find((x) => x.currency === "ARS")!;
    expect(t.settled.rate_diff).toBe(0);
    expect(t.admin_income).toBe(0);
  });

  it("V3b una diferencia del 40% sigue siendo diferencia de tarifa", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        units: [unit("u1", "U1")],
        bookings: [booking({ id: "b40", check_in_date: "2026-08-10", check_out_date: "2026-08-12", total_amount: 100_000, paid_amount: 100_000 })],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("b40", 60_000, { manual: true }), ded("b40", 12_000, { manual: true })])],
      }),
    );
    const r = rowOf(res, "b40");
    expect(codes(r)).toEqual([]);
    expect(r.outcome).toBe("diferencia");
    expect(r.settled?.rate_diff).toBe(40_000);
  });

  it("R3 co-propiedad 50/50: dos porciones, fila liquidada y diferencia 0 por dueño", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        units: [unit("u1", "U1", [["A", 50], ["B", 50]])],
        bookings: [booking({ id: "b1", check_in_date: "2026-08-10", check_out_date: "2026-08-12", total_amount: 80_000 })],
        settlements: [
          sdoc("sA", "A", 2026, 8, [rev("b1", 40_000), ded("b1", 8_000)]),
          sdoc("sB", "B", 2026, 8, [rev("b1", 40_000), ded("b1", 8_000)]),
        ],
      }),
    );
    const r = rowOf(res, "b1");
    expect(r.coverage).toBe("liquidada");
    expect(r.outcome).toBe("coincide");
    expect(r.owners.find((o) => o.owner_id === "A")?.rate_diff).toBe(0);
    expect(r.owners.find((o) => o.owner_id === "B")?.rate_diff).toBe(0);
  });

  it("R21 airbnb: sin % de canal la diferencia no se lee; con 15% coincide", () => {
    const b = booking({ id: "air", source: "airbnb", check_in_date: "2026-08-10", check_out_date: "2026-08-14", total_amount: 425_000 });
    const sinPct = reconcileMonth(
      input({ year: 2026, month: 8, bookings: [b], settlements: [sdoc("s8", "o1", 2026, 8, [rev("air", 373_500)])] }),
    );
    const r1 = rowOf(sinPct, "air");
    expect(codes(r1)).toContain("canal_sin_comision");
    expect(r1.settled?.rate_diff).toBeNull();
    expect(sinPct.channels_without_pct).toEqual(["airbnb"]);

    const conPct = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        org: { base_currency: "ARS", commission_base: "gross", channel_commissions: { airbnb: 15 } },
        bookings: [b],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("air", 361_250)])],
      }),
    );
    const r2 = rowOf(conPct, "air");
    expect(r2.channel_commission).toBe(63_750);
    expect(r2.settled?.rate_diff).toBe(0);
    expect(r2.outcome).toBe("coincide");
  });

  it("R25 ANDES1: liquidada sin cobro → saldo_huesped y el ítem del panel", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        bookings: [booking({ id: "andes", check_in_date: "2026-09-01", check_out_date: "2026-09-05", total_amount: 505_435, paid_amount: 0 })],
        settlements: [sdoc("s9", "o1", 2026, 9, [rev("andes", 505_435)])],
      }),
    );
    const r = rowOf(res, "andes");
    expect(r.flags).toContain("saldo_huesped");
    const item = res.review.find((i) => i.id === "saldo_huesped");
    expect(item?.label).toBe("Liquidadas con saldo del huésped");
    expect(item?.count).toBe(1);
  });
});

// ── Avisos ───────────────────────────────────────────────────────────────────

describe("avisos por fila", () => {
  it("R4 VEL727: dueños al 100% + 100% → participaciones, D nula, sin tocar el margen", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        units: [unit("u1", "VEL727", [["A", 100], ["B", 100]])],
        bookings: [booking({ id: "vel", check_in_date: "2026-09-01", check_out_date: "2026-09-04", total_amount: 340_000 })],
        settlements: [
          sdoc("sA", "A", 2026, 9, [rev("vel", 340_000)]),
          sdoc("sB", "B", 2026, 9, [rev("vel", 340_000)]),
        ],
      }),
    );
    const r = rowOf(res, "vel");
    const issue = r.issues.find((i) => i.code === "participaciones")!;
    expect(issue.detail).toBe("Las participaciones de VEL727 suman 200%.");
    expect(issue.at_stake).toBe(340_000);
    expect(r.settled?.rate_diff).toBeNull();
    expect(res.totals[0].settled.rate_diff).toBe(0);
    expect(res.totals[0].settled.bookings).toBe(0);
    // Las partes siguen cerrando contra G aunque el % esté mal cargado.
    expect(r.parts.settled + r.parts.estimated + r.parts.unreconciled).toBe(340_000);
  });

  it("R5 50/50 con un solo dueño liquidado: parcial, coincide sobre lo cubierto y falta_en_liquidacion", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        units: [unit("u1", "U1", [["A", 50], ["B", 50]])],
        bookings: [booking({ id: "b1", check_in_date: "2026-08-10", check_out_date: "2026-08-15", total_amount: 700_000 })],
        settlements: [
          sdoc("sA", "A", 2026, 8, [rev("b1", 350_000)]),
          // B tiene liquidación de agosto, pero sin esta reserva.
          sdoc("sB", "B", 2026, 8, [ded(null, 20_000, { type: "maintenance_charge", refType: "maintenance" })]),
        ],
      }),
    );
    const r = rowOf(res, "b1");
    expect(r.coverage).toBe("parcial");
    expect(r.covered_pct).toBe(50);
    expect(r.outcome).toBe("coincide");
    expect(r.settled?.rate_diff).toBe(0);
    const falta = r.issues.find((i) => i.code === "falta_en_liquidacion")!;
    expect(falta.at_stake).toBe(350_000);
    expect(falta.href).toBe("/dashboard/liquidaciones/sB");
    expect(r.parts).toEqual({ settled: 350_000, estimated: 350_000, unreconciled: 0 });
  });

  it("R6 TREJO2: reserva en USD liquidada dos veces en pesos → moneda_distinta + posible_doble, fuera de los totales", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [
          booking({ id: "trejo", currency: "USD", check_in_date: "2026-07-13", check_out_date: "2026-08-13", total_amount: 593.64 }),
        ],
        settlements: [
          sdoc("s7", "o1", 2026, 7, [rev("rnd-trejo", 930_000, { synthetic: { ci: "2026-07-13", co: "2026-08-13" } })]),
          sdoc("s8", "o1", 2026, 8, [rev("trejo", 950_000, { manual: true })]),
        ],
      }),
    );
    const r = rowOf(res, "trejo");
    expect(codes(r)).toEqual(expect.arrayContaining(["moneda_distinta", "posible_doble"]));
    // Está en la liquidación (en pesos): no es "en $0".
    expect(codes(r)).not.toContain("cobrada_no_liquidada");
    expect(r.settled?.rate_diff).toBeNull();
    expect(r.settled?.owner_rate_other).toEqual({ currency: "ARS", amount: 1_880_000 });
    expect(r.excluded_from_totals).toBe(true);
    const usd = res.totals.find((t) => t.currency === "USD")!;
    expect(usd.excluded_bookings).toBe(1);
    // Sin reservas incluidas: la UI no muestra la línea compacta de USD.
    expect(usd.bookings).toBe(0);
  });

  it("V1 CAS3 (datos reales ago 2026): reserva ARS de airbnb liquidada en USD → sólo moneda_distinta", () => {
    // Regresión: con R en la moneda de la reserva = 0 saltaban también
    // cobrada_no_liquidada ("está en $0", falso) y canal_sin_comision (D_calc
    // restaba pesos de dólares), e inflaban el "en juego" del panel en ARS.
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [
          booking({ id: "cas3", source: "airbnb", check_in_date: "2026-08-01", check_out_date: "2026-08-31", total_amount: 1_005_882.35 }),
        ],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("cas3", 650, { currency: "USD", manual: true })])],
      }),
    );
    const r = rowOf(res, "cas3");
    expect(codes(r)).toEqual(["moneda_distinta"]);
    expect(r.issues[0].at_stake).toBe(650);
    expect(r.issues[0].at_stake_currency).toBe("USD");
    expect(r.excluded_from_totals).toBe(true);
    expect(res.review.find((i) => i.id === "falta_liquidar")).toBeUndefined();
    const canal = res.review.find((i) => i.id === "canal");
    expect(canal?.at_stake ?? []).toEqual([]);
  });

  it("V2 DF-3 (datos reales sep 2026): fila manual de agosto + automática de septiembre en $0 → sin posible_doble", () => {
    // Regresión: la fila en $0 contaba como segunda liquidación ("¿liquidada dos
    // veces?") y el mismo 1.350.000 quedaba en juego en dos grupos del panel.
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        bookings: [booking({ id: "df3", check_in_date: "2026-08-24", check_out_date: "2026-09-30", total_amount: 0 })],
        settlements: [
          sdoc("s8", "o1", 2026, 8, [rev("rnd-df3", 1_350_000, { synthetic: { ci: "2026-08-24", co: "2026-09-30" } })]),
          sdoc("s9", "o1", 2026, 9, [rev("df3", 0)]),
        ],
      }),
    );
    const r = rowOf(res, "df3");
    expect(r.pieces).toHaveLength(2);
    expect(r.settled?.owner_rate).toBe(1_350_000);
    expect(codes(r)).toEqual(["sin_precio"]);
    expect(res.review.find((i) => i.id === "liquidado_de_mas")).toBeUndefined();
  });

  it("R7 DIVA: 241,53 pesos por 3 noches → importe_sospechoso y fuera de los totales ARS", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [booking({ id: "diva", source: "airbnb", check_in_date: "2026-08-10", check_out_date: "2026-08-13", total_amount: 241.53 })],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("diva", 380_000, { manual: true })])],
      }),
    );
    const r = rowOf(res, "diva");
    const issue = r.issues.find((i) => i.code === "importe_sospechoso")!;
    expect(issue.detail).toContain("241,53 por 3 noches: ¿son dólares cargados en pesos?");
    expect(r.excluded_from_totals).toBe(true);
    const ars = res.totals.find((t) => t.currency === "ARS")!;
    expect(ars.excluded_bookings).toBe(1);
    expect(ars.guest_total).toBe(0);
  });

  it("R8 TERRA: calendario en $0 con 1.100.000 liquidados → sin_precio", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [booking({ id: "terra", check_in_date: "2026-08-01", check_out_date: "2026-08-20", total_amount: 0 })],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("terra", 1_100_000, { manual: true })])],
      }),
    );
    const r = rowOf(res, "terra");
    const issue = r.issues.find((i) => i.code === "sin_precio")!;
    expect(issue.at_stake).toBe(1_100_000);
    expect(r.settled?.rate_diff).toBeNull();
    expect(res.missing_price_count).toBe(1);
    expect(r.level).toBe("revisar");
  });

  it("R9 ITU airbnb: cobrada 310.000 y en la liquidación en 0 → Falta en la liquidación", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [
          booking({ id: "itu", source: "airbnb", check_in_date: "2026-08-10", check_out_date: "2026-08-14", total_amount: 310_000, paid_amount: 310_000 }),
        ],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("itu", 0, { manual: true })])],
      }),
    );
    const r = rowOf(res, "itu");
    expect(codes(r)).toContain("cobrada_no_liquidada");
    expect(r.issues[0].group).toBe("falta_liquidar");
    expect(r.settled?.rate_diff).toBeNull();
  });

  it("R10 QUIROS1: línea automática en 0 de una reserva que se completó después → liquidación vieja", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        org: { base_currency: "ARS", commission_base: "gross", channel_commissions: { booking: 15 } },
        bookings: [
          booking({
            id: "quiros",
            source: "booking",
            check_in_date: "2026-09-03",
            check_out_date: "2026-09-08",
            total_amount: 526_748,
            updated_at: "2026-09-10T15:00:00Z",
          }),
        ],
        settlements: [
          sdoc("s9", "o1", 2026, 9, [rev("quiros", 0)], { status: "borrador", generated_at: "2026-09-02T12:00:00Z" }),
        ],
      }),
    );
    const r = rowOf(res, "quiros");
    expect(codes(r)).toEqual(["liquidacion_vieja", "cobrada_no_liquidada"]);
    expect(r.issues[0].group).toBe("liquidacion_desactualizada");
    expect(r.issues[0].detail.endsWith("Está en borrador: regenerala.")).toBe(true);
  });

  it("R12 tipo SARA: fila manual del mes anterior + la automática → liquidado de más, fuera del margen", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [booking({ id: "sara", check_in_date: "2026-07-20", check_out_date: "2026-08-20", total_amount: 900_000 })],
        settlements: [
          sdoc("s7", "o1", 2026, 7, [
            rev("rnd-sara", 900_000, { synthetic: { ci: "2026-07-20", co: "2026-08-20" } }),
            ded("rnd-sara", 180_000, { manual: true }),
          ]),
          sdoc("s8", "o1", 2026, 8, [rev("sara", 900_000), ded("sara", 180_000)]),
        ],
      }),
    );
    const r = rowOf(res, "sara");
    expect(codes(r)).toEqual(expect.arrayContaining(["liquidado_de_mas", "posible_doble"]));
    expect(r.outcome).toBe("liquidado_de_mas");
    expect(r.settled?.rate_diff).toBe(-900_000);
    expect(res.totals[0].overpaid.excess).toBe(900_000);
    expect(res.totals[0].settled.rate_diff).toBe(0);
  });

  it("R15 RONDEAU1: fila manual en $0 que solapa 6 reservas no liquida la ganadora", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        bookings: [
          booking({ id: "r-a", check_in_date: "2026-09-01", check_out_date: "2026-09-16", total_amount: 270_000 }),
          booking({ id: "r-b", check_in_date: "2026-09-16", check_out_date: "2026-09-18", total_amount: 40_000 }),
          booking({ id: "r-c", check_in_date: "2026-09-18", check_out_date: "2026-09-21", total_amount: 60_000 }),
          booking({ id: "r-d", check_in_date: "2026-09-21", check_out_date: "2026-09-24", total_amount: 60_000 }),
          booking({ id: "r-e", check_in_date: "2026-09-24", check_out_date: "2026-09-27", total_amount: 60_000 }),
          booking({ id: "r-f", check_in_date: "2026-09-27", check_out_date: "2026-09-30", total_amount: 60_000 }),
        ],
        settlements: [
          sdoc("s9", "o1", 2026, 9, [rev("rnd-entrega", 0, { synthetic: { ci: "2026-09-01", co: "2026-09-30" } })]),
        ],
      }),
    );
    const r = rowOf(res, "r-a"); // 15 de 29 noches = 52%
    expect(r.coverage).toBe("sin_liquidar");
    expect(codes(r)).toContain("falta_en_liquidacion");
    expect(codes(r)).not.toContain("cobrada_no_liquidada");
    expect(r.flags).toContain("pieza_en_cero");
    expect(res.orphans).toEqual([]);
  });

  it("R23 DF-3: estadía larga que empezó antes de la primera liquidación → historia_incompleta, nivel ok", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 6,
        firstSettlementPeriod: periodIndex(2026, 5),
        bookings: [
          booking({ id: "df3", check_in_date: "2026-03-30", check_out_date: "2026-06-30", total_amount: 3_986_667, paid_amount: 3_500_000 }),
        ],
        settlements: [
          sdoc("s5", "o1", 2026, 5, [rev("rnd-df3", 1_104_000, { synthetic: { ci: "2026-04-30", co: "2026-05-30" } })]),
        ],
      }),
    );
    const r = rowOf(res, "df3");
    expect(r.flags).toContain("historia_incompleta");
    expect(r.settled?.rate_diff).toBeNull();
    expect(r.outcome).toBe("sin_conciliar");
    expect(r.issues).toEqual([]);
    expect(r.level).toBe("ok");
  });

  it("R24 unidad sin propietario: sin_propietario y fila 'Sin propietario' al 100% sin NaN", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 6,
        units: [unit("u1", "TEST", [])],
        bookings: [booking({ id: "test", check_in_date: "2026-06-10", check_out_date: "2026-06-12", total_amount: 60_000 })],
      }),
    );
    const r = rowOf(res, "test");
    expect(codes(r)).toContain("sin_propietario");
    const owner = res.by_owner.find((o) => o.owner_id === null)!;
    expect(owner.label).toBe("Sin propietario");
    expect(owner.guest_total).toBe(60_000);
    expect(r.owners[0].share_pct).toBe(100);
    expect(JSON.stringify(res)).not.toMatch(/NaN|Infinity/);
    const numbers: number[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "number") numbers.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(res);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });
});

// ── Varios meses y filas sintéticas ──────────────────────────────────────────

describe("emparejamiento por fechas", () => {
  it("R11 CAMPILLO: adelantada con fila manual en junio, línea real de julio en 0 → coincide", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 7,
        bookings: [booking({ id: "camp", check_in_date: "2026-06-25", check_out_date: "2026-07-02", total_amount: 280_000 })],
        settlements: [
          sdoc("s6", "o1", 2026, 6, [rev("rnd-camp", 280_000, { synthetic: { ci: "2026-06-25", co: "2026-07-02" } })]),
          sdoc("s7", "o1", 2026, 7, [rev("camp", 0, { manual: true })]),
        ],
      }),
    );
    const r = rowOf(res, "camp");
    expect(r.settled?.owner_rate).toBe(280_000);
    expect(r.outcome).toBe("coincide");
    expect(r.flags).toEqual(expect.arrayContaining(["por_fechas", "varios_periodos"]));
    expect(codes(r)).not.toContain("posible_doble");
  });

  it("R13 IND1446: la fila de mayo es de la reserva de junio y suma en una sola vista", () => {
    const b1 = booking({ id: "ind-a", check_in_date: "2026-05-13", check_out_date: "2026-05-14", total_amount: 40_000 });
    const b2 = booking({ id: "ind-b", check_in_date: "2026-05-14", check_out_date: "2026-06-13", total_amount: 1_100_000 });
    const may = sdoc("s5", "o1", 2026, 5, [rev("rnd-ind", 1_000_000, { synthetic: { ci: "2026-05-13", co: "2026-06-13" } })]);

    const vMay = reconcileMonth(input({ year: 2026, month: 5, bookings: [b1, b2], candidates: [b1, b2], settlements: [may] }));
    expect(rowOf(vMay, "ind-a").pieces).toEqual([]);
    expect(vMay.orphans).toEqual([]);
    const bridgeMay = vMay.bridges.find((b) => b.owner_id === "o1")!;
    expect(bridgeMay.other_month_rows_net).toBe(1_000_000);

    const vJun = reconcileMonth(input({ year: 2026, month: 6, bookings: [b2], candidates: [b1, b2], settlements: [may] }));
    const r = rowOf(vJun, "ind-b");
    expect(r.settled?.owner_rate).toBe(1_000_000);
    expect(r.flags).toContain("por_fechas");

    const inMay = vMay.rows.reduce((a, x) => a + (x.settled?.owner_rate ?? 0), 0);
    expect(inMay + r.settled!.owner_rate).toBe(1_000_000);
  });

  it("R14 ALVEAR: la fila de agosto es de la temporaria de septiembre (85%), no del mensual (9%)", () => {
    const mensual = booking({
      id: "alv-m",
      unit_id: "u1",
      mode: "mensual",
      check_in_date: "2026-07-27",
      check_out_date: "2026-08-28",
      monthly_rent: 900_000,
      total_amount: 960_000,
    });
    const temp = booking({ id: "alv-t", check_in_date: "2026-08-30", check_out_date: "2026-09-30", total_amount: 90_000 });
    const aug = sdoc("s8", "o1", 2026, 8, [rev("rnd-alv", 75_000, { synthetic: { ci: "2026-08-25", co: "2026-09-28" } })]);

    const vAug = reconcileMonth(input({ year: 2026, month: 8, bookings: [mensual, temp], candidates: [mensual, temp], settlements: [aug] }));
    expect(vAug.orphans).toEqual([]);
    expect(vAug.bridges[0].other_month_rows_net).toBe(75_000);
    expect(rowOf(vAug, "alv-m").pieces).toEqual([]);

    const vSep = reconcileMonth(input({ year: 2026, month: 9, bookings: [temp], candidates: [mensual, temp], settlements: [aug] }));
    expect(rowOf(vSep, "alv-t").settled?.owner_rate).toBe(75_000);
  });

  it("R22 CAS1152: 103 noches liquidadas en mayo, junio, julio (manuales) y agosto", () => {
    const cas = booking({ id: "cas", check_in_date: "2026-05-15", check_out_date: "2026-08-26", total_amount: 3_090_000 });
    const org = input({ year: 2026, month: 8 }).org;
    expect(
      settlementWindow({ year: 2026, month: 8, org, bookings: [cas], firstSettlementPeriod: periodIndex(2026, 5) }),
    ).toEqual({ from: periodIndex(2026, 5), to: periodIndex(2026, 9) });

    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        firstSettlementPeriod: periodIndex(2026, 5),
        bookings: [cas],
        candidates: [cas],
        settlements: [
          sdoc("s5", "o1", 2026, 5, [rev("rnd-may", 770_000, { synthetic: { ci: "2026-05-15", co: "2026-06-01" } })]),
          sdoc("s6", "o1", 2026, 6, [rev("rnd-jun", 770_000, { synthetic: { ci: "2026-06-01", co: "2026-07-01" } })]),
          sdoc("s7", "o1", 2026, 7, [rev("rnd-jul", 770_000, { synthetic: { ci: "2026-07-01", co: "2026-08-01" } })]),
          sdoc("s8", "o1", 2026, 8, [rev("cas", 282_333, { manual: true })]),
        ],
      }),
    );
    const r = rowOf(res, "cas");
    expect(r.settled?.owner_rate).toBe(2_592_333);
    expect(r.settled?.rate_diff).toBe(497_667);
    expect(r.settled?.rate_diff_pct).toBeCloseTo(16.1, 1);
    expect(r.flags).toEqual(expect.arrayContaining(["estadia_larga", "varios_periodos", "por_fechas"]));
    expect(codes(r)).not.toContain("posible_doble");
  });
});

describe("huérfanas", () => {
  it("R16 PEREDO: fechas invertidas → fechas_invalidas y entra en orphans_net", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 7,
        settlements: [
          sdoc("s7", "o1", 2026, 7, [
            rev("rnd-peredo", 160_000, { synthetic: { ci: "2026-07-30", co: "2026-07-02" } }),
            ded("rnd-peredo", 32_000, { manual: true }),
          ]),
        ],
      }),
    );
    expect(res.orphans).toHaveLength(1);
    expect(res.orphans[0].reason).toBe("fechas_invalidas");
    expect(res.bridges[0].orphans_net).toBe(128_000);
  });

  it("R17 DF-PH TRANDICIONAL: fila manual sin ninguna reserva en la unidad → sin_reserva", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("rnd-dfph", 548_000, { synthetic: { ci: "2026-08-01", co: "2026-09-01" } })])],
      }),
    );
    expect(res.orphans.map((o) => o.reason)).toEqual(["sin_reserva"]);
    expect(res.review.find((i) => i.id === "sin_reserva")?.count).toBe(1);
  });

  it("R18 dos reservas con las mismas fechas → ambigua con las dos candidatas", () => {
    const a = booking({ id: "amb-a", check_in_date: "2026-08-01", check_out_date: "2026-08-11" });
    const b = booking({ id: "amb-b", check_in_date: "2026-08-01", check_out_date: "2026-08-11" });
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [a, b],
        candidates: [a, b],
        settlements: [sdoc("s8", "o1", 2026, 8, [rev("rnd-amb", 300_000, { synthetic: { ci: "2026-08-01", co: "2026-08-11" } })])],
      }),
    );
    expect(res.orphans).toHaveLength(1);
    expect(res.orphans[0].reason).toBe("ambigua");
    expect(res.orphans[0].candidate_booking_ids.sort()).toEqual(["amb-a", "amb-b"]);
  });
});

// ── Puente ───────────────────────────────────────────────────────────────────

describe("puente por propietario", () => {
  it("B1: el neto del documento se explica pieza por pieza y cierra con buildSettledResults", () => {
    const units = [unit("u-sal", "SAL525", [["X", 100]]), unit("u-alv", "ALVEAR", [["X", 100]]), unit("u-df", "DF-PH", [["X", 100]])];
    const sal = booking({ id: "sal", unit_id: "u-sal", check_in_date: "2026-08-10", check_out_date: "2026-08-13", total_amount: 270_000 });
    const aug2 = booking({ id: "aug2", unit_id: "u-sal", check_in_date: "2026-08-20", check_out_date: "2026-08-25", total_amount: 770_000 });
    const alv = booking({ id: "alv", unit_id: "u-alv", check_in_date: "2026-08-30", check_out_date: "2026-09-30", total_amount: 90_000 });
    const augDoc = sdoc("s8", "X", 2026, 8, [
      rev("sal", 240_000, { unit: "u-sal", manual: true }),
      ded("sal", 48_000, { unit: "u-sal", manual: true }),
      rev("rnd-alv", 75_000, { unit: "u-alv", synthetic: { ci: "2026-08-25", co: "2026-09-28" } }),
      ded("rnd-alv", 15_000, { unit: "u-alv", manual: true }),
      rev("rnd-df", 548_000, { unit: "u-df", synthetic: { ci: "2026-08-01", co: "2026-09-01" } }),
      ded("rnd-df", 109_600, { unit: "u-df", manual: true }),
      ded("t1", 50_000, { unit: "u-sal", type: "maintenance_charge", refType: "maintenance" }),
      ded(null, 100, { unit: null, currency: "USD", type: "adjustment", refType: null }),
    ]);
    const junDoc = sdoc("s6", "X", 2026, 6, [
      rev("aug2", 770_000, { unit: "u-sal" }),
      ded("aug2", 154_000, { unit: "u-sal" }),
    ]);
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        units,
        bookings: [sal, aug2, alv],
        candidates: [sal, aug2, alv],
        settlements: [augDoc, junDoc],
      }),
    );
    const b = res.bridges.find((x) => x.owner_id === "X")!;
    expect(b.month_rows_net_all_periods).toBe(808_000);
    expect(b.month_rows_net_other_periods).toBe(616_000);
    expect(b.other_month_rows_net).toBe(60_000);
    expect(b.orphans_net).toBe(438_400);
    expect(b.other_charges_net).toBe(-50_000);
    expect(b.lines_net).toBe(640_400);
    expect(b.missing_rate).toBe(true);
    expect(
      b.month_rows_net_all_periods - b.month_rows_net_other_periods + b.other_month_rows_net + b.orphans_net + b.other_charges_net,
    ).toBe(b.lines_net);

    const settled = buildSettledResults([
      {
        id: augDoc.id,
        status: augDoc.status,
        currency: augDoc.currency,
        exchange_rates: augDoc.exchange_rates,
        paid_at: augDoc.paid_at,
        owner: { id: "X", full_name: augDoc.owner_name },
        lines: augDoc.lines,
      },
    ]);
    expect(settled.by_owner.find((o) => o.owner_id === "X")!.net).toBe(b.lines_net);
  });
});

// ── Totales ──────────────────────────────────────────────────────────────────

describe("totales", () => {
  it("T1: las partes cierran contra G, la barra suma lo conciliado y el % es sobre lo cobrado sin plataformas", () => {
    const units = [
      unit("u1", "R1", [["o1", 100]]),
      unit("u2", "SAL525", [["o2", 100]]),
      unit("u3", "TERRA", [["o3", 100]]),
      unit("u4", "SARA", [["o4", 100]]),
      unit("u5", "EST", [["o5", 100]]),
    ];
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        units,
        bookings: [
          booking({ id: "r1", unit_id: "u1", check_in_date: "2026-08-10", check_out_date: "2026-08-12", total_amount: 80_000 }),
          booking({ id: "sal", unit_id: "u2", check_in_date: "2026-08-10", check_out_date: "2026-08-13", total_amount: 270_000 }),
          booking({ id: "terra", unit_id: "u3", check_in_date: "2026-08-01", check_out_date: "2026-08-20", total_amount: 0 }),
          booking({ id: "sara", unit_id: "u4", check_in_date: "2026-07-20", check_out_date: "2026-08-20", total_amount: 900_000 }),
          booking({ id: "est", unit_id: "u5", check_in_date: "2026-08-03", check_out_date: "2026-08-08", total_amount: 150_000 }),
        ],
        settlements: [
          sdoc("s1", "o1", 2026, 8, [rev("r1", 70_000, { unit: "u1" }), ded("r1", 14_000, { unit: "u1" })]),
          sdoc("s2", "o2", 2026, 8, [rev("sal", 240_000, { unit: "u2" }), ded("sal", 48_000, { unit: "u2" })]),
          sdoc("s3", "o3", 2026, 8, [rev("terra", 1_100_000, { unit: "u3", manual: true })]),
          sdoc("s4a", "o4", 2026, 7, [rev("rnd-sara", 900_000, { unit: "u4", synthetic: { ci: "2026-07-20", co: "2026-08-20" } })]),
          sdoc("s4b", "o4", 2026, 8, [rev("sara", 900_000, { unit: "u4" })]),
        ],
      }),
    );
    const t = res.totals.find((x) => x.currency === "ARS")!;
    expect(t.guest_total).toBe(1_400_000);
    expect(t.parts.settled + t.parts.estimated + t.parts.unreconciled).toBe(t.guest_total);
    expect(t.parts).toEqual({ settled: 350_000, estimated: 150_000, unreconciled: 900_000 });
    const bar = t.settled.channel + t.settled.rate_diff + t.settled.commission + t.settled.expenses_net + t.settled.owner_net;
    expect(bar).toBe(t.parts.settled);
    expect(t.settled.rate_diff).toBe(40_000);
    expect(t.rate_diff_pct).toBe(11.43);
    expect(t.estimated.bookings).toBe(1);
  });

  it("T2: sin reservas conciliadas el % del mes es null", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [booking({ id: "est", check_in_date: "2026-08-03", check_out_date: "2026-08-08", total_amount: 150_000 })],
      }),
    );
    expect(res.totals[0].rate_diff_pct).toBeNull();
    expect(res.totals[0].settled.bookings).toBe(0);
    expect(res.rows[0].outcome).toBe("estimada");
    expect(res.rows[0].level).toBe("sin_liquidar");
  });
});

// ── Regresiones de la revisión (datos reales ago–sep 2026) ───────────────────

describe("regresiones de la revisión", () => {
  it("F1 CAS1083: fila reusada para la estadía siguiente (ref 19/06→19/07, fechas 19/07→19/08) se empareja por fechas", () => {
    const jun = booking({ id: "c-jun", check_in_date: "2026-06-19", check_out_date: "2026-07-19", total_amount: 900_000 });
    const aug = booking({ id: "c-aug", check_in_date: "2026-07-19", check_out_date: "2026-08-18", total_amount: 1_800_000 });
    const julDoc = sdoc("s7", "o1", 2026, 7, [
      rev("c-jun", 900_000, { manual: true, dates: { ci: "2026-07-19", co: "2026-08-19" } }),
    ]);
    const augDoc = sdoc("s8", "o1", 2026, 8, [rev("c-aug", 900_000)]);
    const org = input({ year: 2026, month: 8 }).org;

    // Vista agosto: la reserva del ref no está en Q1; va a Q5b (con check-in) y sus fechas a Q5a.
    const lookups = collectLookups({ year: 2026, month: 8, org, bookings: [aug], settlements: [julDoc, augDoc] });
    expect(lookups.refIds).toContain("c-jun");
    expect(lookups.synthetic).toContainEqual({ unit_id: "u1", check_in: "2026-07-19", check_out: "2026-08-19" });

    const vAug = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [aug],
        candidates: [aug],
        refLookups: [
          { id: "c-jun", status: "confirmada", is_block: false, mode: "temporario", check_in_date: "2026-06-19", check_out_date: "2026-07-19" },
        ],
        settlements: [julDoc, augDoc],
      }),
    );
    const rAug = rowOf(vAug, "c-aug");
    expect(rAug.settled?.owner_rate).toBe(1_800_000);
    expect(rAug.pieces.find((p) => p.settlement_id === "s7")?.matched_by).toBe("fechas");
    expect(rAug.outcome).toBe("coincide");

    // Vista julio: la estadía del ref ya no se lleva la plata de la siguiente.
    const vJul = reconcileMonth(
      input({ year: 2026, month: 7, bookings: [jun, aug], candidates: [jun, aug], settlements: [julDoc] }),
    );
    expect(rowOf(vJul, "c-jun").pieces).toEqual([]);
    expect(vJul.orphans).toEqual([]);
    expect(vJul.bridges.find((b) => b.owner_id === "o1")!.other_month_rows_net).toBe(900_000);
  });

  it("F1b: una fila automática con la reserva movida después de generar sigue por ref (liquidacion_vieja, no reusada)", () => {
    const b = booking({
      id: "mov",
      check_in_date: "2026-08-20",
      check_out_date: "2026-08-25",
      total_amount: 500_000,
      updated_at: "2026-08-30T12:00:00Z",
    });
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [b],
        candidates: [b],
        settlements: [
          sdoc("s8", "o1", 2026, 8, [rev("mov", 400_000, { dates: { ci: "2026-08-01", co: "2026-08-05" } })], {
            generated_at: "2026-08-10T12:00:00Z",
          }),
        ],
      }),
    );
    const r = rowOf(res, "mov");
    expect(r.pieces[0]?.matched_by).toBe("ref");
    expect(codes(r)).toContain("liquidacion_vieja");
  });

  it("F2 DEHEZA2: fila manual que conserva el importe automático de 30/31 → prorrateo_viejo; corregida (ROND.134) → coincide", () => {
    const deheza = booking({
      id: "deh",
      mode: "mensual",
      check_in_date: "2026-08-01",
      check_out_date: "2026-09-01",
      monthly_rent: 945_000,
      total_amount: 976_500, // 945.000 / 30 × 31
    });
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [deheza],
        settlements: [
          sdoc("s8", "o1", 2026, 8, [rev("deh", 914_516.13, { type: "monthly_rent_fraction", prorate: 30, manual: true })]),
        ],
      }),
    );
    const r = rowOf(res, "deh");
    expect(r.guest_total).toBe(945_000);
    const issue = r.issues.find((i) => i.code === "prorrateo_viejo")!;
    // Fila manual: regenerar la conserva tal cual, así que el consejo es editarla.
    expect(issue.detail).toBe("Se liquidaron 30 días y el mes tiene 31 noches ocupadas. Editá la fila.");
    expect(issue.at_stake).toBe(30_483.87); // una noche
    expect(r.settled?.rate_diff).toBeNull();
    expect(res.totals[0].settled.rate_diff).toBe(0);

    const rond = booking({
      id: "rond",
      mode: "mensual",
      check_in_date: "2026-09-01",
      check_out_date: "2026-10-01",
      monthly_rent: 900_000,
      total_amount: 900_000,
    });
    const res2 = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        bookings: [rond],
        settlements: [
          sdoc("s9", "o1", 2026, 9, [rev("rond", 900_000, { type: "monthly_rent_fraction", prorate: 29, manual: true })]),
        ],
      }),
    );
    const r2 = rowOf(res2, "rond");
    expect(codes(r2)).not.toContain("prorrateo_viejo");
    expect(r2.outcome).toBe("coincide");
  });

  it("F5: el monto en juego de prorrateo_viejo es lo que valen las noches mal contadas, no |D|", () => {
    const p3 = booking({
      id: "p3",
      mode: "mensual",
      check_in_date: "2026-09-01",
      check_out_date: "2026-10-01",
      monthly_rent: 900_000,
      total_amount: 900_000,
    });
    const r1 = rowOf(
      reconcileMonth(
        input({
          year: 2026,
          month: 9,
          bookings: [p3],
          settlements: [sdoc("s9", "o1", 2026, 9, [rev("p3", 870_000, { type: "monthly_rent_fraction", prorate: 29 })])],
        }),
      ),
      "p3",
    );
    expect(r1.issues.find((i) => i.code === "prorrateo_viejo")?.at_stake).toBe(30_000);

    // BSAS1: renta basura → total ÷ noches del tramo; no repite los 1.415.699 de "Revisá el importe".
    const bsas1 = booking({
      id: "bsas1",
      mode: "mensual",
      check_in_date: "2026-09-01",
      check_out_date: "2026-10-01",
      monthly_rent: 1,
      total_amount: 1_415_700,
    });
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 9,
        bookings: [bsas1],
        settlements: [sdoc("s9", "o1", 2026, 9, [rev("bsas1", 0.97, { type: "monthly_rent_fraction", prorate: 29 })])],
      }),
    );
    expect(rowOf(res, "bsas1").issues.find((i) => i.code === "prorrateo_viejo")?.at_stake).toBe(47_190);
    expect(res.review.find((i) => i.id === "prorrateo_mensual")?.at_stake).toEqual([{ currency: "ARS", amount: 47_190 }]);
  });

  it("F3 CORRO: un cobro extra de un mensual de 3 meses suma en un solo mes (el del movimiento)", () => {
    const corro = booking({
      id: "corro",
      mode: "mensual",
      check_in_date: "2026-06-25",
      check_out_date: "2026-09-25",
      monthly_rent: 900_000,
      total_amount: 2_760_000, // 900.000 / 30 × 92
    });
    const extraCharges = [
      { ref_id: "corro", amount: 1_029_000, currency: "ARS", billable_to: null, description: "Pago pdo Agosto- Septiembre", occurred_at: "2026-07-31T15:00:00Z" },
      { ref_id: "corro", amount: 70_000, currency: "ARS", billable_to: null, description: "Luz", occurred_at: "2026-09-05T15:00:00Z" },
    ];
    const byMonth = [7, 8, 9].map((month) => reconcileMonth(input({ year: 2026, month, bookings: [corro], extraCharges })));
    expect(byMonth.map((r) => r.totals[0].extra_charges)).toEqual([1_029_000, 0, 70_000]);
    expect(byMonth.map((r) => r.close[0].extra_charges)).toEqual([1_029_000, 0, 70_000]);
    expect(rowOf(byMonth[1], "corro").extra_charge_items).toEqual([]);

    // Temporaria: una sola fila, van todos aunque se hayan cobrado otro mes.
    const temp = booking({ id: "temp", check_in_date: "2026-07-28", check_out_date: "2026-08-03", total_amount: 300_000 });
    const t = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [temp],
        extraCharges: [{ ref_id: "temp", amount: 20_000, currency: "ARS", billable_to: null, description: "Cochera", occurred_at: "2026-07-28T15:00:00Z" }],
      }),
    );
    expect(t.totals[0].extra_charges).toBe(20_000);
  });

  it("F3b: el mes del cobro se mira en la zona horaria de la org y se acota a los meses del tramo", () => {
    const tramo = { check_in_date: "2026-06-25", check_out_date: "2026-09-25" };
    // 01/08 01:00 UTC es 31/07 22:00 en Córdoba.
    expect(extraChargePeriod({ occurred_at: "2026-08-01T01:00:00Z" }, tramo)).toBe(periodIndex(2026, 7));
    expect(extraChargePeriod({ occurred_at: "2026-05-10T12:00:00Z" }, tramo)).toBe(periodIndex(2026, 6));
    expect(extraChargePeriod({ occurred_at: "2026-11-10T12:00:00Z" }, tramo)).toBe(periodIndex(2026, 9));
    expect(extraChargePeriod({ occurred_at: null }, tramo)).toBe(periodIndex(2026, 6));
  });

  it("F4: el panel no suma dos veces la misma plata de una fila (liquidado_de_mas + posible_doble)", () => {
    const res = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [booking({ id: "sara", check_in_date: "2026-07-20", check_out_date: "2026-08-20", total_amount: 900_000 })],
        settlements: [
          sdoc("s7", "o1", 2026, 7, [rev("rnd-sara", 900_000, { synthetic: { ci: "2026-07-20", co: "2026-08-20" } })]),
          sdoc("s8", "o1", 2026, 8, [rev("sara", 900_000)]),
        ],
      }),
    );
    expect(codes(rowOf(res, "sara"))).toEqual(expect.arrayContaining(["liquidado_de_mas", "posible_doble"]));
    const item = res.review.find((i) => i.id === "liquidado_de_mas")!;
    expect(item.at_stake).toEqual([{ currency: "ARS", amount: 900_000 }]);
    expect(item.at_stake[0].amount).toBe(res.totals[0].overpaid.excess);
  });

  it("F6: un contrato que cubre febrero completo no es contrato_incompleto; liquidar el doble del contrato sí", () => {
    const feb = booking({
      id: "feb",
      mode: "mensual",
      check_in_date: "2027-02-01",
      check_out_date: "2027-03-01",
      monthly_rent: 900_000,
      total_amount: 840_000, // 900.000 / 30 × 28
    });
    const res = reconcileMonth(
      input({
        year: 2027,
        month: 2,
        bookings: [feb],
        settlements: [sdoc("s2", "o1", 2027, 2, [rev("feb", 900_000, { type: "monthly_rent_fraction", prorate: 28 })])],
      }),
    );
    const r = rowOf(res, "feb");
    expect(codes(r)).not.toContain("contrato_incompleto");
    expect(r.outcome).toBe("coincide");

    const alc = booking({
      id: "alc",
      mode: "mensual",
      check_in_date: "2026-08-01",
      check_out_date: "2026-09-01",
      monthly_rent: 900_000,
      total_amount: 930_000,
    });
    const res2 = reconcileMonth(
      input({
        year: 2026,
        month: 8,
        bookings: [alc],
        settlements: [
          sdoc("s7", "o1", 2026, 7, [rev("alc", 900_000, { type: "monthly_rent_fraction", manual: true })]),
          sdoc("s8", "o1", 2026, 8, [rev("alc", 900_000, { type: "monthly_rent_fraction", prorate: 31 })]),
        ],
      }),
    );
    expect(codes(rowOf(res2, "alc"))).toContain("contrato_incompleto");
  });

  it("F9: la ventana no baja más de 12 meses y lo que empezó antes queda con historia_incompleta", () => {
    const long = booking({
      id: "long",
      mode: "mensual",
      check_in_date: "2024-01-01",
      check_out_date: "2027-01-01",
      monthly_rent: 900_000,
      total_amount: 900_000,
    });
    const org = input({ year: 2026, month: 8 }).org;
    expect(settlementWindow({ year: 2026, month: 8, org, bookings: [long], firstSettlementPeriod: null }).from).toBe(
      periodIndex(2026, 8) - 12,
    );
    const stay = booking({ id: "stay", check_in_date: "2025-05-01", check_out_date: "2026-08-10", total_amount: 5_000_000 });
    const res = reconcileMonth(
      input({ year: 2026, month: 8, bookings: [stay], settlements: [sdoc("s8", "o1", 2026, 8, [rev("stay", 5_000_000)])] }),
    );
    const r = rowOf(res, "stay");
    expect(r.flags).toContain("historia_incompleta");
    expect(r.settled?.rate_diff).toBeNull();
  });

  it("F10: una fila manual con una fecha que no existe ('2026-02-30') es fechas_invalidas y no llega a la consulta", () => {
    const doc = sdoc("s5", "o1", 2026, 5, [rev("rnd-bad", 100_000, { synthetic: { ci: "2026-02-30", co: "2026-03-05" } })]);
    const org = input({ year: 2026, month: 5 }).org;
    expect(collectLookups({ year: 2026, month: 5, org, bookings: [], settlements: [doc] }).synthetic).toEqual([]);
    const res = reconcileMonth(input({ year: 2026, month: 5, settlements: [doc] }));
    expect(res.orphans.map((o) => o.reason)).toEqual(["fechas_invalidas"]);
  });

  it("F12: con un filtro de modo, Por depto y Por propietario no listan a quien sólo tiene otros cargos", () => {
    const units = [unit("u1", "MENS", [["o1", 100]]), unit("u2", "TEMP", [["o2", 100]])];
    const m1 = booking({
      id: "m1",
      unit_id: "u1",
      mode: "mensual",
      check_in_date: "2026-08-01",
      check_out_date: "2026-09-01",
      monthly_rent: 900_000,
      total_amount: 930_000,
    });
    const docs = [
      sdoc("s1", "o1", 2026, 8, [rev("m1", 900_000, { unit: "u1", type: "monthly_rent_fraction", prorate: 31 })]),
      sdoc("s2", "o2", 2026, 8, [ded("t1", 50_000, { unit: "u2", type: "maintenance_charge", refType: "maintenance" })]),
    ];
    const mensual = reconcileMonth(input({ year: 2026, month: 8, mode: "mensual", units, bookings: [m1], settlements: docs }));
    expect(mensual.by_owner.map((o) => o.owner_id)).toEqual(["o1"]);
    expect(mensual.by_unit.map((u) => u.unit_id)).toEqual(["u1"]);
    const todos = reconcileMonth(input({ year: 2026, month: 8, units, bookings: [m1], settlements: docs }));
    expect(todos.by_owner.map((o) => o.owner_id).sort()).toEqual(["o1", "o2"]);
  });

  it("F13: el ítem de comisión de canal cuenta las filas con el aviso, no toda reserva del canal", () => {
    const liq = booking({ id: "air-liq", source: "airbnb", check_in_date: "2026-08-10", check_out_date: "2026-08-14", total_amount: 425_000 });
    const est = booking({ id: "air-est", source: "airbnb", check_in_date: "2026-08-20", check_out_date: "2026-08-24", total_amount: 300_000 });
    const res = reconcileMonth(
      input({ year: 2026, month: 8, bookings: [liq, est], settlements: [sdoc("s8", "o1", 2026, 8, [rev("air-liq", 373_500)])] }),
    );
    const item = res.review.find((i) => i.id === "canal")!;
    expect(item.count).toBe(1);
    expect(item.at_stake).toEqual([{ currency: "ARS", amount: 51_500 }]);
  });

  it("F14: 'Reservas sin liquidar' del cierre cuenta lo mismo que la cobertura (sin filas fuera de los totales)", () => {
    const diva = booking({ id: "diva", source: "airbnb", check_in_date: "2026-08-10", check_out_date: "2026-08-13", total_amount: 241.53 });
    const est = booking({ id: "est", check_in_date: "2026-08-03", check_out_date: "2026-08-08", total_amount: 150_000 });
    const res = reconcileMonth(input({ year: 2026, month: 8, bookings: [diva, est] }));
    const ars = res.close.find((c) => c.currency === "ARS")!;
    expect(ars.bookings_not_settled).toBe(1);
    expect(ars.bookings_not_settled).toBe(res.totals.find((t) => t.currency === "ARS")!.estimated.bookings);
  });
});
