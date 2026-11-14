/**
 * Reservas (nov-2026): crear una temporaria directa (con la seña que dejó el
 * huésped), cambiar su estado operativo y extender la estadía.
 *
 * Reglas:
 * - Nada se inventa. Lo que la persona no dijo y no sale del sistema se
 *   pregunta (`ask`), de a una cosa y en orden: unidad → fechas → huésped →
 *   total → seña. Si el sistema sugiere un valor (el total con la tarifa base),
 *   va en la pregunta, nunca directo a la tarjeta.
 * - La seña que el huésped YA dejó es plata cobrada: entra a Caja con
 *   `addBookingPayment` en la misma confirmación, DESPUÉS de crear la reserva
 *   con `paid_amount: 0` (con cobro, `createBooking` inserta antes de validar la
 *   cuenta). Es lo mismo que hace el formulario con «Cobrado»: no se toca
 *   `deposit_amount`, que es la seña A INFORMAR en el mensaje al huésped (y
 *   ese mensaje, sin una explícita, ya toma lo cobrado).
 * - Cancelar va por `cancelar_reserva` (tarjeta roja, con motivo); el no-show y
 *   las reactivaciones, por la ficha (migración 053).
 * - Check-out con saldo: nunca se fuerza (`force_checkout`); primero el cobro.
 * - Contratos mensuales y estadías de más de 30 noches: van por el formulario.
 */
import { z } from "zod/v4";
import { can } from "@/lib/permissions";
import {
  addBookingPayment,
  changeBookingStatus,
  createBooking,
  extendBooking,
  previewBookingChange,
} from "@/lib/actions/bookings";
import { createGuest, getGuest } from "@/lib/actions/guests";
import { getWebSettingsForCurrentOrg } from "@/lib/actions/web-settings";
import { computeSena } from "@/lib/marketplace/sena";
import { getAvailabilitySnapshot, type AvailabilitySnapshot } from "@/lib/actions/pms-availability";
import { getUnit, listUnitsForBookingForm, type UnitForBookingForm } from "@/lib/actions/units";
import { MAX_BOOKING_NIGHTS } from "@/lib/booking-split";
import { addDaysYmd } from "@/lib/dates";
import { computeUnitAvailability, rangesOverlap, statusOccupies } from "@/lib/units/availability";
import type { BookingStatus, Guest } from "@/lib/types/database";
import { attempt, defineWrite, hrefs } from "../../tool";
import { clip, dateRange, isYmd, money, nightsBetween, shortDate } from "../../format";
import { resolveUnit } from "../_resolve";
import {
  ask,
  candidateFromDetail,
  describeBooking,
  findBooking,
  idSchema,
  isOta,
  joinNotes,
  loadBooking,
  nightsText,
  pickAccount,
  recheckAccount,
  resolveGuestForBooking,
  round2,
  sourceLabel,
  statusLabel,
  unitLabel,
  ymdSchema,
  type BookingCandidate,
} from "./_shared";

export const SOURCES = ["directo", "airbnb", "booking", "expedia", "vrbo", "whatsapp", "instagram", "otro"] as const;
export const ALL_STATUSES = ["pendiente", "confirmada", "check_in", "check_out", "cancelada", "no_show"] as const;
const CHECK_IN_TIME = "14:00";
const CHECK_OUT_TIME = "10:00";
export const ASK_RESERVA = "¿De qué reserva? Decime el huésped o la unidad.";

/** En mensual las cuotas salen de las fechas: el arrastre y Tex no las rearman, el formulario sí. */
export const monthlyByForm = (bookingId: string) =>
  `Es un alquiler mensual: las fechas se cambian desde la ficha de la reserva (${hrefs.booking(bookingId)}), que rearma las cuotas.`;

type Busy = { busy: boolean; tentative: boolean; reason: string | null; tentativeChannel: string | null };

/**
 * La seña que corresponde según la regla de la organización (Configuración →
 * Web y cobros: una noche, un % o ninguna), para preguntar «¿te dejó seña? La
 * que tenés configurada sería de $ X» en vez de que el modelo invente un monto.
 * null = sin regla o no se pudo leer (se pregunta sin sugerencia).
 */
