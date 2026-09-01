"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { todayYmdInTz } from "@/lib/dates";
import { channelLabel, reprojectReservation } from "@/lib/channels/ingest";
import {
  channelsHoldingAvailability,
  getChannelRequestPolicies,
} from "@/lib/channels/request-policy";
import type { Channel, ChannelPromotionSource } from "@/lib/channels/types";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";

/**
 * Solicitudes de canal — el estado intermedio entre "la OTA nos avisó" y "hay
 * una reserva".
 *
 * Existe porque el feed iCal de Airbnb publica una solicitud pendiente con el
 * mismo VEVENT que una reserva aceptada, así que proyectarla directo llenaba el
 * calendario de reservas fantasma que después había que cancelar a mano. Una
 * solicitud NO tiene fila en `bookings`: se ve, pero no ocupa.
 *
 * Acá viven las dos decisiones humanas ("es una reserva" / "se cayó") y los
 * lectores que alimentan la grilla y la bandeja.
 */

const REQUEST_PATHS = [
  "/dashboard/canales",
  "/dashboard/reservas-pendientes",
  "/dashboard/reservas",
  "/dashboard/unidades/kanban",
  "/dashboard",
];

function revalidateRequests() {
  for (const p of REQUEST_PATHS) revalidatePath(p);
}

export interface ChannelRequestRow {
  id: string;
  channel: Channel;
  unit_id: string | null;
  unit: { id: string; code: string; name: string } | null;
  check_in: string | null;
  check_out: string | null;
  confirmation_code: string | null;
  guest: { name?: string; phone_last4?: string } | null;
  created_at: string;
  expired_at: string | null;
  external_status: "pending" | "expired";
  /** Días hasta la llegada, calculado en el server (el render no puede leer el reloj). */
  days_to_check_in: number | null;
  /** Horas que lleva pedida, calculado en el server por el mismo motivo. */
  hours_since_request: number | null;
  /**
   * ¿Esta solicitud retiene la venta en la web propia? Depende de
   * `hold_availability` por canal, así que el copy no puede afirmar "no ocupa"
   * a ciegas: para Booking sí ocupa.
   */
  holds_availability: boolean;
  /** URL al panel de la OTA para resolver la duda en 10 segundos. */
  external_url: string | null;
}

/** Solicitudes vivas: lo que espera una decisión (o que se resuelva sola). */
export async function listPendingChannelRequests(): Promise<ChannelRequestRow[]> {
  try {
    await requireSession();
    const { organization, role } = await getCurrentOrg();
    if (!can(role, "channels", "view")) return [];
    return await readRequests(organization.id, "pending");
  } catch {
    // Se llama desde una pantalla compartida con el marketplace: si falla, la
    // sección de OTAs no aparece, pero la de la web propia sigue funcionando.
    return [];
  }
}

/** Solicitudes descartadas recientemente, para poder deshacer. */
export async function listDiscardedChannelRequests(): Promise<ChannelRequestRow[]> {
  try {
    await requireSession();
    const { organization, role } = await getCurrentOrg();
    if (!can(role, "channels", "view")) return [];
    return await readRequests(organization.id, "expired");
  } catch {
    return [];
  }
}

/**
 * Fuente de la capa de solicitudes en la grilla del PMS.
 *
 * Pide `bookings:view` y NO `channels:view` a propósito: mantenimiento y
 * limpieza ven la grilla, y si les faltaran estas barras estarían mirando un
 * calendario incompleto sin ninguna señal de que les falta algo.
 */
export async function listChannelRequestsInRange(
  fromIso: string,
  toIso: string,
): Promise<ChannelRequestRow[]> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_reservations")
    .select(
      "id, channel, unit_id, check_in, check_out, confirmation_code, guest, created_at, expired_at, external_status, units:unit_id(id, code, name)",
    )
    .eq("organization_id", organization.id)
    .eq("external_status", "pending")
    .not("unit_id", "is", null)
    .lt("check_in", toIso)
    .gt("check_out", fromIso)
    .order("check_in", { ascending: true })
    .limit(500);
  // LANZA, nunca devuelve []: el llamador alimenta un merge CON DESALOJO, así
  // que una lista vacía por un timeout borraría de la grilla todas las barras
  // de solicitud — justo la señal de que esas fechas están comprometidas.
  // (supabase-js no lanza al vencer el timeout: devuelve { data:null, error }.)
  if (error) throw new Error(error.message);
  const holdChannels = channelsHoldingAvailability(
    await getChannelRequestPolicies(admin, organization.id),
  );
  return (data ?? []).map((r) => toRequestRow(r, holdChannels));
}

