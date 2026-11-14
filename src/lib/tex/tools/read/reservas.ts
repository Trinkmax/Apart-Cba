/**
 * `listar_reservas`, `ver_reserva` y `ver_huesped`.
 *
 * Ojo con los importes: `paid_amount` es lo cobrado (sale de Caja);
 * `deposit_amount` (la seña) es lo que se le PIDIÓ al huésped, no plata que
 * entró. El saldo es total − cobrado, en la moneda de la reserva.
 */
import { z } from "zod/v4";
import { getBooking, listBookings, listBookingsPaged } from "@/lib/actions/bookings";
import { listMovementsForBooking } from "@/lib/actions/cash";
import { listScheduleForBooking } from "@/lib/actions/payment-schedule";
import { getGuestProfile, searchGuests } from "@/lib/actions/guests";
import { addDaysYmd } from "@/lib/dates";
import { can, isAdminLevel } from "@/lib/permissions";
import type { Booking, BookingPaymentSchedule, BookingStatus } from "@/lib/types/database";
import type { CardRow, TexCard } from "../../types";
import { attempt, defineRead, hrefs, type ReadResult } from "../../tool";
import { clip, fold, isYmd, money, moneyByCurrency, nightsBetween, shortDate, sumByCurrency } from "../../format";
import { resolveBooking } from "../_resolve";
import {
  BOOKING_STATUSES,
  UUID_RE,
  bookingStatusLabel,
  bookingStatusTone,
  cashCategoryLabel,
  isDeadBooking,
  localYmd,
  num,
  plural,
  round2,
  sourceLabel,
  stayLabel,
  unitLabel,
} from "./_shared";

type ListRow = {
  id: string;
  status: BookingStatus;
  source: string;
  check_in_date: string;
  check_out_date: string;
  guests_count: number;
  currency: string;
  total_amount: number | string;
  paid_amount: number | string;
  external_id?: string | null;
  unit: { id: string; code: string; name: string } | null | undefined;
  guest: { full_name: string; phone?: string | null; email?: string | null } | null | undefined;
};

/** Estos estados se buscan en todo el historial; el resto, por fecha de entrada. */
const HISTORY_STATUSES: readonly string[] = ["check_in", "check_out", "cancelada", "no_show"];
const HISTORY_TITLE: Record<string, string> = {
  check_in: "Alojados ahora",
  check_out: "Reservas que ya salieron",
  cancelada: "Reservas canceladas",
  no_show: "No-shows",
};
/** Las filas de `listBookings` vienen con `select *`: un rango largo pesa. */
const MAX_RANGE_DAYS = 400;

