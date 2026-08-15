"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import type { Channel } from "@/lib/channels/types";

/**
 * Bloqueos de calendario importados de una OTA (`bookings.is_block = true`).
 *
 * Por qué existe este archivo: Booking.com exporta TODO su calendario como
 * `SUMMARY:CLOSED - Not available` — no distingue una reserva real de un cierre
 * manual del anfitrión. El adapter no puede adivinar, así que las importa como
 * "ocupación" (`is_block`), que el PMS dibuja como una barra gris sin acciones.
 * Eso dejaba al operador sin salida: fechas ocupadas que no podía liberar por
 * ningún camino visible, ni siquiera cuando el bloqueo era un artefacto del
 * feed. Estas dos acciones resuelven la ambigüedad del lado humano:
 *
 *   releaseChannelBlock  → "esto no es una reserva, liberá las fechas"
 *   promoteBlockToBooking → "esto SÍ es una reserva, dejame cargarle los datos"
 *
 * Ninguna de las dos borra filas: liberar cancela el booking (lo saca del
 * calendario y libera la fecha, porque `bookings_no_overlap` sólo cubre
 * pendiente/confirmada/check_in) y marca la reserva externa como `ignored`,
 * que es lo que impide que el próximo sync la vuelva a proyectar.
 */

const bookingIdSchema = z.object({
  booking_id: z.string().uuid(),
  reason: z.string().trim().max(300).optional(),
});

export interface ChannelBlockContext {
  booking_id: string;
  unit_id: string;
  check_in_date: string;
  check_out_date: string;
  source: string;
  notes: string | null;
  /** Reserva externa que lo originó — null si el bloqueo es huérfano/legacy. */
  reservation: {
    id: string;
    channel: Channel;
    external_status: "active" | "cancelled" | "ignored";
    ical_uid: string | null;
    confirmation_code: string | null;
    last_seen_at: string | null;
    missing_since: string | null;
  } | null;
  link: { id: string; channel: Channel; last_success_at: string | null } | null;
  /**
   * true = la OTA TODAVÍA publica estas fechas como ocupadas. Liberarlas acá es
   * legítimo (el operador manda) pero deja el PMS y la OTA en desacuerdo, así
   * que la UI lo advierte antes de confirmar.
   */
  still_in_feed: boolean;
  can_manage: boolean;
}

/**
 * Contexto para el popover del bloqueo. Se carga on-demand al abrirlo: son dos
 * queries chicas y el grid ya carga bastante.
 */
export async function getChannelBlockContext(
  bookingId: string
): Promise<ChannelBlockContext | null> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!z.string().uuid().safeParse(bookingId).success) return null;

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, unit_id, check_in_date, check_out_date, source, notes, is_block")
    .eq("id", bookingId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!booking || !booking.is_block) return null;

  const { data: reservation } = await admin
    .from("channel_reservations")
    .select(
      "id, channel, external_status, ical_uid, confirmation_code, last_seen_at, missing_since, link_id"
    )
    .eq("booking_id", bookingId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  let link: ChannelBlockContext["link"] = null;
  if (reservation?.link_id) {
    const { data: linkRow } = await admin
      .from("channel_links")
      .select("id, channel, last_success_at")
      .eq("id", reservation.link_id)
      .maybeSingle();
    if (linkRow) {
      link = {
        id: linkRow.id as string,
        channel: linkRow.channel as Channel,
        last_success_at: linkRow.last_success_at as string | null,
      };
    }
  }

  return {
    booking_id: booking.id as string,
    unit_id: booking.unit_id as string,
    check_in_date: booking.check_in_date as string,
    check_out_date: booking.check_out_date as string,
    source: booking.source as string,
    notes: (booking.notes as string | null) ?? null,
    reservation: reservation
      ? {
          id: reservation.id as string,
          channel: reservation.channel as Channel,
          external_status: reservation.external_status as
            | "active"
            | "cancelled"
            | "ignored",
          ical_uid: (reservation.ical_uid as string | null) ?? null,
          confirmation_code: (reservation.confirmation_code as string | null) ?? null,
          last_seen_at: (reservation.last_seen_at as string | null) ?? null,
          missing_since: (reservation.missing_since as string | null) ?? null,
        }
      : null,
    link,
    // Vigente en la OTA = activa y sin racha de ausencias en las últimas lecturas.
    still_in_feed:
      reservation?.external_status === "active" && !reservation?.missing_since,
    can_manage: can(role, "bookings", "update"),
  };
}

/**
 * Libera las fechas de un bloqueo importado.
 *
 * Cancela el booking (desaparece del grid y libera la fecha) y marca la reserva
 * externa como `ignored` — el estado que le dice al sync "el operador ya
 * decidió esto, no lo vuelvas a traer". Sin ese segundo paso el bloqueo
 * reaparecía cada vez que la OTA le movía las fechas.
 */
