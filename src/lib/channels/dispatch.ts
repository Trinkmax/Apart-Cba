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
  ClaimedChannelLink,
  ReservationEvent,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

/**
 * Dispatcher de Canales de venta. Lo dispara pg_cron → POST /api/cron/channel-dispatch.
 *
 * Qué cuesta acá y por qué el código tiene la forma que tiene:
 *
 *   · Vercel Fluid cobra WALL-CLOCK de la función, no CPU. Cada request a
 *     Supabase desde gru1/pdx1 paga ~220 ms de ida y vuelta aunque la query
 *     tarde 7 ms en Postgres. El dispatcher pasa el 100 % de su tiempo
 *     esperando red (feed de la OTA o Supabase), así que la única palanca real
 *     es HACER MENOS REQUESTS y hacer los que quedan EN PARALELO.
 *   · Antes: 3 requests por conexión (secreto + reservas conocidas + PATCH) y
 *     un solo batch de 12 por corrida con 4 fetches a la vez → 12 links/min de
 *     capacidad contra 14/min de demanda (70 links cada 5 min). Cada link se
 *     leía en realidad cada ~6 min y la función sumaba 2-3 h/día.
 *   · Ahora: 1 request por conexión (el PATCH final). El RPC v2 devuelve la
 *     URL del feed junto con el claim y las reservas conocidas se leen UNA vez
 *     por batch. Y la corrida no se detiene tras un batch: reclama hasta agotar
 *     las conexiones vencidas o hasta agotar el presupuesto, en todos los
 *     modos, así el cron puede correr cada 2 min sin perder cadencia.
 *
 * Mecánica:
 *   - claim transaccional (FOR UPDATE SKIP LOCKED; el lock por conexión vive en
 *     claimed_until) de hasta CLAIM_BATCH conexiones vencidas
 *   - CONCURRENCY fetches simultáneos, timeout individual de 10 s
 *   - presupuesto total TOTAL_BUDGET_MS, con margen para el maxDuration de 60 s
 *   - éxito → próxima revisión en 5 min; error → backoff exponencial hasta 1 h
 *   - 3 fallos consecutivos → incidencia
 *
 * El modo `reconcile` (diario) además fuerza una pasada completa y hace
 * housekeeping (reintentos de eventos en error, incidencias obsoletas, links
 * estancados, retención de channel_sync_runs).
 */

const CLAIM_BATCH = 20;
// La concurrencia manda sobre el costo: el fetch del feed (~0,65 s p50) no toca
// Supabase, y el pool de PostgREST (10 conexiones) apenas se ocupa unos ms por
// request. 10 a la vez es seguro con una sola corrida del cron activa.
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;
// Tope duro por conexión (fetch + sus escrituras). Es la unidad con la que se
// decide si todavía "entra" trabajo nuevo antes de agotar el presupuesto.
const PER_LINK_HARD_TIMEOUT_MS = FETCH_TIMEOUT_MS + 5_000;
// 40 s deja margen para finalizar (PATCH de la corrida, limpiezas) dentro del
// maxDuration de 60 s de la ruta. Antes con 45 s + 30 s de tope por link, Vercel
// mataba corridas a los 60 s y quedaban filas de sync_runs sin cerrar.
const TOTAL_BUDGET_MS = 40_000;
const CLAIM_LEASE_SECONDS = 120;
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
// Una reserva activa sin proyección (conflicto/ambigüedad) se reintenta como
// mucho una vez por hora. Reintentarla en CADA lectura costaba 7-8 requests por
// reserva cada 5 min (había un evento con 2.025 intentos) y nunca cambiaba nada:
// lo que la destraba es una persona, o el reconcile diario.
const UNPROJECTED_RETRY_MS = 60 * 60 * 1000;
// Retención de la auditoría de corridas. Nadie la lee desde la UI; a 1 fila
// por minuto crecía 31 MB en seis semanas.
const SYNC_RUNS_RETENTION_DAYS = 14;
const SYNC_RUNS_PURGE_BATCH = 5000;
const SYNC_RUNS_PURGE_MAX_BATCHES = 4;
// Si el RPC v2 no está (PGRST202), cada cuántas corridas volvemos a probarlo.
const CLAIM_V2_REPROBE_RUNS = 30;
const TIMEOUT_MESSAGE = "timeout de procesamiento";

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
  /** Cuántos claims hizo la corrida (antes era siempre 1 en modo dispatch). */
  batches: number;
  /** Conexiones reclamadas que se liberaron sin procesar por falta de tiempo. */
  released: number;
  housekeeping?: Record<string, number>;
}

