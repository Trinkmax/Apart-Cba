import { describe, expect, it } from "vitest";
import {
  buildMonthlyCharge,
  carryOverItems,
  chooseDifferenceTarget,
  monthIsBillable,
  pickCarrySource,
  rentDiscountOf,
  type DifferenceTargetCandidate,
  type VoidedChargeItem,
  type VoidedMonthlyCharge,
} from "../charges";
import { lateFeeAlreadyBilled } from "../late-fees";
import { buildSchedule } from "../schedule";

// Contrato IPC con desfasaje 1 y ajuste trimestral en junio: el IPC de mayo sale
// ~12/06, después del vencimiento del 10/06. La diferencia aparece el 13/06.
const TODAY = "2026-06-13";

function charge(id: string, over: Partial<DifferenceTargetCandidate> = {}): DifferenceTargetCandidate {
  return { id, kind: "mensual", status: "pendiente", due_date: "2026-06-10", period_start: "2026-06-01", ...over };
}

describe("chooseDifferenceTarget (sin punitorios por días en que la diferencia no existía)", () => {
  it("junio abierto pero ya vencido: la diferencia no va ahí", () => {
    const june = charge("jun");
    expect(chooseDifferenceTarget(june, [june], { today: TODAY })).toBeNull();
  });

  it("junio abierto y todavía en plazo: va al mismo cargo", () => {
    const june = charge("jun", { due_date: "2026-06-20" });
    expect(chooseDifferenceTarget(june, [june], { today: TODAY })).toBe("jun");
  });

  it("junio pagado y mayo todavía abierto (vencido el 10/05): nunca al cargo de mayo", () => {
    const june = charge("jun", { status: "pagado" });
    const may = charge("may", { status: "parcial", due_date: "2026-05-10", period_start: "2026-05-01" });
    expect(chooseDifferenceTarget(june, [may, june], { today: TODAY })).toBeNull();
  });

  it("si hay un mensual abierto que vence más adelante, va al que vence más tarde", () => {
    const june = charge("jun", { status: "pagado" });
    const july = charge("jul", { due_date: "2026-07-10", period_start: "2026-07-01" });
    const aug = charge("ago", { due_date: "2026-08-10", period_start: "2026-08-01" });
    expect(chooseDifferenceTarget(june, [june, july, aug], { today: TODAY })).toBe("ago");
  });

  it("un cargo que vence en menos del aviso mínimo no sirve", () => {
    const june = charge("jun", { due_date: "2026-06-15" });
    expect(chooseDifferenceTarget(june, [june], { today: TODAY })).toBeNull();
    expect(chooseDifferenceTarget(june, [june], { today: TODAY, minNoticeDays: 0 })).toBe("jun");
  });

  it("ni cargos que no son mensuales ni meses posteriores a la salida", () => {
    const june = charge("jun", { status: "pagado" });
    const exit = charge("salida", { kind: "salida", due_date: "2026-07-01", period_start: null });
    const july = charge("jul", { due_date: "2026-07-10", period_start: "2026-07-01" });
    expect(chooseDifferenceTarget(june, [june, exit, july], { today: TODAY, terminatedAt: "2026-06-30" })).toBeNull();
    expect(chooseDifferenceTarget(june, [june, exit, july], { today: TODAY, terminatedAt: "2026-07-15" })).toBe("jul");
  });
});

// ─── Mensual anulado → cargo nuevo del mismo mes ──────────────────────────────

function item(id: string, over: Partial<VoidedChargeItem> = {}): VoidedChargeItem {
  return {
    id,
    kind: "alquiler",
    payee: "propietario",
    description: "Alquiler Septiembre 2026",
    amount: 100_000,
    original_amount: null,
    discount_reason: null,
    ref_type: null,
    ref_id: null,
    meta: {},
    sort_order: 0,
    ...over,
  };
}

// Septiembre vencido el 10/09: al cobrar agosto se condonaron 3.000 de mora de
// septiembre (marca en $ 0), tenía expensas, una reparación y un gasto trasladado.
const SEPTEMBER: VoidedChargeItem[] = [
  item("rent", { amount: 90_000, original_amount: 100_000, discount_reason: "arreglo del calefón", meta: { billed_rent: 100_000 } }),
  item("diff", { kind: "diferencia_ajuste", description: "Diferencia por ajuste · Agosto", amount: 5_000, ref_type: "rental_charge", ref_id: "ago", sort_order: 5 }),
  item("exp", { kind: "expensas", payee: "consorcio", description: "Expensas Septiembre 2026", amount: 45_000, meta: { month: "2026-09-01" }, sort_order: 10 }),
  item("gasto", { kind: "reparacion", payee: "inmobiliaria", description: "Reparación: canilla", amount: 8_000, ref_type: "rental_expense", ref_id: "e1", sort_order: 30 }),
  item("rep", { kind: "reparacion", payee: "propietario", description: "Vidrio roto", amount: 12_000, meta: { manual: true }, sort_order: 30 }),
  item("marca", { kind: "punitorio", description: "Intereses por mora condonados · Septiembre", amount: 0, meta: { waived: true, waived_amount: 3_000, payment_id: "p1" } }),
];

