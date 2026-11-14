/**
 * Reservas (nov-2026): crear una temporaria directa, cambiar su estado
 * operativo y extender la estadía.
 *
 * Lo que NO hacen, a propósito:
 * - Cancelar / no-show / reactivar: lo decide una persona desde la ficha
 *   (migración 053). `cambiar_estado_reserva` devuelve el link.
 * - Check-out con saldo: nunca se fuerza (`force_checkout`); primero el cobro.
 * - Contratos mensuales y estadías de más de 30 noches: van por el formulario
 *   (renta, cuotas, división en períodos).
 * - Cobrar al crear: `createBooking` con `paid_amount > 0` inserta la reserva
 *   antes de validar la cuenta. El cobro va aparte con `registrar_cobro`.
 */
import { z } from "zod/v4";
import { can } from "@/lib/permissions";
import {
  changeBookingStatus,
  createBooking,
  extendBooking,
  previewBookingChange,
} from "@/lib/actions/bookings";
import { createGuest, getGuest } from "@/lib/actions/guests";
import { getAvailabilitySnapshot, type AvailabilitySnapshot } from "@/lib/actions/pms-availability";
import { listUnitsForBookingForm } from "@/lib/actions/units";
import { MAX_BOOKING_NIGHTS } from "@/lib/booking-split";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { computeUnitAvailability, rangesOverlap, statusOccupies } from "@/lib/units/availability";
import type { BookingSource, BookingStatus, Guest } from "@/lib/types/database";
import { attempt, defineWrite, hrefs } from "../../tool";
import { clip, dateRange, isYmd, money, nightsBetween, shortDate } from "../../format";
import { resolveUnit } from "../_resolve";
import {
  candidateFromDetail,
  describeBooking,
  findBooking,
  idSchema,
  joinNotes,
  loadBooking,
  resolveGuestForBooking,
  round2,
  statusLabel,
  unitLabel,
  ymdSchema,
  type BookingCandidate,
} from "./_shared";

const SOURCES = ["directo", "airbnb", "booking", "expedia", "vrbo", "whatsapp", "instagram", "otro"] as const;
const OTA_SOURCES = new Set<string>(["airbnb", "booking", "expedia", "vrbo"]);
const ALL_STATUSES = ["pendiente", "confirmada", "check_in", "check_out", "cancelada", "no_show"] as const;
const CHECK_IN_TIME = "14:00";
const CHECK_OUT_TIME = "10:00";

const sourceLabel = (s: string) => BOOKING_SOURCE_META[s as BookingSource]?.label ?? s;
const nightsText = (n: number) => `${n} ${n === 1 ? "noche" : "noches"}`;

type Busy = { busy: boolean; tentative: boolean; reason: string | null; tentativeChannel: string | null };

/** ¿La unidad está libre en [desde, hasta)? La misma foto autoritativa que «Buscar disp» del PMS. */
async function unitAvailability(
  unitId: string,
  unitCode: string,
  from: string,
  to: string,
): Promise<{ ok: true; value: Busy } | { ok: false; error: string }> {
  const r = await attempt(() => getAvailabilitySnapshot(from, to));
  if (!r.ok) return r;
  const snap: AvailabilitySnapshot = r.value;
  if (!snap.ok) return { ok: false, error: snap.error };
  const av = computeUnitAvailability({ from, to, bookings: snap.bookings, requests: snap.requests });
  const clash = snap.bookings.find(
    (b) => b.unit_id === unitId && statusOccupies(b.status) && rangesOverlap(b.check_in_date, b.check_out_date, from, to),
  );
  const held = snap.requests.find(
    (q) => q.unit_id === unitId && q.check_in && q.check_out && rangesOverlap(q.check_in, q.check_out, from, to),
  );
  let reason: string | null = null;
  if (av.busy.has(unitId)) {
    reason = clash
      ? `${unitCode} ya está ocupada del ${dateRange(clash.check_in_date, clash.check_out_date)}${clash.is_block ? " (cierre de calendario)" : ""}. Probá otras fechas u otra unidad.`
      : `Hay una solicitud de ${sourceLabel(held?.channel ?? "un canal")} que retiene ${unitCode} en esas fechas. Probá otras fechas u otra unidad.`;
  }
  return {
    ok: true,
    value: {
      busy: av.busy.has(unitId),
      tentative: av.tentative.has(unitId),
      reason,
      tentativeChannel: held && !held.holds_availability ? sourceLabel(held.channel) : null,
    },
  };
}

