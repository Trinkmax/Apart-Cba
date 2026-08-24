/**
 * Propuestas de cancelación — el único camino por el que una señal de una OTA
 * puede llegar a cancelar una reserva.
 *
 * Invariante del módulo de Canales, después del incidente del 14/08/2026:
 * **ningún proceso automático escribe `status = 'cancelada'` en `bookings`.**
 * Las señales externas (un VEVENT que desaparece del iCal, un email de
 * cancelación de la OTA) abren una propuesta; una persona la resuelve con
 * Cancelar / Mantener desde el PMS.
 *
 * El motivo es que ninguna de esas señales es concluyente:
 *   · el feed puede venir vacío, truncado o con los UID rotados
 *   · el email se parsea con heurísticas, y el fallback busca por fecha de
 *     llegada — puede señalar la reserva equivocada
 *   · nuestro propio export vuelve con sello de la OTA (eco de sincronización)
 *
 * Contra eso, el costo de equivocarse es una reserva cobrada que desaparece del
 * calendario y una unidad que se revende. Ya pasó: tres reservas reales, una
 * con $80.000 de seña y confirmación enviada al huésped, revendida después a
 * otra persona.
 */

import type { Channel, ChannelLinkRow, ChannelReservationRow } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

export type CancellationReasonCode = "missing_from_feed" | "ota_cancellation_email";

const LIVE_STATUSES = ["pendiente", "confirmada", "check_in"];

export function channelName(channel: Channel | string): string {
  return channel === "airbnb" ? "Airbnb" : channel === "booking" ? "Booking" : String(channel);
}

interface OpenRequestInput {
  organizationId: string;
  link?: ChannelLinkRow | null;
  linkId?: string | null;
  channel: Channel;
  reservation?: ChannelReservationRow | null;
  bookingId?: string | null;
  reasonCode: CancellationReasonCode;
  detail: string;
  evidence: Record<string, unknown>;
}

/**
 * Abre la propuesta con una foto completa de lo que está en juego. El snapshot
 * existe para que quien decide vea el huésped, el importe y la seña cobrada en
 * el mismo diálogo — sin eso, "¿cancelo o mantengo?" es una pregunta imposible
 * de responder.
 *
 * Devuelve `false` si no había nada que proponer (la reserva ya no está viva) o
 * si ya hay una propuesta abierta para el mismo caso.
 */
export async function openCancellationRequest(
  admin: AdminClient,
  input: OpenRequestInput,
): Promise<boolean> {
  const r = input.reservation ?? null;
  const bookingId = input.bookingId ?? r?.booking_id ?? null;
  const linkId = input.linkId ?? input.link?.id ?? r?.link_id ?? null;

  let snapshot: Record<string, unknown> = {
    unidad: null,
    huesped: null,
    check_in: r?.check_in ?? null,
    check_out: r?.check_out ?? null,
    es_bloqueo: r?.is_block ?? false,
    referencia_ota: r?.confirmation_code ?? r?.ical_uid ?? null,
  };
  let risk: "normal" | "alto" = "normal";

  if (bookingId) {
    const { data: booking } = await admin
      .from("bookings")
      .select(
        "id, status, source, is_block, check_in_date, check_out_date, currency, total_amount, paid_amount, created_by, confirmation_sent_at, guest_id, unit_id",
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) return false;
    // Ya no está viva: no hay nada que proponer.
    if (!LIVE_STATUSES.includes(booking.status)) return false;

    const [{ data: unit }, { data: guest }] = await Promise.all([
      booking.unit_id
        ? admin.from("units").select("name").eq("id", booking.unit_id).maybeSingle()
        : Promise.resolve({ data: null }),
      booking.guest_id
        ? admin.from("guests").select("full_name, phone").eq("id", booking.guest_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const paid = Number(booking.paid_amount ?? 0);
    const diasParaLlegada = Math.round(
      (Date.parse(`${booking.check_in_date}T00:00:00Z`) - Date.now()) / 86_400_000,
    );

    snapshot = {
      unidad: unit?.name?.trim() ?? null,
      huesped: guest?.full_name?.trim() ?? null,
      telefono: guest?.phone ?? null,
      check_in: booking.check_in_date,
      check_out: booking.check_out_date,
      estado: booking.status,
      origen: booking.source,
      es_bloqueo: booking.is_block,
      moneda: booking.currency ?? "ARS",
      total: Number(booking.total_amount ?? 0),
      cobrado: paid,
      confirmacion_enviada: Boolean(booking.confirmation_sent_at),
      cargada_a_mano: Boolean(booking.created_by),
      dias_para_llegada: diasParaLlegada,
      referencia_ota: r?.confirmation_code ?? r?.ical_uid ?? null,
    };

    // Lo que hace grave a esta decisión: hay plata, hay una promesa hecha al
    // huésped, o la llegada es inminente.
    if (paid > 0 || booking.confirmation_sent_at || diasParaLlegada <= 7) risk = "alto";
    // Una reserva cargada por una persona nunca es un descarte rutinario.
    if (booking.created_by && !booking.is_block) risk = "alto";
  }

  const { error } = await admin.from("channel_cancellation_requests").insert({
    organization_id: input.organizationId,
    link_id: linkId,
    reservation_id: r?.id ?? null,
    booking_id: bookingId,
    channel: input.channel,
    reason_code: input.reasonCode,
    detail: input.detail,
    evidence: input.evidence,
    snapshot,
    risk,
  });

  // 23505 = ya hay una propuesta abierta para este caso. No es un error.
  if (error) {
    if (error.code !== "23505") {
      console.error("[channels/cancel-request] insert falló", error.message);
    }
    return false;
  }

  await admin.from("notifications").insert({
    organization_id: input.organizationId,
    type: "channel_cancellation_pending",
    severity: risk === "alto" ? "critical" : "warning",
    title:
      risk === "alto"
        ? `Confirmá: se cayó una reserva con dinero cobrado en ${channelName(input.channel)}`
        : `Confirmá si se cancela una reserva de ${channelName(input.channel)}`,
    body: describeSnapshot(snapshot, input.channel, input.reasonCode),
    ref_type: bookingId ? "booking" : undefined,
    ref_id: bookingId ?? undefined,
    target_role: "admin",
    action_url: "/dashboard/canales/cancelaciones",
    dedup_key: `cancel_request:${r?.id ?? bookingId}`,
  });

  return true;
}

/** Una línea que dice de quién y de cuánto estamos hablando. */
export function describeSnapshot(
  snapshot: Record<string, unknown>,
  channel: Channel | string,
  reasonCode: CancellationReasonCode,
): string {
  const unidad = (snapshot.unidad as string) ?? "una unidad";
  const huesped = (snapshot.huesped as string) ?? null;
  const desde = (snapshot.check_in as string) ?? "?";
  const hasta = (snapshot.check_out as string) ?? "?";
  const cobrado = Number(snapshot.cobrado ?? 0);
  const quien = huesped ? `${huesped} — ` : "";
  const senal =
    reasonCode === "missing_from_feed"
      ? `${channelName(channel)} dejó de listarla en su calendario.`
      : `${channelName(channel)} avisó por email que se canceló.`;
  const plata =
    cobrado > 0
      ? ` Tiene ${formatMoney(cobrado, (snapshot.moneda as string) ?? "ARS")} cobrados.`
      : "";
  const promesa = snapshot.confirmacion_enviada ? " Ya se le envió la confirmación." : "";
  return `${quien}${unidad}, ${desde} → ${hasta}. ${senal}${plata}${promesa} Nadie la canceló: decidí vos si se cancela o se mantiene.`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("es-AR")}`;
  }
}