describe("carryOverItems (nada de lo cargado a mano se pierde al rehacer un mensual)", () => {
  it("pasan expensas, conceptos a mano y la marca de lo condonado; no lo que rehace el motor", () => {
    const carried = carryOverItems(SEPTEMBER);
    expect(carried.map((c) => c.meta?.carried_from)).toEqual(["marca", "exp", "rep"]);
    expect(carried.find((c) => c.kind === "expensas")).toMatchObject({ payee: "consorcio", amount: 45_000, meta: { month: "2026-09-01", carried_from: "exp" } });
  });

  it("lo condonado en el mensual anulado sigue contando como ya facturado en el nuevo", () => {
    const carried = carryOverItems(SEPTEMBER).filter((c) => c.kind === "punitorio");
    const billed = lateFeeAlreadyBilled(carried.map((c) => ({ amount: c.amount, originalAmount: c.original_amount, meta: c.meta })));
    expect(billed).toBe(3_000);
  });

  it("un punitorio bonificado pasa con su importe original: la bonificación no se deshace", () => {
    const [p] = carryOverItems([item("pun", { kind: "punitorio", amount: 1_000, original_amount: 3_000, discount_reason: "pagó con demora del banco" })]);
    expect(p).toMatchObject({ amount: 1_000, original_amount: 3_000, discount_reason: "pagó con demora del banco" });
    expect(lateFeeAlreadyBilled([{ amount: p.amount, originalAmount: p.original_amount, meta: p.meta }])).toBe(3_000);
  });

  it("la bonificación del alquiler no pasa (el alquiler sale del contrato) pero se puede avisar", () => {
    expect(rentDiscountOf(SEPTEMBER)).toBe(10_000);
    expect(rentDiscountOf([item("r")])).toBe(0);
  });

  it("buildMonthlyCharge suma lo que pasa tal cual, aunque sea una marca en $ 0", () => {
    const draft = buildMonthlyCharge({
      period: { index: 2, start: "2026-09-01", end: "2026-09-30", dueDate: "2026-09-10", cycle: 1, indexInCycle: 3, cycleLength: 3, adjustsHere: false },
      rent: { amount: 110_000, fromSequence: 1, pendingSequence: null },
      currency: "ARS",
      carriedItems: carryOverItems(SEPTEMBER),
    });
    expect(draft.items.map((i) => i.kind)).toEqual(["alquiler", "punitorio", "expensas", "reparacion"]);
    expect(draft.items.find((i) => i.kind === "punitorio")?.amount).toBe(0);
  });
});

describe("pickCarrySource (de qué mensual anulado salen)", () => {
  const voided = (id: string, periodStart: string, voidedAt: string, currency = "ARS"): VoidedMonthlyCharge => ({
    id,
    period_start: periodStart,
    currency,
    voided_at: voidedAt,
    items: [],
  });

  it("el último anulado del mismo mes, aunque haya cambiado el día de inicio", () => {
    const list = [voided("v1", "2026-09-01", "2026-09-05T12:00:00+00:00"), voided("v2", "2026-09-01", "2026-09-20T12:00:00+00:00"), voided("ago", "2026-08-01", "2026-09-20T12:00:00+00:00")];
    expect(pickCarrySource(list, "2026-09-03", "ARS")?.id).toBe("v2");
    expect(pickCarrySource(list, "2026-10-01", "ARS")).toBeNull();
  });

  it("en otra moneda no pasa nada", () => {
    expect(pickCarrySource([voided("v1", "2026-09-01", "2026-09-05T12:00:00+00:00", "ARS")], "2026-09-01", "USD")).toBeNull();
  });
});

describe("monthIsBillable (¿lo del mensual anulado tiene adónde pasar?)", () => {
  // 12 meses desde el 15/10/2026: el primer período empieza en octubre y el último en septiembre 2027.
  const schedule = buildSchedule({ startDate: "2026-10-15", durationMonths: 12, adjustmentEveryMonths: 3, paymentWindowDays: 10 });

  it("un mes con período, aunque el día de inicio haya cambiado", () => {
    expect(monthIsBillable(schedule, "2026-10-01", {})).toBe(true);
    expect(monthIsBillable(schedule, "2027-09-01", {})).toBe(true);
  });

  it("antes del inicio, después del fin o de la salida, o antes de que empiece la cobranza: no", () => {
    expect(monthIsBillable(schedule, "2026-09-01", {})).toBe(false);
    expect(monthIsBillable(schedule, "2027-10-01", {})).toBe(false);
    expect(monthIsBillable(schedule, "2027-01-01", { terminatedAt: "2026-12-31" })).toBe(false);
    expect(monthIsBillable(schedule, "2026-10-01", { billingStartsOn: "2026-12-01" })).toBe(false);
  });
});