async function suggestedSena(params: {
  nights: number;
  total: number;
  cleaningFee: number | null;
  currency: string;
}): Promise<{ amount: number; basis: string } | null> {
  const ws = await attempt(() => getWebSettingsForCurrentOrg());
  if (!ws.ok) return null;
  const policy = ws.value.resolved.deposit;
  const amount = computeSena({
    policy,
    nights: params.nights,
    subtotal: params.total - (params.cleaningFee ?? 0),
    total: params.total,
    currency: params.currency,
  });
  if (!amount) return null;
  const basis = policy.rule === "percent" ? `el ${policy.percent} % del total` : "una noche";
  return { amount, basis };
}

/**
 * ¿La unidad está libre en [desde, hasta)? La misma foto autoritativa que
 * «Buscar disp» del PMS (reservas + solicitudes de canal que retienen la venta).
 * `excludeBookingId`: al mover una reserva, ella misma no cuenta.
 */
export async function unitAvailability(
  unitId: string,
  unitCode: string,
  from: string,
  to: string,
  excludeBookingId?: string,
): Promise<{ ok: true; value: Busy } | { ok: false; error: string }> {
  const r = await attempt(() => getAvailabilitySnapshot(from, to));
  if (!r.ok) return r;
  const snap: AvailabilitySnapshot = r.value;
  if (!snap.ok) return { ok: false, error: snap.error };
  const bookings = excludeBookingId ? snap.bookings.filter((b) => b.id !== excludeBookingId) : snap.bookings;
  const av = computeUnitAvailability({ from, to, bookings, requests: snap.requests });
  const clash = bookings.find(
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

/** Las unidades temporarias libres en [desde, hasta), para sugerirlas cuando falta la unidad. */
async function freeUnits(
  units: UnitForBookingForm[],
  from: string,
  to: string,
): Promise<{ ok: true; value: UnitForBookingForm[] } | { ok: false; error: string }> {
  const r = await attempt(() => getAvailabilitySnapshot(from, to));
  if (!r.ok) return r;
  const snap: AvailabilitySnapshot = r.value;
  if (!snap.ok) return { ok: false, error: snap.error };
  const av = computeUnitAvailability({ from, to, bookings: snap.bookings, requests: snap.requests });
  return { ok: true, value: units.filter((u) => u.default_mode !== "mensual" && !av.busy.has(u.id)) };
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
  /** La seña que el huésped YA dejó: entra a Caja al confirmar. */
  deposit: z.object({ amount: z.number().positive(), account_id: idSchema }).nullable(),
});

export const crearReserva = defineWrite({
  name: "crear_reserva",
  label: "Preparando la reserva…",
  description:
    "Prepara una RESERVA temporaria nueva (por noches) para que la persona la confirme con un botón: no se crea hasta que confirma. " +
    "Llamala apenas te pidan una reserva, aunque falten datos: te dice qué preguntar, de a uno (unidad, fechas, huésped, total, seña), con la " +
    "sugerencia del sistema cuando la hay. Verifica que la unidad esté libre y busca al huésped (si hay parecidos, pregunta). " +
    "Si el huésped dejó seña, entra a Caja en la misma confirmación. No sirve para alquileres mensuales ni estadías de más de 30 noches (van por el formulario).",
  input: z.object({
    unidad: z.string().describe("Código o nombre de la unidad, o el id que la persona eligió de una lista.").optional(),
    desde: z.string().describe("Día de llegada (check-in), YYYY-MM-DD.").optional(),
    hasta: z.string().describe("Día de salida (check-out), YYYY-MM-DD: el día que se va (3 noches desde el 14 → hasta el 17).").optional(),
    huesped: z.string().describe("Nombre y apellido del huésped.").optional(),
    huesped_id: z
      .string()
      .describe("Sólo si la persona eligió un huésped de una lista que le mostraste: su id, o «nuevo» si dijo que es otra persona.")
      .optional(),
    telefono: z.string().describe("Teléfono del huésped, si lo dieron.").optional(),
    email: z.string().describe("Mail del huésped, si lo dieron.").optional(),
    huespedes: z.number().int().min(1).max(50).describe("Cuántas personas. Si no lo dijeron, omitir (queda 1).").optional(),
    confirma_capacidad: z
      .boolean()
      .describe("true sólo si la persona confirmó que son más personas que la capacidad de la unidad.")
      .optional(),
    total: z
      .number()
      .min(0)
      .describe("Total que paga el huésped, con la limpieza incluida, tal como lo dijo o confirmó la persona. Si no, omitir.")
      .optional(),
    moneda: z.string().describe("ARS, USD… sólo si la dijeron; si no, la de la tarifa de la unidad.").optional(),
    canal: z.enum(SOURCES).describe("Por dónde llegó la reserva. Si no nombraron una plataforma, directo.").optional(),
    sena: z
      .number()
      .min(0)
      .describe("Seña que el huésped YA dejó (plata que entró). 0 = sin seña. Si no lo dijeron, omitir (se pregunta).")
      .optional(),
    cuenta: z.string().describe("Cuenta de Caja donde entró la seña, si la dijeron (o su id).").optional(),
    notas: z.string().max(1000).describe("Notas para la reserva, si las dieron.").optional(),
  }),
  payload: crearPayload,
  resource: "bookings",
  action: "create",
  async propose(input, ctx) {
    const units = await attempt(() => listUnitsForBookingForm());
    if (!units.ok) return units;
    const desde = input.desde?.trim() || undefined;
    const hasta = input.hasta?.trim() || undefined;

    // 1) Unidad (con las libres como sugerencia si ya hay fechas).
    if (!input.unidad?.trim()) {
      if (desde && hasta && isYmd(desde) && isYmd(hasta) && hasta > desde) {
        const free = await freeUnits(units.value, desde, hasta);
        if (!free.ok) return free;
        if (free.value.length === 0) return { ok: false, error: `No hay unidades libres del ${dateRange(desde, hasta)}.` };
        const codes = free.value.slice(0, 8).map((x) => x.code).join(", ");
        return ask(
          `¿En qué unidad? Libres del ${dateRange(desde, hasta)}: ${codes}${free.value.length > 8 ? "…" : ""}.`,
          free.value.slice(0, 4).map((x) => `${x.code} · ${x.name}`),
        );
      }
      return ask("¿En qué unidad es la reserva?");
    }
    const u = await resolveUnit(input.unidad);
    if (u.ok !== true) return u;
    const unit = u.value;
    const info = units.value.find((x) => x.id === unit.id);
    if (!info) return { ok: false, error: `No encontré la tarifa de ${unit.code}.` };
    if (info.default_mode === "mensual") {
      return {
        ok: false,
        error: `${unit.code} es de alquiler mensual: los contratos mensuales se cargan desde el formulario de Reservas (${hrefs.bookings()}).`,
      };
    }

    // 2) Fechas.
    if (!desde && !hasta) return ask(`¿Qué fechas en ${unit.code}? Decime el día que llega y el día que se va.`);
    if (!desde) {
      if (!hasta || !isYmd(hasta)) return { ok: false, error: "La fecha de salida va en formato YYYY-MM-DD." };
      return ask(`¿Qué día llega? Se va el ${shortDate(hasta, ctx.today)}.`);
    }
    if (!isYmd(desde)) return { ok: false, error: "La fecha de llegada va en formato YYYY-MM-DD." };
    if (!hasta) {
      return ask(
        `¿Hasta qué día se queda? Llega el ${shortDate(desde, ctx.today)}.`,
        [1, 2, 3].map((n) => `${nightsText(n)} (sale ${shortDate(addDaysYmd(desde, n), ctx.today)})`),
      );
    }
    if (!isYmd(hasta)) return { ok: false, error: "La fecha de salida va en formato YYYY-MM-DD." };
    if (+desde.slice(0, 4) < 2020 || +hasta.slice(0, 4) > 2100) return { ok: false, error: "Revisá el año de las fechas." };
    if (hasta <= desde) return { ok: false, error: "La salida tiene que ser después de la llegada." };
    const nights = nightsBetween(desde, hasta);
    if (nights > MAX_BOOKING_NIGHTS) {
      return {
        ok: false,
        error: `Son ${nights} noches: una estadía de más de ${MAX_BOOKING_NIGHTS} noches se carga desde el formulario de Reservas (${hrefs.bookings()}), que pregunta si dividirla en períodos.`,
      };
    }
    const av = await unitAvailability(unit.id, unit.code, desde, hasta);
    if (!av.ok) return av;
    if (av.value.busy) return { ok: false, error: av.value.reason ?? `${unit.code} no está libre en esas fechas.` };

    // 3) Huésped.
    if (!input.huesped?.trim() && !input.huesped_id?.trim()) return ask("¿A nombre de quién es la reserva? Nombre y apellido.");
    const g = await resolveGuestForBooking({
      name: input.huesped ?? "",
      phone: input.telefono,
      email: input.email,
      guestId: input.huesped_id,
    });
    if (g.ok !== true) return g;
    const guest = g.value;
    if (guest.kind === "new" && !can(ctx.role, "guests", "create")) {
      return { ok: false, error: "Tu rol no puede dar de alta huéspedes: elegí uno que ya exista." };
    }
    const contact = [guest.phone, guest.email].filter(Boolean).join(" · ");

    // 4) Total: si no lo dijeron, se pregunta con la tarifa base como sugerencia.
    const unitCurrency = info.base_price_currency || ctx.org.currency || "ARS";
    const moneda = input.moneda?.trim().toUpperCase();
    if (moneda && !/^[A-Z]{3}$/.test(moneda)) return { ok: false, error: `No reconozco la moneda «${input.moneda}». Usá el código: ARS, USD…` };
    const currency = moneda || unitCurrency;
    const basePrice = Number(info.base_price ?? 0);
    const unitFee = Number(info.cleaning_fee ?? 0);
    const feeApplies = unitFee > 0 && currency === unitCurrency;
    if (input.total === undefined) {
      if (basePrice > 0 && currency === unitCurrency) {
        const fee = feeApplies ? unitFee : 0;
        const estimate = round2(basePrice * nights + fee);
        return ask(
          `¿El total sería ${money(estimate, currency)} (${nightsText(nights)} a tarifa base${fee ? ` + limpieza ${money(fee, currency)}` : ""})?`,
          [`Sí, ${money(estimate, currency)}`, "Otro monto"],
        );
      }
      return ask(`¿Cuál es el total que paga ${guest.name}, con la limpieza incluida${currency !== unitCurrency ? ` (en ${currency})` : ""}?`);
    }
    const total = round2(input.total);
    const cleaningFee = feeApplies && unitFee <= total ? unitFee : null;

    // 5) Personas: 1 si no lo dijeron; si superan la capacidad, se confirma.
    const guestsCount = input.huespedes ?? 1;
    if (guestsCount > 1 && !input.confirma_capacidad) {
      const full = await attempt(() => getUnit(unit.id));
      const max = full.ok ? Number((full.value as { max_guests?: number | null } | null)?.max_guests ?? 0) : 0;
      if (max > 0 && guestsCount > max) {
        return ask(`¿Son ${guestsCount} personas? ${unit.code} es para ${max}.`, [`Sí, son ${guestsCount}`, "Corregir la cantidad"]);
      }
    }

    // 6) Seña: las plataformas cobran ellas; en el resto, se pregunta.
    const source = input.canal ?? "directo";
    const ota = isOta(source);
    if (ota && (input.sena ?? 0) > 0) {
      return {
        ok: false,
        error: `En las reservas de ${sourceLabel(source)} el pago lo cobra la plataforma: no hay seña para registrar. Si te pagaron algo aparte, registralo después como cargo extra.`,
      };
    }
    if (!ota && input.sena === undefined) {
      // La sugerencia sale de la regla configurada, nunca del modelo. Y la
      // pregunta es por plata que YA entró: lo que se toque acá va a Caja.
      const hint = total > 0 ? await suggestedSena({ nights, total, cleaningFee, currency }) : null;
      if (hint) {
        return ask(`¿Te dejó seña? La que tenés configurada (${hint.basis}) sería de ${money(hint.amount, currency)}.`, [
          `Sí, ${money(hint.amount, currency)}`,
          "Sí, otro monto",
          "Sin seña",
        ]);
      }
      return ask("¿Te dejó seña? ¿De cuánto?", ["Sin seña", "Sí, dejó seña"]);
    }
    const sena = ota ? 0 : round2(input.sena ?? 0);
    if (sena > total + 0.004) {
      return { ok: false, error: `La seña (${money(sena, currency)}) es más que el total (${money(total, currency)}). Revisá los montos.` };
    }
    let account: { id: string; name: string; currency: string } | null = null;
    if (sena > 0) {
      const acc = await pickAccount(input.cuenta, currency, "la seña");
      if (acc.ok !== true) return acc;
      account = acc.value;
    }

    const notes = clip(input.notas, 1000) ?? null;
    const saldo = round2(total - sena);
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
        deposit: account ? { amount: sena, account_id: account.id } : null,
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
            label: "Total",
            value: `${money(total, currency)}${cleaningFee ? ` (incluye limpieza ${money(cleaningFee, currency)})` : ""}`,
          },
          {
            label: ota ? "Seña" : "Seña que dejó",
            value: ota
              ? `La cobra ${sourceLabel(source)}`
              : account
                ? `${money(sena, currency)} · entra en ${account.name} (${account.currency})`
                : "Sin seña",
          },
          ...(ota ? [] : [{ label: "Saldo", value: saldo > 0.01 ? money(saldo, currency) : "Sin saldo" }]),
          { label: "Canal", value: sourceLabel(source) },
          { label: "Estado", value: "Confirmada" },
          ...(notes ? [{ label: "Notas", value: notes }] : []),
        ],
        note: joinNotes([
          guest.kind === "existing" &&
            guest.blacklisted &&
            `Ojo: ${guest.name} está en la lista negra${guest.blacklistReason ? ` (${guest.blacklistReason})` : ""}.`,
          total === 0 && "La reserva queda en $ 0.",
          av.value.tentative &&
            `Hay una solicitud de ${av.value.tentativeChannel ?? "una plataforma"} sin confirmar en esas fechas: si la aceptan, se superponen.`,
          desde < ctx.today && "La llegada ya pasó: queda cargada como una reserva atrasada.",
          ota &&
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
    if (p.deposit && p.deposit.amount > p.total_amount + 0.004) return { ok: false, error: "La seña supera el total. No creé nada." };

    // Otra vez: el constraint de la base no ve las solicitudes de canal que retienen la venta.
    const av = await unitAvailability(p.unit_id, u.value.code, p.check_in_date, p.check_out_date);
    if (!av.ok) return av;
    if (av.value.busy) return { ok: false, error: `Mientras confirmabas se ocupó: ${av.value.reason ?? "la unidad ya no está libre."} No creé nada.` };

    // La cuenta de la seña, ANTES de crear nada: si no sirve, que no quede una reserva a medias.
    let accountName: string | null = null;
    if (p.deposit) {
      const acc = await recheckAccount(p.deposit.account_id, p.currency);
      if (!acc.ok) return acc;
      accountName = acc.value.name;
    }

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
        // Siempre 0: con cobro, createBooking inserta antes de validar la cuenta. La seña va abajo.
        paid_amount: 0,
        // null = los resuelve el servidor con la misma cascada que el formulario.
        commission_pct: null,
        channel_commission_pct: null,
        cleaning_fee: p.cleaning_fee,
        notes: p.notes,
        internal_notes: `Cargada con Tex por ${ctx.user.name}.`,
      }),
    );
    if (!r.ok) {
      // El huésped nuevo ya se dio de alta: que nadie lo cargue dos veces.
      return ng
        ? {
            ok: false,
            error: `${r.error} La reserva no se creó, pero ${guestName} quedó cargado como huésped: si lo intentás de nuevo, usá ese mismo huésped.`,
          }
        : r;
    }
    const bookingId = r.value.id;
    const created = `Reserva creada: ${guestName} en ${u.value.code}, ${dateRange(p.check_in_date, p.check_out_date)}.`;

    if (p.deposit) {
      const dep = p.deposit;
      const paid = await attempt(() => addBookingPayment(bookingId, dep.amount, dep.account_id));
      if (!paid.ok) {
        // La reserva ya existe: se informa lo que quedó, para que nadie la vuelva a crear.
        const after = await loadBooking(bookingId);
        const half = after.ok && after.value.paid_amount > 0.004;
        return {
          ok: true,
          message: half
            ? `${created} Pero la seña quedó a medias: la reserva la sumó y el movimiento de Caja no se creó (${paid.error}). Revisalo en la ficha.`
            : `${created} Pero la seña no se registró: ${paid.error}. Cargala desde la ficha.`,
          href: hrefs.booking(bookingId),
          data: { reserva_id: bookingId, huesped_id: guestId, sena_registrada: false },
        };
      }
      return {
        ok: true,
        message: `${created} Seña de ${money(dep.amount, p.currency)} en ${accountName ?? "Caja"}.`,
        href: hrefs.booking(bookingId),
        data: { reserva_id: bookingId, huesped_id: guestId, sena_registrada: true },
      };
    }
    return { ok: true, message: created, href: hrefs.booking(bookingId), data: { reserva_id: bookingId, huesped_id: guestId } };
  },
});