/**
 * "Es una reserva": la persona miró el panel de la OTA y confirmó. Recién ahí
 * se escribe en `bookings`.
 */
export async function confirmChannelRequest(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "channels", "update")) {
    return { ok: false, error: "No tenés permisos para administrar Canales de venta" };
  }
  const admin = createAdminClient();

  // Estado previo, para poder revertir exactamente a lo que era si la
  // proyección no llega a crear la reserva.
  const { data: before, error: beforeErr } = await admin
    .from("channel_reservations")
    .select("external_status, expired_at, expired_source")
    .eq("id", requestId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (beforeErr) {
    return { ok: false, error: "No se pudo leer la solicitud. Probá de nuevo." };
  }
  // El destino del rollback NUNCA puede ser `active`: si una carrera con el
  // dispatcher hiciera que leyéramos ese valor, revertiríamos a una reserva
  // sin booking. Sólo puede volver a lo que era antes de que la tocáramos.
  const previous = {
    external_status: before?.external_status === "expired" ? "expired" : "pending",
    expired_at: (before?.expired_at as string | null) ?? null,
    expired_source: (before?.expired_source as string | null) ?? null,
  };

  // Condicional: si el mail o el TTL llegaron primero, esto no aplica y
  // conservamos el promoted_source verdadero.
  const { data: locked, error: lockErr } = await admin
    .from("channel_reservations")
    .update({
      external_status: "active",
      promoted_at: new Date().toISOString(),
      promoted_source: "manual" satisfies ChannelPromotionSource,
      promoted_by: session.userId,
      missing_since: null,
      missing_runs: 0,
      expired_at: null,
    })
    .eq("id", requestId)
    .eq("organization_id", organization.id)
    .in("external_status", ["pending", "expired"])
    .select("id, unit_id, check_in, check_out, channel");
  if (lockErr) {
    // Distinto de "no aplicó": el UPDATE puede haber quedado commiteado y la
    // respuesta haberse cortado. Decir "ya no está pendiente" sería mentir y
    // dejaría la fila `active` sin booking sin que nadie lo sepa.
    return { ok: false, error: "No se pudo tomar la solicitud. Probá de nuevo." };
  }
  if (!locked || locked.length === 0) {
    return { ok: false, error: "La solicitud ya no está pendiente" };
  }
  const revert = () =>
    admin
      .from("channel_reservations")
      .update({
        ...previous,
        promoted_at: null,
        promoted_source: null,
        promoted_by: null,
      })
      .eq("id", requestId)
      .eq("organization_id", organization.id)
      .eq("promoted_source", "manual")
      .is("booking_id", null);

  const row = locked[0];
  if (!row.unit_id || !row.check_in || !row.check_out) {
    // Sin revertir quedaba `active` sin unidad ni booking: invisible en la
    // bandeja Y fuera del reconciliador (que filtra `unit_id not null`).
    await revert();
    return { ok: false, error: "La solicitud no tiene unidad o fechas: no se puede confirmar" };
  }

  let result;
  try {
    result = await reprojectReservation(admin, requestId);
  } catch (err) {
    await revert();
    return { ok: false, error: err instanceof Error ? err.message : "No se pudo crear la reserva" };
  }

  // Whitelist, no blacklist: `needs_review` también termina SIN reserva (p.ej.
  // findAdoptableBooking bloqueada porque ya hay una reserva local en esas
  // fechas y el evento no tiene con qué reclamarla). Con una blacklist la UI
  // decía "Se cargó la reserva", la fila salía de la bandeja y de la grilla —
  // las dos filtran `pending` — y no había ningún booking.
  // `duplicate` es ambiguo (ya estaba proyectada / la función se negó), así que
  // no alcanza con mirar el outcome: se verifica que exista el booking.
  const { data: after } = await admin
    .from("channel_reservations")
    .select("booking_id")
    .eq("id", requestId)
    .maybeSingle();
  // `projectToBooking` escribe `booking_id` en un statement aparte: si ese
  // UPDATE falló, la reserva EXISTE aunque la fila no la referencie. Revertir
  // ahí dejaría un booking huérfano ocupando el calendario, así que se re-linkea.
  if (!after?.booking_id && result.outcome === "created" && result.bookingId) {
    await admin
      .from("channel_reservations")
      .update({ booking_id: result.bookingId })
      .eq("id", requestId)
      .is("booking_id", null);
  }
  const created =
    (Boolean(after?.booking_id) || Boolean(result.bookingId)) &&
    (result.outcome === "created" ||
      result.outcome === "updated" ||
      result.outcome === "duplicate");
  if (!created) {
    // Dejarla `active` sin booking la metería en el reintento horario del
    // dispatcher, repitiendo el conflicto cada hora, y además la sacaría del
    // iCal saliente: las fechas quedarían libres sin reserva detrás.
    await revert();

    if (result.outcome === "conflict") {
      return {
        ok: false,
        error: `Esas fechas ya están ocupadas en la unidad. Revisá el conflicto antes de confirmar la reserva de ${channelLabel(row.channel as Channel)}.`,
      };
    }
    return {
      ok: false,
      error:
        result.error ??
        "No se pudo crear la reserva. Quedó una incidencia para revisar en Canales de venta.",
    };
  }

  revalidateRequests();
  return { ok: true };
}

