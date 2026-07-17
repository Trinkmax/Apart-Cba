import { getSecret } from "@/lib/crm/encryption";
import { fetchIcalFeed, toReservationEvent } from "./ical-adapter";
import {
  channelLabel,
  ingestEvent,
  openIssue,
  processStoredEvent,
  resolveIssuesByDedupe,
} from "./ingest";
import type {
  Channel,
  ChannelLinkRow,
  ChannelReservationRow,
  ReservationEvent,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

/**
 * Dispatcher de Canales de venta. Corre cada minuto vía pg_cron →
 * POST /api/cron/channel-dispatch.
 *
 *   - reclama hasta 12 conexiones vencidas (RPC transaccional con
 *     FOR UPDATE SKIP LOCKED — el lock por conexión vive en claimed_until)
 *   - máx. 4 fetches simultáneos, timeout individual de 10 s
 *   - presupuesto total < 45 s
 *   - éxito → próxima revisión en 5 min; error → backoff exponencial hasta 1 h
 *   - 3 fallos consecutivos → incidencia
 *
 * El modo `reconcile` (diario) además fuerza una pasada completa y hace
 * housekeeping (reintentos de eventos en error, incidencias obsoletas, links
 * estancados).
 */

const CLAIM_BATCH = 12;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 10_000;
const TOTAL_BUDGET_MS = 45_000;
const SUCCESS_INTERVAL_MIN = 5;
const MAX_BACKOFF_MIN = 60;
const MISSING_RUNS_TO_CANCEL = 3;
const MISSING_MIN_WINDOW_MS = 30 * 60 * 1000;

export interface DispatchSummary {
  runId: string | null;
  claimed: number;
  processed: number;
  imported: number;
  updated: number;
  cancelled: number;
  conflicts: number;
  errors: number;
  housekeeping?: Record<string, number>;
}

export async function runChannelDispatch(
  admin: AdminClient,
  mode: "dispatch" | "reconcile" | "manual" = "dispatch",
  opts: { organizationId?: string; linkIds?: string[] } = {},
): Promise<DispatchSummary> {
  const startedAt = Date.now();

  const { data: run } = await admin
    .from("channel_sync_runs")
    .insert({ run_type: mode, organization_id: opts.organizationId ?? null })
    .select("id")
    .single();
  const runId: string | null = run?.id ?? null;

  const summary: DispatchSummary = {
    runId,
    claimed: 0,
    processed: 0,
    imported: 0,
    updated: 0,
    cancelled: 0,
    conflicts: 0,
    errors: 0,
  };

  try {
    if (mode === "reconcile") {
      // fuerza revisión inmediata de todas las conexiones activas
      await admin
        .from("channel_links")
        .update({ next_poll_at: new Date().toISOString() })
        .eq("status", "active")
        .gt("next_poll_at", new Date().toISOString());
      summary.housekeeping = await runHousekeeping(admin);
    }

    if (mode === "manual" && (opts.linkIds?.length || opts.organizationId)) {
      // sync-ahora desde la UI: vence las conexiones pedidas y las procesa ya
      let q = admin
        .from("channel_links")
        .update({ next_poll_at: new Date(Date.now() - 1000).toISOString(), claimed_until: null })
        .eq("status", "active");
      if (opts.linkIds?.length) q = q.in("id", opts.linkIds);
      if (opts.organizationId) q = q.eq("organization_id", opts.organizationId);
      await q;
    }

    const affectedOrgs = new Set<string>();

    for (;;) {
      if (Date.now() - startedAt > TOTAL_BUDGET_MS) break;

      const { data: claimed, error: claimErr } = await admin.rpc("channels_claim_due_links", {
        p_limit: CLAIM_BATCH,
        p_lease_seconds: 120,
      });
      if (claimErr) throw new Error(`claim falló: ${claimErr.message}`);
      const links = (claimed ?? []) as ChannelLinkRow[];
      if (links.length === 0) break;
      summary.claimed += links.length;

      await withConcurrency(links, CONCURRENCY, async (link) => {
        const r = await syncLink(admin, link);
        summary.processed++;
        summary.imported += r.imported;
        summary.updated += r.updated;
        summary.cancelled += r.cancelled;
        summary.conflicts += r.conflicts;
        if (r.error) summary.errors++;
        if (r.imported > 0 || r.updated > 0) affectedOrgs.add(link.organization_id);
      });

      // dispatch normal: un solo batch por corrida (el cron corre cada minuto)
      if (mode === "dispatch") break;
    }

    // limpiezas para check-outs cercanos de reservas recién importadas
    for (const orgId of affectedOrgs) {
      await ensureCleaningSafely(orgId);
    }

    await finalizeRun(admin, runId, summary, startedAt, null);
    return summary;
  } catch (err) {
    summary.errors++;
    await finalizeRun(admin, runId, summary, startedAt, (err as Error).message);
    return summary;
  }
}

interface LinkSyncResult {
  imported: number;
  updated: number;
  cancelled: number;
  conflicts: number;
  skipped: number;
  error?: string;
}

async function syncLink(admin: AdminClient, link: ChannelLinkRow): Promise<LinkSyncResult> {
  const result: LinkSyncResult = { imported: 0, updated: 0, cancelled: 0, conflicts: 0, skipped: 0 };

  let feedUrl: string | null = null;
  try {
    feedUrl = await getSecret(link.feed_secret_id);
  } catch {
    feedUrl = null;
  }
  if (!feedUrl) {
    await markLinkFailure(admin, link, "La conexión no tiene feed configurado", true);
    result.error = "sin feed";
    return result;
  }

  const outcome = await fetchIcalFeed({
    feedUrl,
    channel: link.channel,
    etag: link.remote_etag,
    lastModified: link.remote_last_modified,
  }).catch((err) => ({
    status: "http_error" as const,
    error: (err as Error).message?.slice(0, 200),
  }));

  if (outcome.status === "not_modified") {
    // lectura válida: el feed no cambió. Conservador: no avanza contadores de
    // desaparición (no re-observamos el contenido).
    await markLinkSuccess(admin, link, { unchanged: true });
    return result;
  }

  if (outcome.status !== "ok" || !outcome.events) {
    await markLinkFailure(
      admin,
      link,
      outcome.error ?? `Error del feed (${outcome.status})`,
      outcome.status === "blocked_url",
    );
    result.error = outcome.error ?? outcome.status;
    return result;
  }

  const events = outcome.events;

  // reservas canónicas conocidas de esta conexión
  const { data: knownRows } = await admin
    .from("channel_reservations")
    .select("*")
    .eq("link_id", link.id)
    .not("ical_uid", "is", null);
  const known = (knownRows ?? []) as ChannelReservationRow[];
  const knownByUid = new Map(known.map((r) => [r.ical_uid as string, r]));

  const seenUids = new Set<string>();
  for (const ev of events) {
    seenUids.add(ev.uid);
    const existing = knownByUid.get(ev.uid);
    const changed =
      !existing ||
      existing.check_in !== ev.checkIn ||
      existing.check_out !== ev.checkOut ||
      (ev.confirmationCode && !existing.confirmation_code) ||
      existing.external_status === "cancelled" ||
      // sin proyección local (conflicto/ambigüedad pendiente) → reintentar
      (existing.external_status === "active" && !existing.booking_id);

    if (changed) {
      const rev = toReservationEvent({
        event: ev,
        organizationId: link.organization_id,
        linkId: link.id,
        unitId: link.unit_id,
        channel: link.channel,
      });
      const r = await ingestEvent(admin, rev);
      switch (r.outcome) {
        case "created":
          result.imported++;
          break;
        case "updated":
          result.updated++;
          break;
        case "conflict":
          result.conflicts++;
          break;
        case "error":
          result.error = r.error;
          break;
        default:
          result.skipped++;
      }
    } else {
      result.skipped++;
    }
  }

  // reapariciones: limpiar tracking de desaparición
  const reappeared = known.filter((r) => r.missing_since && seenUids.has(r.ical_uid as string));
  if (reappeared.length > 0) {
    await admin
      .from("channel_reservations")
      .update({ missing_since: null, missing_runs: 0, last_seen_at: new Date().toISOString() })
      .in("id", reappeared.map((r) => r.id));
    for (const r of reappeared) {
      await resolveIssuesByDedupe(
        admin,
        link.organization_id,
        `missing:${r.id}`,
        "La reserva volvió a aparecer en el calendario de la OTA.",
      );
    }
  }

  // refresco liviano de last_seen_at (informativo; no participa del diff)
  const staleSeenIds = known
    .filter(
      (r) =>
        seenUids.has(r.ical_uid as string) &&
        !r.missing_since &&
        (!r.last_seen_at || Date.now() - Date.parse(r.last_seen_at) > 60 * 60 * 1000),
    )
    .map((r) => r.id);
  if (staleSeenIds.length > 0) {
    await admin
      .from("channel_reservations")
      .update({ last_seen_at: new Date().toISOString() })
      .in("id", staleSeenIds);
  }

  // desapariciones — SOLO con lectura completa y no anómala
  const anomalousEmpty =
    events.length === 0 && known.some((r) => r.external_status === "active");
  if (!anomalousEmpty) {
    result.cancelled += await handleDisappearances(admin, link, known, seenUids, outcome.horizon ?? null);
  }

  await markLinkSuccess(admin, link, {
    events: events.length,
    horizon: outcome.horizon ?? null,
    etag: outcome.etag ?? null,
    lastModified: outcome.lastModified ?? null,
    anomalousEmpty,
  });
  return result;
}

/**
 * Cancelación defensiva por desaparición del VEVENT:
 *   - advertencia desde la primera ausencia
 *   - cancela recién con ≥3 lecturas completas donde falte Y ≥30 min entre la
 *     primera y la última
 *   - solo reservas futuras observadas antes, dentro del horizonte del feed
 *   - feeds vacíos/anómalos nunca llegan acá (guard del caller)
 */
export async function handleDisappearances(
  admin: AdminClient,
  link: ChannelLinkRow,
  known: ChannelReservationRow[],
  seenUids: Set<string>,
  horizon: string | null,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  let cancelled = 0;

  const candidates = known.filter(
    (r) =>
      r.external_status === "active" &&
      r.ical_uid &&
      !seenUids.has(r.ical_uid) &&
      r.last_seen_at !== null && // observada previamente
      r.check_in !== null &&
      r.check_in >= today && // solo futuras
      (horizon === null || (r.check_out !== null && r.check_out <= horizon)), // dentro del horizonte
  );

  for (const r of candidates) {
    const runs = r.missing_runs + 1;
    const missingSince = r.missing_since ?? new Date().toISOString();
    const windowElapsed = Date.now() - Date.parse(missingSince) >= MISSING_MIN_WINDOW_MS;

    if (runs >= MISSING_RUNS_TO_CANCEL && windowElapsed && r.missing_since) {
      // confirmado: cancelar
      let bookingCancelled = false;
      if (r.booking_id) {
        const { data: booking } = await admin
          .from("bookings")
          .select("id, status")
          .eq("id", r.booking_id)
          .maybeSingle();
        if (booking && (booking.status === "confirmada" || booking.status === "pendiente")) {
          const { error } = await admin
            .from("bookings")
            .update({
              status: "cancelada",
              cancelled_at: new Date().toISOString(),
              cancelled_reason: `Cancelada en ${channelLabel(link.channel)} (desapareció del calendario y se confirmó en 3 lecturas)`,
            })
            .eq("id", r.booking_id);
          bookingCancelled = !error;
        } else if (booking && booking.status === "check_in") {
          await openIssue(admin, {
            organizationId: link.organization_id,
            linkId: link.id,
            reservationId: r.id,
            bookingId: r.booking_id,
            issueType: "cancellation_review",
            severity: "critical",
            title: `Cancelación de ${channelLabel(link.channel)} con huésped en casa`,
            detail: `La reserva ${r.confirmation_code ?? r.ical_uid} desapareció del calendario de la OTA pero el huésped ya hizo check-in. No se canceló automáticamente.`,
            dedupeKey: `cancel_inhouse:${r.booking_id}`,
          });
          await admin
            .from("channel_reservations")
            .update({ missing_since: null, missing_runs: 0 })
            .eq("id", r.id);
          continue;
        } else {
          bookingCancelled = booking?.status === "cancelada";
        }
      }

      await admin
        .from("channel_reservations")
        .update({ external_status: "cancelled", missing_since: null, missing_runs: 0 })
        .eq("id", r.id);
      await resolveIssuesByDedupe(
        admin,
        link.organization_id,
        `missing:${r.id}`,
        "Cancelación confirmada tras tres lecturas del calendario.",
      );
      if (bookingCancelled || !r.booking_id) {
        cancelled++;
        await admin.from("notifications").insert({
          organization_id: link.organization_id,
          type: "inbound_booking_cancelled",
          severity: "warning",
          title: `Cancelación en ${channelLabel(link.channel)}`,
          body: `La reserva ${r.confirmation_code ?? "externa"} (${r.check_in} → ${r.check_out}) desapareció del calendario y se canceló localmente.`,
          ref_type: r.booking_id ? "booking" : undefined,
          ref_id: r.booking_id ?? undefined,
          target_role: "admin",
          action_url: r.booking_id ? `/dashboard/reservas/${r.booking_id}` : "/dashboard/canales",
          dedup_key: `channel_gone:${r.id}`,
        });
      }
    } else {
      // advertencia + avanzar contador
      await admin
        .from("channel_reservations")
        .update({ missing_since: missingSince, missing_runs: runs })
        .eq("id", r.id);
      if (!r.missing_since) {
        await openIssue(admin, {
          organizationId: link.organization_id,
          linkId: link.id,
          reservationId: r.id,
          bookingId: r.booking_id,
          issueType: "cancellation_review",
          severity: "warning",
          title: `Una reserva de ${channelLabel(link.channel)} desapareció del calendario`,
          detail: `La reserva ${r.confirmation_code ?? r.ical_uid} (${r.check_in} → ${r.check_out}) no apareció en la última lectura. Si desaparece en 3 lecturas durante 30+ minutos se cancelará automáticamente. Puede ser una cancelación de la OTA en curso.`,
          dedupeKey: `missing:${r.id}`,
        });
      }
    }
  }
  return cancelled;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health bookkeeping por conexión
// ─────────────────────────────────────────────────────────────────────────────

async function markLinkSuccess(
  admin: AdminClient,
  link: ChannelLinkRow,
  extra: {
    events?: number;
    horizon?: string | null;
    etag?: string | null;
    lastModified?: string | null;
    unchanged?: boolean;
    anomalousEmpty?: boolean;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    claimed_until: null,
    consecutive_failures: 0,
    last_success_at: new Date().toISOString(),
    next_poll_at: new Date(Date.now() + SUCCESS_INTERVAL_MIN * 60 * 1000).toISOString(),
    health: {
      ...(link.health ?? {}),
      last_error: null,
      ...(extra.unchanged
        ? {}
        : {
            last_events: extra.events ?? 0,
            horizon: extra.horizon ?? null,
            anomalous_empty: extra.anomalousEmpty ?? false,
          }),
    },
  };
  if (extra.etag !== undefined) patch.remote_etag = extra.etag;
  if (extra.lastModified !== undefined) patch.remote_last_modified = extra.lastModified;

  await admin.from("channel_links").update(patch).eq("id", link.id);

  // si venía con incidencia de feed, se resuelve sola
  if (link.consecutive_failures >= 3) {
    await resolveIssuesByDedupe(
      admin,
      link.organization_id,
      `feed:${link.id}`,
      "El feed volvió a responder correctamente.",
    );
  }
  // si estaba marcada como estancada (>10 min sin éxito), este éxito la resuelve
  const wasStale =
    !link.last_success_at || Date.now() - Date.parse(link.last_success_at) > 10 * 60 * 1000;
  if (wasStale) {
    await resolveIssuesByDedupe(
      admin,
      link.organization_id,
      `stale:${link.id}`,
      "La conexión volvió a revisarse correctamente.",
    );
  }
}

async function markLinkFailure(
  admin: AdminClient,
  link: ChannelLinkRow,
  errorMsg: string,
  permanent: boolean,
): Promise<void> {
  const failures = link.consecutive_failures + 1;
  const backoffMin = Math.min(SUCCESS_INTERVAL_MIN * 2 ** (failures - 1), MAX_BACKOFF_MIN);
  await admin
    .from("channel_links")
    .update({
      claimed_until: null,
      consecutive_failures: failures,
      next_poll_at: new Date(Date.now() + backoffMin * 60 * 1000).toISOString(),
      health: { ...(link.health ?? {}), last_error: errorMsg.slice(0, 300) },
    })
    .eq("id", link.id);

  if (failures >= 3 || permanent) {
    await openIssue(admin, {
      organizationId: link.organization_id,
      linkId: link.id,
      issueType: "feed_error",
      severity: "critical",
      title: `No se puede leer el calendario de ${channelLabel(link.channel)}`,
      detail: `La conexión falló ${failures} veces seguidas. Último error: ${errorMsg.slice(0, 200)}. Verificá que el calendario siga publicado en la OTA o volvé a pegar el enlace.`,
      dedupeKey: `feed:${link.id}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Housekeeping del reconciliador diario
// ─────────────────────────────────────────────────────────────────────────────

async function runHousekeeping(admin: AdminClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // eventos colgados en processing (>15 min) → error, para reintento
  const { data: stuck } = await admin
    .from("channel_events")
    .update({ status: "error", error: "processing interrumpido (reciclado por reconcile)" })
    .eq("status", "processing")
    .lt("updated_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .select("id");
  counts.stuck_recycled = stuck?.length ?? 0;

  // reintentar eventos en error (máx 5 intentos)
  const { data: retriable } = await admin
    .from("channel_events")
    .select("*")
    .eq("status", "error")
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(50);
  let retried = 0;
  for (const row of retriable ?? []) {
    const ev = reservationEventFromRow(row);
    if (!ev) continue;
    await processStoredEvent(admin, row.id, ev);
    retried++;
  }
  counts.events_retried = retried;

  // reservas externas activas con unidad pero sin proyección → re-proyectar
  const { data: unprojected } = await admin
    .from("channel_reservations")
    .select("id")
    .eq("external_status", "active")
    .is("booking_id", null)
    .not("unit_id", "is", null)
    .limit(50);
  let reprojected = 0;
  const { reprojectReservation } = await import("./ingest");
  for (const r of unprojected ?? []) {
    const res = await reprojectReservation(admin, r.id);
    if (res.outcome === "created" || res.outcome === "updated" || res.outcome === "duplicate") {
      reprojected++;
    }
  }
  counts.reservations_reprojected = reprojected;

  // conexiones activas sin éxito hace >30 min → incidencia stale_link
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: staleLinks } = await admin
    .from("channel_links")
    .select("id, organization_id, channel, last_success_at, created_at")
    .eq("status", "active")
    .or(`last_success_at.lt.${cutoff},last_success_at.is.null`);
  let stale = 0;
  for (const l of staleLinks ?? []) {
    if (!l.last_success_at && Date.parse(l.created_at) > Date.now() - 30 * 60 * 1000) continue;
    await openIssue(admin, {
      organizationId: l.organization_id,
      linkId: l.id,
      issueType: "stale_link",
      severity: "critical",
      title: `Conexión de ${channelLabel(l.channel as Channel)} sin revisión reciente`,
      detail:
        "La conexión no se pudo revisar con éxito en los últimos 30 minutos. La protección del calendario puede estar desactualizada.",
      dedupeKey: `stale:${l.id}`,
    });
    stale++;
  }
  counts.stale_links = stale;

  // auto-resolver stale_link de conexiones que volvieron a estar sanas
  const { data: healthy } = await admin
    .from("channel_links")
    .select("id, organization_id")
    .eq("status", "active")
    .gte("last_success_at", cutoff);
  for (const l of healthy ?? []) {
    await resolveIssuesByDedupe(
      admin,
      l.organization_id,
      `stale:${l.id}`,
      "La conexión volvió a revisarse correctamente.",
    );
  }

  return counts;
}

/** Reconstruye el ReservationEvent desde una fila de channel_events. */
export function reservationEventFromRow(row: {
  organization_id: string;
  dedupe_key: string;
  content_hash: string | null;
  transport: string;
  event_type: string;
  payload: Record<string, unknown>;
}): ReservationEvent | null {
  const p = row.payload ?? {};
  const channel = p.channel as Channel | undefined;
  if (!channel || (channel !== "airbnb" && channel !== "booking")) return null;
  return {
    transport: (row.transport as "ical" | "email") ?? "ical",
    channel,
    eventType: row.event_type === "reservation_cancelled" ? "reservation_cancelled" : "reservation_upsert",
    organizationId: row.organization_id,
    linkId: (p.link_id as string) ?? undefined,
    unitId: (p.unit_id as string) ?? undefined,
    icalUid: (p.ical_uid as string) ?? undefined,
    confirmationCode: (p.confirmation_code as string) ?? undefined,
    checkIn: (p.check_in as string) ?? undefined,
    checkOut: (p.check_out as string) ?? undefined,
    isBlock: Boolean(p.is_block),
    listingId: (p.listing_id as string) ?? undefined,
    listingHint: (p.listing_hint as string) ?? undefined,
    guest: {
      name: (p.guest_name as string) ?? undefined,
      email: (p.guest_email as string) ?? undefined,
      phone: (p.guest_phone as string) ?? undefined,
    },
    amounts: (p.amounts as { total?: number; currency?: string }) ?? undefined,
    dedupeKey: row.dedupe_key,
    contentHash: row.content_hash ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

async function ensureCleaningSafely(orgId: string): Promise<void> {
  try {
    const { ensureCleaningTasksForCheckouts } = await import("@/lib/actions/cleaning");
    const { DEFAULT_ORG_TIMEZONE, addDaysYmd, todayYmdInTz } = await import("@/lib/dates");
    const today = todayYmdInTz(DEFAULT_ORG_TIMEZONE);
    await Promise.all([
      ensureCleaningTasksForCheckouts(orgId, today, null),
      ensureCleaningTasksForCheckouts(orgId, addDaysYmd(today, 1), null),
    ]);
  } catch (err) {
    console.warn("[channels/dispatch] ensure cleaning falló", (err as Error).message);
  }
}

async function finalizeRun(
  admin: AdminClient,
  runId: string | null,
  summary: DispatchSummary,
  startedAt: number,
  error: string | null,
): Promise<void> {
  if (!runId) return;
  await admin
    .from("channel_sync_runs")
    .update({
      claimed_count: summary.claimed,
      processed_count: summary.processed,
      results: {
        imported: summary.imported,
        updated: summary.updated,
        cancelled: summary.cancelled,
        conflicts: summary.conflicts,
        errors: summary.errors,
        housekeeping: summary.housekeeping ?? null,
      },
      error,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", runId);
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await withTimeout(fn(item), FETCH_TIMEOUT_MS + 20_000);
      } catch (err) {
        console.error("[channels/dispatch] worker error", (err as Error).message);
      }
    }
  });
  await Promise.all(workers);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout de procesamiento")), ms),
    ),
  ]);
}
