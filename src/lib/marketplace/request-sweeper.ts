import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { getResolvedWebSettings } from "./web-settings-server";
import { notifyRequestExpired, notifyStaffRequestReminder } from "./notifications";

/**
 * Barrido de los pedidos de la web (pg_cron cada 5 min → /api/cron/from-pg).
 *
 * 1. Vence los pedidos `pendiente` cuyo `expires_at` ya pasó (update
 *    condicional: si alguien lo confirmó o rechazó en el medio, no se pisa).
 * 2. Le avisa al huésped que su pedido venció, UNA sola vez: la marca
 *    `guest_notified_at` la reclama `notifyRequestExpired` con un update
 *    condicional antes de mandar. Incluye los que venció el barrido diario de
 *    `daily-dispatch` (ese no avisa).
 * 3. Le recuerda al equipo los pedidos que siguen sin respuesta pasado el
 *    plazo prometido (`response_hours` de cada organización), una sola vez
 *    (`staff_reminded_at`, que reclama `notifyStaffRequestReminder`).
 *
 * Sólo toca pedidos del flujo web nuevo (con `access_token_hash`): los viejos
 * y los de la cuenta demo no tienen link de seguimiento y no deben generar
 * mails. Idempotente, acotado (máx. 50 por paso) y con presupuesto de tiempo:
 * lo que no entra en una corrida queda para la siguiente. Nunca lanza.
 */

export interface SweepResult {
  /** Pedidos que pasaron de pendiente a expirada en esta corrida. */
  expired: number;
  /** Avisos de vencimiento al huésped intentados. */
  guestsNotified: number;
  /** Recordatorios al equipo intentados. */
  reminded: number;
}

const MAX_PER_STEP = 50;
/** Pasado esto, un vencimiento viejo ya no se le avisa al huésped (llega tarde). */
const GUEST_NOTICE_WINDOW_MS = 72 * 60 * 60 * 1000;
/** `response_hours` mínimo configurable: filtro grueso antes de mirar cada org. */
const MIN_RESPONSE_HOURS = 1;
const HOUR_MS = 60 * 60 * 1000;

export async function sweepWebRequests(opts?: { now?: Date; budgetMs?: number }): Promise<SweepResult> {
  const result: SweepResult = { expired: 0, guestsNotified: 0, reminded: 0 };
  const now = opts?.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const deadline = Date.now() + (opts?.budgetMs ?? 20_000);
  const outOfTime = () => Date.now() > deadline;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[request-sweeper] sin cliente de base:", e);
    return result;
  }

  // 1) Vencer pendientes (todas las organizaciones; sin mails acá).
  try {
    const { data: due, error } = await admin
      .from("booking_requests")
      .select("id")
      .eq("status", "pendiente")
      .lt("expires_at", nowIso)
      .order("expires_at", { ascending: true })
      .limit(MAX_PER_STEP);
    if (error) throw new Error(error.message);
    const ids = (due ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      const { data: done, error: upErr } = await admin
        .from("booking_requests")
        .update({ status: "expirada" })
        .in("id", ids)
        .eq("status", "pendiente")
        .lt("expires_at", nowIso)
        .select("id");
      if (upErr) throw new Error(upErr.message);
      result.expired = done?.length ?? 0;
    }
  } catch (e) {
    console.error("[request-sweeper] vencer pedidos falló:", e);
  }

  // 2) Avisar al huésped (una vez). Primero los más recientes: si algo viejo
  //    falla siempre, no tapa a los nuevos.
  try {
    const since = new Date(nowMs - GUEST_NOTICE_WINDOW_MS).toISOString();
    const { data: pending, error } = await admin
      .from("booking_requests")
      .select("id")
      .eq("status", "expirada")
      .is("guest_notified_at", null)
      .not("access_token_hash", "is", null)
      .gt("expires_at", since)
      .order("expires_at", { ascending: false })
      .limit(MAX_PER_STEP);
    if (error) throw new Error(error.message);
    for (const r of pending ?? []) {
      if (outOfTime()) break;
      await notifyRequestExpired({ requestId: r.id as string });
      result.guestsNotified += 1;
    }
  } catch (e) {
    console.error("[request-sweeper] aviso de vencimiento falló:", e);
  }

  // 3) Recordatorio al equipo pasado el plazo prometido de cada organización.
  try {
    const cutoff = new Date(nowMs - MIN_RESPONSE_HOURS * HOUR_MS).toISOString();
    const { data: candidates, error } = await admin
      .from("booking_requests")
      .select("id, organization_id, created_at")
      .eq("status", "pendiente")
      .is("staff_reminded_at", null)
      .not("access_token_hash", "is", null)
      .gt("expires_at", nowIso)
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(MAX_PER_STEP);
    if (error) throw new Error(error.message);
    const hoursByOrg = new Map<string, number>();
    for (const r of candidates ?? []) {
      if (outOfTime()) break;
      const orgId = r.organization_id as string;
      let hours = hoursByOrg.get(orgId);
      if (hours == null) {
        // Nunca después de 44 h: el pedido vence a las 48 h y el recordatorio
        // tiene que llegar a tiempo aunque la promesa guardada sea de 48 h.
        hours = Math.min((await getResolvedWebSettings(orgId)).responseHours, 44);
        hoursByOrg.set(orgId, hours);
      }
      if (Date.parse(r.created_at as string) + hours * HOUR_MS > nowMs) continue;
      await notifyStaffRequestReminder({ requestId: r.id as string });
      result.reminded += 1;
    }
  } catch (e) {
    console.error("[request-sweeper] recordatorio al equipo falló:", e);
  }

  return result;
}
