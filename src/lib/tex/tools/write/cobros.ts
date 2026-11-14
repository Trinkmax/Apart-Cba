/**
 * Plata que entra (nov-2026).
 *
 * - `registrar_cobro`: lo que paga un huésped por su reserva. Temporaria →
 *   `addBookingPayment`; alquiler mensual con cuotas → `markScheduleAsPaid`
 *   sobre la cuota (si no, la cuota sigue figurando impaga).
 *   OJO `addBookingPayment` sube `paid_amount` ANTES de validar la cuenta: si
 *   la cuenta no sirve, tira pero la reserva queda "cobrada" sin asiento en
 *   Caja. Por eso la cuenta (activa, de la org, misma moneda EXACTA que la
 *   reserva) se valida acá al proponer y otra vez al confirmar.
 * - `registrar_ingreso`: un ingreso suelto de la administración (`createMovement`,
 *   que no compara moneda con la cuenta: la moneda sale siempre de la cuenta).
 */
import { z } from "zod/v4";
import { addBookingPayment } from "@/lib/actions/bookings";
import { createMovement, listAccounts } from "@/lib/actions/cash";
import { listScheduleForBooking, listScheduleForLeaseGroup, markScheduleAsPaid } from "@/lib/actions/payment-schedule";
import type { BookingPaymentSchedule, CashAccount } from "@/lib/types/database";
import { attempt, defineWrite, hrefs } from "../../tool";
import { clip, dateRange, fold, money, nightsBetween, shortDate } from "../../format";
import { resolveAccount, resolveUnit, type Resolved } from "../_resolve";
import { findBooking, idSchema, joinNotes, loadBooking, round2, statusLabel, unitLabel } from "./_shared";

const OPEN_CUOTA = new Set(["pending", "partial", "overdue"]);
const OTA_SOURCES = new Set(["airbnb", "booking", "expedia", "vrbo"]);
const SOURCE_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking", expedia: "Expedia", vrbo: "VRBO" };

/** La cuenta donde entra el cobro: activa, de la org y en la moneda EXACTA del cobro. */
async function pickAccount(query: string | undefined, currency: string): Promise<Resolved<CashAccount>> {
  const acc = await resolveAccount(query, { currency });
  if (acc.ok === false && query?.trim()) {
    // "No hay una cuenta «Dólares»" confunde si existe, pero en otra moneda.
    const all = await attempt(() => listAccounts());
    const q = fold(query);
    const other = all.ok ? (all.value as CashAccount[]).find((a) => a.active && fold(a.name) === q && a.currency !== currency) : undefined;
    if (other) {
      return {
        ok: false,
        error: `La cuenta «${other.name}» es en ${other.currency} y el cobro es en ${currency}. Tiene que entrar en una cuenta en ${currency}.`,
      };
    }
  }
  if (acc.ok !== true) return acc;
  if (acc.value.currency !== currency) {
    return {
      ok: false,
      error: `La cuenta «${acc.value.name}» es en ${acc.value.currency} y el cobro es en ${currency}. Tiene que entrar en una cuenta en ${currency}.`,
    };
  }
  return acc;
}

/** Al confirmar: la cuenta sigue activa, es de la org y está en la misma moneda. */
async function recheckAccount(
  accountId: string,
  currency: string,
): Promise<{ ok: true; value: CashAccount } | { ok: false; error: string }> {
  const r = await attempt(() => listAccounts());
  if (!r.ok) return r;
  const acc = (r.value as CashAccount[]).find((a) => a.id === accountId && a.active);
  if (!acc) return { ok: false, error: "La cuenta de Caja elegida ya no existe o la desactivaron. Pedime el cobro de nuevo." };
  if (acc.currency !== currency) {
    return { ok: false, error: `La cuenta «${acc.name}» ahora es en ${acc.currency} y el cobro es en ${currency}. No registré nada.` };
  }
  return { ok: true, value: acc };
}

