"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";

/**
 * Decisiones sobre cancelaciones propuestas por las OTAs.
 *
 * El sistema nunca cancela una reserva por su cuenta (ver migración 053). Las
 * señales externas —un evento que desaparece del iCal, un email de cancelación—
 * abren una propuesta y esperan acá. Este archivo es el ÚNICO lugar del
 * pipeline de canales donde una reserva pasa a `cancelada`, y siempre con un
 * `session.userId` detrás.
 */

const PATHS = [
  "/dashboard/canales",
  "/dashboard/canales/cancelaciones",
  "/dashboard/reservas",
  "/dashboard/unidades",
  "/dashboard/unidades/kanban",
  "/dashboard",
];

function revalidateAll(bookingId?: string | null) {
  for (const p of PATHS) revalidatePath(p);
  if (bookingId) revalidatePath(`/dashboard/reservas/${bookingId}`);
}

export interface PendingCancellation {
  id: string;
  channel: string;
  reason_code: "missing_from_feed" | "ota_cancellation_email";
  detail: string | null;
  risk: "normal" | "alto";
  created_at: string;
  booking_id: string | null;
  reservation_id: string | null;
  evidence: Record<string, unknown>;
  snapshot: {
    unidad?: string | null;
    huesped?: string | null;
    telefono?: string | null;
    check_in?: string | null;
    check_out?: string | null;
    estado?: string | null;
    origen?: string | null;
    es_bloqueo?: boolean;
    moneda?: string | null;
    total?: number;
    cobrado?: number;
    confirmacion_enviada?: boolean;
    cargada_a_mano?: boolean;
    dias_para_llegada?: number;
    referencia_ota?: string | null;
  };
}

/**
 * Propuestas abiertas de la org activa. Se consulta en el layout del dashboard,
 * así que devuelve rápido y nunca tira: si algo falla, la lista viene vacía y
 * el PMS sigue funcionando (una propuesta no vista es un aviso perdido; una
 * excepción acá sería el dashboard caído).
 */
export async function listPendingCancellations(): Promise<PendingCancellation[]> {
  try {
    await requireSession();
    const { organization, role } = await getCurrentOrg();
    if (!can(role, "channels", "view")) return [];

    const admin = createAdminClient();
    const { data } = await admin
      .from("channel_cancellation_requests")
      .select(
        "id, channel, reason_code, detail, risk, created_at, booking_id, reservation_id, evidence, snapshot",
      )
      .eq("organization_id", organization.id)
      .eq("status", "pending")
      // las de mayor riesgo primero, y dentro de cada grupo las más viejas
      .order("risk", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(50);

    return (data ?? []) as PendingCancellation[];
  } catch {
    return [];
  }
}

export interface DecidedCancellation extends PendingCancellation {
  status: "cancelled" | "kept" | "stale";
  decided_at: string | null;
  decision_note: string | null;
  decided_by_name: string | null;
}

/**
 * Historial de decisiones. Existe para que "¿por qué desapareció esta reserva?"
 * tenga siempre una respuesta con nombre y fecha — la pregunta que nadie podía
 * contestar cuando el barrido cancelaba solo.
 */
export async function listCancellationHistory(limit = 40): Promise<DecidedCancellation[]> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "channels", "view")) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_cancellation_requests")
    .select(
      "id, channel, reason_code, detail, risk, created_at, booking_id, reservation_id, evidence, snapshot, status, decided_at, decision_note, decided_by",
    )
    .eq("organization_id", organization.id)
    .neq("status", "pending")
    .order("decided_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  const rows = (data ?? []) as (DecidedCancellation & { decided_by: string | null })[];
  const userIds = [...new Set(rows.map((r) => r.decided_by).filter(Boolean))] as string[];

  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    for (const p of profiles ?? []) names.set(p.user_id, p.full_name);
  }

  return rows.map((r) => ({
    ...r,
    decided_by_name: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
  }));
}

const decideSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(["cancel", "keep"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * Resuelve una propuesta.
 *
 *   · "cancel" → recién acá la reserva pasa a `cancelada`, con nombre y apellido
 *     de quién lo decidió en `cancelled_by`.
 *   · "keep"   → la reserva queda como está y la reserva externa se marca
 *     protegida: el barrido no vuelve a preguntar por la misma ausencia.
 */
export async function decideCancellation(input: z.infer<typeof decideSchema>) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "channels", "update")) {
    throw new Error("No tenés permisos para decidir cancelaciones de canales");
  }
  const validated = decideSchema.parse(input);
  const admin = createAdminClient();

  const { data: request, error: reqErr } = await admin
    .from("channel_cancellation_requests")
    .select("*")
    .eq("id", validated.request_id)
    .eq("organization_id", organization.id)
    .single();
  if (reqErr || !request) throw new Error("Esa solicitud ya no existe");
  if (request.status !== "pending") return { ok: true, already: true as const };

  const now = new Date().toISOString();

  if (validated.decision === "cancel") {
    if (request.booking_id) {
      const { error: cancelErr } = await admin
        .from("bookings")
        .update({
          status: "cancelada",
          cancelled_at: now,
          cancelled_by: session.userId,
          cancelled_source: "channel_decision",
          cancelled_reason:
            validated.note?.trim() ||
            `Cancelada en ${channelName(request.channel)} — confirmado desde el PMS`,
        })
        .eq("id", request.booking_id)
        .eq("organization_id", organization.id);
      if (cancelErr) throw new Error(traducirError(cancelErr.message));
    }
    if (request.reservation_id) {
      await admin
        .from("channel_reservations")
        .update({ external_status: "cancelled", missing_since: null, missing_runs: 0 })
        .eq("id", request.reservation_id);
    }
  } else {
    // MANTENER: la reserva no se toca y la ausencia queda zanjada. Reseteamos
    // los contadores para que el barrido no la traiga de vuelta en la próxima
    // lectura, y dejamos el candado para que no vuelva a preguntar nunca por
    // este mismo motivo.
    if (request.reservation_id) {
      await admin
        .from("channel_reservations")
        .update({
          missing_since: null,
          missing_runs: 0,
          cancellation_locked_at: now,
          cancellation_locked_by: session.userId,
        })
        .eq("id", request.reservation_id);
    }
  }

  await admin
    .from("channel_cancellation_requests")
    .update({
      status: validated.decision === "cancel" ? "cancelled" : "kept",
      decided_by: session.userId,
      decided_at: now,
      decision_note: validated.note?.trim() || null,
    })
    .eq("id", request.id);

  // El aviso ya cumplió su función: se marca leído para que no siga sonando.
  await admin
    .from("notifications")
    .update({ read_at: now })
    .eq("organization_id", organization.id)
    .eq("dedup_key", `cancel_request:${request.reservation_id ?? request.booking_id}`)
    .is("read_at", null);

  revalidateAll(request.booking_id);
  return { ok: true as const, decision: validated.decision };
}

function channelName(channel: string): string {
  return channel === "airbnb" ? "Airbnb" : channel === "booking" ? "Booking" : channel;
}

/** El overlap es el único error esperable acá y en crudo no dice nada. */
function traducirError(message: string): string {
  if (message.includes("bookings_no_overlap")) {
    return "No se pudo aplicar el cambio: las fechas se superponen con otra reserva de la misma unidad.";
  }
  return message;
}
