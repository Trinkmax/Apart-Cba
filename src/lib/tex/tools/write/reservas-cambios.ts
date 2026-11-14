/**
 * Cambios sobre una reserva existente (nov-2026).
 *
 * - `modificar_reserva`: precio, personas, horarios, notas, canal, código
 *   externo. `updateBooking` REEMPLAZA la fila (el esquema completo con
 *   defaults): el input se arma con TODO lo que la reserva tiene hoy
 *   (`bookingInputFrom`) y se pisa sólo lo pedido. Al confirmar, si la huella de
 *   la fila cambió (otra edición, un cobro), no se pisa nada.
 * - `mover_reserva`: fechas y/o unidad, con `previewBookingChange` y la misma
 *   action que el arrastre del PMS (`moveBookingTransaction`, vía
 *   MoveConfirmDialog). Motivo obligatorio si cambia la unidad o más de 30
 *   noches, como la pantalla.
 * - `completar_precio`: reservas que entraron en $0 (las de OTA) →
 *   `completeChannelPrice`, que sólo escribe mientras el total siga ≤ 0.
 * - `cancelar_reserva`: una decisión humana en una tarjeta roja, con motivo
 *   (la 053 prohíbe las cancelaciones AUTOMÁTICAS, no las de una persona).
 *   Nunca no-show ni reactivar.
 */
import { z } from "zod/v4";
import {
  changeBookingStatus,
  completeChannelPrice,
  listBookingsNeedingCompletion,
  moveBookingTransaction,
  previewBookingChange,
  updateBooking,
} from "@/lib/actions/bookings";
import { listScheduleForBooking, listScheduleForLeaseGroup } from "@/lib/actions/payment-schedule";
import { getUnit, listUnitsForBookingForm } from "@/lib/actions/units";
import { MAX_BOOKING_NIGHTS } from "@/lib/booking-split";
import { addDaysYmd } from "@/lib/dates";
import type { BookingPaymentSchedule, BookingStatus } from "@/lib/types/database";
import { attempt, defineWrite, hrefs } from "../../tool";
import { clip, dateRange, isYmd, money, nightsBetween, shortDate } from "../../format";
import { resolveUnit } from "../_resolve";
import {
  ask,
  attemptResult,
  bookingFingerprint,
  bookingInputFrom,
  bookingOptions,
  candidateFromDetail,
  describeBooking,
  findBooking,
  HHMM_RE,
  hhmm,
  idSchema,
  isOta,
  joinNotes,
  loadBooking,
  loadFullBooking,
  nightsText,
  round2,
  sourceLabel,
  statusLabel,
  unitLabel,
  ymdSchema,
  type BookingCandidate,
} from "./_shared";
import { ASK_RESERVA, monthlyByForm, MOVABLE, previewBlockers, SOURCES, unitAvailability } from "./reservas";

const notCancelled = (c: BookingCandidate) =>
  c.status === "cancelada" || c.status === "no_show"
    ? `La reserva de ${describeBooking(c)} está ${statusLabel(c.status).toLowerCase()}: se edita desde su ficha (${hrefs.booking(c.id)}).`
    : null;

/**
 * Con plata cobrada, la moneda de la reserva no cambia: el total quedaría en
 * USD y lo cobrado (pesos de verdad) contado como dólares, con el saldo en
 * negativo y el check-out destrabado.
 */
function currencyChangeBlocked(b: { currency: string | null; paid_amount: number }, next: string): string | null {
  const cur = (b.currency || "ARS").toUpperCase();
  if (next === cur || !(Number(b.paid_amount) > 0.004)) return null;
  return `La reserva ya tiene ${money(Number(b.paid_amount), cur)} cobrados: el precio va en ${cur}. Si de verdad es en ${next}, primero hay que anular ese cobro.`;
}

/** Capacidad de la unidad (0 = sin dato). */
async function unitCapacity(unitId: string): Promise<number> {
  const r = await attempt(() => getUnit(unitId));
  return r.ok ? Number((r.value as { max_guests?: number | null } | null)?.max_guests ?? 0) : 0;
}

// ── modificar_reserva ───────────────────────────────────────────────────────

const changesSchema = z.object({
  total_amount: z.number().min(0).optional(),
  guests_count: z.number().int().min(1).max(50).optional(),
  check_in_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  check_out_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  notes_replace: z.string().max(1000).optional(),
  notes_append: z.string().max(1000).optional(),
  internal_append: z.string().max(1000).optional(),
  source: z.enum(SOURCES).optional(),
  external_id: z.string().max(100).nullable().optional(),
});