const cobroPayload = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reserva"),
    booking_id: idSchema,
    amount: z.number().positive(),
    account_id: idSchema,
    currency: z.string().min(1).max(12),
  }),
  z.object({
    kind: z.literal("cuota"),
    /** La reserva de la cuota (en un contrato partido, el tramo al que pertenece). */
    booking_id: idSchema,
    schedule_id: idSchema,
    amount: z.number().positive(),
    account_id: idSchema,
    currency: z.string().min(1).max(12),
  }),
]);

export const registrarCobro = defineWrite({
  name: "registrar_cobro",
  label: "Preparando el cobro…",
  description:
    "Prepara el COBRO de una reserva (lo que pagó el huésped) para que la persona lo confirme con un botón: no se registra hasta que confirma. " +
    "Suma a lo cobrado de la reserva y entra a Caja en una cuenta de la misma moneda que la reserva. En alquileres mensuales se imputa a la cuota " +
    "(la más vieja sin cobrar, o la que digan). Para ingresos que no son de una reserva usá registrar_ingreso; para gastos, registrar_gasto.",
  input: z.object({
    reserva: z
      .string()
      .describe(
        "De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva (ej. HMABC123), o el id que la persona eligió de una lista.",
      ),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir entre reservas.").optional(),
    monto: z.number().positive().describe("Importe cobrado, en la moneda de la reserva."),
    cuenta: z
      .string()
      .describe("Cuenta de Caja donde entró la plata si la dijeron (ej. «Efectivo», «Mercado Pago»), o su id. Si no, omitir.")
      .optional(),
    cuota: z
      .number()
      .int()
      .positive()
      .describe("Sólo alquileres mensuales: número de cuota si lo dijeron (3 = la tercera). Si no, va a la más vieja sin cobrar.")
      .optional(),
  }),
  payload: cobroPayload,
  resource: "payments",
  action: "create",
  async propose(input, ctx) {
    const found = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today });
    if (found.ok !== true) return found;
    const bk = await loadBooking(found.value.id);
    if (!bk.ok) return bk;
    const b = bk.value;
    const who = b.guest?.full_name ?? "Sin huésped";
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva: no lleva cobros." };
    if (b.status === "cancelada" || b.status === "no_show") {
      return {
        ok: false,
        error: `La reserva de ${who} está ${statusLabel(b.status).toLowerCase()}: un cobro sobre una reserva cancelada se resuelve desde su ficha (${hrefs.booking(b.id)}).`,
      };
    }
    const amount = round2(input.monto);
    const nights = nightsBetween(b.check_in_date, b.check_out_date);
    const baseLines = [
      { label: "Huésped", value: who },
      { label: "Unidad", value: unitLabel(b.unit) },
      { label: "Fechas", value: `${dateRange(b.check_in_date, b.check_out_date)} · ${nights} ${nights === 1 ? "noche" : "noches"}` },
    ];

    // ── Alquiler mensual: el cobro va a una cuota ──
    if (b.mode === "mensual") {
      const sch = await attempt(() =>
        b.lease_group_id ? listScheduleForLeaseGroup(b.lease_group_id) : listScheduleForBooking(b.id),
      );
      if (!sch.ok) return sch;
      const all = sch.value as BookingPaymentSchedule[];
      if (all.length > 0) {
        // Una cuota de un tramo cancelado (contrato re-partido, salida anticipada)
        // no se cobra: la plata iría a una reserva que la liquidación no ve y la
        // cuota viva seguiría vencida. Un tramo que no se pudo leer, tampoco.
        const segIds = [...new Set(all.map((s) => s.booking_id))].slice(0, 40);
        const segs = await Promise.all(segIds.map((id) => loadBooking(id)));
        const liveSegs = new Set(
          segs.flatMap((r, i) =>
            r.ok && r.value.status !== "cancelada" && r.value.status !== "no_show" ? [segIds[i]] : [],
          ),
        );
        const open = all
          .filter((s) => OPEN_CUOTA.has(s.status) && liveSegs.has(s.booking_id))
          .sort((x, y) => x.due_date.localeCompare(y.due_date) || x.sequence_number - y.sequence_number);
        const openList = open.map((s) => `${s.sequence_number} (vence ${shortDate(s.due_date, ctx.today)})`).join(", ");
        if (open.length === 0) {
          return {
            ok: false,
            error: `Todas las cuotas del contrato de ${who} ya están cobradas o anuladas. Si es otro cobro, cargalo desde la reserva (${hrefs.booking(b.id)}).`,
          };
        }
        let cuota = open[0];
        if (input.cuota !== undefined) {
          const hit = open.find((s) => s.sequence_number === input.cuota);
          if (!hit) {
            const other = all.find((s) => s.sequence_number === input.cuota);
            return {
              ok: false,
              error: other
                ? `La cuota ${input.cuota} ya está ${other.status === "paid" ? "cobrada" : "anulada"}. Las que faltan cobrar: ${openList}.`
                : `El contrato no tiene cuota ${input.cuota}. Las que faltan cobrar: ${openList}.`,
            };
          }
          cuota = hit;
        }
        const currency = cuota.currency;
        const acc = await pickAccount(input.cuenta, currency);
        if (acc.ok !== true) return acc;
        const falta = round2(Number(cuota.expected_amount) - Number(cuota.paid_amount));
        const despues = round2(falta - amount);
        const others = open.length - 1;
        // En un contrato partido la cuota es de otro tramo: se muestra el período de ESA cuota.
        let period = baseLines[2].value;
        if (cuota.booking_id !== b.id) {
          const seg = await loadBooking(cuota.booking_id);
          if (seg.ok) {
            const n = nightsBetween(seg.value.check_in_date, seg.value.check_out_date);
            period = `${dateRange(seg.value.check_in_date, seg.value.check_out_date)} · ${n} ${n === 1 ? "noche" : "noches"}`;
          }
        }
        return {
          ok: true,
          payload: {
            kind: "cuota" as const,
            booking_id: cuota.booking_id,
            schedule_id: cuota.id,
            amount,
            account_id: acc.value.id,
            currency,
          },
          summary: {
            title: "Registrar el cobro de una cuota",
            lines: [
              baseLines[0],
              baseLines[1],
              { label: "Período", value: period },
              {
                label: "Cuota",
                value: `${cuota.sequence_number} de ${cuota.total_count} · vence ${shortDate(cuota.due_date, ctx.today)}${cuota.status === "overdue" ? " (vencida)" : ""}`,
              },
              { label: "Importe", value: money(amount, currency) },
              { label: "Entra en", value: `${acc.value.name} (${acc.value.currency})` },
              { label: "Falta de la cuota", value: `${money(falta, currency)} → ${money(Math.max(0, despues), currency)}` },
            ],
            note: joinNotes([
              despues < -0.01 &&
                `Supera lo que falta de la cuota (${money(falta, currency)}): el excedente queda en esta cuota, no pasa a la siguiente.`,
              despues > 0.01 && `La cuota queda parcial: faltan ${money(despues, currency)}.`,
              others > 0 && `Hay ${others} ${others === 1 ? "cuota más" : "cuotas más"} sin cobrar.`,
            ]),
            confirmLabel: "Registrar cobro",
          },
        };
      }
    }

    // ── Reserva temporaria (o mensual sin cuotas generadas) ──
    if (input.cuota !== undefined) {
      return { ok: false, error: `La reserva de ${who} no tiene cuotas: el cobro va directo a la reserva, sin número de cuota.` };
    }
    const currency = b.currency;
    const acc = await pickAccount(input.cuenta, currency);
    if (acc.ok !== true) return acc;
    const saldo = round2(b.total_amount - b.paid_amount);
    const despues = round2(saldo - amount);
    return {
      ok: true,
      payload: { kind: "reserva" as const, booking_id: b.id, amount, account_id: acc.value.id, currency },
      summary: {
        title: "Registrar un cobro",
        lines: [
          ...baseLines,
          { label: "Importe", value: money(amount, currency) },
          { label: "Entra en", value: `${acc.value.name} (${acc.value.currency})` },
          { label: "Saldo", value: `${money(saldo, currency)} → ${money(despues, currency)}` },
        ],
        note: joinNotes([
          b.total_amount <= 0
            ? "La reserva no tiene importe cargado: el cobro queda como saldo a favor del huésped hasta que se cargue el precio."
            : despues < -0.01 &&
              (saldo <= 0.01
                ? "La reserva ya estaba paga: esto queda como saldo a favor del huésped."
                : `Supera el saldo (${money(saldo, currency)}): quedan ${money(-despues, currency)} a favor del huésped.`),
          OTA_SOURCES.has(b.source) &&
            `Es una reserva de ${SOURCE_LABEL[b.source] ?? b.source}: lo que paga el huésped lo cobra la plataforma. Registrá acá sólo plata que entró a tu Caja.`,
        ]),
        confirmLabel: "Registrar cobro",
      },
    };
  },
  async execute(p) {
    if (p.kind === "cuota") {
      const sch = await attempt(() => listScheduleForBooking(p.booking_id));
      if (!sch.ok) return sch;
      const cuota = (sch.value as BookingPaymentSchedule[]).find((s) => s.id === p.schedule_id);
      if (!cuota) return { ok: false, error: "Esa cuota ya no existe. No registré nada." };
      if (!OPEN_CUOTA.has(cuota.status)) {
        return { ok: false, error: "Esa cuota ya figura cobrada o anulada (alguien la cargó mientras tanto). No registré nada." };
      }
      if (cuota.currency !== p.currency) return { ok: false, error: "La moneda de la cuota cambió. No registré nada." };
      const seg = await loadBooking(p.booking_id);
      if (!seg.ok) return seg;
      if (seg.value.status === "cancelada" || seg.value.status === "no_show") {
        return { ok: false, error: "Ese tramo del contrato quedó cancelado mientras tanto. No registré nada." };
      }
      const acc = await recheckAccount(p.account_id, p.currency);
      if (!acc.ok) return acc;
      const r = await attempt(() => markScheduleAsPaid({ schedule_id: p.schedule_id, amount: p.amount, account_id: p.account_id }));
      if (!r.ok) return r;
      return {
        ok: true,
        message: `Cobro registrado: cuota ${cuota.sequence_number}/${cuota.total_count}, ${money(p.amount, p.currency)} en ${acc.value.name}.`,
        href: hrefs.booking(p.booking_id),
        data: { reserva_id: p.booking_id, cuota: cuota.sequence_number, estado_cuota: r.value.status },
      };
    }

    // Todo lo que `addBookingPayment` valida DESPUÉS de subir lo cobrado, se valida antes.
    const bk = await loadBooking(p.booking_id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.status === "cancelada" || b.status === "no_show") {
      return { ok: false, error: `La reserva pasó a ${statusLabel(b.status).toLowerCase()} mientras tanto. No registré nada.` };
    }
    if (b.currency !== p.currency) return { ok: false, error: "La moneda de la reserva cambió. No registré nada." };
    const acc = await recheckAccount(p.account_id, p.currency);
    if (!acc.ok) return acc;
    const r = await attempt(() => addBookingPayment(p.booking_id, p.amount, p.account_id));
    if (!r.ok) {
      // `addBookingPayment` sube lo cobrado ANTES de crear el movimiento de Caja:
      // si falló en el medio (un timeout), avisarlo así, para que nadie lo repita.
      const after = await loadBooking(p.booking_id);
      if (after.ok && Number(after.value.paid_amount) > Number(b.paid_amount) + 0.004) {
        return {
          ok: false,
          error: `Quedó a medias: la reserva sumó el cobro pero el movimiento de Caja no se creó (${r.error}). No lo repitas: revisalo en la ficha de la reserva.`,
        };
      }
      return r;
    }
    const total = Number(r.value.total_amount ?? b.total_amount);
    const paid = Number(r.value.paid_amount ?? b.paid_amount + p.amount);
    return {
      ok: true,
      message: `Cobro registrado: ${money(p.amount, p.currency)} en ${acc.value.name}.`,
      href: hrefs.booking(p.booking_id),
      data: { reserva_id: p.booking_id, cobrado: paid, saldo: round2(total - paid) },
    };
  },
});