// ── crear_reserva ───────────────────────────────────────────────────────────

const crearPayload = z.object({
  unit_id: idSchema,
  guest_id: idSchema.nullable(),
  new_guest: z
    .object({
      full_name: z.string().min(2).max(200),
      phone: z.string().max(40).nullable(),
      phone_e164: z.string().max(20).nullable(),
      email: z.string().max(320).nullable(),
    })
    .nullable(),
  check_in_date: ymdSchema,
  check_out_date: ymdSchema,
  guests_count: z.number().int().min(1).max(50),
  currency: z.string().min(1).max(12),
  total_amount: z.number().min(0),
  cleaning_fee: z.number().min(0).nullable(),
  source: z.enum(SOURCES),
  notes: z.string().max(1000).nullable(),
});

export const crearReserva = defineWrite({
  name: "crear_reserva",
  label: "Preparando la reserva…",
  description:
    "Prepara una RESERVA temporaria nueva (por noches) para que la persona la confirme con un botón: no se crea hasta que confirma. " +
    "Verifica que la unidad esté libre, busca al huésped (si hay parecidos, pregunta) y, si no dicen el total, lo estima con la tarifa base. " +
    "Queda confirmada y sin cobros: lo cobrado se registra después con registrar_cobro. " +
    "No sirve para alquileres mensuales ni estadías de más de 30 noches (van por el formulario de Reservas).",
  input: z.object({
    unidad: z.string().describe("Código o nombre de la unidad, o el id que la persona eligió de una lista."),
    huesped: z.string().describe("Nombre y apellido del huésped."),
    huesped_id: z
      .string()
      .describe("Sólo si la persona eligió un huésped de una lista que le mostraste: su id, o «nuevo» si dijo que es otra persona.")
      .optional(),
    telefono: z.string().describe("Teléfono del huésped, si lo dieron.").optional(),
    email: z.string().describe("Mail del huésped, si lo dieron.").optional(),
    desde: z.string().describe("Día de llegada (check-in), YYYY-MM-DD."),
    hasta: z.string().describe("Día de salida (check-out), YYYY-MM-DD: el día que se va (3 noches desde el 14 → hasta el 17)."),
    huespedes: z.number().int().min(1).max(50).describe("Cuántas personas. Si no lo dijeron, omitir (queda 1).").optional(),
    total: z
      .number()
      .min(0)
      .describe("Total que paga el huésped, con la limpieza incluida. Si no lo dijeron, omitir: se estima con la tarifa base.")
      .optional(),
    moneda: z.string().describe("ARS, USD… sólo si la dijeron; si no, la de la tarifa de la unidad.").optional(),
    canal: z.enum(SOURCES).describe("Por dónde llegó la reserva. Si no lo dijeron, directo.").optional(),
    notas: z.string().max(1000).describe("Notas para la reserva, si las dieron.").optional(),
  }),
  payload: crearPayload,
  resource: "bookings",
  action: "create",
  async propose(input, ctx) {
    const desde = input.desde.trim();
    const hasta = input.hasta.trim();
    if (!isYmd(desde) || !isYmd(hasta)) {
      return { ok: false, error: "Necesito las fechas de llegada y salida en formato YYYY-MM-DD." };
    }
    if (+desde.slice(0, 4) < 2020 || +hasta.slice(0, 4) > 2100) return { ok: false, error: "Revisá el año de las fechas." };
    if (hasta <= desde) return { ok: false, error: "La salida tiene que ser después de la llegada." };
    const nights = nightsBetween(desde, hasta);
    if (nights > MAX_BOOKING_NIGHTS) {
      return {
        ok: false,
        error: `Son ${nights} noches: una estadía de más de ${MAX_BOOKING_NIGHTS} noches se carga desde el formulario de Reservas (${hrefs.bookings()}), que pregunta si dividirla en períodos.`,
      };
    }

    const u = await resolveUnit(input.unidad);
    if (u.ok !== true) return u;
    const unit = u.value;
    const units = await attempt(() => listUnitsForBookingForm());
    if (!units.ok) return units;
    const info = units.value.find((x) => x.id === unit.id);
    if (!info) return { ok: false, error: `No encontré la tarifa de ${unit.code}.` };
    if (info.default_mode === "mensual") {
      return {
        ok: false,
        error: `${unit.code} es de alquiler mensual: los contratos mensuales se cargan desde el formulario de Reservas (${hrefs.bookings()}).`,
      };
    }

    // Moneda y precio: los mismos que arma el formulario (tarifa × noches + limpieza, en la moneda de la tarifa).
    const unitCurrency = info.base_price_currency || ctx.org.currency || "ARS";
    const moneda = input.moneda?.trim().toUpperCase();
    if (moneda && !/^[A-Z]{3}$/.test(moneda)) return { ok: false, error: `No reconozco la moneda «${input.moneda}». Usá el código: ARS, USD…` };
    const currency = moneda || unitCurrency;
    const basePrice = Number(info.base_price ?? 0);
    const unitFee = Number(info.cleaning_fee ?? 0);
    const feeApplies = unitFee > 0 && currency === unitCurrency;
    let total: number;
    let cleaningFee: number | null = null;
    let estimated = false;
    if (input.total !== undefined) {
      total = round2(input.total);
      if (feeApplies && unitFee <= total) cleaningFee = unitFee;
    } else {
      if (!(basePrice > 0)) {
        return { ok: false, error: `${unit.code} no tiene tarifa base cargada: preguntale a la persona el total que paga el huésped.` };
      }
      if (currency !== unitCurrency) {
        return { ok: false, error: `La tarifa de ${unit.code} es en ${unitCurrency}: para cobrarla en ${currency} necesito el total.` };
      }
      cleaningFee = feeApplies ? unitFee : null;
      total = round2(basePrice * nights + (cleaningFee ?? 0));
      estimated = true;
    }

    const av = await unitAvailability(unit.id, unit.code, desde, hasta);
    if (!av.ok) return av;
    if (av.value.busy) return { ok: false, error: av.value.reason ?? `${unit.code} no está libre en esas fechas.` };

    const g = await resolveGuestForBooking({
      name: input.huesped,
      phone: input.telefono,
      email: input.email,
      guestId: input.huesped_id,
    });
    if (g.ok !== true) return g;
    const guest = g.value;
    const contact = [guest.phone, guest.email].filter(Boolean).join(" · ");

    const source = input.canal ?? "directo";
    const guestsCount = input.huespedes ?? 1;
    const notes = clip(input.notas, 1000) ?? null;

    if (guest.kind === "new" && !can(ctx.role, "guests", "create")) {
      return { ok: false, error: "Tu rol no puede dar de alta huéspedes: elegí uno que ya exista." };
    }
    return {
      ok: true,
      payload: {
        unit_id: unit.id,
        guest_id: guest.kind === "existing" ? guest.id : null,
        new_guest:
          guest.kind === "new"
            ? { full_name: guest.name, phone: guest.phone, phone_e164: guest.phoneE164, email: guest.email }
            : null,
        check_in_date: desde,
        check_out_date: hasta,
        guests_count: guestsCount,
        currency,
        total_amount: total,
        cleaning_fee: cleaningFee,
        source,
        notes,
      },
      summary: {
        title: "Crear una reserva",
        lines: [
          { label: "Unidad", value: `${unit.code} · ${unit.name}` },
          {
            label: "Huésped",
            value:
              guest.kind === "new"
                ? `${guest.name} (huésped nuevo${contact ? `: ${contact}` : ""})`
                : `${guest.name}${contact ? ` (${contact})` : ""}`,
          },
          { label: "Entrada", value: `${shortDate(desde, ctx.today)} · ${CHECK_IN_TIME}` },
          { label: "Salida", value: `${shortDate(hasta, ctx.today)} · ${CHECK_OUT_TIME}` },
          { label: "Noches", value: String(nights) },
          { label: "Personas", value: String(guestsCount) },
          {
            label: estimated ? "Total (tarifa base)" : "Total",
            value: `${money(total, currency)}${cleaningFee ? ` (incluye limpieza ${money(cleaningFee, currency)})` : ""}`,
          },
          { label: "Canal", value: sourceLabel(source) },
          { label: "Estado", value: "Confirmada, sin cobros" },
          ...(notes ? [{ label: "Notas", value: notes }] : []),
        ],
        note: joinNotes([
          guest.kind === "existing" &&
            guest.blacklisted &&
            `Ojo: ${guest.name} está en la lista negra${guest.blacklistReason ? ` (${guest.blacklistReason})` : ""}.`,
          estimated &&
            `El total es la tarifa base × ${nightsText(nights)}${cleaningFee ? " + limpieza" : ""}: no tiene en cuenta precios especiales. Si acordaron otro, decime el total.`,
          input.total !== undefined && total === 0 && "La reserva queda en $ 0.",
          av.value.tentative &&
            `Hay una solicitud de ${av.value.tentativeChannel ?? "una plataforma"} sin confirmar en esas fechas: si la aceptan, se superponen.`,
          desde < ctx.today && "La llegada ya pasó: queda cargada como una reserva atrasada.",
          OTA_SOURCES.has(source) &&
            `Las reservas de ${sourceLabel(source)} suelen entrar solas por el canal: si entra también por ahí, puede quedar duplicada.`,
          "Puede disparar los mensajes automáticos de reservas nuevas, si los tenés configurados.",
        ]),
        confirmLabel: "Crear reserva",
      },
    };
  },
  async execute(p, ctx) {
    const u = await resolveUnit(p.unit_id);
    if (u.ok !== true) return { ok: false, error: "La unidad ya no existe o está archivada. No creé nada." };
    if ((p.guest_id === null) === (p.new_guest === null)) return { ok: false, error: "Falta el huésped. No creé nada." };

    // Otra vez: el constraint de la base no ve las solicitudes de canal que retienen la venta.
    const av = await unitAvailability(p.unit_id, u.value.code, p.check_in_date, p.check_out_date);
    if (!av.ok) return av;
    if (av.value.busy) return { ok: false, error: `Mientras confirmabas se ocupó: ${av.value.reason ?? "la unidad ya no está libre."} No creé nada.` };

    let guestId: string;
    let guestName: string;
    const existingId = p.guest_id;
    const ng = p.new_guest;
    if (!existingId && !can(ctx.role, "guests", "create")) {
      return { ok: false, error: "Tu rol no puede dar de alta huéspedes. No creé nada." };
    }
    if (existingId) {
      const g = await attempt(() => getGuest(existingId));
      if (!g.ok) return g;
      const row = g.value as Guest | null;
      if (!row) return { ok: false, error: "El huésped elegido ya no existe. No creé nada." };
      guestId = row.id;
      guestName = row.full_name;
    } else if (ng) {
      const g = await attempt(() =>
        createGuest({ full_name: ng.full_name, phone: ng.phone, phone_e164: ng.phone_e164, email: ng.email, country: "AR" }),
      );
      if (!g.ok) return g;
      guestId = g.value.id;
      guestName = g.value.full_name;
    } else {
      return { ok: false, error: "Falta el huésped. No creé nada." };
    }

    const r = await attempt(() =>
      createBooking({
        unit_id: p.unit_id,
        guest_id: guestId,
        source: p.source,
        status: "confirmada",
        mode: "temporario",
        check_in_date: p.check_in_date,
        check_in_time: CHECK_IN_TIME,
        check_out_date: p.check_out_date,
        check_out_time: CHECK_OUT_TIME,
        guests_count: p.guests_count,
        currency: p.currency,
        total_amount: p.total_amount,
        // Siempre 0: con cobro, createBooking inserta antes de validar la cuenta.
        paid_amount: 0,
        // null = los resuelve el servidor con la misma cascada que el formulario.
        commission_pct: null,
        channel_commission_pct: null,
        cleaning_fee: p.cleaning_fee,
        notes: p.notes,
        internal_notes: `Cargada con Tex por ${ctx.user.name}.`,
      }),
    );
    if (!r.ok) return r;
    return {
      ok: true,
      message: `Reserva creada: ${guestName} en ${u.value.code}, ${dateRange(p.check_in_date, p.check_out_date)}.`,
      href: hrefs.booking(r.value.id),
      data: { reserva_id: r.value.id, huesped_id: guestId },
    };
  },
});