/**
 * "Se cayó": la OTA la rechazó o venció. No hay nada que cancelar — nunca fue
 * una reserva — así que es un cambio de estado reversible, no una cancelación.
 */
export async function discardChannelRequest(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "channels", "update")) {
    return { ok: false, error: "No tenés permisos para administrar Canales de venta" };
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_reservations")
    .update({
      external_status: "expired",
      expired_at: new Date().toISOString(),
      // Marca de decisión humana: la revitalización automática del dispatcher
      // no la toca aunque el VEVENT siga publicado.
      expired_source: "manual",
      expired_by: session.userId,
    })
    .eq("id", requestId)
    .eq("organization_id", organization.id)
    .eq("external_status", "pending")
    .is("booking_id", null)
    .select("id");
  if (!data || data.length === 0) {
    return { ok: false, error: "La solicitud ya no está pendiente" };
  }
  revalidateRequests();
  return { ok: true };
}

/** Deshacer un descarte. Sin esto, "se cayó" sería una cancelación con otro nombre. */
export async function undoDiscardChannelRequest(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "channels", "update")) {
    return { ok: false, error: "No tenés permisos para administrar Canales de venta" };
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_reservations")
    // `expired_at` se sella AHORA: es el piso del reloj del TTL. Dejarlo con la
    // fecha del descarte (o borrarlo) hace que reactivar a mano una solicitud
    // caída hace cinco días la confirme sola en la corrida siguiente, sin que
    // nadie haya mirado nada.
    .update({
      external_status: "pending",
      expired_at: new Date().toISOString(),
      expired_source: null,
      expired_by: null,
      missing_since: null,
      missing_runs: 0,
    })
    .eq("id", requestId)
    .eq("organization_id", organization.id)
    .eq("external_status", "expired")
    .is("booking_id", null)
    .select("id");
  if (!data || data.length === 0) {
    return { ok: false, error: "La solicitud ya no se puede reactivar" };
  }
  revalidateRequests();
  return { ok: true };
}

export interface ChannelRequestStats {
  pendientes: number;
  confirmadas: number;
  caidas: number;
  /** Confirmadas por el TTL: si esto no es cero, el mail de la OTA está roto. */
  sinMail: number;
}