const ingresoPayload = z.object({
  account_id: idSchema,
  currency: z.string().min(1).max(12),
  amount: z.number().positive(),
  unit_id: idSchema.nullable(),
  description: z.string().min(2).max(300),
});

export const registrarIngreso = defineWrite({
  name: "registrar_ingreso",
  label: "Preparando el ingreso…",
  description:
    "Prepara un INGRESO suelto de Caja (plata que entra y no es el pago de una reserva: un reintegro, una venta, un aporte) para que la persona lo confirme. " +
    "Queda como ingreso de la administración, no se le liquida a ningún propietario. Si es lo que pagó un huésped por su reserva, usá registrar_cobro, no esto.",
  input: z.object({
    monto: z.number().positive().describe("Importe positivo, en la moneda de la cuenta."),
    detalle: z.string().min(2).max(300).describe("Qué fue, en pocas palabras (ej. «Reintegro de expensas de octubre»)."),
    cuenta: z
      .string()
      .describe("Cuenta de Caja donde entró la plata si la dijeron (ej. «Caja chica», «Banco»), o su id. Si no, omitir.")
      .optional(),
    moneda: z.string().describe("ARS, USD… sólo si la dijeron y no dijeron la cuenta.").optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si el ingreso es de un depto puntual.").optional(),
  }),
  payload: ingresoPayload,
  resource: "cash",
  action: "create",
  async propose(input) {
    const moneda = input.moneda?.trim().toUpperCase() || undefined;
    if (moneda && !/^[A-Z]{3}$/.test(moneda)) return { ok: false, error: `No reconozco la moneda «${input.moneda}». Usá el código: ARS, USD…` };
    const account = await resolveAccount(input.cuenta, { currency: moneda });
    if (account.ok !== true) return account;
    const a = account.value;
    if (moneda && a.currency.toUpperCase() !== moneda) {
      return { ok: false, error: `La cuenta «${a.name}» es en ${a.currency}, no en ${moneda}.` };
    }
    let unit: { id: string; code: string; name: string } | null = null;
    if (input.unidad) {
      const u = await resolveUnit(input.unidad);
      if (u.ok !== true) return u;
      unit = u.value;
    }
    const description = clip(input.detalle, 300);
    if (!description || description.length < 2) return { ok: false, error: "Decime qué fue el ingreso, en pocas palabras." };
    const amount = round2(input.monto);
    return {
      ok: true,
      payload: { account_id: a.id, currency: a.currency, amount, unit_id: unit?.id ?? null, description },
      summary: {
        title: "Registrar un ingreso",
        lines: [
          { label: "Importe", value: money(amount, a.currency) },
          { label: "Entra en", value: `${a.name} (${a.currency})` },
          ...(unit ? [{ label: "Unidad", value: `${unit.code} · ${unit.name}` }] : []),
          { label: "Detalle", value: description },
        ],
        note: "Queda como ingreso de la administración: no va a la liquidación de ningún propietario.",
        confirmLabel: "Registrar ingreso",
      },
    };
  },
  async execute(p) {
    const acc = await recheckAccount(p.account_id, p.currency);
    if (!acc.ok) return acc;
    if (p.unit_id) {
      const u = await resolveUnit(p.unit_id);
      if (u.ok !== true) return { ok: false, error: "La unidad ya no existe o está archivada. No registré nada." };
    }
    const r = await attempt(() =>
      createMovement({
        account_id: p.account_id,
        direction: "in",
        amount: p.amount,
        currency: acc.value.currency,
        category: "other",
        description: p.description,
        unit_id: p.unit_id,
        billable_to: "apartcba",
      }),
    );
    if (!r.ok) return r;
    return {
      ok: true,
      message: `Ingreso registrado: ${money(p.amount, acc.value.currency)} en ${acc.value.name}.`,
      href: hrefs.cashAccount(p.account_id),
      data: { movimiento_id: r.value?.id ?? null },
    };
  },
});
