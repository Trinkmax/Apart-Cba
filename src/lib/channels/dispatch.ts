import { getSecret } from "@/lib/crm/encryption";
import { openCancellationRequest } from "./cancellation-requests";
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
// Cuánta evidencia juntamos antes de MOLESTAR a una persona con una decisión.
// Ya no son umbrales de ejecución: nada se cancela al cumplirlos, sólo se abre
// una propuesta. Por eso pueden ser generosos sin poner nada en riesgo.
const MISSING_RUNS_TO_PROPOSE = 3;
const MISSING_MIN_WINDOW_MS = 30 * 60 * 1000;
// Fuera del horizonte publicado (o con el feed vacío) la ausencia es mucho
// menos concluyente: puede ser la OTA recortando su ventana de calendario, o un
// feed que vino vacío por error. Ahí pedimos MUCHA más evidencia antes de
// preguntar, para no gastar la atención del operador en falsos positivos.
const MISSING_RUNS_TO_PROPOSE_WEAK = 12;
const MISSING_MIN_WINDOW_WEAK_MS = 6 * 60 * 60 * 1000;

export interface DispatchSummary {
  runId: string | null;
  claimed: number;
  processed: number;
  imported: number;
  updated: number;
  cancelled: number;
  /** Cancelaciones PROPUESTAS que esperan decisión humana. */
  proposed: number;
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
    proposed: 0,
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
        summary.proposed += r.proposed;
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
  /** Propuestas de cancelación abiertas para decisión humana. */
  proposed: number;
  conflicts: number;
  skipped: number;
  error?: string;
}