// ── cambiar_estado_reserva ──────────────────────────────────────────────────

type OpTarget = "confirmada" | "check_in" | "check_out";
type AnyTarget = OpTarget | "cancelada" | "no_show";

/** Por qué una reserva no sirve para pasar a `target` (null = sirve). */
function eligibleFor(target: AnyTarget, today: string) {
  return (c: BookingCandidate): string | null => {
    if (target === "cancelada" || target === "no_show") return null; // sólo se busca para dar el link
    const d = describeBooking(c);
    if (c.status === "cancelada" || c.status === "no_show") {
      return `La reserva de ${d} está ${statusLabel(c.status).toLowerCase()}: reactivarla se decide desde su ficha (${hrefs.booking(c.id)}).`;
    }
    if (target === "confirmada") {
      return c.status === "pendiente" ? null : `La reserva de ${d} ya está ${statusLabel(c.status).toLowerCase()}.`;
    }
    if (target === "check_in") {
      if (c.status === "check_in") return `${d} ya tiene el check-in hecho.`;
      if (c.status === "check_out") return `${d} ya hizo el check-out.`;
      if (c.checkIn > today) return `La llegada de ${d} es el ${shortDate(c.checkIn, today)}: el check-in se marca el día que entra.`;
      if (c.checkOut < today) return `La estadía de ${d} ya terminó.`;
      return null;
    }
    if (c.status === "check_out") return `${d} ya tiene el check-out hecho.`;
    if (c.checkIn > today) return `${d} todavía no llegó: entra el ${shortDate(c.checkIn, today)}.`;
    return null;
  };
}