export const modificarReserva = defineWrite({
  name: "modificar_reserva",
  label: "Preparando el cambio…",
  description:
    "Prepara un CAMBIO en una reserva existente para que la persona lo confirme: el total, la cantidad de personas, el horario de entrada o salida, " +
    "las notas (agregar o reemplazar), una nota interna, el canal o el código de la plataforma. Cambia sólo lo pedido. " +
    "Para fechas o unidad usá mover_reserva; para el estado, cambiar_estado_reserva; para cargar el precio de una reserva que entró en $0, completar_precio.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id elegido de una lista.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    total: z.number().min(0).describe("Nuevo total de la estadía (con limpieza), si lo cambian.").optional(),
    huespedes: z.number().int().min(1).max(50).describe("Nueva cantidad de personas, si la cambian.").optional(),
    confirma_capacidad: z.boolean().describe("true sólo si la persona confirmó que son más que la capacidad de la unidad.").optional(),
    hora_entrada: z.string().describe("Nuevo horario de check-in, HH:MM (24 h).").optional(),
    hora_salida: z.string().describe("Nuevo horario de check-out, HH:MM (24 h).").optional(),
    notas: z.string().max(1000).describe("Texto para las notas de la reserva.").optional(),
    notas_modo: z.enum(["agregar", "reemplazar"]).describe("agregar (por defecto) suma el texto; reemplazar borra lo que había.").optional(),
    nota_interna: z.string().max(1000).describe("Texto que se AGREGA a las notas internas (no las ve el huésped).").optional(),
    canal: z.enum(SOURCES).describe("Nuevo canal de venta, si lo corrigen.").optional(),
    codigo_externo: z.string().max(100).describe("Código de la reserva en la plataforma (ej. HMABC123), si lo cargan o corrigen.").optional(),
  }),
  payload: z.object({ booking_id: idSchema, fingerprint: z.string().min(4).max(40), changes: changesSchema }),
  resource: "bookings",
  action: "update",
  async propose(input, ctx) {
    if (!input.reserva?.trim()) return ask(ASK_RESERVA);
    const found = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today, eligible: notCancelled });
    if (found.ok !== true) return found;
    const full = await loadFullBooking(found.value.id);
    if (!full.ok) return full;
    const b = full.value;
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva." };
    const described = describeBooking({
      guest: b.guest?.full_name ?? null,
      unitCode: b.unit?.code ?? null,
      checkIn: b.check_in_date,
      checkOut: b.check_out_date,
    });
    if (b.status === "cancelada" || b.status === "no_show") {
      return { ok: false, error: `La reserva de ${described} está ${statusLabel(b.status).toLowerCase()}: se edita desde su ficha (${hrefs.booking(b.id)}).` };
    }
    const who = b.guest?.full_name ?? "Sin huésped";
    const cur = b.currency || "ARS";
    const total = Number(b.total_amount ?? 0);
    const paid = Number(b.paid_amount ?? 0);

    const requested = [
      input.total, input.huespedes, input.hora_entrada, input.hora_salida, input.notas, input.nota_interna, input.canal, input.codigo_externo,
    ].some((v) => v !== undefined && v !== "");
    if (!requested) {
      return ask(`¿Qué querés cambiar de la reserva de ${described}?`, [
        "El total",
        "Cantidad de personas",
        "Horario de entrada o salida",
        "Las notas",
      ]);
    }

    const changes: z.infer<typeof changesSchema> = {};
    const lines: Array<{ label: string; value: string }> = [];
    const notes: Array<string | false> = [];

    if (input.total !== undefined) {
      if (b.mode === "mensual") return { ok: false, error: "En un alquiler mensual el importe sale de la renta: cambialo desde la ficha de la reserva." };
      if (total <= 0 && isOta(b.source)) {
        return { ok: false, error: `Esa reserva entró sin precio desde ${sourceLabel(b.source)}: cargalo con completar_precio.` };
      }
      const t = round2(input.total);
      const fee = Number(b.cleaning_fee ?? 0);
      if (fee > 0 && t < fee) return { ok: false, error: `El total no puede ser menor que la limpieza incluida (${money(fee, cur)}).` };
      if (Math.abs(t - total) >= 0.01) {
        changes.total_amount = t;
        lines.push({ label: "Total", value: `${money(total, cur)} → ${money(t, cur)}` });
        const saldo = round2(t - paid);
        lines.push({ label: "Saldo después", value: saldo > 0.01 ? money(saldo, cur) : saldo < -0.01 ? `${money(-saldo, cur)} a favor del huésped` : "Sin saldo" });
      }
    }
    if (input.huespedes !== undefined && input.huespedes !== Number(b.guests_count)) {
      if (!input.confirma_capacidad) {
        const max = await unitCapacity(b.unit_id);
        if (max > 0 && input.huespedes > max) {
          return ask(`¿Son ${input.huespedes} personas? ${b.unit?.code ?? "La unidad"} es para ${max}.`, [`Sí, son ${input.huespedes}`, "Corregir la cantidad"]);
        }
      }
      changes.guests_count = input.huespedes;
      lines.push({ label: "Personas", value: `${b.guests_count} → ${input.huespedes}` });
    }
    for (const [key, raw, label, current] of [
      ["check_in_time", input.hora_entrada, "Entrada", b.check_in_time],
      ["check_out_time", input.hora_salida, "Salida", b.check_out_time],
    ] as const) {
      if (raw === undefined || raw.trim() === "") continue;
      if (!HHMM_RE.test(raw.trim())) return { ok: false, error: `El horario «${raw}» va como HH:MM (ej. 15:30).` };
      const next = hhmm(raw) ?? raw.trim();
      if (next !== hhmm(current)) {
        changes[key] = next;
        lines.push({ label: `Horario de ${label.toLowerCase()}`, value: `${hhmm(current) ?? "—"} → ${next}` });
      }
    }
    const nota = clip(input.notas, 1000);
    if (nota) {
      if (input.notas_modo === "reemplazar") {
        changes.notes_replace = nota;
        lines.push({ label: "Notas (reemplaza lo que había)", value: nota });
      } else {
        changes.notes_append = nota;
        lines.push({ label: "Notas (se agrega)", value: nota });
      }
    }
    const interna = clip(input.nota_interna, 1000);
    if (interna) {
      changes.internal_append = interna;
      lines.push({ label: "Nota interna (se agrega)", value: interna });
    }
    if (input.canal && input.canal !== b.source) {
      changes.source = input.canal;
      lines.push({ label: "Canal", value: `${sourceLabel(b.source)} → ${sourceLabel(input.canal)}` });
      notes.push("Las comisiones pasan a las del canal nuevo (las que tiene configuradas la organización).");
    }
    // Vacío = "no lo dijeron", nunca "borralo": el código de la OTA es lo que
    // cruza la reserva con los mails de cancelación. Borrarlo va por la ficha.
    const code = input.codigo_externo?.trim() ?? "";
    if (code && code !== (b.external_id ?? "")) {
      changes.external_id = code;
      lines.push({ label: "Código de la plataforma", value: `${b.external_id || "—"} → ${code}` });
    }
    if (Object.keys(changes).length === 0) return { ok: false, error: "Eso ya está así en la reserva: no hay nada para cambiar." };

    return {
      ok: true,
      payload: { booking_id: b.id, fingerprint: bookingFingerprint(b), changes },
      summary: {
        title: "Modificar la reserva",
        lines: [
          { label: "Huésped", value: who },
          { label: "Unidad", value: unitLabel(b.unit) },
          { label: "Fechas", value: `${dateRange(b.check_in_date, b.check_out_date)} · ${nightsText(nightsBetween(b.check_in_date, b.check_out_date))}` },
          ...lines,
        ],
        note: joinNotes([
          ...notes,
          isOta(b.source) && changes.total_amount !== undefined && `Es una reserva de ${sourceLabel(b.source)}: el total tiene que ser el de la plataforma.`,
          changes.total_amount !== undefined && "Las comisiones se recalculan con el total nuevo.",
        ]),
        confirmLabel: "Guardar cambios",
      },
    };
  },
  async execute(p, ctx) {
    const full = await loadFullBooking(p.booking_id);
    if (!full.ok) return full;
    const b = full.value;
    if (bookingFingerprint(b) !== p.fingerprint) {
      return { ok: false, error: "La reserva cambió mientras tanto (otra edición o un cobro). No toqué nada: pedímelo de nuevo." };
    }
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva. No toqué nada." };
    if (b.status === "cancelada" || b.status === "no_show") return { ok: false, error: "La reserva quedó cancelada. No toqué nada." };
    const c = p.changes;
    const merged = bookingInputFrom(b);
    if (c.total_amount !== undefined) merged.total_amount = c.total_amount;
    if (c.guests_count !== undefined) merged.guests_count = c.guests_count;
    if (c.check_in_time !== undefined) merged.check_in_time = c.check_in_time;
    if (c.check_out_time !== undefined) merged.check_out_time = c.check_out_time;
    if (c.notes_replace !== undefined) merged.notes = c.notes_replace;
    if (c.notes_append !== undefined) merged.notes = merged.notes ? `${merged.notes}\n${c.notes_append}` : c.notes_append;
    if (c.internal_append !== undefined) {
      const line = `${c.internal_append} — ${ctx.user.name}, con Tex (${ctx.today}).`;
      merged.internal_notes = merged.internal_notes ? `${merged.internal_notes}\n${line}` : line;
    }
    if (c.source !== undefined) {
      merged.source = c.source;
      // Como el formulario al cambiar el Origen: las comisiones vuelven a la cascada del canal nuevo.
      merged.channel_commission_pct = null;
      merged.commission_pct = null;
    }
    if (c.external_id) merged.external_id = c.external_id;
    const r = await attempt(() => updateBooking(p.booking_id, merged));
    if (!r.ok) {
      // updateBooking sigue después del UPDATE (cuotas, división de estadías
      // largas): si falló ahí, el cambio ya está guardado. Que nadie lo repita.
      const after = await loadFullBooking(p.booking_id);
      if (after.ok && bookingFingerprint(after.value) !== p.fingerprint) {
        return {
          ok: false,
          error: `El cambio se guardó, pero algo falló después (${r.error}). No lo repitas: revisá la reserva en su ficha.`,
        };
      }
      return r;
    }
    const cur = b.currency || "ARS";
    return {
      ok: true,
      message: `Reserva actualizada: ${b.guest?.full_name ?? "la reserva"} en ${b.unit?.code ?? "la unidad"}${c.total_amount !== undefined ? ` (total ${money(c.total_amount, cur)})` : ""}.`,
      href: hrefs.booking(p.booking_id),
    };
  },
});