export const listarReservas = defineRead({
  name: "listar_reservas",
  label: "Buscando reservas…",
  description:
    "Lista reservas. Sin texto: las que ENTRAN en un rango de fechas (por defecto de hoy a 30 días), de la más próxima a la más lejana, " +
    "sin canceladas salvo que se pida ese estado. Con texto (huésped, teléfono, código de Airbnb/Booking, unidad): busca en todo el historial, " +
    "las más nuevas primero. Con estado check_in: quién está alojado ahora. Para el detalle de una usá ver_reserva con su reserva_id; " +
    "para lo de un solo día (llegadas/salidas) es mejor parte_del_dia.",
  input: z.object({
    texto: z.string().max(120).describe("Huésped, teléfono, email, documento, código de Airbnb/Booking o código/nombre de la unidad.").optional(),
    estado: z
      .enum(BOOKING_STATUSES)
      .describe("pendiente, confirmada, check_in (alojado ahora), check_out (ya salió), cancelada o no_show.")
      .optional(),
    desde: z.string().describe("Entradas desde este día, YYYY-MM-DD.").optional(),
    hasta: z.string().describe("Entradas hasta este día inclusive, YYYY-MM-DD.").optional(),
  }),
  resource: "bookings",
  action: "view",
  async run(input, ctx) {
    const texto = input.texto?.trim() || undefined;
    const estado = input.estado;
    if ((input.desde && !isYmd(input.desde)) || (input.hasta && !isYmd(input.hasta))) {
      return { ok: false, error: "Las fechas tienen que ser días reales en formato YYYY-MM-DD." };
    }
    const showMoney = can(ctx.role, "payments", "view");
    const hasDates = Boolean(input.desde || input.hasta);
    let rows: ListRow[];
    let total: number;
    let title: string;
    let rango: { desde: string; hasta: string } | null = null;
    let truncado = false;

    if (!hasDates && (texto || (estado && HISTORY_STATUSES.includes(estado)))) {
      // Búsqueda o estado "de historial": sin ventana, las más nuevas primero (página 0 = la primera).
      const r = await attempt(() => listBookingsPaged({ page: 0, pageSize: 40, q: texto, status: estado, windowDays: 0 }));
      if (!r.ok) return r;
      rows = r.value.rows as ListRow[];
      total = r.value.total;
      title = texto ? `Reservas de «${texto}»` : (HISTORY_TITLE[estado ?? ""] ?? "Reservas");
    } else {
      const desde = input.desde ?? ctx.today;
      const hasta = input.hasta ?? addDaysYmd(desde, 30);
      if (hasta < desde) return { ok: false, error: "«Hasta» tiene que ser igual o posterior a «desde»." };
      if (nightsBetween(desde, hasta) > MAX_RANGE_DAYS) {
        return { ok: false, error: "Pedí un rango de hasta un año (o buscá por texto)." };
      }
      rango = { desde, hasta };
      const r = await attempt(() => listBookings({ status: estado, fromDate: desde, toDate: hasta }));
      if (!r.ok) return r;
      truncado = r.value.length >= 1000;
      const q = texto ? fold(texto) : null;
      rows = (r.value as unknown as (ListRow & { is_block?: boolean })[])
        .filter((b) => !b.is_block && (estado ? true : !isDeadBooking(b.status)))
        .filter((b) => {
          if (!q) return true;
          const hay = [b.guest?.full_name, b.guest?.phone, b.guest?.email, b.unit?.code, b.unit?.name, b.external_id];
          return hay.some((s) => fold(s).includes(q));
        })
        .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date) || (a.unit?.code ?? "").localeCompare(b.unit?.code ?? ""));
      total = rows.length;
      title = `Entradas del ${shortDate(desde, ctx.today)} al ${shortDate(hasta, ctx.today)}`;
    }

    const shown = rows.slice(0, 40);
    const cardRows: CardRow[] = shown.slice(0, 15).map((b) => ({
      title: b.guest?.full_name?.trim() || "Sin huésped cargado",
      subtitle: `${unitLabel(b.unit)} · ${stayLabel(b.check_in_date, b.check_out_date, ctx.today)}`,
      badge: { label: bookingStatusLabel(b.status), tone: bookingStatusTone(b.status) },
      amount: showMoney ? { value: money(b.total_amount, b.currency) } : undefined,
      href: hrefs.booking(b.id),
    }));
    const listHref = `${hrefs.bookings()}${texto ? `?q=${encodeURIComponent(texto)}` : estado ? `?status=${estado}` : ""}`;

    return {
      ok: true,
      data: {
        ...(rango ? { entradas_desde: rango.desde, entradas_hasta: rango.hasta } : {}),
        total,
        reservas: shown.map((b) => {
          const saldo = round2(num(b.total_amount) - num(b.paid_amount));
          return {
            reserva_id: b.id,
            huesped: b.guest?.full_name ?? "Sin huésped cargado",
            unidad: unitLabel(b.unit),
            entrada: b.check_in_date,
            salida: b.check_out_date,
            noches: nightsBetween(b.check_in_date, b.check_out_date),
            estado: b.status,
            canal: sourceLabel(b.source),
            ...(showMoney
              ? {
                  total: num(b.total_amount) > 0 ? money(b.total_amount, b.currency) : "sin precio",
                  ...(saldo > 0.004 && !isDeadBooking(b.status) ? { saldo: money(saldo, b.currency) } : {}),
                }
              : {}),
          };
        }),
        ...(total > shown.length ? { nota: `Hay ${total} en total; muestro ${shown.length}. Afiná con fechas, estado o texto.` } : {}),
        ...(truncado ? { aviso: "El rango trajo el máximo de filas; puede faltar alguna. Pedí un rango más corto." } : {}),
      },
      card: {
        kind: "list",
        title: total ? `${title} (${total})` : title,
        icon: "calendar",
        rows: cardRows,
        more: Math.max(0, total - cardRows.length),
        empty: "No hay reservas con esos filtros.",
        footer: { label: "Ver la lista de reservas", href: listHref },
      },
    };
  },
});

type BookingFull = Booking & {
  unit?: { id: string; code: string; name: string } | null;
  guest?: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    document_type: string | null;
    document_number: string | null;
  } | null;
  commission_effective?: { pct: number; origin: string } | null;
};

type MovementLite = {
  direction: "in" | "out";
  amount: number | string;
  currency: string;
  category: string;
  occurred_at: string;
  description: string | null;
  account: { name: string } | null;
};