const TITLE: Record<OpTarget, string> = {
  confirmada: "Confirmar la reserva",
  check_in: "Marcar el check-in",
  check_out: "Marcar el check-out",
};
const CONFIRM: Record<OpTarget, string> = {
  confirmada: "Confirmar reserva",
  check_in: "Marcar check-in",
  check_out: "Marcar check-out",
};

export const cambiarEstadoReserva = defineWrite({
  name: "cambiar_estado_reserva",
  label: "Preparando el cambio de estado…",
  description:
    "Prepara el cambio de estado operativo de una reserva para que la persona lo confirme: confirmar una pendiente, marcar el check-in (el día que llega) " +
    "o el check-out (sólo sin saldo: si debe, primero registrar_cobro). CANCELAR o marcar NO-SHOW no se hace desde acá: lo decide una persona " +
    "desde la ficha de la reserva; si te lo piden, llamala igual con ese estado y te devuelve el link para pasarle.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id que la persona eligió de una lista."),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    estado: z.enum(["confirmada", "check_in", "check_out", "cancelada", "no_show"]).describe("Estado al que pasa."),
  }),
  payload: z.object({
    booking_id: idSchema,
    status: z.enum(["confirmada", "check_in", "check_out"]),
    from_status: z.enum(ALL_STATUSES),
  }),
  resource: "bookings",
  action: "update",
  async propose(input, ctx) {
    const estado: AnyTarget = input.estado;
    const found = await findBooking(input.reserva, {
      unidad: input.unidad,
      today: ctx.today,
      eligible: eligibleFor(estado, ctx.today),
    });
    if (found.ok !== true) return found;
    if (estado === "cancelada" || estado === "no_show") {
      return {
        ok: false,
        error: `${estado === "cancelada" ? "Cancelar una reserva" : "Marcar un no-show"} lo decide una persona desde la ficha de la reserva, no desde acá. Pasale el link: ${hrefs.booking(found.value.id)}`,
      };
    }
    const bk = await loadBooking(found.value.id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva." };
    const why = eligibleFor(estado, ctx.today)(candidateFromDetail(b));
    if (why) return { ok: false, error: why };

    const who = b.guest?.full_name ?? "Sin huésped";
    const saldo = round2(b.total_amount - b.paid_amount);
    if (estado === "check_out" && saldo > 0.01) {
      return {
        ok: false,
        error: `${who} tiene un saldo de ${money(saldo, b.currency)} sin cobrar y el check-out no se marca con saldo. Primero registrá el cobro (registrar_cobro); si no se va a cobrar, lo resuelve un administrador desde la ficha (${hrefs.booking(b.id)}).`,
      };
    }
    const nights = nightsBetween(b.check_in_date, b.check_out_date);
    return {
      ok: true,
      payload: { booking_id: b.id, status: estado, from_status: b.status },
      summary: {
        title: TITLE[estado],
        lines: [
          { label: "Huésped", value: who },
          { label: "Unidad", value: unitLabel(b.unit) },
          { label: "Fechas", value: `${dateRange(b.check_in_date, b.check_out_date)} · ${nightsText(nights)}` },
          { label: "Estado", value: `${statusLabel(b.status)} → ${statusLabel(estado)}` },
          { label: "Saldo", value: saldo > 0.01 ? money(saldo, b.currency) : "Sin saldo" },
        ],
        note: joinNotes([
          estado === "confirmada" && "Si tenés mensajes automáticos de confirmación, al huésped le puede llegar uno.",
          estado === "check_in" && saldo > 0.01 && `Queda un saldo de ${money(saldo, b.currency)} para cobrar antes del check-out.`,
          estado === "check_out" &&
            b.check_out_date > ctx.today &&
            `Se va antes de la salida prevista (${shortDate(b.check_out_date, ctx.today)}); las fechas de la reserva no cambian.`,
          estado === "check_out" && "La unidad queda para limpiar (salvo que el mismo huésped siga en la unidad).",
        ]),
        confirmLabel: CONFIRM[estado],
      },
    };
  },
  async execute(p) {
    const bk = await loadBooking(p.booking_id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.status !== p.from_status) {
      return { ok: false, error: `La reserva cambió mientras tanto: ahora está ${statusLabel(b.status).toLowerCase()}. No toqué nada.` };
    }
    const saldo = round2(b.total_amount - b.paid_amount);
    if (p.status === "check_out" && saldo > 0.01) {
      return { ok: false, error: `Ahora tiene un saldo de ${money(saldo, b.currency)}: primero hay que cobrarlo. No toqué nada.` };
    }
    const r = await attempt(() => changeBookingStatus(p.booking_id, p.status));
    if (!r.ok) return { ok: false, error: r.error.replace(/^CHECKOUT_PENDING_BALANCE:\s*/, "") };
    const who = b.guest?.full_name ?? "La reserva";
    const code = b.unit?.code ?? "la unidad";
    const message: Record<OpTarget, string> = {
      confirmada: `Reserva confirmada: ${who} en ${code}.`,
      check_in: `Check-in marcado: ${who} en ${code}.`,
      check_out: `Check-out marcado: ${who} dejó ${code}.`,
    };
    return { ok: true, message: message[p.status], href: hrefs.booking(p.booking_id) };
  },
});