// ── mover_reserva ───────────────────────────────────────────────────────────

const notMovable = (c: BookingCandidate) =>
  MOVABLE.has(c.status) ? null : `La reserva de ${describeBooking(c)} está ${statusLabel(c.status).toLowerCase()}: no se puede mover.`;

export const moverReserva = defineWrite({
  name: "mover_reserva",
  label: "Preparando el cambio de fechas…",
  description:
    "Prepara un cambio de FECHAS (llegada y/o salida: mover, acortar o alargar) y/o de UNIDAD de una reserva para que la persona lo confirme. " +
    "Revisa choques con otras reservas, solicitudes de canal y liquidaciones cerradas; si el total cambia, pregunta cuál queda. " +
    "Si cambia la unidad pide el motivo (queda registrado). Para cambiar otras cosas usá modificar_reserva.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id elegido de una lista.")
      .optional(),
    unidad: z.string().describe("Unidad ACTUAL de la reserva, si hace falta para encontrarla.").optional(),
    nueva_unidad: z.string().describe("Unidad a la que se pasa (código, nombre o id), si cambia.").optional(),
    desde: z.string().describe("Nueva fecha de llegada, YYYY-MM-DD, si cambia.").optional(),
    hasta: z.string().describe("Nueva fecha de salida, YYYY-MM-DD, si cambia.").optional(),
    total: z.number().min(0).describe("Total de la estadía tal como lo eligió la persona (si se le preguntó). Si no, omitir.").optional(),
    motivo: z.string().max(500).describe("Por qué se mueve (obligatorio si cambia la unidad o más de 30 noches).").optional(),
  }),
  payload: z.object({
    booking_id: idSchema,
    from_unit_id: idSchema,
    from_check_in: ymdSchema,
    from_check_out: ymdSchema,
    previous_total: z.number(),
    unit_id: idSchema,
    check_in_date: ymdSchema,
    check_out_date: ymdSchema,
    total_amount: z.number().min(0).nullable(),
    reason: z.string().max(500).nullable(),
  }),
  resource: "bookings",
  action: "update",
  async propose(input, ctx) {
    if (!input.reserva?.trim()) return ask(ASK_RESERVA);
    const found = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today, eligible: notMovable });
    if (found.ok !== true) return found;
    const bk = await loadBooking(found.value.id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva." };
    const why = notMovable(candidateFromDetail(b));
    if (why) return { ok: false, error: why };
    if (b.mode === "mensual") return { ok: false, error: monthlyByForm(b.id) };
    const who = b.guest?.full_name ?? "Sin huésped";
    const desde = input.desde?.trim() || undefined;
    const hasta = input.hasta?.trim() || undefined;
    if (!input.nueva_unidad?.trim() && !desde && !hasta) {
      return ask(`¿Qué cambia en la reserva de ${who}: las fechas o la unidad?`, ["Las fechas", "La unidad"]);
    }

    // Unidad destino.
    let unit = { id: b.unit_id, code: b.unit?.code ?? "la unidad", name: b.unit?.name ?? "" };
    if (input.nueva_unidad?.trim()) {
      const u = await resolveUnit(input.nueva_unidad);
      if (u.ok !== true) return u;
      unit = u.value;
    }
    const unitChanged = unit.id !== b.unit_id;

    // Fechas: con sólo una llegada nueva, ¿se corre toda la estadía o sólo la llegada?
    if (desde && !isYmd(desde)) return { ok: false, error: "La fecha de llegada va en formato YYYY-MM-DD." };
    if (hasta && !isYmd(hasta)) return { ok: false, error: "La fecha de salida va en formato YYYY-MM-DD." };
    const oldNights = nightsBetween(b.check_in_date, b.check_out_date);
    if (desde && !hasta && desde !== b.check_in_date) {
      const shifted = addDaysYmd(desde, oldNights);
      return ask(
        `¿Se corre toda la estadía (${nightsText(oldNights)}: del ${dateRange(desde, shifted)}) o cambia sólo la llegada (sale igual el ${shortDate(b.check_out_date, ctx.today)})?`,
        [
          `Toda: del ${shortDate(desde, ctx.today)} al ${shortDate(shifted, ctx.today)}`,
          ...(desde < b.check_out_date ? [`Sólo la llegada: entra el ${shortDate(desde, ctx.today)}`] : []),
        ],
      );
    }
    const newIn = desde ?? b.check_in_date;
    const newOut = hasta ?? b.check_out_date;
    if (+newIn.slice(0, 4) < 2020 || +newOut.slice(0, 4) > 2100) return { ok: false, error: "Revisá el año de las fechas." };
    if (newOut <= newIn) return { ok: false, error: "La salida tiene que ser después de la llegada." };
    if (!unitChanged && newIn === b.check_in_date && newOut === b.check_out_date) {
      return { ok: false, error: "La reserva ya está en esa unidad y esas fechas: no hay nada para mover." };
    }
    const newNights = nightsBetween(newIn, newOut);
    const reason = clip(input.motivo, 500) ?? null;
    if ((unitChanged || Math.abs(newNights - oldNights) > 30) && !reason) {
      return unitChanged
        ? ask(`¿Por qué pasa a ${unit.code}? Queda registrado en la reserva.`, ["Problema en la unidad", "Pedido del huésped"])
        : ask("Cambia más de 30 noches: ¿por qué? Queda registrado en la reserva.");
    }

    const pv = await attempt(() =>
      previewBookingChange({ id: b.id, unit_id: unit.id, check_in_date: newIn, check_out_date: newOut }),
    );
    if (!pv.ok) return pv;
    const preview = pv.value;
    const blockers = previewBlockers(preview);
    if (blockers) return { ok: false, error: `No se puede mover: ${blockers}.` };
    const av = await unitAvailability(unit.id, unit.code, newIn, newOut, b.id);
    if (!av.ok) return av;
    if (av.value.busy) return { ok: false, error: av.value.reason ?? `${unit.code} no está libre en esas fechas.` };

    const pd = preview.price_diff;
    const previous = round2(pd.previous_total);
    const suggested = round2(pd.suggested_total);
    const basisLabel = pd.basis === "nightly" ? "misma tarifa por noche" : "renta mensual prorrateada";
    let newTotal = previous;
    if (input.total !== undefined) newTotal = round2(input.total);
    else if (pd.basis !== "unchanged" && Math.abs(suggested - previous) >= 0.01) {
      return ask(
        `¿El total pasa a ${money(suggested, b.currency)} (${basisLabel}) o queda en ${money(previous, b.currency)}?`,
        [`Pasa a ${money(suggested, b.currency)}`, `Queda en ${money(previous, b.currency)}`, "Otro monto"],
      );
    }
    const totalToSend = Math.abs(newTotal - previous) >= 0.01 ? newTotal : null;
    const saldo = round2(newTotal - b.paid_amount);
    const fromUnit = unitLabel(b.unit);
    const toUnit = `${unit.code}${unit.name ? ` · ${unit.name}` : ""}`;

    return {
      ok: true,
      payload: {
        booking_id: b.id,
        from_unit_id: b.unit_id,
        from_check_in: b.check_in_date,
        from_check_out: b.check_out_date,
        previous_total: previous,
        unit_id: unit.id,
        check_in_date: newIn,
        check_out_date: newOut,
        total_amount: totalToSend,
        reason,
      },
      summary: {
        title: unitChanged ? "Cambiar la reserva de unidad" : "Cambiar las fechas de la reserva",
        lines: [
          { label: "Huésped", value: who },
          { label: "Unidad", value: unitChanged ? `${fromUnit} → ${toUnit}` : fromUnit },
          {
            label: "Entrada",
            value: newIn === b.check_in_date ? shortDate(newIn, ctx.today) : `${shortDate(b.check_in_date, ctx.today)} → ${shortDate(newIn, ctx.today)}`,
          },
          {
            label: "Salida",
            value: newOut === b.check_out_date ? shortDate(newOut, ctx.today) : `${shortDate(b.check_out_date, ctx.today)} → ${shortDate(newOut, ctx.today)}`,
          },
          { label: "Noches", value: newNights === oldNights ? String(newNights) : `${oldNights} → ${newNights}` },
          {
            label: "Total",
            value: totalToSend === null ? `${money(previous, b.currency)} (no cambia)` : `${money(previous, b.currency)} → ${money(newTotal, b.currency)}`,
          },
          { label: "Saldo después", value: saldo > 0.01 ? money(saldo, b.currency) : "Sin saldo" },
          ...(reason ? [{ label: "Motivo", value: reason }] : []),
        ],
        note: joinNotes([
          ...preview.warnings.filter((w) => w.kind === "info").map((w) => `${w.message}.`),
          newOut !== b.check_out_date && preview.cleaning_tasks_affected.length > 0 && "La limpieza de salida se mueve con la nueva fecha.",
          unitChanged && b.status === "check_in" && "El huésped ya está adentro: coordiná el cambio de unidad con él.",
          av.value.tentative &&
            `Hay una solicitud de ${av.value.tentativeChannel ?? "una plataforma"} sin confirmar en esas fechas en ${unit.code}: si la aceptan, se superponen.`,
          newNights > MAX_BOOKING_NIGHTS &&
            b.lease_group_id &&
            `Pasa de ${MAX_BOOKING_NIGHTS} noches: el sistema la divide en períodos de ${MAX_BOOKING_NIGHTS}.`,
          isOta(b.source) &&
            `Es una reserva de ${sourceLabel(b.source)}: hacé el cambio también en la plataforma, si no va a quedar con fechas distintas.`,
        ]),
        confirmLabel: "Mover reserva",
      },
    };
  },
  async execute(p, ctx) {
    const bk = await loadBooking(p.booking_id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (!MOVABLE.has(b.status)) return { ok: false, error: `La reserva pasó a ${statusLabel(b.status).toLowerCase()} mientras tanto. No toqué nada.` };
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva. No toqué nada." };
    if (b.mode === "mensual") return { ok: false, error: `${monthlyByForm(b.id)} No toqué nada.` };
    if (b.unit_id !== p.from_unit_id || b.check_in_date !== p.from_check_in || b.check_out_date !== p.from_check_out) {
      return { ok: false, error: "La reserva cambió de fechas o de unidad mientras tanto. No toqué nada: pedímelo de nuevo." };
    }
    if (Math.abs(b.total_amount - p.previous_total) >= 0.01) {
      return { ok: false, error: "El importe de la reserva cambió mientras tanto. No toqué nada: pedímelo de nuevo." };
    }
    const u = await resolveUnit(p.unit_id);
    if (u.ok !== true) return { ok: false, error: "La unidad de destino ya no existe o está archivada. No toqué nada." };
    const pv = await attempt(() =>
      previewBookingChange({ id: b.id, unit_id: p.unit_id, check_in_date: p.check_in_date, check_out_date: p.check_out_date }),
    );
    if (!pv.ok) return pv;
    if (previewBlockers(pv.value)) return { ok: false, error: "Mientras confirmabas apareció un choque con otra reserva o una liquidación cerrada. No toqué nada." };
    const av = await unitAvailability(p.unit_id, u.value.code, p.check_in_date, p.check_out_date, b.id);
    if (!av.ok) return av;
    if (av.value.busy) return { ok: false, error: `Mientras confirmabas se ocupó: ${av.value.reason ?? "ya no está libre."} No toqué nada.` };
    const r = await attempt(() =>
      moveBookingTransaction({
        id: p.booking_id,
        unit_id: p.unit_id,
        check_in_date: p.check_in_date,
        check_out_date: p.check_out_date,
        total_amount: p.total_amount,
        reason: p.reason,
      }),
    );
    if (!r.ok) {
      // moveBookingTransaction sigue después del UPDATE (limpiezas, división de
      // estadías largas): si quedó en el lugar nuevo, el movimiento ya se hizo.
      const after = await loadBooking(p.booking_id);
      if (
        after.ok &&
        after.value.unit_id === p.unit_id &&
        after.value.check_in_date === p.check_in_date &&
        after.value.check_out_date === p.check_out_date
      ) {
        return {
          ok: false,
          error: `La reserva se movió, pero algo falló después (${r.error}). No lo repitas: revisá la ficha y la limpieza de salida.`,
        };
      }
      return r;
    }
    return {
      ok: true,
      message: `Reserva movida: ${b.guest?.full_name ?? "la reserva"} queda en ${u.value.code} del ${shortDate(p.check_in_date, ctx.today)} al ${shortDate(p.check_out_date, ctx.today)}.`,
      href: hrefs.booking(p.booking_id),
    };
  },
});