export async function releaseChannelBlock(
  input: z.infer<typeof bookingIdSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    return { ok: false, error: "No tenés permiso para liberar fechas bloqueadas" };
  }
  const parsed = bookingIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, is_block, status, unit_id, check_in_date, check_out_date")
    .eq("id", parsed.data.booking_id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!booking) return { ok: false, error: "No encontramos ese bloqueo" };
  if (!booking.is_block) {
    return {
      ok: false,
      error: "Esto es una reserva, no un bloqueo. Cancelala desde la reserva.",
    };
  }
  if (booking.status === "cancelada") return { ok: true }; // idempotente

  const reason = parsed.data.reason?.trim();
  const { error: cancelErr } = await admin
    .from("bookings")
    .update({
      status: "cancelada",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason
        ? `Bloqueo liberado desde el calendario: ${reason}`
        : "Bloqueo liberado desde el calendario",
    })
    .eq("id", booking.id)
    .eq("organization_id", organization.id);
  if (cancelErr) return { ok: false, error: cancelErr.message };

  // El paso que hace que no vuelva.
  const { data: reservation } = await admin
    .from("channel_reservations")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (reservation) {
    await admin
      .from("channel_reservations")
      .update({
        external_status: "ignored",
        ignored_at: new Date().toISOString(),
        ignored_by: session.userId,
        ignored_reason: reason ?? null,
        missing_since: null,
        missing_runs: 0,
      })
      .eq("id", reservation.id);

    // Las incidencias abiertas de esa reserva ya no aplican: el operador resolvió.
    await admin
      .from("channel_issues")
      .update({
        status: "resolved",
        resolution: "El operador liberó las fechas desde el calendario.",
        resolved_by: session.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("organization_id", organization.id)
      .eq("reservation_id", reservation.id)
      .eq("status", "open");
  }

  revalidateBlockPaths(booking.id);
  return { ok: true };
}

/**
 * Deshace un `releaseChannelBlock`. Alimenta el "Deshacer" del toast: liberar
 * fechas es una decisión de un click sobre datos ambiguos, así que tiene que
 * poder revertirse igual de rápido — más aún porque una vez liberado el bloqueo
 * desaparece del calendario y ya no hay dónde volver a encontrarlo.
 */
export async function undoReleaseChannelBlock(
  input: { booking_id: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    return { ok: false, error: "No tenés permiso para editar reservas" };
  }
  if (!z.string().uuid().safeParse(input.booking_id).success) {
    return { ok: false, error: "Reserva inválida" };
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, is_block, status")
    .eq("id", input.booking_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!booking) return { ok: false, error: "No encontramos ese bloqueo" };
  if (booking.status !== "cancelada") return { ok: true }; // ya está vigente

  const { error } = await admin
    .from("bookings")
    .update({ status: "confirmada", cancelled_at: null, cancelled_reason: null })
    .eq("id", booking.id)
    .eq("organization_id", organization.id);
  if (error) {
    // Alguien vendió esas fechas mientras tanto: el bloqueo ya no puede volver.
    if (error.message.includes("bookings_no_overlap")) {
      return {
        ok: false,
        error: "Esas fechas ya se ocuparon con otra reserva. El bloqueo no se puede restaurar.",
      };
    }
    return { ok: false, error: error.message };
  }

  await admin
    .from("channel_reservations")
    .update({
      external_status: "active",
      ignored_at: null,
      ignored_by: null,
      ignored_reason: null,
    })
    .eq("booking_id", booking.id)
    .eq("organization_id", organization.id)
    .eq("external_status", "ignored");

  revalidateBlockPaths(booking.id);
  return { ok: true };
}

/**
 * "Esto sí es una reserva": deja de ser un bloqueo y pasa a comportarse como
 * cualquier reserva del PMS (editable, cobrable, con huésped, con limpieza).
 *
 * Es el caso real más común en Booking.com: la reserva entró por el calendario
 * pero el email de confirmación nunca llegó (reenviado a otra casilla, filtro
 * de spam, cuenta nueva), así que se quedó para siempre como una barra gris que
 * el operador no podía trabajar.
 */
export async function promoteBlockToBooking(
  input: { booking_id: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    return { ok: false, error: "No tenés permiso para editar reservas" };
  }
  if (!z.string().uuid().safeParse(input.booking_id).success) {
    return { ok: false, error: "Reserva inválida" };
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, is_block, source")
    .eq("id", input.booking_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!booking) return { ok: false, error: "No encontramos ese bloqueo" };
  if (!booking.is_block) return { ok: true }; // ya es una reserva

  const label = booking.source === "airbnb" ? "Airbnb" : "Booking";
  const { error } = await admin
    .from("bookings")
    .update({
      is_block: false,
      notes: `Importada de ${label} (confirmada a mano desde el calendario)`,
    })
    .eq("id", booking.id)
    .eq("organization_id", organization.id);
  if (error) return { ok: false, error: error.message };

  // La block-ness también vive en la reserva externa: si no la actualizamos, el
  // reconciliador diario la volvería a proyectar como ocupación.
  await admin
    .from("channel_reservations")
    .update({ is_block: false })
    .eq("booking_id", booking.id)
    .eq("organization_id", organization.id);

  revalidateBlockPaths(booking.id);
  return { ok: true };
}

function revalidateBlockPaths(bookingId: string) {
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${bookingId}`);
  revalidatePath("/dashboard/canales");
}