async function syncLink(admin: AdminClient, link: ChannelLinkRow): Promise<LinkSyncResult> {
  const result: LinkSyncResult = {
    imported: 0,
    updated: 0,
    cancelled: 0,
    proposed: 0,
    conflicts: 0,
    skipped: 0,
  };

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

  // desapariciones. Un feed vacío teniendo reservas activas sigue siendo
  // sospechoso (glitch típico de la OTA), pero ya no cancela el barrido: pasa
  // por la vía lenta (12 lecturas / 6 h). Saltearlo del todo era una trampa —
  // una conexión cuyo único evento era un bloqueo quedaba bloqueada para
  // siempre, porque al sacar ese bloqueo el feed queda vacío por definición.
  const anomalousEmpty =
    events.length === 0 && known.some((r) => r.external_status === "active");
  result.proposed += await proposeDisappearances(
    admin,
    link,
    known,
    seenUids,
    outcome.horizon ?? null,
    events.length === 0,
  );

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
 * Desaparición del VEVENT → PROPUESTA de cancelación. Nunca una cancelación.
 *
 * El 14/08/2026 este barrido canceló solo 26 reservas, tres de ellas reales:
 * una con $80.000 de seña cobrada y confirmación ya enviada al huésped (que
 * después se revendió a otra persona), y una con el huésped adentro del
 * departamento. Todas por el mismo motivo: "el evento no aparece en el feed".
 *
 * Que un VEVENT desaparezca NO prueba que la reserva se canceló. Puede ser:
 *   · el feed vino vacío o truncado por un error de la OTA
 *   · la OTA rotó el UID del mismo evento (Booking lo hace a diario)
 *   · la OTA recortó su ventana de calendario
 *   · el eco de nuestro propio export volviendo con sello ajeno
 *
 * Ninguna de esas cosas se distingue de una cancelación real leyendo el feed.
 * Así que el sistema junta evidencia y una persona decide: Cancelar / Mantener.
 *
 * Umbrales (sólo para decidir CUÁNDO vale la pena molestar a una persona, ya
 * no para ejecutar nada):
 *   · vía normal (dentro del horizonte publicado): ≥3 lecturas y ≥30 min
 *   · vía lenta (más allá del horizonte, o feed vacío): ≥12 lecturas y ≥6 h
 */
export async function proposeDisappearances(
  admin: AdminClient,
  link: ChannelLinkRow,
  known: ChannelReservationRow[],
  seenUids: Set<string>,
  horizon: string | null,
  feedEmpty = false,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  let proposed = 0;

  const candidates = known.filter(
    (r) =>
      r.external_status === "active" &&
      r.ical_uid &&
      !seenUids.has(r.ical_uid) &&
      r.last_seen_at !== null && // observada previamente
      r.check_in !== null &&
      r.check_out !== null &&
      // Una persona ya miró esta ausencia y dijo "la reserva va". No se vuelve
      // a preguntar por el mismo motivo.
      !r.cancellation_locked_at &&
      (r.check_in >= today || (r.is_block && r.check_out > today)),
  );

  // Un feed que devuelve CERO eventos teniendo reservas activas conocidas no es
  // una lectura: es una lectura fallida disfrazada de éxito (una URL que venció,
  // un token rotado, la OTA respondiendo 200 con un calendario vacío). Hoy 43 de
  // las 70 conexiones activas devuelven cero eventos y el sistema las da por
  // sanas. Tratar ese silencio como evidencia es exactamente cómo se cancelan
  // todas las reservas de una unidad de una sola vez, así que no avanza nada:
  // ni contadores ni propuestas. Queda una incidencia para que se revise el feed.
  if (feedEmpty && candidates.length > 0) {
    await openIssue(admin, {
      organizationId: link.organization_id,
      linkId: link.id,
      issueType: "feed_error",
      severity: "critical",
      title: `El calendario de ${channelLabel(link.channel)} está viniendo vacío`,
      detail: `La última lectura no trajo ningún evento, pero hay ${candidates.length} ${candidates.length === 1 ? "reserva activa" : "reservas activas"} de esta conexión. No tocamos nada: revisá que el enlace del calendario siga siendo válido.`,
      dedupeKey: `empty_feed:${link.id}`,
    });
    return 0;
  }

  for (const r of candidates) {
    // "Más allá del horizonte" = el feed no publica tan lejos, así que su
    // silencio no prueba nada. Ojo: el evento MÁS lejano define el horizonte,
    // por lo que al desaparecer siempre cae acá — de ahí la vía lenta.
    const beyondHorizon = feedEmpty || horizon === null || r.check_out! > horizon;
    const runsNeeded = beyondHorizon ? MISSING_RUNS_TO_PROPOSE_WEAK : MISSING_RUNS_TO_PROPOSE;
    const windowNeeded = beyondHorizon ? MISSING_MIN_WINDOW_WEAK_MS : MISSING_MIN_WINDOW_MS;

    const runs = r.missing_runs + 1;
    const missingSince = r.missing_since ?? new Date().toISOString();
    const windowElapsed = Date.now() - Date.parse(missingSince) >= windowNeeded;

    if (runs >= runsNeeded && windowElapsed && r.missing_since) {
      // Evidencia suficiente para pedir una decisión humana.
      const created = await openCancellationRequest(admin, {
        organizationId: link.organization_id,
        link,
        channel: link.channel,
        reservation: r,
        reasonCode: "missing_from_feed",
        detail: `Dejó de aparecer en el calendario de ${channelLabel(link.channel)}. Puede ser una cancelación real, o un problema de lectura del feed.`,
        evidence: {
          lecturas_sin_verla: runs,
          ausente_desde: missingSince,
          feed_vacio: feedEmpty,
          horizonte_publicado: horizon,
          mas_alla_del_horizonte: beyondHorizon,
          ultima_vez_vista: r.last_seen_at,
        },
      });
      if (created) proposed++;
      // El contador se congela: la propuesta ya está abierta y esperando.
      await admin
        .from("channel_reservations")
        .update({ missing_since: missingSince, missing_runs: runs })
        .eq("id", r.id);
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
          detail: `La reserva ${r.confirmation_code ?? r.ical_uid} (${r.check_in} → ${r.check_out}) no apareció en la última lectura. Si sigue ausente en ${runsNeeded} lecturas durante ${beyondHorizon ? "6+ horas" : "30+ minutos"} te vamos a pedir que decidas si se cancela o se mantiene. Nadie la va a cancelar sin tu confirmación.`,
          dedupeKey: `missing:${r.id}`,
        });
      }
    }
  }
  return proposed;
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
    eventType:
      row.event_type === "reservation_cancelled"
        ? "reservation_cancelled"
        : row.event_type === "reservation_reference"
          ? "reservation_reference"
          : "reservation_upsert",
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