const SCHEDULE_STATUS: Record<string, string> = {
  pending: "pendiente",
  partial: "parcial",
  paid: "pagada",
  overdue: "vencida",
  cancelled: "anulada",
};

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

function chooseCard(question: string, options: Array<{ id: string; label: string; detail?: string }>): TexCard {
  return {
    kind: "list",
    title: question,
    icon: "list",
    rows: options.map((o) => ({ title: o.label, subtitle: o.detail, href: hrefs.booking(o.id) })),
  };
}

export const verReserva = defineRead({
  name: "ver_reserva",
  label: "Abriendo la reserva…",
  description:
    "Todo sobre UNA reserva: huésped y contacto, unidad, fechas y noches, estado, canal, total, cobrado y saldo, los cobros registrados " +
    "y las cuotas si es un alquiler mensual. Usala para «¿cuánto debe Pérez?», «¿pagó la reserva del 525?», «¿cuándo sale la de Gómez?». " +
    "Si hay varias que coinciden te devuelve las opciones: preguntale a la persona cuál es (nunca elijas vos). La seña informada NO es plata cobrada.",
  input: z.object({
    reserva: z
      .string()
      .min(2)
      .max(120)
      .describe("El reserva_id si vino de otra herramienta, o lo que dijo la persona: huésped, código de Airbnb/Booking o «Pérez en el 525»."),
  }),
  resource: "bookings",
  action: "view",
  async run(input, ctx): Promise<ReadResult> {
    const q = input.reserva.trim();
    let id: string;
    if (UUID_RE.test(q)) {
      // Un reserva_id de otra herramienta: getBooking alcanza (resolveBooking la leería dos veces).
      id = q;
    } else {
      const res = await resolveBooking(q);
      if (res.ok === false) return res;
      if (res.ok === "choose") {
        return {
          ok: true,
          data: { necesito_elegir: res.question, opciones: res.options },
          card: chooseCard(res.question, res.options),
        };
      }
      id = res.value.id;
    }
    const showMoney = can(ctx.role, "payments", "view");
    const empty = <T,>() => Promise.resolve({ ok: true as const, value: [] as T[] });
    const [bR, mvR, schR] = await Promise.all([
      attempt(() => getBooking(id)),
      showMoney ? attempt(() => listMovementsForBooking(id)) : empty<unknown>(),
      showMoney ? attempt(() => listScheduleForBooking(id)) : empty<BookingPaymentSchedule>(),
    ]);
    if (!bR.ok) return bR;
    const b = bR.value as unknown as BookingFull | null;
    if (!b) return { ok: false, error: "No encontré esa reserva." };

    const cur = b.currency || ctx.org.currency;
    const total = num(b.total_amount);
    const paid = num(b.paid_amount);
    const saldo = round2(total - paid);
    const dead = isDeadBooking(b.status);
    const noches = nightsBetween(b.check_in_date, b.check_out_date);
    const movements = (mvR.ok ? mvR.value : []) as MovementLite[];
    const schedule = (schR.ok ? schR.value : []) as BookingPaymentSchedule[];
    const guestName = b.guest?.full_name?.trim() || "Sin huésped cargado";
    const tz = ctx.org.timezone;

    const cuotas = schedule.slice(0, 24).map((s) => {
      const open = s.status === "pending" || s.status === "partial" || s.status === "overdue";
      return {
        cuota: `${s.sequence_number}/${s.total_count}`,
        vence: s.due_date,
        monto: money(s.expected_amount, s.currency),
        pagado: money(s.paid_amount, s.currency),
        estado: SCHEDULE_STATUS[s.status] ?? s.status,
        ...(open && s.due_date < ctx.today ? { vencida: true } : {}),
      };
    });

    const data = {
      reserva_id: b.id,
      ...(b.is_block ? { es_cierre: "Es un cierre de calendario de la OTA, no una reserva." } : {}),
      estado: b.status,
      huesped: guestName,
      ...(can(ctx.role, "guests", "view") && b.guest
        ? {
            contacto: {
              telefono: b.guest.phone ?? undefined,
              email: b.guest.email ?? undefined,
              documento: [b.guest.document_type, b.guest.document_number].filter(Boolean).join(" ") || undefined,
            },
          }
        : {}),
      unidad: unitLabel(b.unit),
      entrada: [b.check_in_date, hhmm(b.check_in_time)].filter(Boolean).join(" "),
      salida: [b.check_out_date, hhmm(b.check_out_time)].filter(Boolean).join(" "),
      noches,
      personas: b.guests_count,
      modo: b.mode,
      canal: sourceLabel(b.source),
      codigo_externo: b.external_id ?? undefined,
      ...(showMoney
        ? {
            total: total > 0 ? money(total, cur) : "sin precio cargado",
            cobrado: money(paid, cur),
            saldo: money(Math.max(0, saldo), cur),
            ...(saldo < -0.004 ? { cobrado_de_mas: money(-saldo, cur) } : {}),
            ...(num(b.cleaning_fee) > 0 ? { limpieza_incluida: money(b.cleaning_fee, cur) } : {}),
            ...(num(b.deposit_amount) > 0
              ? { sena_pedida: `${money(b.deposit_amount, cur)} (lo que se le pidió al huésped; NO es plata cobrada)` }
              : {}),
            ...(b.mode === "mensual" && num(b.monthly_rent) > 0 ? { renta_mensual: money(b.monthly_rent, cur) } : {}),
            ...(b.commission_effective ? { comision_pct: b.commission_effective.pct } : {}),
            cobros: movements.slice(0, 15).map((m) => ({
              fecha: localYmd(m.occurred_at, tz),
              importe: `${m.direction === "in" ? "" : "−"}${money(m.amount, m.currency)}`,
              concepto: cashCategoryLabel(m.category),
              cuenta: m.account?.name,
              detalle: clip(m.description, 80),
            })),
            ...(cuotas.length ? { cuotas } : {}),
          }
        : {}),
      notas: clip(b.notes, 200),
      ...(isAdminLevel(ctx.role) ? { notas_internas: clip(b.internal_notes, 200) } : {}),
      ...(b.status === "cancelada" ? { cancelada_el: localYmd(b.cancelled_at, tz), motivo: clip(b.cancelled_reason, 140) } : {}),
    };

    const cards: TexCard[] = [
      {
        kind: "stats",
        title: `${guestName} · ${b.unit?.code ?? unitLabel(b.unit)}`,
        icon: "bed",
        tiles: [
          { label: "Fechas", value: stayLabel(b.check_in_date, b.check_out_date, ctx.today), hint: plural(noches, "noche", "noches") },
          { label: "Estado", value: bookingStatusLabel(b.status), tone: bookingStatusTone(b.status) },
          ...(showMoney
            ? [
                { label: "Total", value: total > 0 ? money(total, cur) : "Sin precio", tone: total > 0 ? undefined : ("warn" as const) },
                {
                  label: "Saldo",
                  value: money(Math.max(0, saldo), cur),
                  hint: `Cobrado ${money(paid, cur)}`,
                  tone: dead ? undefined : saldo > 0.004 ? ("warn" as const) : ("good" as const),
                },
              ]
            : []),
        ],
        note: [sourceLabel(b.source), b.external_id].filter(Boolean).join(" · ") || undefined,
        footer: { label: "Abrir la reserva", href: hrefs.booking(b.id) },
      },
    ];
    if (cuotas.length > 0) {
      cards.push({
        kind: "list",
        title: "Cuotas",
        icon: "wallet",
        rows: schedule.slice(0, 8).map((s, i) => ({
          title: `Cuota ${cuotas[i].cuota}`,
          meta: shortDate(s.due_date, ctx.today),
          badge: cuotas[i].vencida
            ? { label: "Vencida", tone: "bad" }
            : { label: cuotas[i].estado, tone: s.status === "paid" ? "good" : "neutral" },
          amount: { value: cuotas[i].monto },
        })),
        more: Math.max(0, schedule.length - 8),
      });
    }
    return { ok: true, data, cards };
  },
});