/** Resumen de 30 días para la pantalla de Canales. */
export async function getChannelRequestStats(): Promise<ChannelRequestStats> {
  const empty = { pendientes: 0, confirmadas: 0, caidas: 0, sinMail: 0 };
  try {
    await requireSession();
    const { organization, role } = await getCurrentOrg();
    if (!can(role, "channels", "view")) return empty;

    const admin = createAdminClient();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [pendingRes, promotedRes, expiredRes] = await Promise.all([
      admin
        .from("channel_reservations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization.id)
        .eq("external_status", "pending"),
      admin
        .from("channel_reservations")
        .select("promoted_source")
        .eq("organization_id", organization.id)
        .gte("promoted_at", since),
      admin
        .from("channel_reservations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization.id)
        .eq("external_status", "expired")
        .gte("expired_at", since),
    ]);

    const promoted = (promotedRes.data ?? []) as { promoted_source: string | null }[];
    return {
      pendientes: pendingRes.count ?? 0,
      confirmadas: promoted.length,
      caidas: expiredRes.count ?? 0,
      sinMail: promoted.filter((p) => p.promoted_source === "ttl").length,
    };
  } catch {
    return empty;
  }
}

/**
 * Solicitudes vivas para la advertencia del formulario de reservas. No bloquea:
 * a veces recepción sabe que la va a rechazar.
 */
export async function listChannelRequestsForOverlapCheck(): Promise<
  { id: string; unit_id: string; check_in_date: string; check_out_date: string; channel: Channel; confirmation_code: string | null }[]
> {
  try {
    await requireSession();
    const { organization, role } = await getCurrentOrg();
    if (!can(role, "bookings", "view")) return [];

    const admin = createAdminClient();
    const { data } = await admin
      .from("channel_reservations")
      .select("id, unit_id, check_in, check_out, channel, confirmation_code")
      .eq("organization_id", organization.id)
      .eq("external_status", "pending")
      .not("unit_id", "is", null)
      .gte("check_out", todayYmdInTz())
      .limit(300);
    return (data ?? [])
      .filter((r) => r.unit_id && r.check_in && r.check_out)
      .map((r) => ({
        id: r.id as string,
        unit_id: r.unit_id as string,
        check_in_date: r.check_in as string,
        check_out_date: r.check_out as string,
        channel: r.channel as Channel,
        confirmation_code: (r.confirmation_code as string | null) ?? null,
      }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function readRequests(
  organizationId: string,
  status: "pending" | "expired",
): Promise<ChannelRequestRow[]> {
  const admin = createAdminClient();
  let q = admin
    .from("channel_reservations")
    .select(
      "id, channel, unit_id, check_in, check_out, confirmation_code, guest, created_at, expired_at, external_status, units:unit_id(id, code, name)",
    )
    .eq("organization_id", organizationId)
    .eq("external_status", status)
    .order("check_in", { ascending: true })
    .limit(100);
  if (status === "pending") {
    q = q.gte("check_out", todayYmdInTz());
  } else {
    q = q.gte("expired_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  }
  const { data, error } = await q;
  // Lanza: el llamador convierte el fallo en "no aparece la sección", que es
  // honesto. Devolver [] pintaría "No hay solicitudes de OTA esperando" sobre
  // una lectura que falló, en la pantalla donde se toman las decisiones.
  if (error) throw new Error(error.message);
  const holdChannels = channelsHoldingAvailability(
    await getChannelRequestPolicies(admin, organizationId),
  );
  return (data ?? []).map((r) => toRequestRow(r, holdChannels));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRequestRow(r: any, holdChannels: Channel[] = []): ChannelRequestRow {
  const unit = Array.isArray(r.units) ? r.units[0] : r.units;
  const code = (r.confirmation_code as string | null) ?? null;
  return {
    id: r.id,
    channel: r.channel,
    unit_id: r.unit_id ?? null,
    unit: unit ? { id: unit.id, code: unit.code, name: unit.name } : null,
    check_in: r.check_in ?? null,
    check_out: r.check_out ?? null,
    confirmation_code: code,
    guest: r.guest ?? null,
    created_at: r.created_at,
    expired_at: r.expired_at ?? null,
    external_status: r.external_status,
    days_to_check_in: daysUntilYmd(r.check_in ?? null),
    hours_since_request: hoursSince(r.created_at),
    holds_availability: holdChannels.includes(r.channel as Channel),
    external_url: externalUrl(r.channel, code),
  };
}

function daysUntilYmd(ymd: string | null): number | null {
  if (!ymd) return null;
  const target = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.parse(`${todayYmdInTz()}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 3_600_000));
}

/**
 * El botón de mejor retorno de toda la función: la duda real ("¿la acepté o
 * no?") se resuelve en 10 segundos en el panel de la OTA, no adentro del PMS.
 */
function externalUrl(channel: Channel, code: string | null): string | null {
  if (!code) return null;
  if (channel === "airbnb") {
    return `https://www.airbnb.com/hosting/reservations/details/${code}`;
  }
  return "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/search_reservations.html";
}