/**
 * Estado a nivel módulo: en Fluid el módulo sobrevive entre invocaciones, así
 * que un PGRST202 transitorio (PostgREST recargando el schema cache justo
 * después del CREATE FUNCTION) no debe dejar el fallback pegado para siempre.
 * Por eso la decisión expira cada CLAIM_V2_REPROBE_RUNS corridas y en reconcile.
 */
const claimRpcState = { v2Available: true, runsSinceFallback: 0 };

/** Medición por corrida: sin esto no se distingue si lo que queda es OTA o Supabase. */
interface RunStats {
  claimMs: number;
  fetchMs: number[];
  linkMs: number[];
  feedErrors: number;
  timeouts: number;
  claimRpc: "v2" | "v1";
}

export async function runChannelDispatch(
  admin: AdminClient,
  mode: "dispatch" | "reconcile" | "manual" = "dispatch",
  opts: { organizationId?: string; linkIds?: string[] } = {},
): Promise<DispatchSummary> {
  const startedAt = Date.now();
  // Después de este instante no se ARRANCA trabajo nuevo (ni claim ni link):
  // lo que arranque antes termina, en el peor caso, dentro de TOTAL_BUDGET_MS.
  const startDeadline = startedAt + TOTAL_BUDGET_MS - PER_LINK_HARD_TIMEOUT_MS;

  maybeReprobeClaimV2(mode);

  // La fila de auditoría se inserta en paralelo con todo lo demás: es el primer
  // request de la invocación (paga el handshake TLS, ~0,5 s) y nadie necesita
  // el id hasta finalizeRun.
  // (async IIFE y no `.then()`: el builder de postgrest-js es un PromiseLike,
  // no un Promise, y el tipo anotado exige Promise.)
  const runIdPromise: Promise<string | null> = (async () => {
    try {
      const res = await admin
        .from("channel_sync_runs")
        .insert({ run_type: mode, organization_id: opts.organizationId ?? null })
        .select("id")
        .single();
      return (res.data as { id: string } | null)?.id ?? null;
    } catch {
      return null;
    }
  })();

  const summary: DispatchSummary = {
    runId: null,
    claimed: 0,
    processed: 0,
    imported: 0,
    updated: 0,
    cancelled: 0,
    proposed: 0,
    conflicts: 0,
    errors: 0,
    batches: 0,
    released: 0,
  };
  const stats: RunStats = {
    claimMs: 0,
    fetchMs: [],
    linkMs: [],
    feedErrors: 0,
    timeouts: 0,
    claimRpc: claimRpcState.v2Available ? "v2" : "v1",
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
      // sync-ahora desde la UI: vence las conexiones pedidas y las procesa ya.
      // Ojo: el claim de abajo no filtra por organización, así que después de
      // las pedidas puede reclamar cualquier otra conexión vencida (pre-existente).
      let q = admin
        .from("channel_links")
        .update({ next_poll_at: new Date(Date.now() - 1000).toISOString(), claimed_until: null })
        .eq("status", "active");
      if (opts.linkIds?.length) q = q.in("id", opts.linkIds);
      if (opts.organizationId) q = q.eq("organization_id", opts.organizationId);
      await q;
    }

    const affectedOrgs = new Set<string>();

    // Loop en TODOS los modos: reclamar → procesar → repetir hasta que no queden
    // conexiones vencidas o se agote el presupuesto. Cortar tras un batch (como
    // antes en modo dispatch) dejaba capacidad fija de 12 links/min.
    for (;;) {
      if (Date.now() > startDeadline) break;

      const claimStart = Date.now();
      const links = await claimDueLinks(admin);
      stats.claimMs += Date.now() - claimStart;
      stats.claimRpc = claimRpcState.v2Available ? "v2" : "v1";
      if (links.length === 0) break;
      summary.claimed += links.length;
      summary.batches++;

      // UNA lectura de channel_reservations para todo el batch, disparada ya:
      // corre en paralelo con los fetches de los feeds y cada link toma su
      // parte cuando la necesita.
      const knownPromise = loadKnownReservations(
        admin,
        links.map((l) => l.id),
      );
      const touches: BatchTouches = { reappearedIds: [], staleSeenIds: [] };

      const leftovers = await withConcurrency(
        links,
        CONCURRENCY,
        startDeadline,
        async (link) => {
          const t0 = Date.now();
          const r = await syncLink(admin, link, knownPromise, touches, stats);
          stats.linkMs.push(Date.now() - t0);
          summary.processed++;
          summary.imported += r.imported;
          summary.updated += r.updated;
          summary.cancelled += r.cancelled;
          summary.proposed += r.proposed;
          summary.conflicts += r.conflicts;
          if (r.error) summary.errors++;
          if (r.imported > 0 || r.updated > 0) affectedOrgs.add(link.organization_id);
        },
        () => {
          stats.timeouts++;
          summary.errors++;
        },
      );

      // Lo que no llegó a arrancar por tiempo vuelve a estar disponible YA, en
      // vez de esperar los 120 s del lease.
      if (leftovers.length > 0) {
        await admin
          .from("channel_links")
          .update({ claimed_until: null })
          .in(
            "id",
            leftovers.map((l) => l.id),
          );
        summary.released += leftovers.length;
      }

      // Escrituras informativas acumuladas de todo el batch (2 requests en vez
      // de 2 por conexión).
      await flushBatchTouches(admin, touches);

      // Un batch incompleto quiere decir que no hay más tiempo; no reclamamos otro.
      if (leftovers.length > 0) break;
    }

    // limpiezas para check-outs cercanos de reservas recién importadas
    for (const orgId of affectedOrgs) {
      await ensureCleaningSafely(orgId);
    }

    summary.runId = await runIdPromise;
    await finalizeRun(admin, summary, stats, startedAt, null);
    return summary;
  } catch (err) {
    summary.errors++;
    summary.runId = await runIdPromise;
    await finalizeRun(admin, summary, stats, startedAt, (err as Error).message);
    return summary;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claim
// ─────────────────────────────────────────────────────────────────────────────

function maybeReprobeClaimV2(mode: "dispatch" | "reconcile" | "manual"): void {
  if (claimRpcState.v2Available) return;
  claimRpcState.runsSinceFallback++;
  if (mode === "reconcile" || claimRpcState.runsSinceFallback >= CLAIM_V2_REPROBE_RUNS) {
    claimRpcState.v2Available = true;
    claimRpcState.runsSinceFallback = 0;
  }
}

/**
 * Reclama conexiones vencidas. Preferimos el RPC v2 (migración 056), que trae
 * la URL del feed desencriptada en la misma respuesta: ahorra un round trip a
 * Vault por conexión (~220 ms × 16k/día). Si el RPC no existe todavía (deploy
 * antes de la migración, o PostgREST recargando el schema cache) caemos al RPC
 * viejo + crm_get_secret por conexión, y lo recordamos a nivel módulo.
 */
async function claimDueLinks(admin: AdminClient): Promise<ClaimedChannelLink[]> {
  if (claimRpcState.v2Available) {
    const { data, error } = await admin.rpc("channels_claim_due_links_v2", {
      p_limit: CLAIM_BATCH,
      p_lease_seconds: CLAIM_LEASE_SECONDS,
    });
    if (!error) return ((data ?? []) as unknown[]).map(unwrapClaimedRow);
    // PGRST202 = "no encuentro la función en el schema cache". También sale si
    // los NOMBRES de los parámetros no coinciden, por eso logueamos el mensaje.
    if (error.code !== "PGRST202") throw new Error(`claim falló: ${error.message}`);
    claimRpcState.v2Available = false;
    claimRpcState.runsSinceFallback = 0;
    console.warn(
      `[channels/dispatch] channels_claim_due_links_v2 no disponible (${error.code}: ${error.message}); fallback al RPC viejo + crm_get_secret por conexión`,
    );
  }

  const { data, error } = await admin.rpc("channels_claim_due_links", {
    p_limit: CLAIM_BATCH,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  });
  if (error) throw new Error(`claim falló: ${error.message}`);
  const links = (data ?? []) as ChannelLinkRow[];
  // los secretos en paralelo: son ≤ CLAIM_BATCH requests independientes
  return Promise.all(
    links.map(async (link) => ({
      ...link,
      feed_url: await getSecret(link.feed_secret_id).catch(() => null),
    })),
  );
}

function unwrapClaimedRow(raw: unknown): ClaimedChannelLink {
  // El RPC devuelve SETOF jsonb: PostgREST entrega cada valor tal cual. Por las
  // dudas, si alguna versión lo envolviera en { channels_claim_due_links_v2: {…} }
  // lo desenvolvemos en vez de romper el claim.
  let row = (raw ?? {}) as Record<string, unknown>;
  const wrapped = row.channels_claim_due_links_v2;
  if (!("id" in row) && wrapped && typeof wrapped === "object") {
    row = wrapped as Record<string, unknown>;
  }
  const feedUrl =
    typeof row.feed_url === "string" && row.feed_url.length > 0 ? row.feed_url : null;
  return { ...(row as unknown as ChannelLinkRow), feed_url: feedUrl };
}

/**
 * Reservas canónicas conocidas de TODAS las conexiones del batch en una sola
 * lectura, repartidas por link_id. Antes era un GET por conexión (16,9k/día).
 * Si la lectura falla, cada link ve `[]` — el mismo comportamiento que tenía
 * cuando fallaba su GET individual (todo parece nuevo → la ingesta lo
 * deduplica; no se propone ninguna desaparición).
 */
async function loadKnownReservations(
  admin: AdminClient,
  linkIds: string[],
): Promise<Map<string, ChannelReservationRow[]>> {
  const byLink = new Map<string, ChannelReservationRow[]>();
  const { data, error } = await admin
    .from("channel_reservations")
    .select("*")
    .in("link_id", linkIds)
    .not("ical_uid", "is", null);
  if (error) {
    console.error("[channels/dispatch] lectura de channel_reservations falló", error.message);
    return byLink;
  }
  for (const row of (data ?? []) as ChannelReservationRow[]) {
    if (!row.link_id) continue;
    const list = byLink.get(row.link_id);
    if (list) list.push(row);
    else byLink.set(row.link_id, [row]);
  }
  return byLink;
}

interface BatchTouches {
  /** reservas que volvieron a aparecer en el feed → limpiar tracking de desaparición */
  reappearedIds: string[];
  /** refresco liviano de last_seen_at (informativo; no participa del diff) */
  staleSeenIds: string[];
}

async function flushBatchTouches(admin: AdminClient, touches: BatchTouches): Promise<void> {
  const now = new Date().toISOString();
  if (touches.reappearedIds.length > 0) {
    await admin
      .from("channel_reservations")
      .update({ missing_since: null, missing_runs: 0, last_seen_at: now })
      .in("id", touches.reappearedIds);
  }
  if (touches.staleSeenIds.length > 0) {
    await admin
      .from("channel_reservations")
      .update({ last_seen_at: now })
      .in("id", touches.staleSeenIds);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync de una conexión
// ─────────────────────────────────────────────────────────────────────────────

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

async function syncLink(
  admin: AdminClient,
  link: ClaimedChannelLink,
  knownPromise: Promise<Map<string, ChannelReservationRow[]>>,
  touches: BatchTouches,
  stats: RunStats,
): Promise<LinkSyncResult> {
  const result: LinkSyncResult = {
    imported: 0,
    updated: 0,
    cancelled: 0,
    proposed: 0,
    conflicts: 0,
    skipped: 0,
  };

  const feedUrl = link.feed_url;
  if (!feedUrl) {
    await markLinkFailure(admin, link, "La conexión no tiene feed configurado", true);
    result.error = "sin feed";
    return result;
  }

  const fetchStart = Date.now();
  const outcome = await fetchIcalFeed({
    feedUrl,
    channel: link.channel,
    etag: link.remote_etag,
    lastModified: link.remote_last_modified,
  }).catch((err) => ({
    status: "http_error" as const,
    error: (err as Error).message?.slice(0, 200),
  }));
  stats.fetchMs.push(Date.now() - fetchStart);

  if (outcome.status === "not_modified") {
    // lectura válida: el feed no cambió. Conservador: no avanza contadores de
    // desaparición (no re-observamos el contenido). Nota: ninguna OTA manda
    // validadores hoy (0 de 70 conexiones con etag), así que esta rama es
    // prácticamente teórica.
    await markLinkSuccess(admin, link, { unchanged: true });
    return result;
  }

  if (outcome.status !== "ok" || !outcome.events) {
    stats.feedErrors++;
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

  // reservas canónicas conocidas de esta conexión (leídas una vez por batch)
  const known = (await knownPromise).get(link.id) ?? [];
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
      // sin proyección local (conflicto/ambigüedad pendiente) → reintentar,
      // pero como mucho una vez por hora (ver UNPROJECTED_RETRY_MS)
      (existing.external_status === "active" &&
        !existing.booking_id &&
        shouldRetryUnprojected(existing));

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

  // reapariciones: limpiar tracking de desaparición (la escritura va por batch)
  const reappeared = known.filter((r) => r.missing_since && seenUids.has(r.ical_uid as string));
  if (reappeared.length > 0) {
    touches.reappearedIds.push(...reappeared.map((r) => r.id));
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
  for (const r of known) {
    if (
      seenUids.has(r.ical_uid as string) &&
      !r.missing_since &&
      (!r.last_seen_at || Date.now() - Date.parse(r.last_seen_at) > 60 * 60 * 1000)
    ) {
      touches.staleSeenIds.push(r.id);
    }
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

function shouldRetryUnprojected(existing: ChannelReservationRow): boolean {
  // Sin unidad no hay nada que proyectar: la destraba una persona (no aplica a
  // iCal, cuya conexión siempre tiene unidad, pero la fila puede venir de email).
  if (!existing.unit_id) return false;
  const updatedAt = Date.parse(existing.updated_at);
  if (Number.isNaN(updatedAt)) return true;
  return Date.now() - updatedAt > UNPROJECTED_RETRY_MS;
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
    // Sólo en la TRANSICIÓN a vacío: el health de la conexión guarda si la
    // lectura anterior ya venía vacía. Insistir en cada lectura era un POST
    // que terminaba en 23505 cada 5 min por conexión (~1,2k/día).
    if (!link.health?.anomalous_empty) {
      await openIssue(admin, {
        organizationId: link.organization_id,
        linkId: link.id,
        issueType: "feed_error",
        severity: "critical",
        title: `El calendario de ${channelLabel(link.channel)} está viniendo vacío`,
        detail: `La última lectura no trajo ningún evento, pero hay ${candidates.length} ${candidates.length === 1 ? "reserva activa" : "reservas activas"} de esta conexión. No tocamos nada: revisá que el enlace del calendario siga siendo válido.`,
        dedupeKey: `empty_feed:${link.id}`,
      });
    }
    return 0;
  }

  // Primero decidimos qué haría cada candidata; las que ya juntaron evidencia
  // suficiente se cruzan con las propuestas pendientes en UNA lectura, para no
  // volver a armar el snapshot (bookings + units + guests + POST que termina en
  // 23505) en cada lectura mientras una persona todavía no decidió.
  const decisions = candidates.map((r) => {
    // "Más allá del horizonte" = el feed no publica tan lejos, así que su
    // silencio no prueba nada. Ojo: el evento MÁS lejano define el horizonte,
    // por lo que al desaparecer siempre cae acá — de ahí la vía lenta.
    const beyondHorizon = feedEmpty || horizon === null || r.check_out! > horizon;
    const runsNeeded = beyondHorizon ? MISSING_RUNS_TO_PROPOSE_WEAK : MISSING_RUNS_TO_PROPOSE;
    const windowNeeded = beyondHorizon ? MISSING_MIN_WINDOW_WEAK_MS : MISSING_MIN_WINDOW_MS;
    const runs = r.missing_runs + 1;
    const missingSince = r.missing_since ?? new Date().toISOString();
    const windowElapsed = Date.now() - Date.parse(missingSince) >= windowNeeded;
    const ready = runs >= runsNeeded && windowElapsed && Boolean(r.missing_since);
    return { r, beyondHorizon, runsNeeded, runs, missingSince, ready };
  });

  const alreadyPending = new Set<string>();
  const readyIds = decisions.filter((d) => d.ready).map((d) => d.r.id);
  if (readyIds.length > 0) {
    const { data: pending } = await admin
      .from("channel_cancellation_requests")
      .select("reservation_id")
      .eq("organization_id", link.organization_id)
      .eq("status", "pending")
      .in("reservation_id", readyIds);
    for (const p of (pending ?? []) as { reservation_id: string | null }[]) {
      if (p.reservation_id) alreadyPending.add(p.reservation_id);
    }
  }

  for (const { r, beyondHorizon, runsNeeded, runs, missingSince, ready } of decisions) {
    if (ready) {
      // La propuesta ya está abierta y esperando: el contador queda congelado
      // y no se escribe nada hasta que una persona decida.
      if (alreadyPending.has(r.id)) continue;

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

  // retención de la auditoría de corridas
  counts.sync_runs_purged = await purgeOldSyncRuns(admin);

  return counts;
}

/**
 * Borra channel_sync_runs más viejas que SYNC_RUNS_RETENTION_DAYS en lotes
 * acotados. PostgREST corre con statement_timeout = 8 s y safeupdate, así que
 * un DELETE masivo se cae; y un `.in('id', 5000 ids)` no entra en una URL. El
 * lote se acota por FECHA: leemos la started_at de la fila N-ésima más vieja y
 * borramos todo lo anterior a ella (usa el índice de started_at).
 *
 * La purga INICIAL (50k+ filas acumuladas) se hace por SQL en la migración 056;
 * esto sólo mantiene la tabla chica de ahí en adelante (también hay un job
 * pg_cron diario que hace lo mismo desde adentro de la base).
 */
async function purgeOldSyncRuns(admin: AdminClient): Promise<number> {
  const cutoff = new Date(Date.now() - SYNC_RUNS_RETENTION_DAYS * 86_400_000).toISOString();
  let purged = 0;
  try {
    for (let batch = 0; batch < SYNC_RUNS_PURGE_MAX_BATCHES; batch++) {
      const { data: edge } = await admin
        .from("channel_sync_runs")
        .select("started_at")
        .lt("started_at", cutoff)
        .order("started_at", { ascending: true })
        .range(SYNC_RUNS_PURGE_BATCH - 1, SYNC_RUNS_PURGE_BATCH - 1)
        .maybeSingle();

      // sin fila N-ésima → queda menos de un lote: borramos hasta el corte y listo
      const upperBound: string = edge?.started_at ?? cutoff;
      const { count, error } = await admin
        .from("channel_sync_runs")
        .delete({ count: "exact" })
        .lte("started_at", upperBound)
        .lt("started_at", cutoff);
      if (error) {
        console.warn("[channels/dispatch] purga de channel_sync_runs falló", error.message);
        break;
      }
      purged += count ?? 0;
      if (!edge || (count ?? 0) === 0) break;
    }
  } catch (err) {
    console.warn("[channels/dispatch] purga de channel_sync_runs falló", (err as Error).message);
  }
  return purged;
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
  summary: DispatchSummary,
  stats: RunStats,
  startedAt: number,
  error: string | null,
): Promise<void> {
  if (!summary.runId) return;
  await admin
    .from("channel_sync_runs")
    .update({
      claimed_count: summary.claimed,
      processed_count: summary.processed,
      results: {
        imported: summary.imported,
        updated: summary.updated,
        cancelled: summary.cancelled,
        proposed: summary.proposed,
        conflicts: summary.conflicts,
        errors: summary.errors,
        housekeeping: summary.housekeeping ?? null,
        // desglose para saber si lo que queda es la OTA o Supabase
        batches: summary.batches,
        released: summary.released,
        feed_errors: stats.feedErrors,
        timeouts: stats.timeouts,
        claim_rpc: stats.claimRpc,
        claim_ms: stats.claimMs,
        fetch_ms: percentiles(stats.fetchMs),
        link_ms: percentiles(stats.linkMs),
      },
      error,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", summary.runId);
}

function percentiles(values: number[]): { n: number; p50: number; p95: number; max: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

/**
 * Procesa `items` con `limit` workers. Un worker no ARRANCA un item nuevo
 * pasado `startDeadline`; los que quedan sin arrancar se devuelven para que el
 * llamador los libere. Se espera a todos los workers antes de volver.
 */
async function withConcurrency<T>(
  items: T[],
  limit: number,
  startDeadline: number,
  fn: (item: T) => Promise<void>,
  onTimeout?: () => void,
): Promise<T[]> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      if (Date.now() > startDeadline) return;
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await withTimeout(fn(item), PER_LINK_HARD_TIMEOUT_MS);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === TIMEOUT_MESSAGE) onTimeout?.();
        console.error("[channels/dispatch] worker error", msg);
      }
    }
  });
  await Promise.all(workers);
  return queue;
}

/**
 * Tope duro por item. El fetch del feed ya se aborta solo a los 10 s
 * (AbortSignal.timeout en safeFetchFeed); esto cubre las escrituras posteriores.
 * No cancela la promesa subyacente: un link que se pasa queda reclamado hasta
 * que venza el lease (120 s) y se reintenta en la próxima corrida.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