// ── cambiar_estado_reserva ──────────────────────────────────────────────────

type OpTarget = "confirmada" | "check_in" | "check_out";
type AnyTarget = OpTarget | "cancelada" | "no_show";

/** Por qué una reserva no sirve para pasar a `target` (null = sirve). */
function eligibleFor(target: AnyTarget, today: string) {
  return (c: BookingCandidate): string | null => {
    if (target === "cancelada" || target === "no_show") return null; // sólo se busca para derivar
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
    "o el check-out (sólo sin saldo: si debe, primero registrar_cobro). Para CANCELAR usá cancelar_reserva. El NO-SHOW no se hace desde acá: " +
    "si te lo piden, llamala igual con ese estado y te devuelve el link de la ficha para pasarle.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id que la persona eligió de una lista.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    estado: z
      .enum(["confirmada", "check_in", "check_out", "cancelada", "no_show"])
      .describe("Estado al que pasa. Si no lo dijeron, omitir (se pregunta).")
      .optional(),
  }),
  payload: z.object({
    booking_id: idSchema,
    status: z.enum(["confirmada", "check_in", "check_out"]),
    from_status: z.enum(ALL_STATUSES),
  }),
  resource: "bookings",
  action: "update",
  async propose(input, ctx) {
    if (!input.reserva?.trim()) return ask(ASK_RESERVA);
    if (!input.estado) {
      const f = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today });
      if (f.ok !== true) return f;
      const c = f.value;
      const next: string[] =
        c.status === "pendiente" ? ["Confirmada", "Check-in"] : c.status === "confirmada" ? ["Check-in", "Check-out"] : c.status === "check_in" ? ["Check-out"] : [];
      if (next.length === 0) return { ok: false, error: `La reserva de ${describeBooking(c)} ya está ${statusLabel(c.status).toLowerCase()}.` };
      return ask(`¿Qué le marco a la reserva de ${describeBooking(c)}? Hoy está ${statusLabel(c.status).toLowerCase()}.`, next);
    }
    const estado: AnyTarget = input.estado;
    const found = await findBooking(input.reserva, {
      unidad: input.unidad,
      today: ctx.today,
      eligible: eligibleFor(estado, ctx.today),
    });
    if (found.ok !== true) return found;
    if (estado === "cancelada") {
      return {
        ok: false,
        error: `Para cancelar usá cancelar_reserva con esta reserva (id ${found.value.id}): pide el motivo y la persona lo confirma en una tarjeta roja.`,
      };
    }
    if (estado === "no_show") {
      return {
        ok: false,
        error: `Marcar un no-show lo decide una persona desde la ficha de la reserva, no desde acá. Pasale el link: ${hrefs.booking(found.value.id)}`,
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

export const MOVABLE = new Set<BookingStatus>(["pendiente", "confirmada", "check_in"]);

const notExtendable = (c: BookingCandidate) =>
  MOVABLE.has(c.status) ? null : `La reserva de ${describeBooking(c)} está ${statusLabel(c.status).toLowerCase()}: no se puede cambiar.`;

/** "choca con la reserva de X (25 al 28 nov); …" a partir del preview. */
export function previewBlockers(preview: {
  warnings: Array<{ kind: string; message: string }>;
  conflicts: Array<{ guest_name: string | null; range: string }>;
  in_closed_settlement_period: boolean;
}): string | null {
  const blocking = preview.warnings.filter((w) => w.kind === "blocking").map((w) => w.message);
  if (blocking.length === 0 && preview.conflicts.length === 0 && !preview.in_closed_settlement_period) return null;
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
  return parts.join("; ") || "el cambio no pasa las validaciones";
}

export const extenderReserva = defineWrite({
  name: "extender_reserva",
  label: "Preparando la extensión…",
  description:
    "Prepara la EXTENSIÓN de una estadía (una salida más tarde, en la misma unidad) para que la persona la confirme. Revisa que no choque con otra " +
    "reserva ni con una liquidación cerrada; si el total cambia, pregunta si pasa al de la misma tarifa por noche o queda igual. " +
    "Para acortar, mover fechas o cambiar de unidad usá mover_reserva.",
  input: z.object({
    reserva: z
      .string()
      .describe("De quién es la reserva: nombre y apellido del huésped, código de la unidad o de la reserva, o el id que la persona eligió de una lista.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    hasta: z.string().describe("Nueva fecha de salida (check-out), YYYY-MM-DD. Si no la dijeron, omitir (se pregunta).").optional(),
    total: z
      .number()
      .min(0)
      .describe("Nuevo total de TODA la estadía, tal como lo dijo o eligió la persona. Si no, omitir.")
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
    if (!input.reserva?.trim()) return ask(ASK_RESERVA);
    const found = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today, eligible: notExtendable });
    if (found.ok !== true) return found;
    const bk = await loadBooking(found.value.id);
    if (!bk.ok) return bk;
    const b = bk.value;
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva." };
    const why = notExtendable(candidateFromDetail(b));
    if (why) return { ok: false, error: why };
    if (b.mode === "mensual") return { ok: false, error: monthlyByForm(b.id) };
    const who = b.guest?.full_name ?? "Sin huésped";
    const hasta = input.hasta?.trim();
    if (!hasta) {
      return ask(
        `¿Hasta qué día se queda ${who}? Hoy sale el ${shortDate(b.check_out_date, ctx.today)}.`,
        [1, 2, 3].map((n) => `${n === 1 ? "1 noche más" : `${n} noches más`} (sale ${shortDate(addDaysYmd(b.check_out_date, n), ctx.today)})`),
      );
    }
    if (!isYmd(hasta) || +hasta.slice(0, 4) > 2100) return { ok: false, error: "Necesito la nueva fecha de salida en formato YYYY-MM-DD." };
    if (hasta === b.check_out_date) return { ok: false, error: `${who} ya sale el ${shortDate(hasta, ctx.today)}.` };
    if (hasta < b.check_out_date) {
      return {
        ok: false,
        error: `Eso acorta la estadía (hoy sale el ${shortDate(b.check_out_date, ctx.today)}): para acortar usá mover_reserva.`,
      };
    }
    const oldNights = nightsBetween(b.check_in_date, b.check_out_date);
    const newNights = nightsBetween(b.check_in_date, hasta);
    const reason = clip(input.motivo, 500) ?? null;
    if (newNights - oldNights > 30 && !reason) return ask("Suma más de 30 noches: ¿por qué se extiende? Queda registrado en la reserva.");

    const pv = await attempt(() =>
      previewBookingChange({ id: b.id, unit_id: b.unit_id, check_in_date: b.check_in_date, check_out_date: hasta }),
    );
    if (!pv.ok) return pv;
    const preview = pv.value;
    const blockers = previewBlockers(preview);
    if (blockers) return { ok: false, error: `No se puede extender hasta el ${shortDate(hasta, ctx.today)}: ${blockers}.` };

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
          { label: "Total", value: totalToSend === null ? `${money(previous, b.currency)} (no cambia)` : `${money(previous, b.currency)} → ${money(newTotal, b.currency)}` },
          { label: "Saldo después", value: saldo > 0.01 ? money(saldo, b.currency) : "Sin saldo" },
          ...(reason ? [{ label: "Motivo", value: reason }] : []),
        ],
        note: joinNotes([
          previous <= 0 && input.total === undefined && "La reserva no tiene importe cargado: el total sigue en $ 0.",
          ...preview.warnings.filter((w) => w.kind === "info").map((w) => `${w.message}.`),
          preview.cleaning_tasks_affected.length > 0 && "La limpieza de salida se mueve a la nueva fecha.",
          newNights > MAX_BOOKING_NIGHTS &&
            b.lease_group_id &&
            `Pasa de ${MAX_BOOKING_NIGHTS} noches: el sistema la divide en períodos de ${MAX_BOOKING_NIGHTS}.`,
          isOta(b.source) &&
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
    if (!MOVABLE.has(b.status)) {
      return { ok: false, error: `La reserva pasó a ${statusLabel(b.status).toLowerCase()} mientras tanto. No toqué nada.` };
    }
    if (b.is_block) return { ok: false, error: "Eso es un cierre de calendario, no una reserva. No toqué nada." };
    if (b.mode === "mensual") return { ok: false, error: `${monthlyByForm(b.id)} No toqué nada.` };
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
    if (previewBlockers(pv.value)) {
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
