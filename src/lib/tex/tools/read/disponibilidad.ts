/**
 * `disponibilidad` y `solicitudes_pendientes`.
 *
 * La disponibilidad sale de la MISMA foto que «Buscar disp» del calendario
 * (`getAvailabilitySnapshot`, completa o falla) y de la misma regla pura
 * (`computeUnitAvailability`): ocupa toda reserva no cancelada, todo cierre y
 * toda solicitud de OTA que retiene la venta. Nunca la ventana lazy del board.
 */
import { z } from "zod/v4";
import { getAvailabilitySnapshot } from "@/lib/actions/pms-availability";
import { listUnitsEnriched, listUnitsForBookingForm } from "@/lib/actions/units";
import { listBookingRequestsForOrg } from "@/lib/actions/booking-requests";
import { listPendingChannelRequests, type ChannelRequestRow } from "@/lib/actions/channel-requests";
import { AVAILABILITY_MAX_DAYS, computeUnitAvailability, rangesOverlap } from "@/lib/units/availability";
import { DAYS_PER_MONTH, unitMonthlyPrice, unitPriceKinds } from "@/lib/units/pricing";
import { can } from "@/lib/permissions";
import type { CardRow } from "../../types";
import { attempt, defineRead, hrefs } from "../../tool";
import { clip, isYmd, money, nightsBetween } from "../../format";
import { localTime, localYmd, num, plural, round2, stayLabel, unitLabel } from "./_shared";

type UnitLite = {
  id: string;
  code: string;
  name: string;
  base_price: number | string | null;
  base_price_currency: string | null;
  monthly_price: number | string | null;
  cleaning_fee: number | string | null;
  default_mode: string;
  /** Sólo viene cuando se pidió capacidad (listUnitsEnriched). */
  max_guests?: number | null;
};

/** La capacidad (`max_guests`) sólo la trae listUnitsEnriched; sin huéspedes alcanza la lista liviana. */
async function loadUnits(withCapacity: boolean): Promise<UnitLite[]> {
  if (withCapacity) return (await listUnitsEnriched()) as UnitLite[];
  return (await listUnitsForBookingForm()) as UnitLite[];
}

const CHANNEL_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking.com" };
const channelName = (c: string | null | undefined) => (c ? (CHANNEL_LABEL[c] ?? c) : "la OTA");

/** Precio de lista para el rango: por noche (+ limpieza) o, si es mensual, renta ÷ 30 × noches. */
function quote(u: UnitLite, noches: number, orgCurrency: string) {
  const currency = (u.base_price_currency || orgCurrency || "ARS").toUpperCase();
  const kinds = unitPriceKinds(u.default_mode);
  const nightly = kinds.nightly && num(u.base_price) > 0 ? num(u.base_price) : null;
  const monthly = unitMonthlyPrice(u);
  const cleaning = num(u.cleaning_fee);
  let estimate: number | null = null;
  let alt: number | null = null;
  if (u.default_mode === "mensual" && monthly) estimate = (monthly / DAYS_PER_MONTH) * noches;
  else if (nightly) {
    estimate = nightly * noches + cleaning;
    if (monthly && noches >= 28) alt = (monthly / DAYS_PER_MONTH) * noches;
  } else if (monthly) estimate = (monthly / DAYS_PER_MONTH) * noches;
  return { currency, nightly, monthly, estimate: estimate === null ? null : round2(estimate), alt: alt === null ? null : round2(alt) };
}