// ── completar_precio ────────────────────────────────────────────────────────

type PendingPriceRow = {
  id: string;
  total_amount: number | null;
  mode: string;
  is_block: boolean;
  status: BookingStatus;
  source: string;
  check_in_date: string;
  check_out_date: string;
  unit: { id: string; code: string; name: string } | null;
  guest: { full_name: string } | null;
};

export const completarPrecio = defineWrite({
  name: "completar_precio",
  label: "Preparando el precio…",
  description:
    "Prepara la carga del PRECIO de una reserva que entró en $0 (las de Airbnb/Booking entran «por completar» porque el iCal no trae precio) " +
    "para que la persona la confirme. Las comisiones se calculan solas. Si no te dicen cuál, muestra las que faltan; si falta el monto, lo pregunta. " +
    "Para cambiar el total de una reserva que ya tiene precio usá modificar_reserva.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id elegido de una lista.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    total: z.number().positive().describe("Total de la reserva (lo que paga el huésped, con limpieza), tal como lo dijo la persona.").optional(),
    moneda: z.string().describe("ARS, USD… sólo si la dijeron; si no, la de la reserva.").optional(),
  }),
  payload: z.object({
    booking_id: idSchema,
    total_amount: z.number().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  resource: "bookings",
  action: "update",
  async propose(input, ctx) {
    let bookingId: string;
    if (!input.reserva?.trim()) {
      const l = await attempt(() => listBookingsNeedingCompletion());
      if (!l.ok) return l;
      // Sólo las que esperan PRECIO (la misma lista trae también las que esperan huésped).
      const pending = (l.value as unknown as PendingPriceRow[]).filter(
        (x) => Number(x.total_amount ?? 0) <= 0 && x.mode !== "mensual" && !x.is_block,
      );
      if (pending.length === 0) return { ok: false, error: "No hay reservas esperando el precio." };
      if (pending.length > 1) {
        return {
          ok: "choose",
          question: `Hay ${pending.length} reservas esperando el precio. ¿Cuál cargás?`,
          options: bookingOptions(
            pending.map((x) => ({
              id: x.id,
              guest: x.guest?.full_name ?? null,
              unitId: x.unit?.id ?? null,
              unitCode: x.unit?.code ?? null,
              unitName: x.unit?.name ?? null,
              checkIn: x.check_in_date,
              checkOut: x.check_out_date,
              status: x.status,
              source: x.source,
            })),
          ),
        };
      }
      bookingId = pending[0].id;
    } else {
      const found = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today });
      if (found.ok !== true) return found;
      bookingId = found.value.id;
    }
    const bk = await loadBooking(bookingId);
    if (!bk.ok) return bk;
    const b = bk.value;
    const who = b.guest?.full_name ?? "Sin huésped";
    if (b.is_block) return { ok: false, error: "Un cierre de calendario no lleva precio." };
    if (b.status === "cancelada" || b.status === "no_show") return { ok: false, error: "La reserva está cancelada: no corresponde cargar precio." };
    if (b.mode === "mensual") return { ok: false, error: "Para un alquiler mensual se carga la renta desde la ficha de la reserva." };
    if (b.total_amount > 0) {
      return { ok: false, error: `La reserva de ${who} ya tiene precio (${money(b.total_amount, b.currency)}): para cambiarlo usá modificar_reserva.` };
    }
    const where = `${b.unit?.code ?? "sin unidad"}, ${dateRange(b.check_in_date, b.check_out_date)}`;
    if (input.total === undefined) {
      return ask(`¿Cuál es el total de la reserva de ${who} (${where})? Lo que paga el huésped, con la limpieza.`);
    }
    const moneda = input.moneda?.trim().toUpperCase();
    if (moneda && !/^[A-Z]{3}$/.test(moneda)) return { ok: false, error: `No reconozco la moneda «${input.moneda}». Usá el código: ARS, USD…` };
    const currency = moneda || (b.currency || "ARS").toUpperCase();
    const currencyBlock = currencyChangeBlocked(b, currency);
    if (currencyBlock) return { ok: false, error: currencyBlock };
    const total = round2(input.total);

    // La misma limpieza que va a snapshotear la action: la de la reserva, o la de la unidad si entra.
    let cleaning = Number(b.cleaning_fee ?? 0);
    if (!(cleaning > 0)) {
      const units = await attempt(() => listUnitsForBookingForm());
      const info = units.ok ? units.value.find((x) => x.id === b.unit_id) : undefined;
      const unitFee = Number(info?.cleaning_fee ?? 0);
      const sameCur = !info?.base_price_currency || info.base_price_currency === currency;
      cleaning = unitFee > 0 && unitFee < total && sameCur ? round2(unitFee) : 0;
    }
    const nights = nightsBetween(b.check_in_date, b.check_out_date);
    return {
      ok: true,
      payload: { booking_id: b.id, total_amount: total, currency },
      summary: {
        title: "Cargar el precio de la reserva",
        lines: [
          { label: "Huésped", value: who },
          { label: "Unidad", value: unitLabel(b.unit) },
          { label: "Fechas", value: `${dateRange(b.check_in_date, b.check_out_date)} · ${nightsText(nights)}` },
          { label: "Canal", value: sourceLabel(b.source) },
          { label: "Total", value: `${money(total, currency)}${cleaning > 0 ? ` (incluye limpieza ${money(cleaning, currency)})` : ""}` },
        ],
        note: joinNotes([
          "Las comisiones (del canal y de administración) se calculan solas con este total.",
          currency !== (b.currency || "").toUpperCase() && `La reserva pasa de ${b.currency} a ${currency}.`,
        ]),
        confirmLabel: "Cargar precio",
      },
    };
  },
  async execute(p) {
    const bk = await loadBooking(p.booking_id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.total_amount > 0) return { ok: false, error: `La reserva ya tiene precio (${money(b.total_amount, b.currency)}): se cargó por otro lado. No toqué nada.` };
    if (b.is_block) return { ok: false, error: "Un cierre de calendario no lleva precio. No toqué nada." };
    const currencyBlock = currencyChangeBlocked(b, p.currency);
    if (currencyBlock) return { ok: false, error: `${currencyBlock} No toqué nada.` };
    const r = await attemptResult(() =>
      completeChannelPrice({ booking_id: p.booking_id, total_amount: p.total_amount, currency: p.currency }),
    );
    if (!r.ok) return r;
    return {
      ok: true,
      message: `Precio cargado: ${money(r.value.booking.total_amount, r.value.booking.currency)} en la reserva de ${b.guest?.full_name ?? "la unidad"} (${b.unit?.code ?? "—"}).`,
      href: hrefs.booking(p.booking_id),
    };
  },
});

