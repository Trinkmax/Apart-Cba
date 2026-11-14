/**
 * Plata (nov-2026).
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
 * - `cargo_extra`: un cobro aparte sobre una reserva (`addBookingExtraCharge`:
 *   no toca total ni saldo).
 * - `transferir_entre_cuentas`: `createTransfer`, que NO chequea permisos ni que
 *   las cuentas sean de la organización (busca por id sin `organization_id`) y
 *   no es atómica: las dos cuentas salen siempre de `listAccounts` (org-scoped,
 *   activas) y se vuelven a verificar al confirmar.
 *
 * Nada se inventa: monto, cuota, concepto o a quién le corresponde la plata, si
 * no lo dijeron, se pregunta (`ask`) con la sugerencia del sistema si la hay.
 */
import { z } from "zod/v4";
import { addBookingExtraCharge, addBookingPayment } from "@/lib/actions/bookings";
import { createMovement, createTransfer, getAccountBalances, listAccounts, listMovements } from "@/lib/actions/cash";
import { listScheduleForBooking, listScheduleForLeaseGroup, markScheduleAsPaid } from "@/lib/actions/payment-schedule";
import type { BookingPaymentSchedule, CashAccount } from "@/lib/types/database";
import { attempt, defineWrite, hrefs } from "../../tool";
import { clip, dateRange, money, nightsBetween, shortDate } from "../../format";
import { resolveAccount, resolveUnit } from "../_resolve";
import {
  ask,
  findBooking,
  idSchema,
  isOta,
  joinNotes,
  loadBooking,
  nightsText,
  pickAccount,
  recheckAccount,
  round2,
  sourceLabel,
  statusLabel,
  unitLabel,
} from "./_shared";