export const disponibilidad = defineRead({
  name: "disponibilidad",
  label: "Mirando qué está libre…",
  description:
    "Qué unidades están LIBRES para un rango de fechas, con el precio de lista y un estimado del total. " +
    "Usala para «¿tengo algo libre del 20 al 25?», «¿qué hay para 4 personas el finde?». " +
    "El día de salida queda libre (salida y entrada el mismo día es un recambio). Cuenta reservas pendientes, cierres de las OTAs " +
    "y solicitudes de Booking como ocupado; una solicitud de Airbnb no ocupa pero se avisa. El estimado es precio de lista, no una cotización.",
  input: z.object({
    desde: z.string().describe("Día de entrada (check-in), YYYY-MM-DD. Calculalo con la fecha de hoy del contexto."),
    hasta: z.string().describe("Día de salida (check-out), YYYY-MM-DD. Esa noche no se cuenta."),
    huespedes: z.number().int().min(1).max(30).describe("Cuántas personas, si lo dijeron (filtra por capacidad).").optional(),
  }),
  resource: "bookings",
  action: "view",
  async run(input, ctx) {
    const { desde, hasta } = input;
    if (!isYmd(desde) || !isYmd(hasta)) {
      return { ok: false, error: "Las fechas tienen que ser días reales en formato YYYY-MM-DD." };
    }
    if (hasta <= desde) return { ok: false, error: "La salida tiene que ser después de la entrada." };
    const noches = nightsBetween(desde, hasta);
    if (noches > AVAILABILITY_MAX_DAYS) return { ok: false, error: "Elegí un rango de hasta 2 años." };

    const [snap, unitsR] = await Promise.all([
      attempt(() => getAvailabilitySnapshot(desde, hasta)),
      attempt(() => loadUnits(Boolean(input.huespedes))),
    ]);
    if (!snap.ok) return snap;
    if (!snap.value.ok) return { ok: false, error: snap.value.error };
    if (!unitsR.ok) return unitsR;

    const { busy, tentative } = computeUnitAvailability({
      from: desde,
      to: hasta,
      bookings: snap.value.bookings,
      requests: snap.value.requests,
    });
    // De qué canal es la solicitud que no retiene la venta (para el aviso).
    const tentativeChannel = new Map<string, string>();
    for (const r of snap.value.requests) {
      if (!r.unit_id || !r.check_in || !r.check_out || r.holds_availability) continue;
      if (rangesOverlap(r.check_in, r.check_out, desde, hasta)) tentativeChannel.set(r.unit_id, r.channel);
    }

    const units = unitsR.value;
    const libres = units.filter((u) => !busy.has(u.id));
    const personas = input.huespedes ?? null;
    const noEntran = personas ? libres.filter((u) => u.max_guests != null && u.max_guests > 0 && u.max_guests < personas) : [];
    const candidatas = personas ? libres.filter((u) => !noEntran.includes(u)) : libres;
    const sinCapacidad = personas ? candidatas.filter((u) => !u.max_guests).length : 0;

    const filas = candidatas.map((u) => {
      const q = quote(u, noches, ctx.org.currency);
      const canal = tentative.has(u.id) ? channelName(tentativeChannel.get(u.id)) : null;
      return { u, q, canal };
    });

    const rows: CardRow[] = filas.slice(0, 14).map(({ u, q, canal }) => ({
      title: unitLabel(u),
      subtitle:
        [
          u.max_guests ? `Hasta ${plural(u.max_guests, "persona", "personas")}` : null,
          q.nightly ? `${money(q.nightly, q.currency)} por noche` : q.monthly ? `${money(q.monthly, q.currency)} por mes` : "Sin precio cargado",
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      badge: canal ? { label: `Solicitud ${canal}`, tone: "warn" } : undefined,
      amount: q.estimate ? { value: money(q.estimate, q.currency) } : undefined,
      href: hrefs.calendar(),
    }));

    return {
      ok: true,
      data: {
        desde,
        hasta,
        noches,
        unidades_activas: units.length,
        libres: candidatas.length,
        ocupadas: units.filter((u) => busy.has(u.id)).length,
        ...(personas
          ? {
              personas,
              libres_pero_chicas: noEntran.length,
              ...(sinCapacidad ? { libres_sin_capacidad_cargada: sinCapacidad } : {}),
            }
          : {}),
        unidades_libres: filas.slice(0, 40).map(({ u, q, canal }) => ({
          codigo: u.code,
          unidad: unitLabel(u),
          capacidad: u.max_guests ?? undefined,
          precio_noche: q.nightly ? money(q.nightly, q.currency) : undefined,
          precio_mes: q.monthly ? money(q.monthly, q.currency) : undefined,
          estimado: q.estimate ? money(q.estimate, q.currency) : "sin precio cargado",
          ...(q.alt ? { estimado_por_mes: money(q.alt, q.currency) } : {}),
          ...(canal
            ? { ojo: `Tiene una solicitud de ${canal} pendiente en esas fechas: no retiene la venta, pero si la aceptan se ocupa.` }
            : {}),
        })),
        ...(filas.length > 40 ? { mas_libres: filas.length - 40 } : {}),
        nota: "Estimado = precio de lista × noches + limpieza (mensual: renta ÷ 30 × noches). No incluye reglas de precio ni descuentos.",
      },
      card: {
        kind: "list",
        title: `Libres del ${stayLabel(desde, hasta, ctx.today)} (${plural(noches, "noche", "noches")})`,
        icon: "bed",
        rows,
        more: Math.max(0, filas.length - rows.length),
        empty: personas ? `No hay nada libre para ${plural(personas, "persona", "personas")} en esas fechas.` : "No hay unidades libres en esas fechas.",
        footer: { label: "Abrir el calendario", href: hrefs.calendar() },
      },
    };
  },
});

export const solicitudesPendientes = defineRead({
  name: "solicitudes_pendientes",
  label: "Mirando las solicitudes…",
  description:
    "Las solicitudes que esperan una respuesta: pedidos de la web propia (huésped, unidad, fechas, total, cuándo vence) y solicitudes de " +
    "Airbnb/Booking que todavía no son reservas. Usala para «¿hay pedidos sin responder?», «¿qué solicitudes tengo?». " +
    "Una solicitud NO es una reserva: no ocupa calendario hasta que se confirma.",
  input: z.object({}),
  resource: "bookings",
  action: "view",
  // El listado de pedidos web no filtra por propietario: sólo el equipo.
  adminLevel: true,
  async run(_input, ctx) {
    const tz = ctx.org.timezone;
    const [webR, otaR] = await Promise.all([
      attempt(() => listBookingRequestsForOrg({ status: "pendiente" })),
      can(ctx.role, "channels", "view")
        ? attempt(() => listPendingChannelRequests())
        : Promise.resolve({ ok: true as const, value: [] as ChannelRequestRow[] }),
    ]);
    if (!webR.ok) return webR;
    const ota = otaR.ok ? otaR.value : [];
    const now = Date.now();

    const web = [...webR.value].sort((a, b) => a.expires_at.localeCompare(b.expires_at));
    const otaSorted = [...ota].sort((a, b) => (a.check_in ?? "").localeCompare(b.check_in ?? ""));
    const expired = (iso: string) => Date.parse(iso) < now;

    const rows: CardRow[] = [
      ...web.map<CardRow>((r) => ({
        title: r.guest_full_name || "Sin nombre",
        subtitle: `${unitLabel(r.unit)} · ${stayLabel(r.check_in_date, r.check_out_date, ctx.today)}`,
        meta: expired(r.expires_at) ? undefined : `vence ${localTime(r.expires_at, tz) ?? ""}`.trim(),
        badge: expired(r.expires_at) ? { label: "Venció", tone: "bad" } : { label: "Web", tone: "info" },
        amount: { value: money(r.total_amount, r.currency) },
        href: hrefs.request(r.id),
      })),
      ...otaSorted.map<CardRow>((r) => ({
        title: r.guest?.name || r.confirmation_code || `Solicitud de ${channelName(r.channel)}`,
        subtitle:
          [unitLabel(r.unit), r.check_in && r.check_out ? stayLabel(r.check_in, r.check_out, ctx.today) : null]
            .filter(Boolean)
            .join(" · ") || undefined,
        badge: { label: channelName(r.channel), tone: "warn" },
        href: hrefs.requests(),
      })),
    ];
    const total = web.length + ota.length;

    return {
      ok: true,
      data: {
        pedidos_web: web.slice(0, 30).map((r) => ({
          pedido_id: r.id,
          huesped: r.guest_full_name,
          telefono: r.guest_phone ?? undefined,
          email: r.guest_email || undefined,
          unidad: unitLabel(r.unit),
          entrada: r.check_in_date,
          salida: r.check_out_date,
          noches: r.nights,
          personas: r.guests_count,
          total: money(r.total_amount, r.currency),
          pedido_el: localYmd(r.created_at, tz),
          vence: `${localYmd(r.expires_at, tz)} ${localTime(r.expires_at, tz) ?? ""}`.trim(),
          ...(expired(r.expires_at) ? { ya_vencio: true } : {}),
          pedido_especial: clip(r.special_requests, 140),
        })),
        solicitudes_ota: otaSorted.slice(0, 30).map((r) => ({
          solicitud_id: r.id,
          canal: channelName(r.channel),
          unidad: unitLabel(r.unit),
          entrada: r.check_in,
          salida: r.check_out,
          codigo: r.confirmation_code,
          huesped: r.guest?.name ?? undefined,
          horas_esperando: r.hours_since_request,
          retiene_fechas: r.holds_availability,
        })),
        ...(otaR.ok ? {} : { nota: "No pude leer las solicitudes de Airbnb/Booking; las de la web están completas." }),
      },
      card: {
        kind: "list",
        title: total ? `Solicitudes pendientes (${total})` : "Solicitudes pendientes",
        icon: "inbox",
        rows: rows.slice(0, 14),
        more: Math.max(0, rows.length - 14),
        empty: "No hay solicitudes esperando respuesta.",
        footer: { label: "Ver solicitudes", href: hrefs.requests() },
      },
    };
  },
});