// ── cancelar_reserva ────────────────────────────────────────────────────────

const CANCELLABLE = new Set<BookingStatus>(["pendiente", "confirmada", "check_in"]);

const notCancellable = (c: BookingCandidate) => {
  if (CANCELLABLE.has(c.status)) return null;
  if (c.status === "check_out") {
    return `La estadía de ${describeBooking(c)} ya terminó (check-out hecho): si de verdad hay que cancelarla, se hace desde la ficha (${hrefs.booking(c.id)}).`;
  }
  return `La reserva de ${describeBooking(c)} ya está ${statusLabel(c.status).toLowerCase()}.`;
};

export const cancelarReserva = defineWrite({
  name: "cancelar_reserva",
  label: "Preparando la cancelación…",
  description:
    "Prepara la CANCELACIÓN de una reserva para que la persona la decida en una tarjeta roja. Pide siempre el motivo (queda registrado). " +
    "Libera las fechas. No marca no-show ni reactiva reservas (eso va por la ficha). Usala sólo cuando la persona pide cancelar.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id elegido de una lista.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    motivo: z.string().max(500).describe("Por qué se cancela, como lo dijo la persona. Si no lo dijo, omitir (se pregunta).").optional(),
  }),
  payload: z.object({
    booking_id: idSchema,
    from_status: z.enum(["pendiente", "confirmada", "check_in"]),
    reason: z.string().min(3).max(500),
  }),
  resource: "bookings",
  action: "update",
  async propose(input, ctx) {
    if (!input.reserva?.trim()) return ask("¿Qué reserva se cancela? Decime el huésped o la unidad.");
    const found = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today, eligible: notCancellable });
    if (found.ok !== true) return found;
    const bk = await loadBooking(found.value.id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva: se libera desde el calendario o el canal." };
    const why = notCancellable(candidateFromDetail(b));
    if (why) return { ok: false, error: why };
    const who = b.guest?.full_name ?? "Sin huésped";
    const reason = clip(input.motivo, 500);
    if (!reason || reason.length < 3) {
      return ask(`¿Por qué se cancela la reserva de ${describeBooking(candidateFromDetail(b))}? Queda registrado.`, [
        "La canceló el huésped",
        "No pagó la seña",
        "Error de carga",
      ]);
    }
    let openCuotas = 0;
    let otherSegments = 0;
    if (b.mode === "mensual") {
      const sch = await attempt(() => (b.lease_group_id ? listScheduleForLeaseGroup(b.lease_group_id) : listScheduleForBooking(b.id)));
      if (sch.ok) {
        const rows = sch.value as BookingPaymentSchedule[];
        openCuotas = rows.filter((s) => s.booking_id === b.id && ["pending", "partial", "overdue"].includes(s.status)).length;
        // Los otros tramos del mismo contrato que siguen vivos (se cancelan uno por uno).
        const others = [...new Set(rows.filter((s) => s.booking_id !== b.id).map((s) => s.booking_id))].slice(0, 8);
        const loaded = await Promise.all(others.map((oid) => loadBooking(oid)));
        otherSegments = loaded.filter((x) => x.ok && CANCELLABLE.has(x.value.status)).length;
      }
    }
    const from = b.status as "pendiente" | "confirmada" | "check_in";
    return {
      ok: true,
      payload: { booking_id: b.id, from_status: from, reason },
      summary: {
        title: "Cancelar la reserva",
        lines: [
          { label: "Huésped", value: who },
          { label: "Unidad", value: unitLabel(b.unit) },
          { label: "Fechas", value: `${dateRange(b.check_in_date, b.check_out_date)} · ${nightsText(nightsBetween(b.check_in_date, b.check_out_date))}` },
          { label: "Estado", value: `${statusLabel(b.status)} → Cancelada` },
          { label: "Total", value: money(b.total_amount, b.currency) },
          ...(b.paid_amount > 0.004 ? [{ label: "Cobrado", value: money(b.paid_amount, b.currency) }] : []),
          { label: "Motivo", value: reason },
        ],
        note: joinNotes([
          `Las fechas quedan libres para vender${from === "check_in" ? "" : " y se cancela su limpieza de salida"}.`,
          b.paid_amount > 0.004 &&
            `Tiene ${money(b.paid_amount, b.currency)} cobrados: cancelar no devuelve nada. Si corresponde un reintegro, registralo aparte.`,
          isOta(b.source) &&
            `Cancelala también en ${sourceLabel(b.source)}: si allá sigue activa, el huésped puede llegar igual y acá las fechas ya quedan libres para venderse por otro lado.`,
          from === "check_in" && "El huésped figura adentro (con check-in hecho).",
          openCuotas > 0 &&
            `Tiene ${openCuotas} ${openCuotas === 1 ? "cuota" : "cuotas"} sin cobrar: después revisá en la ficha que ${openCuotas === 1 ? "quede anulada" : "queden anuladas"}.`,
          otherSegments > 0 &&
            `Es un tramo de un contrato más largo: ${otherSegments === 1 ? "el otro tramo sigue activo" : `los otros ${otherSegments} tramos siguen activos`}. Si se cancela todo, hay que cancelarlos también.`,
          "Si tenés mensajes automáticos de cancelación, al huésped le puede llegar uno.",
        ]),
        confirmLabel: "Cancelar reserva",
        danger: true,
      },
    };
  },
  async execute(p) {
    const bk = await loadBooking(p.booking_id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva. No la cancelé." };
    if (b.status !== p.from_status) {
      return { ok: false, error: `La reserva cambió mientras tanto: ahora está ${statusLabel(b.status).toLowerCase()}. No la cancelé.` };
    }
    // Quién la canceló queda en `cancelled_by` (la action); por dónde, en el motivo.
    const r = await attempt(() => changeBookingStatus(p.booking_id, "cancelada", `${p.reason} (cancelada con Tex)`));
    if (!r.ok) return r;
    return {
      ok: true,
      message: `Reserva cancelada: ${b.guest?.full_name ?? "la reserva"} en ${b.unit?.code ?? "la unidad"} (${dateRange(b.check_in_date, b.check_out_date)}). Las fechas quedaron libres.`,
      href: hrefs.booking(p.booking_id),
    };
  },
});