const OPEN_CUOTA = new Set(["pending", "partial", "overdue"]);
const ASK_RESERVA = "¿De qué reserva? Decime el huésped o la unidad.";

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
    "Suma a lo cobrado de la reserva y entra a Caja en una cuenta de la misma moneda que la reserva. En alquileres mensuales se imputa a una cuota. " +
    "Si no te dijeron el monto (o la cuota), llamala igual: te dice qué preguntar, con el saldo como sugerencia. " +
    "Para ingresos que no son de una reserva usá registrar_ingreso; para un extra (late check-out, daños), cargo_extra; para gastos, registrar_gasto.",
  input: z.object({
    reserva: z
      .string()
      .describe(
        "De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva (ej. HMABC123), o el id que la persona eligió de una lista.",
      )
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir entre reservas.").optional(),
    monto: z.number().positive().describe("Importe cobrado, en la moneda de la reserva. Si no lo dijeron, omitir.").optional(),
    cuenta: z
      .string()
      .describe("Cuenta de Caja donde entró la plata si la dijeron (ej. «Efectivo», «Mercado Pago»), o su id. Si no, omitir.")
      .optional(),
    cuota: z
      .number()
      .int()
      .positive()
      .describe("Sólo alquileres mensuales: número de cuota (3 = la tercera), si lo dijeron o lo eligieron.")
      .optional(),
  }),
  payload: cobroPayload,
  resource: "payments",
  action: "create",
  async propose(input, ctx) {
    if (!input.reserva?.trim()) return ask(ASK_RESERVA);
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
    const nights = nightsBetween(b.check_in_date, b.check_out_date);
    const baseLines = [
      { label: "Huésped", value: who },
      { label: "Unidad", value: unitLabel(b.unit) },
      { label: "Fechas", value: `${dateRange(b.check_in_date, b.check_out_date)} · ${nightsText(nights)}` },
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
        let cuota: BookingPaymentSchedule;
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
        } else if (open.length === 1) {
          cuota = open[0];
        } else {
          return ask(
            `¿Qué cuota cobraste? La más vieja sin cobrar es la ${open[0].sequence_number} (vence ${shortDate(open[0].due_date, ctx.today)}).`,
            open.slice(0, 4).map((s) => `Cuota ${s.sequence_number} · vence ${shortDate(s.due_date, ctx.today)}`),
          );
        }
        const currency = cuota.currency;
        const falta = round2(Number(cuota.expected_amount) - Number(cuota.paid_amount));
        if (input.monto === undefined) {
          return ask(
            `¿Cuánto cobraste de la cuota ${cuota.sequence_number}? Falta ${money(falta, currency)}.`,
            falta > 0.01 ? [`${money(falta, currency)}, la cuota entera`, "Otro monto"] : undefined,
          );
        }
        const amount = round2(input.monto);
        const acc = await pickAccount(input.cuenta, currency);
        if (acc.ok !== true) return acc;
        const despues = round2(falta - amount);
        const others = open.length - 1;
        // En un contrato partido la cuota es de otro tramo: se muestra el período de ESA cuota.
        let period = baseLines[2].value;
        if (cuota.booking_id !== b.id) {
          const seg = await loadBooking(cuota.booking_id);
          if (seg.ok) {
            const n = nightsBetween(seg.value.check_in_date, seg.value.check_out_date);
            period = `${dateRange(seg.value.check_in_date, seg.value.check_out_date)} · ${nightsText(n)}`;
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
    const saldo = round2(b.total_amount - b.paid_amount);
    if (input.monto === undefined) {
      return saldo > 0.01
        ? ask(`¿Cuánto cobraste? El saldo de la reserva es ${money(saldo, currency)}.`, [`El saldo: ${money(saldo, currency)}`, "Otro monto"])
        : ask(`¿Cuánto cobraste? La reserva de ${who} no tiene saldo pendiente.`);
    }
    const amount = round2(input.monto);
    const acc = await pickAccount(input.cuenta, currency);
    if (acc.ok !== true) return acc;
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
          isOta(b.source) &&
            `Es una reserva de ${sourceLabel(b.source)}: lo que paga el huésped lo cobra la plataforma. Registrá acá sólo plata que entró a tu Caja.`,
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

// ── registrar_ingreso ───────────────────────────────────────────────────────

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
    "Queda como ingreso de la administración, no se le liquida a ningún propietario. Si falta el monto o qué fue, te dice qué preguntar. " +
    "Si es lo que pagó un huésped por su reserva, usá registrar_cobro, no esto.",
  input: z.object({
    monto: z.number().positive().describe("Importe positivo, en la moneda de la cuenta. Si no lo dijeron, omitir.").optional(),
    detalle: z.string().max(300).describe("Qué fue, en pocas palabras (ej. «Reintegro de expensas de octubre»).").optional(),
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
    if (input.monto === undefined) return ask("¿De cuánto es el ingreso?");
    const description = clip(input.detalle, 300);
    if (!description || description.length < 2) return ask("¿Qué fue? Por ejemplo: reintegro de expensas, venta de un mueble.");
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

// ── cargo_extra ─────────────────────────────────────────────────────────────

const EXTRA_FOR = ["administracion", "propietario"] as const;

export const cargoExtra = defineWrite({
  name: "cargo_extra",
  label: "Preparando el cargo extra…",
  description:
    "Prepara un CARGO EXTRA cobrado sobre una reserva (late check-out, limpieza extra, cochera, daños) para que la persona lo confirme. " +
    "Entra a Caja vinculado a la reserva pero NO cambia su total ni su saldo. Pregunta lo que falte (monto, concepto, si la plata es de la " +
    "administración o del propietario). Para el pago de la estadía en sí usá registrar_cobro.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id elegido de una lista.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    monto: z.number().positive().describe("Importe del extra, en la moneda de la reserva.").optional(),
    concepto: z.string().max(200).describe("Por qué es (ej. «Late check-out», «Limpieza extra»).").optional(),
    para: z
      .enum(EXTRA_FOR)
      .describe("De quién es la plata: administracion o propietario. Si no lo dijeron, omitir (se pregunta).")
      .optional(),
    cuenta: z.string().describe("Cuenta de Caja donde entró la plata, si la dijeron (o su id).").optional(),
  }),
  payload: z.object({
    booking_id: idSchema,
    amount: z.number().positive(),
    account_id: idSchema,
    currency: z.string().min(1).max(12),
    concept: z.string().min(2).max(200),
    billable_to: z.enum(["apartcba", "owner"]),
  }),
  resource: "payments",
  action: "create",
  async propose(input, ctx) {
    if (!input.reserva?.trim()) return ask(ASK_RESERVA);
    const found = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today });
    if (found.ok !== true) return found;
    const bk = await loadBooking(found.value.id);
    if (!bk.ok) return bk;
    const b = bk.value;
    const who = b.guest?.full_name ?? "Sin huésped";
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva." };
    if (b.status === "cancelada" || b.status === "no_show") {
      return { ok: false, error: `La reserva de ${who} está ${statusLabel(b.status).toLowerCase()}: no se le pueden cobrar extras.` };
    }
    if (input.monto === undefined) return ask(`¿De cuánto es el cargo extra a ${who}?`);
    const concept = clip(input.concepto, 200);
    if (!concept || concept.length < 2) return ask("¿Por qué es el cargo?", ["Late check-out", "Limpieza extra", "Cochera", "Daños"]);
    if (!input.para) {
      return ask(`¿La plata de «${concept}» es de la administración o del propietario?`, ["De la administración", "Del propietario"]);
    }
    const amount = round2(input.monto);
    const currency = b.currency;
    const acc = await pickAccount(input.cuenta, currency, "el cargo");
    if (acc.ok !== true) return acc;
    const owner = input.para === "propietario";
    return {
      ok: true,
      payload: {
        booking_id: b.id,
        amount,
        account_id: acc.value.id,
        currency,
        concept,
        billable_to: owner ? ("owner" as const) : ("apartcba" as const),
      },
      summary: {
        title: "Registrar un cargo extra",
        lines: [
          { label: "Huésped", value: who },
          { label: "Unidad", value: unitLabel(b.unit) },
          { label: "Fechas", value: dateRange(b.check_in_date, b.check_out_date) },
          { label: "Concepto", value: concept },
          { label: "Importe", value: money(amount, currency) },
          { label: "Entra en", value: `${acc.value.name} (${acc.value.currency})` },
          { label: "Es de", value: owner ? "El propietario de la unidad" : "La administración" },
        ],
        note: "Es un cobro aparte: no cambia el total ni el saldo de la reserva.",
        confirmLabel: "Registrar cargo",
      },
    };
  },
  async execute(p) {
    const bk = await loadBooking(p.booking_id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva. No registré nada." };
    if (b.status === "cancelada" || b.status === "no_show") {
      return { ok: false, error: `La reserva pasó a ${statusLabel(b.status).toLowerCase()} mientras tanto. No registré nada.` };
    }
    if (b.currency !== p.currency) return { ok: false, error: "La moneda de la reserva cambió. No registré nada." };
    const acc = await recheckAccount(p.account_id, p.currency);
    if (!acc.ok) return acc;
    const r = await attempt(() =>
      addBookingExtraCharge({
        booking_id: p.booking_id,
        amount: p.amount,
        account_id: p.account_id,
        concept: p.concept,
        billable_to: p.billable_to,
      }),
    );
    if (!r.ok) return r;
    return {
      ok: true,
      message: `Cargo extra registrado: ${money(p.amount, p.currency)} por «${p.concept}» en ${acc.value.name}.`,
      href: hrefs.booking(p.booking_id),
      data: { movimiento_id: r.value?.id ?? null },
    };
  },
});

// ── transferir_entre_cuentas ────────────────────────────────────────────────

/** ¿Qué patas de esta transferencia quedaron escritas? null = no se pudo saber. */
async function transferLegsSince(
  p: { from_account_id: string; to_account_id: string; from_amount: number; to_amount: number },
  userId: string,
  sinceMs: number,
): Promise<{ out: boolean; in: boolean } | null> {
  const [outs, ins] = await Promise.all([
    attempt(() => listMovements({ accountId: p.from_account_id, category: "transfer", limit: 10 })),
    attempt(() => listMovements({ accountId: p.to_account_id, category: "transfer", limit: 10 })),
  ]);
  if (!outs.ok || !ins.ok) return null;
  const mine = (m: { created_by?: string | null; created_at?: string | null }) =>
    m.created_by === userId && Date.parse(m.created_at ?? "") >= sinceMs;
  return {
    out: outs.value.some((m) => mine(m) && m.direction === "out" && Math.abs(m.amount - p.from_amount) < 0.005),
    in: ins.value.some((m) => mine(m) && m.direction === "in" && Math.abs(m.amount - p.to_amount) < 0.005),
  };
}

export const transferirEntreCuentas = defineWrite({
  name: "transferir_entre_cuentas",
  label: "Preparando la transferencia…",
  description:
    "Prepara una TRANSFERENCIA entre dos cuentas de Caja (ej. depositar el efectivo en el banco, pasar a Mercado Pago) para que la persona la confirme. " +
    "Si las cuentas son de distinta moneda, pregunta cuánto entra en la de destino. Pregunta lo que falte (cuentas, monto).",
  input: z.object({
    cuenta_origen: z.string().describe("Cuenta de la que SALE la plata (nombre o id).").optional(),
    cuenta_destino: z.string().describe("Cuenta a la que ENTRA la plata (nombre o id).").optional(),
    monto: z.number().positive().describe("Cuánto sale de la cuenta de origen, en su moneda.").optional(),
    monto_destino: z
      .number()
      .positive()
      .describe("Sólo si las cuentas tienen distinta moneda: cuánto entra en la de destino, en SU moneda (si te dieron la cotización, calculalo).")
      .optional(),
    detalle: z.string().max(200).describe("Descripción, si la dieron.").optional(),
  }),
  payload: z.object({
    from_account_id: idSchema,
    to_account_id: idSchema,
    from_currency: z.string().min(1).max(12),
    to_currency: z.string().min(1).max(12),
    from_amount: z.number().positive(),
    to_amount: z.number().positive(),
    exchange_rate: z.number().positive().nullable(),
    description: z.string().min(2).max(200),
  }),
  resource: "cash",
  action: "create",
  async propose(input) {
    const list = await attempt(() => listAccounts());
    if (!list.ok) return list;
    const accounts = (list.value as CashAccount[]).filter((a) => a.active);
    if (accounts.length < 2) return { ok: false, error: "Para transferir hacen falta dos cuentas de Caja activas." };
    if (!input.cuenta_origen?.trim()) return ask("¿De qué cuenta sale la plata?", accounts.slice(0, 4).map((a) => a.name));
    const from = await resolveAccount(input.cuenta_origen);
    if (from.ok !== true) return from;
    const f = from.value;
    if (!input.cuenta_destino?.trim()) {
      return ask(`¿A qué cuenta va la plata de ${f.name}?`, accounts.filter((a) => a.id !== f.id).slice(0, 4).map((a) => a.name));
    }
    const to = await resolveAccount(input.cuenta_destino);
    if (to.ok !== true) return to;
    const t = to.value;
    if (t.id === f.id) return { ok: false, error: "La cuenta de origen y la de destino son la misma: elegí dos distintas." };

    const balances = await attempt(() => getAccountBalances());
    const balance = balances.ok ? balances.value[f.id] : undefined;
    if (input.monto === undefined) {
      const has = typeof balance === "number" && Number.isFinite(balance);
      return ask(
        `¿Cuánto pasás de ${f.name} a ${t.name}?${has ? ` Hoy tiene ${money(balance, f.currency)}.` : ""}`,
        has && balance > 0.01 ? [`Todo: ${money(balance, f.currency)}`, "Otro monto"] : undefined,
      );
    }
    const fromAmount = round2(input.monto);
    const same = f.currency === t.currency;
    const destino = input.monto_destino;
    if (!same && destino === undefined) {
      return ask(`¿Cuántos ${t.currency} entran en ${t.name} por ${money(fromAmount, f.currency)}?`);
    }
    const toAmount = same || destino === undefined ? fromAmount : round2(destino);
    // Como la pantalla de Caja: cotización = moneda de origen por cada 1 de la de destino.
    const rate = same ? null : Math.round((fromAmount / toAmount) * 10_000) / 10_000;
    // Para mostrarla, la forma natural: 1 de la moneda fuerte = tanto de la otra.
    const quote =
      rate === null
        ? null
        : rate >= 1
          ? `1 ${t.currency} = ${money(rate, f.currency)}`
          : `1 ${f.currency} = ${money(round2(toAmount / fromAmount), t.currency)}`;
    const description = clip(input.detalle, 200) ?? `Transferencia de ${f.name} a ${t.name}`;
    const after = typeof balance === "number" ? round2(balance - fromAmount) : null;
    return {
      ok: true,
      payload: {
        from_account_id: f.id,
        to_account_id: t.id,
        from_currency: f.currency,
        to_currency: t.currency,
        from_amount: fromAmount,
        to_amount: toAmount,
        exchange_rate: rate,
        description,
      },
      summary: {
        title: "Transferir entre cuentas",
        lines: [
          { label: "Sale de", value: `${f.name} (${f.currency})` },
          { label: "Importe", value: money(fromAmount, f.currency) },
          { label: "Entra en", value: `${t.name} (${t.currency})` },
          ...(same
            ? []
            : [
                { label: "Acredita", value: money(toAmount, t.currency) },
                { label: "Cotización", value: quote ?? "—" },
              ]),
          { label: "Detalle", value: description },
        ],
        note: after !== null && after < -0.01 ? `${f.name} queda en negativo (${money(after, f.currency)}).` : undefined,
        confirmLabel: "Transferir",
      },
    };
  },
  async execute(p, ctx) {
    const list = await attempt(() => listAccounts());
    if (!list.ok) return list;
    const accounts = (list.value as CashAccount[]).filter((a) => a.active);
    const f = accounts.find((a) => a.id === p.from_account_id);
    const t = accounts.find((a) => a.id === p.to_account_id);
    if (!f || !t) return { ok: false, error: "Una de las cuentas ya no existe o la desactivaron. No transferí nada." };
    if (f.currency !== p.from_currency || t.currency !== p.to_currency) {
      return { ok: false, error: "La moneda de una de las cuentas cambió. No transferí nada." };
    }
    const startedAt = Date.now();
    const r = await attempt(() =>
      createTransfer({
        from_account_id: p.from_account_id,
        to_account_id: p.to_account_id,
        from_amount: p.from_amount,
        to_amount: p.to_amount,
        exchange_rate: p.exchange_rate ?? undefined,
        description: p.description,
      }),
    );
    if (!r.ok) {
      // createTransfer inserta las dos patas por separado (primero la salida):
      // se mira qué quedó escrito para decir exactamente qué pasó.
      const legs = await transferLegsSince(p, ctx.user.id, startedAt - 5_000);
      if (legs === null) {
        return {
          ok: false,
          error: `La transferencia no se completó (${r.error}). Antes de repetirla, revisá en Caja que no haya quedado un egreso suelto en ${f.name}.`,
        };
      }
      if (legs.out && legs.in) {
        return {
          ok: false,
          error: `Se registraron la salida y la entrada, pero algo falló al final (${r.error}). No la repitas: revisala en Caja.`,
        };
      }
      if (legs.out) {
        return {
          ok: false,
          error: `Quedó a medias: salió ${money(p.from_amount, p.from_currency)} de ${f.name} pero no entró en ${t.name} (${r.error}). No la repitas: en Caja, borrá ese egreso o cargá el ingreso a mano.`,
        };
      }
      return { ok: false, error: `No se registró nada (${r.error}). Podés intentarlo de nuevo.` };
    }
    return {
      ok: true,
      message: `Transferencia registrada: ${money(p.from_amount, p.from_currency)} de ${f.name} a ${t.name}.`,
      href: hrefs.cash(),
    };
  },
});
