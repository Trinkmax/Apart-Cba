/**
 * `responder_solicitud`: confirmar o rechazar un pedido de reserva de la web
 * propia (`booking_requests`, migración 067). Las dos respuestas le MANDAN UN
 * MAIL al huésped, así que la tarjeta lo dice siempre.
 *
 * - Confirmar → `approveBookingRequest` crea la reserva con la seña que se
 *   muestra en la tarjeta (se le pasa explícita: lo que se vio es lo que se
 *   aplica). Con reservas en esas fechas no se propone.
 * - Rechazar → `rejectBookingRequest` con el motivo que va a leer el huésped.
 * - Un pedido vencido no se responde: el sistema ya le avisa al huésped.
 *
 * Las solicitudes de OTA (Airbnb/Booking pendientes) son otra cosa y no pasan por acá.
 */
import { z } from "zod/v4";
import { can } from "@/lib/permissions";
import {
  approveBookingRequest,
  getApprovalDefaults,
  getBookingRequest,
  listBookingRequestsForOrg,
  rejectBookingRequest,
} from "@/lib/actions/booking-requests";
import { DEFAULT_ORG_TIMEZONE, ymdInTz } from "@/lib/dates";
import { clampSena } from "@/lib/marketplace/staff-helpers";
import type { BookingRequestStatus, BookingRequestWithRelations } from "@/lib/types/database";
import { attempt, defineWrite, hrefs, type ToolContext } from "../../tool";
import { clip, dateRange, fold, money, shortDate } from "../../format";
import { ask, attemptResult, idSchema, joinNotes, UUID_RE } from "./_shared";

const STATUS_TEXT: Record<BookingRequestStatus, string> = {
  pendiente: "sigue pendiente",
  aprobada: "ya fue confirmado",
  rechazada: "ya fue rechazado",
  expirada: "venció",
  cancelada: "lo canceló el huésped",
};

const CHANNEL_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking" };