// ── extender_reserva ────────────────────────────────────────────────────────

const EXTENDABLE = new Set<BookingStatus>(["pendiente", "confirmada", "check_in"]);

const notExtendable = (c: BookingCandidate) =>
  EXTENDABLE.has(c.status) ? null : `La reserva de ${describeBooking(c)} está ${statusLabel(c.status).toLowerCase()}: no se puede extender.`;

export const extenderReserva = defineWrite({
  name: "extender_reserva",
  label: "Preparando la extensión…",
  description:
    "Prepara la EXTENSIÓN de una estadía (una salida más tarde, en la misma unidad) para que la persona la confirme. Revisa que no choque con otra " +
    "reserva ni con una liquidación cerrada y propone el total nuevo con la misma tarifa por noche (o el que digan). No sirve para acortar ni para mover de unidad.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id que la persona eligió de una lista."),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    hasta: z.string().describe("Nueva fecha de salida (check-out), YYYY-MM-DD."),
    total: z
      .number()
      .min(0)
      .describe("Nuevo total de TODA la estadía, sólo si lo dijeron. Si no, omitir: se calcula con la misma tarifa por noche.")
      .optional(),
    motivo: z.string().max(500).describe("Por qué se extiende, si lo dijeron (obligatorio si suma más de 30 noches).").optional(),
  }),
  payload: z.object({
    booking_id: idSchema,
    check_in_date: ymdSchema,
    from_check_out: ymdSchema,
    new_check_out: ymdSchema,
    previous_total: z.number(),
    total_amount: z.number().min(0).nullable(),
    reason: z.string().max(500).nullable(),
  }),
  resource: "bookings",
  action: "update",
  async propose(input, ctx) {
    const hasta = input.hasta.trim();
    if (!isYmd(hasta) || +hasta.slice(0, 4) > 2100) return { ok: false, error: "Necesito la nueva fecha de salida en formato YYYY-MM-DD." };
    const found = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today, eligible: notExtendable });
    if (found.ok !== true) return found;
    const bk = await loadBooking(found.value.id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva." };
    const why = notExtendable(candidateFromDetail(b));
    if (why) return { ok: false, error: why };
    const who = b.guest?.full_name ?? "Sin huésped";
    if (hasta === b.check_out_date) return { ok: false, error: `${who} ya sale el ${shortDate(hasta, ctx.today)}.` };
    if (hasta < b.check_out_date) {
      return {
        ok: false,
        error: `Eso acorta la estadía (hoy sale el ${shortDate(b.check_out_date, ctx.today)}). Para acortar, usá la ficha de la reserva: ${hrefs.booking(b.id)}`,
      };
    }
    const oldNights = nightsBetween(b.check_in_date, b.check_out_date);
    const newNights = nightsBetween(b.check_in_date, hasta);
    const reason = clip(input.motivo, 500) ?? null;
    if (newNights - oldNights > 30 && !reason) {
      return { ok: false, error: "Suma más de 30 noches: decime el motivo de la extensión (queda registrado)." };
    }

    const pv = await attempt(() =>
      previewBookingChange({ id: b.id, unit_id: b.unit_id, check_in_date: b.check_in_date, check_out_date: hasta }),
    );
    if (!pv.ok) return pv;
    const preview = pv.value;
    const blocking = preview.warnings.filter((w) => w.kind === "blocking").map((w) => w.message);
    if (blocking.length > 0 || preview.conflicts.length > 0 || preview.in_closed_settlement_period) {
      // El rango viene "2026-11-25 → 2026-11-28"; el aviso "Se solapa con N reservas" ya lo cuentan los choques.
      const clash = preview.conflicts
        .slice(0, 3)
        .map((c) => {
          const [from, to] = c.range.split(" → ");
          const when = isYmd(from) && isYmd(to) ? dateRange(from, to) : c.range;
          return `${c.guest_name ? `la reserva de ${c.guest_name}` : "otra reserva"} (${when})`;
        })
        .join(", ");
      const others = blocking.filter((m) => !/^Se solapa con/i.test(m)).map((m) => m.charAt(0).toLowerCase() + m.slice(1));
      const parts = [clash && `choca con ${clash}`, ...others].filter(Boolean);
      return {
        ok: false,
        error: `No se puede extender hasta el ${shortDate(hasta, ctx.today)}: ${parts.join("; ") || "el cambio no pasa las validaciones"}.`,
      };
    }

    const pd = preview.price_diff;
    const previous = round2(pd.previous_total);
    let newTotal = previous;
    let basis: string | null = null;
    if (input.total !== undefined) {
      newTotal = round2(input.total);
      basis = "el que dijeron";
    } else if (pd.basis !== "unchanged") {
      newTotal = round2(pd.suggested_total);
      basis = pd.basis === "nightly" ? "misma tarifa por noche" : "renta mensual prorrateada";
    }
    const totalToSend = Math.abs(newTotal - previous) >= 0.01 ? newTotal : null;
    const saldo = round2(newTotal - b.paid_amount);

    return {
      ok: true,
      payload: {
        booking_id: b.id,
        check_in_date: b.check_in_date,
        from_check_out: b.check_out_date,
        new_check_out: hasta,
        previous_total: previous,
        total_amount: totalToSend,
        reason,
      },
      summary: {
        title: "Extender la estadía",
        lines: [
          { label: "Huésped", value: who },
          { label: "Unidad", value: unitLabel(b.unit) },
          { label: "Salida", value: `${shortDate(b.check_out_date, ctx.today)} → ${shortDate(hasta, ctx.today)}` },
          { label: "Noches", value: `${oldNights} → ${newNights}` },
          {
            label: "Total",
            value: `${money(previous, b.currency)} → ${money(newTotal, b.currency)}${basis ? ` (${basis})` : ""}`,
          },
          { label: "Saldo después", value: saldo > 0.01 ? money(saldo, b.currency) : "Sin saldo" },
          ...(reason ? [{ label: "Motivo", value: reason }] : []),
        ],
        note: joinNotes([
          previous <= 0 && input.total === undefined && "La reserva no tiene importe cargado: el total sigue en $ 0.",
          ...preview.warnings.filter((w) => w.kind === "info").map((w) => `${w.message}.`),
          preview.cleaning_tasks_affected.length > 0 && "La limpieza de salida se mueve a la nueva fecha.",
          newNights > MAX_BOOKING_NIGHTS &&
            `Pasa de ${MAX_BOOKING_NIGHTS} noches: el sistema la divide en períodos de ${MAX_BOOKING_NIGHTS}.`,
          OTA_SOURCES.has(b.source) &&
            `Es una reserva de ${sourceLabel(b.source)}: hacé el cambio también en la plataforma, si no va a quedar con fechas distintas.`,
        ]),
        confirmLabel: "Extender estadía",
      },
    };
  },
  async execute(p, ctx) {
    const bk = await loadBooking(p.booking_id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (!EXTENDABLE.has(b.status)) {
      return { ok: false, error: `La reserva pasó a ${statusLabel(b.status).toLowerCase()} mientras tanto. No toqué nada.` };
    }
    if (b.check_in_date !== p.check_in_date || b.check_out_date !== p.from_check_out) {
      return { ok: false, error: "Las fechas de la reserva cambiaron mientras tanto. No toqué nada: pedímelo de nuevo." };
    }
    if (Math.abs(b.total_amount - p.previous_total) >= 0.01) {
      return { ok: false, error: "El importe de la reserva cambió mientras tanto. No toqué nada: pedímelo de nuevo." };
    }
    const pv = await attempt(() =>
      previewBookingChange({ id: b.id, unit_id: b.unit_id, check_in_date: b.check_in_date, check_out_date: p.new_check_out }),
    );
    if (!pv.ok) return pv;
    if (pv.value.conflicts.length > 0 || pv.value.warnings.some((w) => w.kind === "blocking")) {
      return { ok: false, error: "Mientras confirmabas apareció un choque con otra reserva o una liquidación cerrada. No toqué nada." };
    }
    const r = await attempt(() =>
      extendBooking({ id: p.booking_id, new_check_out_date: p.new_check_out, total_amount: p.total_amount, reason: p.reason }),
    );
    if (!r.ok) return r;
    const total = p.total_amount ?? p.previous_total;
    return {
      ok: true,
      message: `Estadía extendida: ${b.guest?.full_name ?? "la reserva"} sale el ${shortDate(p.new_check_out, ctx.today)} (total ${money(total, b.currency)}).`,
      href: hrefs.booking(p.booking_id),
    };
  },
});