export const verHuesped = defineRead({
  name: "ver_huesped",
  label: "Buscando al huésped…",
  description:
    "La ficha de un huésped: contacto (teléfono, email, documento), si está bloqueado, y su historial de estadías (cuántas, la última, " +
    "la próxima y cuánto sumó por moneda). Usala para «¿tenemos el teléfono de Gómez?», «¿ya vino antes?». " +
    "Si hay varios con ese nombre te devuelve las opciones: preguntale a la persona cuál es.",
  input: z.object({
    huesped: z
      .string()
      .min(2)
      .max(120)
      .describe("Nombre, teléfono, email o documento del huésped, o su id si vino de otra herramienta."),
  }),
  resource: "guests",
  action: "view",
  async run(input, ctx): Promise<ReadResult> {
    const q = input.huesped.trim();
    let id: string | null = UUID_RE.test(q) ? q : null;
    if (!id) {
      const r = await attempt(() => searchGuests(q));
      if (!r.ok) return r;
      const found = r.value;
      if (found.length === 0) return { ok: false, error: `No encontré huéspedes para «${q}».` };
      const exact = found.filter((g) => fold(g.full_name) === fold(q));
      const pick = found.length === 1 ? found[0] : exact.length === 1 ? exact[0] : null;
      if (!pick) {
        const opciones = found.slice(0, 8).map((g) => ({
          id: g.id,
          label: g.full_name,
          detail: [g.phone, g.email, g.document_number].filter(Boolean).join(" · ") || undefined,
        }));
        const question = `Hay ${found.length} huéspedes que coinciden con «${q}». ¿Cuál es?`;
        return {
          ok: true,
          data: { necesito_elegir: question, opciones },
          card: {
            kind: "list",
            title: question,
            icon: "user",
            rows: opciones.map((o) => ({ title: o.label, subtitle: o.detail })),
          },
        };
      }
      id = pick.id;
    }

    const guestId = id;
    const r = await attempt(() => getGuestProfile(guestId));
    if (!r.ok) return r;
    const g = r.value;
    if (!g) return { ok: false, error: "No encontré ese huésped." };

    const showMoney = can(ctx.role, "payments", "view");
    const real = g.bookings.filter((b) => !isDeadBooking(b.status));
    const past = real.filter((b) => b.check_in_date <= ctx.today).sort((a, b) => b.check_in_date.localeCompare(a.check_in_date));
    const next = real.filter((b) => b.check_in_date > ctx.today).sort((a, b) => a.check_in_date.localeCompare(b.check_in_date));
    const brief = (b: (typeof g.bookings)[number]) => ({
      reserva_id: b.id,
      unidad: unitLabel(b.unit),
      fechas: stayLabel(b.check_in_date, b.check_out_date, ctx.today),
      estado: b.status,
    });
    const totals = sumByCurrency(real, (b) => num(b.total_amount), (b) => b.currency);
    const lugar = [g.city_name ?? g.city, g.state_or_province, g.country].filter(Boolean).join(", ");

    return {
      ok: true,
      data: {
        huesped_id: g.id,
        nombre: g.full_name,
        telefono: g.phone ?? undefined,
        email: g.email ?? undefined,
        documento: [g.document_type, g.document_number].filter(Boolean).join(" ") || undefined,
        lugar: lugar || undefined,
        nacimiento: g.birth_date ?? undefined,
        notas: clip(g.notes, 200),
        ...(g.blacklisted ? { bloqueado: true, motivo_bloqueo: clip(g.blacklist_reason, 140) } : {}),
        estadias: real.length,
        canceladas: g.bookings.length - real.length,
        ...(past[0] ? { ultima: brief(past[0]) } : {}),
        ...(next[0] ? { proxima: brief(next[0]) } : {}),
        ...(showMoney && real.length ? { total_por_moneda: moneyByCurrency(totals) } : {}),
        reservas: g.bookings.slice(0, 12).map((b) => ({
          ...brief(b),
          ...(showMoney ? { total: money(b.total_amount, b.currency) } : {}),
        })),
      },
      cards: [
        {
          kind: "stats",
          title: g.full_name,
          icon: "user",
          tiles: [
            { label: "Estadías", value: String(real.length), hint: g.bookings.length > real.length ? `${g.bookings.length - real.length} canceladas` : undefined },
            {
              label: next[0] ? "Próxima" : "Última",
              value: next[0]
                ? stayLabel(next[0].check_in_date, next[0].check_out_date, ctx.today)
                : past[0]
                  ? stayLabel(past[0].check_in_date, past[0].check_out_date, ctx.today)
                  : "—",
            },
            ...(showMoney && real.length ? [{ label: "Total", value: moneyByCurrency(totals) }] : []),
            ...(g.blacklisted ? [{ label: "Bloqueado", value: "Sí", tone: "bad" as const }] : []),
          ],
          note: [g.phone, g.email].filter(Boolean).join(" · ") || undefined,
          footer: { label: "Ir a Huéspedes", href: hrefs.guests() },
        },
        {
          kind: "list",
          title: "Estadías",
          icon: "calendar",
          rows: g.bookings.slice(0, 8).map((b) => ({
            title: unitLabel(b.unit),
            subtitle: stayLabel(b.check_in_date, b.check_out_date, ctx.today),
            badge: { label: bookingStatusLabel(b.status), tone: bookingStatusTone(b.status) },
            amount: showMoney ? { value: money(b.total_amount, b.currency) } : undefined,
            href: hrefs.booking(b.id),
          })),
          more: Math.max(0, g.bookings.length - 8),
          empty: "Todavía no tiene reservas.",
        },
      ],
    };
  },
});