function words(s: string | null | undefined): string[] {
  return fold(s)
    .replace(/[.,;:¿?¡!"'()]/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** En los nombres, palabra entera ("Ana" no es "Mariana"); en mail, teléfono y código de unidad, alcanza con que esté adentro. */
function wordMatches(r: BookingRequestWithRelations, w: string): boolean {
  if (words(r.guest_full_name).includes(w) || words(r.unit?.name).includes(w) || words(r.unit?.marketplace_title).includes(w)) {
    return true;
  }
  if (w.length < 3) return fold(r.unit?.code) === w;
  const phone = (r.guest_phone ?? "").replace(/\D/g, "");
  return [r.unit?.code, r.guest_email, phone].some((c) => fold(c).includes(w));
}

function haystack(r: BookingRequestWithRelations): string {
  return fold([r.guest_full_name, r.guest_email, r.guest_phone, r.unit?.code, r.unit?.name, r.unit?.marketplace_title].join(" "));
}

const unitText = (r: BookingRequestWithRelations) => (r.unit ? `${r.unit.code} · ${r.unit.name}` : "Sin unidad");
const isExpired = (r: { expires_at: string }) => Date.parse(r.expires_at) <= Date.now();

function localWhen(iso: string, ctx: ToolContext): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const tz = ctx.org.timezone || DEFAULT_ORG_TIMEZONE;
  const time = new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${shortDate(ymdInTz(d, tz), ctx.today)} a las ${time}`;
}

function stayLine(r: BookingRequestWithRelations): string {
  const n = Number(r.nights);
  return `${dateRange(r.check_in_date, r.check_out_date)} · ${n} ${n === 1 ? "noche" : "noches"}`;
}

const payloadSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("aprobar"),
    request_id: idSchema,
    deposit: z.number().min(0),
    internal_note: z.string().max(500).nullable(),
  }),
  z.object({
    decision: z.literal("rechazar"),
    request_id: idSchema,
    reason: z.string().min(5).max(1000),
  }),
]);

export const responderSolicitud = defineWrite({
  name: "responder_solicitud",
  label: "Preparando la respuesta al pedido…",
  description:
    "Prepara la respuesta a un PEDIDO DE RESERVA de la web propia (los de «Reservas pendientes») para que la persona la confirme: " +
    "aprobar (crea la reserva con la seña que se le pide al huésped) o rechazar (con un motivo). En los dos casos al huésped le llega un mail. " +
    "Pregunta lo que falte (qué pedido, si se aprueba o rechaza, la seña —con la sugerida—, el motivo). " +
    "Si las fechas ya están ocupadas, no se puede aprobar. No sirve para solicitudes de Airbnb o Booking.",
  input: z.object({
    solicitud: z
      .string()
      .describe("De quién es el pedido: nombre y apellido del huésped, su mail, la unidad, o el id que la persona eligió de una lista.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
    decision: z.enum(["aprobar", "rechazar"]).describe("Si no lo dijeron, omitir (se pregunta).").optional(),
    sena: z
      .number()
      .min(0)
      .describe("Sólo al aprobar: la seña a pedirle al huésped, tal como la dijo o confirmó la persona (0 = sin seña). Si no, omitir (se pregunta).")
      .optional(),
    nota_interna: z.string().max(500).describe("Sólo al aprobar: nota interna para la reserva (el huésped no la ve).").optional(),
    motivo: z
      .string()
      .max(1000)
      .describe("Obligatorio al rechazar: el motivo, que le llega al huésped por mail (ej. «Esas fechas ya no están disponibles»).")
      .optional(),
  }),
  payload: payloadSchema,
  resource: "bookings",
  action: "create",
  async propose(input, ctx) {
    const q = input.solicitud?.trim() ?? "";
    const l = await attempt(() => listBookingRequestsForOrg({ status: "pendiente" }));
    if (!l.ok) return l;
    let pool = l.value;
    let partial = false;
    if (!q) {
      const live = pool.filter((r) => !isExpired(r));
      if (live.length === 0) return { ok: false, error: "No hay pedidos de la web esperando respuesta." };
      if (live.length > 1) {
        return {
          ok: "choose",
          question: `Hay ${live.length} pedidos esperando respuesta. ¿Cuál?`,
          options: live.slice(0, 8).map((r) => ({
            id: r.id,
            label: `${r.guest_full_name} · ${r.unit?.code ?? "—"}`,
            detail: `${dateRange(r.check_in_date, r.check_out_date)} · ${money(r.total_amount, r.currency)}`,
          })),
        };
      }
      pool = live;
    }

    if (UUID_RE.test(q)) {
      const hit = pool.find((r) => r.id === q);
      if (!hit) {
        const g = await attempt(() => getBookingRequest(q));
        if (!g.ok) return g;
        if (!g.value) return { ok: false, error: "No encontré ese pedido." };
        return { ok: false, error: `Ese pedido ${STATUS_TEXT[g.value.status] ?? "ya no está pendiente"}: no hay nada para responder.` };
      }
      pool = [hit];
    } else if (q) {
      const unidad = input.unidad?.trim();
      if (unidad) {
        const u = fold(unidad);
        pool = pool.filter((r) => {
          const code = fold(r.unit?.code);
          const name = fold(r.unit?.name);
          return code === u || name === u || code.includes(u) || name.includes(u) || r.unit?.id === unidad;
        });
      }
      const ws = words(q);
      if (q.length < 2 || ws.length === 0) return { ok: false, error: "Decime de quién es el pedido (nombre del huésped o la unidad)." };
      const strong = pool.filter((r) => ws.every((w) => wordMatches(r, w)));
      if (strong.length > 0) pool = strong;
      else {
        partial = true;
        pool = pool.filter((r) => ws.some((w) => w.length >= 3 && haystack(r).includes(w)));
      }
    }
    if (pool.length === 0) return { ok: false, error: `No hay pedidos pendientes de la web para «${q}».` };
    if (partial || pool.length > 1) {
      return {
        ok: "choose",
        question: partial
          ? `No encontré un pedido pendiente que coincida tal cual con «${q}». ¿Es alguno de estos?`
          : `Hay ${pool.length} pedidos pendientes para «${q}». ¿Cuál es?`,
        options: pool.slice(0, 8).map((r) => ({
          id: r.id,
          label: `${r.guest_full_name} · ${r.unit?.code ?? "—"}`,
          detail: `${dateRange(r.check_in_date, r.check_out_date)} · ${money(r.total_amount, r.currency)}`,
        })),
      };
    }

    const r = pool[0];
    if (isExpired(r)) {
      return {
        ok: false,
        error: `El pedido de ${r.guest_full_name} venció el ${localWhen(r.expires_at, ctx)} sin respuesta: ya no se puede responder (el sistema le avisa al huésped). Si sigue interesado, cargá la reserva a mano.`,
      };
    }
    if (!input.decision) {
      return ask(
        `¿El pedido de ${r.guest_full_name} (${r.unit?.code ?? "sin unidad"}, ${dateRange(r.check_in_date, r.check_out_date)}) lo confirmo o lo rechazo?`,
        ["Confirmarlo", "Rechazarlo"],
      );
    }
    const total = Number(r.total_amount ?? 0);
    const contact = [r.guest_email, r.guest_phone].filter(Boolean).join(" · ");
    const baseLines = [
      { label: "Huésped", value: r.guest_full_name },
      ...(contact ? [{ label: "Contacto", value: contact }] : []),
      { label: "Unidad", value: unitText(r) },
      { label: "Fechas", value: stayLine(r) },
      { label: "Personas", value: String(r.guests_count) },
      { label: "Total", value: money(total, r.currency) },
    ];

    if (input.decision === "rechazar") {
      // Rechazar es actualizar la solicitud (`rejectBookingRequest` pide bookings.update).
      if (!can(ctx.role, "bookings", "update")) return { ok: false, error: "Tu rol no puede rechazar solicitudes." };
      const motivo = clip(input.motivo, 1000);
      if (!motivo || motivo.length < 5) {
        return ask(`¿Qué motivo le ponemos a ${r.guest_full_name}? Le llega por mail.`, [
          "Esas fechas ya no están disponibles",
          "Otro motivo",
        ]);
      }
      return {
        ok: true,
        payload: { decision: "rechazar" as const, request_id: r.id, reason: motivo },
        summary: {
          title: "Rechazar un pedido de la web",
          lines: [...baseLines, { label: "Motivo (lo lee el huésped)", value: motivo }],
          note: "Al huésped le llega un mail con este motivo. No se puede deshacer.",
          confirmLabel: "Rechazar pedido",
          danger: true,
        },
      };
    }

    const d = await attempt(() => getApprovalDefaults(r.id));
    if (!d.ok) return d;
    const defaults = d.value;
    if (!defaults) return { ok: false, error: "No encontré ese pedido." };
    if (defaults.conflicts.length > 0) {
      const clash = defaults.conflicts
        .slice(0, 3)
        .map((c) => `${c.guest_name ?? (c.is_block ? "un cierre de calendario" : "otra reserva")} (${dateRange(c.check_in, c.check_out)})`)
        .join(", ");
      return {
        ok: false,
        error: `Esas fechas ya están ocupadas en ${r.unit?.code ?? "la unidad"} por ${clash}: no se puede confirmar. Se puede rechazar («Esas fechas ya no están disponibles») o escribirle al huésped para ofrecerle otras.`,
      };
    }
    // La seña nunca se asume: la sugerida va en la pregunta ("¿La seña sería de $ X?").
    if (input.sena === undefined) {
      const s = defaults.senaSuggested ?? 0;
      return s > 0
        ? ask(`¿La seña sería de ${money(s, r.currency)}? Es la que sugiere la configuración de la web.`, [
            `Sí, ${money(s, r.currency)}`,
            "Sin seña",
            "Otro monto",
          ])
        : ask(`¿Le pedís seña a ${r.guest_full_name}? ¿De cuánto?`, ["Sin seña", "Sí, le pido seña"]);
    }
    const c = clampSena(input.sena, total, r.currency);
    if (c == null) return { ok: false, error: "Revisá el monto de la seña." };
    const deposit = c;
    const note = clip(input.nota_interna, 500) ?? null;
    const otaRequests = defaults.requestConflicts;
    return {
      ok: true,
      payload: { decision: "aprobar" as const, request_id: r.id, deposit, internal_note: note },
      summary: {
        title: "Confirmar un pedido de la web",
        lines: [
          ...baseLines,
          {
            label: "Seña",
            value: deposit > 0 ? `${money(deposit, r.currency)} (a transferir en ${defaults.dueHours} h)` : "Sin seña",
          },
          ...(r.special_requests ? [{ label: "Pidió", value: clip(r.special_requests, 200) ?? "" }] : []),
          ...(note ? [{ label: "Nota interna", value: note }] : []),
        ],
        note: joinNotes([
          `Al confirmar se crea la reserva y al huésped le llega un mail con la confirmación${deposit > 0 ? " y cómo pagar la seña" : ""}.`,
          deposit > 0 && !defaults.transfer && "Ojo: no hay datos para transferir cargados en la configuración de la web, así que el mail no dice a dónde.",
          otaRequests.length > 0 &&
            `Hay ${otaRequests.length === 1 ? "una solicitud" : `${otaRequests.length} solicitudes`} de ${CHANNEL_LABEL[otaRequests[0].channel] ?? otaRequests[0].channel} sin confirmar en esas fechas: si la aceptan, se superponen.`,
          defaults.nightly?.differs && `Las tarifas cambiaron desde que pidió: se respeta el total del pedido (${money(total, r.currency)}).`,
        ]),
        confirmLabel: "Confirmar reserva",
      },
    };
  },
  async execute(p, ctx) {
    const g = await attempt(() => getBookingRequest(p.request_id));
    if (!g.ok) return g;
    const r = g.value;
    if (!r) return { ok: false, error: "No encontré ese pedido. No hice nada." };
    if (r.status !== "pendiente") return { ok: false, error: `Ese pedido ${STATUS_TEXT[r.status] ?? "ya no está pendiente"}. No hice nada.` };
    if (isExpired(r)) return { ok: false, error: "El pedido venció mientras tanto. No hice nada." };

    if (p.decision === "aprobar") {
      const d = await attempt(() => getApprovalDefaults(p.request_id));
      if (d.ok && d.value && d.value.conflicts.length > 0) {
        return { ok: false, error: "Mientras confirmabas se ocuparon esas fechas. No confirmé nada." };
      }
      const res = await attemptResult(() =>
        approveBookingRequest(p.request_id, { deposit: p.deposit, internal_note: p.internal_note }),
      );
      if (!res.ok) return res;
      const v = res.value;
      return {
        ok: true,
        message: `Reserva confirmada: ${r.guest_full_name} en ${r.unit?.code ?? "la unidad"}, ${dateRange(r.check_in_date, r.check_out_date)}. ${
          v.emailSent ? "Le llegó el mail de confirmación." : "No salió el mail: mandale la confirmación por WhatsApp."
        }`,
        href: hrefs.booking(v.bookingId),
        data: { reserva_id: v.bookingId, mail_enviado: v.emailSent, whatsapp_url: v.guestWhatsappUrl, seguimiento_url: v.statusUrl },
      };
    }

    if (!can(ctx.role, "bookings", "update")) return { ok: false, error: "Tu rol no puede rechazar solicitudes." };
    const res = await attemptResult(() => rejectBookingRequest(p.request_id, p.reason));
    if (!res.ok) return res;
    return {
      ok: true,
      message: `Pedido rechazado: ${r.guest_full_name}. ${res.value.emailSent ? "Le llegó el mail con el motivo." : "No salió el mail: avisale por WhatsApp."}`,
      href: hrefs.requests(),
      data: { mail_enviado: res.value.emailSent },
    };
  },
});
