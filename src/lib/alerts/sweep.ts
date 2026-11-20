import { classifyIgnorableEmail } from "@/lib/channels/email-noise";
import { reservationEventFromRow } from "@/lib/channels/event-row";
import { processStoredEvent, withoutDates } from "@/lib/channels/ingest";
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz, ymdInTz } from "@/lib/dates";
import {
  issueResolution,
  notificationDismissReason,
  type IssueFacts,
  type NotificationFacts,
} from "./policy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

/**
 * Barrido diario de avisos: la tercera pregunta de la política ("¿sigue siendo
 * verdad?") aplicada a todo lo abierto, en todas las orgs.
 *
 * Junta los hechos en lote (pocas consultas, sin N+1) y deja que policy.ts
 * decida. Cierra incidencias de Canales con su motivo y archiva notificaciones
 * de la campana (`dismissed_at`: salen de la campana, quedan en el historial).
 * Idempotente: correrlo dos veces no cambia nada la segunda.
 *
 * Lo corre /api/cron/daily-dispatch.
 */
export interface AlertSweepResult {
  dry_run: boolean;
  issues_resolved: number;
  issues_by_reason: Record<string, number>;
  notifications_dismissed: number;
  notifications_by_reason: Record<string, number>;
  /** Por org (sólo en dryRun, para revisar antes de aplicar). */
  by_org?: Record<string, { issues: number; notifications: number }>;
}

interface SweepOptions {
  /** Decide todo pero no escribe ni reprocesa nada. */
  dryRun?: boolean;
  now?: Date;
}

export async function sweepAlerts(
  admin: AdminClient,
  options: SweepOptions = {},
): Promise<AlertSweepResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const today = todayYmdInTz(DEFAULT_ORG_TIMEZONE);
  const byOrg: Record<string, { issues: number; notifications: number }> = {};
  const issues = await sweepChannelIssues(admin, now, today, dryRun, byOrg);
  const notifications = await sweepNotifications(admin, now, today, dryRun, byOrg);
  return {
    dry_run: dryRun,
    ...(dryRun ? { by_org: byOrg } : {}),
    issues_resolved: issues.total,
    issues_by_reason: issues.byReason,
    notifications_dismissed: notifications.total,
    notifications_by_reason: notifications.byReason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Incidencias de Canales
// ─────────────────────────────────────────────────────────────────────────────

interface OpenIssueRow {
  id: string;
  organization_id: string;
  issue_type: string;
  dedupe_key: string | null;
  created_at: string;
  reservation_id: string | null;
  booking_id: string | null;
  link_id: string | null;
  event_id: string | null;
}

async function sweepChannelIssues(
  admin: AdminClient,
  now: Date,
  today: string,
  dryRun: boolean,
  byOrg: Record<string, { issues: number; notifications: number }>,
): Promise<{ total: number; byReason: Record<string, number> }> {
  const issues = await fetchAllPages<OpenIssueRow>((from, to) =>
    admin
      .from("channel_issues")
      .select("id, organization_id, issue_type, dedupe_key, created_at, reservation_id, booking_id, link_id, event_id")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (issues.length === 0) return { total: 0, byReason: {} };

  const keyOf = (i: OpenIssueRow) => i.dedupe_key ?? "";
  const linkIdOf = (i: OpenIssueRow) =>
    i.link_id ?? keyOf(i).match(/^(?:feed|feed_gone|own_feed|stale|empty_feed|export_stale):(.+)$/)?.[1] ?? null;
  const isLinkIssue = (i: OpenIssueRow) =>
    /^(?:feed|feed_gone|own_feed|stale|empty_feed|export_stale):/.test(keyOf(i));

  // Reservas y bookings a los que apuntan.
  const reservations = await loadById(
    admin,
    "channel_reservations",
    "id, check_in, check_out, external_status, is_block, booking_id, channel, created_at",
    issues.map((i) => i.reservation_id),
  );
  const bookings = await loadById(
    admin,
    "bookings",
    "id, status, check_out_date, is_block",
    [
      ...issues.map((i) => i.booking_id),
      ...[...reservations.values()].map((r) => r.booking_id as string | null),
    ],
  );

  // Conexiones (feed caído, sin revisión, vacío) y lo que queda por proteger.
  const linkIds = issues.filter(isLinkIssue).map(linkIdOf);
  const links = await loadById(
    admin,
    "channel_links",
    "id, status, consecutive_failures, last_success_at, last_export_access_at, health",
    linkIds,
  );
  const activeFutureByLink = new Map<string, number>();
  const emptyFeedLinks = issues
    .filter((i) => keyOf(i).startsWith("empty_feed:"))
    .map(linkIdOf)
    .filter((id): id is string => Boolean(id));
  for (const chunk of chunks(unique(emptyFeedLinks))) {
    const rows = await fetchAllPages<{ link_id: string }>((from, to) =>
      admin
        .from("channel_reservations")
        .select("link_id")
        .in("link_id", chunk)
        .eq("external_status", "active")
        // Lo que una persona decidió mantener (o un cierre que ya depende de
        // este calendario) no está esperando nada del calendario de la OTA.
        .is("cancellation_locked_at", null)
        .gte("check_out", today)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      activeFutureByLink.set(r.link_id, (activeFutureByLink.get(r.link_id) ?? 0) + 1);
    }
  }

  // Mails que no se pudieron leer: el asunto vive en su evento.
  const emailEventKeys = issues
    .filter((i) => keyOf(i).startsWith("email_unparsed:"))
    .map((i) => `email:${keyOf(i).slice("email_unparsed:".length)}`);
  const emailEvents = new Map<string, { id: string; subject: string | null; fromDomain: string | null }>();
  for (const chunk of chunks(unique(emailEventKeys))) {
    const { data: rows } = await admin
      .from("channel_events")
      .select("id, organization_id, dedupe_key, payload")
      .eq("transport", "email")
      .in("dedupe_key", chunk);
    for (const r of (rows ?? []) as {
      id: string;
      organization_id: string;
      dedupe_key: string;
      payload: Record<string, unknown> | null;
    }[]) {
      emailEvents.set(`${r.organization_id}|${r.dedupe_key}`, {
        id: r.id,
        subject: typeof r.payload?.subject === "string" ? r.payload.subject : null,
        fromDomain: typeof r.payload?.from_domain === "string" ? r.payload.from_domain : null,
      });
    }
  }

  // "Sin unidad": ¿el código ya está en una reserva con unidad? ¿Y las fechas?
  const unitIssues = issues.filter((i) => keyOf(i).startsWith("unit:"));
  const codesWithUnit = new Set<string>();
  const unitCodes = unitIssues
    .map((i) => keyOf(i).split(":").slice(2).join(":"))
    .filter(Boolean);
  for (const chunk of chunks(unique(unitCodes))) {
    const { data: rows } = await admin
      .from("channel_reservations")
      .select("organization_id, channel, confirmation_code")
      .in("confirmation_code", chunk)
      .not("unit_id", "is", null);
    for (const r of (rows ?? []) as {
      organization_id: string;
      channel: string;
      confirmation_code: string;
    }[]) {
      codesWithUnit.add(`${r.organization_id}|unit:${r.channel}:${r.confirmation_code}`);
    }
  }
  const unitEvents = await loadById(
    admin,
    "channel_events",
    "id, organization_id, dedupe_key, content_hash, transport, event_type, payload",
    unitIssues.map((i) => i.event_id),
  );

  // Decidir.
  const toResolve = new Map<string, string[]>();
  const archivedEmailEvents: { id: string; reason: string }[] = [];
  const replays: { issueId: string; row: Record<string, unknown> }[] = [];
  const opts = { today, now };

  for (const i of issues) {
    const key = keyOf(i);
    const facts: IssueFacts = {};
    const res = i.reservation_id ? reservations.get(i.reservation_id) : undefined;
    const bookingId = i.booking_id ?? (res?.booking_id as string | null | undefined) ?? null;
    const bk = bookingId ? bookings.get(bookingId) : undefined;
    if (res) {
      facts.stayStartYmd = (res.check_in as string | null) ?? null;
      facts.channel = (res.channel as string | null) ?? null;
      facts.reservationSeenYmd = typeof res.created_at === "string" ? res.created_at.slice(0, 10) : null;
      facts.stayEndYmd = (res.check_out as string | null) ?? null;
      facts.reservationStatus = (res.external_status as string | null) ?? null;
      facts.isBlock = Boolean(res.is_block);
    }
    if (bk) {
      facts.stayEndYmd = facts.stayEndYmd ?? ((bk.check_out_date as string | null) ?? null);
      facts.bookingStatus = (bk.status as string | null) ?? null;
      facts.isBlock = facts.isBlock || Boolean(bk.is_block);
    }
    if (isLinkIssue(i)) {
      const linkId = linkIdOf(i);
      const l = linkId ? links.get(linkId) : undefined;
      facts.link = l
        ? {
            status: l.status as string,
            consecutiveFailures: Number(l.consecutive_failures ?? 0),
            lastSuccessAt: (l.last_success_at as string | null) ?? null,
            anomalousEmpty: Boolean((l.health as { anomalous_empty?: boolean } | null)?.anomalous_empty),
            lastExportAccessAt: (l.last_export_access_at as string | null) ?? null,
          }
        : linkId
          ? null
          : undefined;
      if (key.startsWith("empty_feed:") && linkId) {
        facts.linkActiveFutureReservations = activeFutureByLink.get(linkId) ?? 0;
      }
    }
    let emailEvent: { id: string; subject: string | null; fromDomain: string | null } | undefined;
    if (key.startsWith("email_unparsed:")) {
      emailEvent = emailEvents.get(
        `${i.organization_id}|email:${key.slice("email_unparsed:".length)}`,
      );
      if (emailEvent) facts.emailSubject = emailEvent.subject;
    }
    if (key.startsWith("unit:")) {
      facts.codeOnReservationWithUnit = codesWithUnit.has(`${i.organization_id}|${key}`);
      const ev = i.event_id ? unitEvents.get(i.event_id) : undefined;
      const checkOut = (ev?.payload as Record<string, unknown> | undefined)?.check_out;
      if (typeof checkOut === "string") facts.stayEndYmd = checkOut;
    }

    const resolution = issueResolution(i, facts, opts);
    if (!resolution) continue;

    if (key.startsWith("unit:") && facts.codeOnReservationWithUnit && i.event_id) {
      const row = unitEvents.get(i.event_id);
      if (row) replays.push({ issueId: i.id, row });
    }
    if (emailEvent && resolution.startsWith("Se archivó")) {
      archivedEmailEvents.push({
        id: emailEvent.id,
        reason:
          classifyIgnorableEmail(`x@${emailEvent.fromDomain ?? ""}`, emailEvent.subject ?? "") ??
          "no_es_reserva",
      });
    }
    const list = toResolve.get(resolution) ?? [];
    list.push(i.id);
    toResolve.set(resolution, list);
    const org = (byOrg[i.organization_id] ??= { issues: 0, notifications: 0 });
    org.issues++;
  }

  if (dryRun) {
    const byReason: Record<string, number> = {};
    let total = 0;
    for (const [resolution, ids] of toResolve) {
      byReason[resolution] = ids.length;
      total += ids.length;
    }
    return { total, byReason };
  }

  // Antes de cerrar un "sin unidad", que el mail aporte lo suyo (huésped,
  // importe) a la reserva que ya trajo el iCal: lo mismo que hace "Reintentar".
  for (const { row } of replays) {
    const ev = reservationEventFromRow(row as Parameters<typeof reservationEventFromRow>[0]);
    if (!ev || ev.transport !== "email") continue;
    try {
      // Sin fechas (ver withoutDates): el mail puede ser de hace semanas y la
      // estadía haberse modificado después; las fechas las manda el iCal.
      await processStoredEvent(admin, row.id as string, withoutDates(ev));
    } catch (err) {
      console.warn("[alerts/sweep] reproceso de mail falló", row.id, (err as Error).message);
    }
  }

  // Los eventos de los mails archivados quedan procesados, con su motivo.
  for (const { id, reason } of archivedEmailEvents) {
    const { data: ev } = await admin.from("channel_events").select("payload").eq("id", id).maybeSingle();
    await admin
      .from("channel_events")
      .update({
        status: "processed",
        error: null,
        payload: { ...((ev?.payload as Record<string, unknown>) ?? {}), ignored: reason },
      })
      .eq("id", id)
      .eq("status", "needs_review");
  }

  const byReason: Record<string, number> = {};
  let total = 0;
  const nowIso = now.toISOString();
  for (const [resolution, ids] of toResolve) {
    for (const chunk of chunks(ids)) {
      const { data: done, error: updErr } = await admin
        .from("channel_issues")
        .update({ status: "resolved", resolution, resolved_at: nowIso, updated_at: nowIso })
        .in("id", chunk)
        .eq("status", "open")
        .select("id");
      if (updErr) {
        console.warn("[alerts/sweep] no se pudieron cerrar incidencias", updErr.message);
        continue;
      }
      const n = done?.length ?? 0;
      total += n;
      byReason[resolution] = (byReason[resolution] ?? 0) + n;
    }
  }
  return { total, byReason };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notificaciones (campana)
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveNotificationRow {
  id: string;
  organization_id: string;
  type: string;
  severity: string;
  ref_type: string | null;
  ref_id: string | null;
  dedup_key: string | null;
  created_at: string;
  due_at: string | null;
}

async function sweepNotifications(
  admin: AdminClient,
  now: Date,
  today: string,
  dryRun: boolean,
  byOrg: Record<string, { issues: number; notifications: number }>,
): Promise<{ total: number; byReason: Record<string, number> }> {
  const notifications = await fetchAllPages<ActiveNotificationRow>((from, to) =>
    admin
      .from("notifications")
      .select("id, organization_id, type, severity, ref_type, ref_id, dedup_key, created_at, due_at")
      .is("dismissed_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (notifications.length === 0) return { total: 0, byReason: {} };

  const refsOf = (refType: string) =>
    notifications.filter((n) => n.ref_type === refType).map((n) => n.ref_id);
  const suffixOf = (n: ActiveNotificationRow, prefix: string) =>
    n.dedup_key?.startsWith(prefix) ? n.dedup_key.slice(prefix.length) : null;

  const cleaningTasks = await loadById(admin, "cleaning_tasks", "id, status, scheduled_for", refsOf("cleaning_task"));
  const dailyReports = await loadById(admin, "daily_reports", "id, status, report_date", refsOf("daily_report"));
  const bookings = await loadById(
    admin,
    "bookings",
    "id, status, check_in_date",
    notifications.filter((n) => n.type === "inbound_booking_pending" && n.ref_type === "booking").map((n) => n.ref_id),
  );
  const schedules = await loadById(
    admin,
    "booking_payment_schedule",
    "id, status, booking:bookings(status, total_amount, paid_amount)",
    refsOf("booking_payment_schedule"),
  );
  const autoConfirmed = await loadById(
    admin,
    "channel_reservations",
    "id, external_status, check_in",
    notifications
      .filter((n) => n.type === "channel_request_auto_confirmed")
      .map((n) => suffixOf(n, "channel_auto_confirm:")),
  );
  const bookingRequests = await loadById(
    admin,
    "booking_requests",
    "id, status, check_in_date",
    refsOf("booking_request"),
  );
  const requestReservations = await loadById(
    admin,
    "channel_reservations",
    "id, external_status",
    notifications.filter((n) => n.type === "channel_request_pending").map((n) => suffixOf(n, "channel_request:")),
  );

  // Conflictos: la notificación acompaña a una incidencia; vale mientras ésa siga abierta.
  const conflictIds = unique(
    notifications
      .filter((n) => n.type === "inbound_booking_conflict")
      .map((n) => suffixOf(n, "channel_conflict:"))
      .filter((id): id is string => Boolean(id)),
  );
  const openConflicts = new Set<string>();
  for (const chunk of chunks(conflictIds)) {
    const keys = chunk.flatMap((id) => [`conflict:${id}`, `adopt_review:${id}`, `conflict_update:${id}`]);
    const { data: rows } = await admin
      .from("channel_issues")
      .select("dedupe_key")
      .eq("status", "open")
      .in("dedupe_key", keys);
    for (const r of (rows ?? []) as { dedupe_key: string }[]) {
      openConflicts.add(r.dedupe_key.split(":").slice(1).join(":"));
    }
  }

  // Pedidos de confirmación de cancelación: la clave es la reserva externa o el booking.
  const cancelRefs = unique(
    notifications
      .filter((n) => n.type === "channel_cancellation_pending")
      .map((n) => suffixOf(n, "cancel_request:"))
      // Van crudos dentro de un filtro `or=(…)`: sólo UUIDs.
      .filter((id): id is string => typeof id === "string" && UUID.test(id)),
  );
  const pendingCancelRefs = new Set<string>();
  for (const chunk of chunks(cancelRefs)) {
    const list = chunk.join(",");
    const { data: rows } = await admin
      .from("channel_cancellation_requests")
      .select("reservation_id, booking_id")
      .eq("status", "pending")
      .or(`reservation_id.in.(${list}),booking_id.in.(${list})`);
    for (const r of (rows ?? []) as { reservation_id: string | null; booking_id: string | null }[]) {
      if (r.reservation_id) pendingCancelRefs.add(r.reservation_id);
      if (r.booking_id) pendingCancelRefs.add(r.booking_id);
    }
  }

  // Confirmación de reenvío de Gmail: deja de hacer falta cuando el canal quedó verificado.
  const forwardingOrgs = unique(
    notifications.filter((n) => n.dedup_key?.startsWith("gmail_forwarding:")).map((n) => n.organization_id),
  );
  const verifiedOrgs = new Set<string>();
  for (const chunk of chunks(forwardingOrgs)) {
    const { data: rows } = await admin
      .from("channel_settings")
      .select("organization_id, email_verified_at")
      .in("organization_id", chunk)
      .not("email_verified_at", "is", null);
    for (const r of (rows ?? []) as { organization_id: string }[]) verifiedOrgs.add(r.organization_id);
  }

  const opts = { today, now };
  const toDismiss = new Map<string, string[]>();
  for (const n of notifications) {
    const facts: NotificationFacts = {};
    if (n.ref_type === "cleaning_task" && n.ref_id) {
      const t = cleaningTasks.get(n.ref_id);
      facts.cleaningTask = t
        ? {
            status: t.status as string,
            scheduledYmd: ymdInTz(new Date(t.scheduled_for as string), DEFAULT_ORG_TIMEZONE),
          }
        : null;
    }
    if (n.ref_type === "daily_report" && n.ref_id) {
      const r = dailyReports.get(n.ref_id);
      facts.dailyReport = r ? { status: r.status as string, reportYmd: r.report_date as string } : null;
    }
    if (n.type === "inbound_booking_pending" && n.ref_type === "booking" && n.ref_id) {
      const b = bookings.get(n.ref_id);
      facts.booking = b ? { status: b.status as string, checkInYmd: b.check_in_date as string } : null;
    }
    if (n.ref_type === "booking_payment_schedule" && n.ref_id) {
      const s = schedules.get(n.ref_id);
      type Bk = { status?: string; total_amount?: number | string | null; paid_amount?: number | string | null };
      const raw = s?.booking as Bk | Bk[] | null | undefined;
      const booking = Array.isArray(raw) ? raw[0] : raw;
      const total = Number(booking?.total_amount ?? 0);
      const paid = Number(booking?.paid_amount ?? 0);
      facts.paymentSchedule = s
        ? {
            status: s.status as string,
            bookingStatus: booking?.status ?? null,
            bookingPaid: total > 0 && paid >= total,
          }
        : null;
    }
    if (n.type === "channel_request_auto_confirmed") {
      const id = suffixOf(n, "channel_auto_confirm:");
      if (id) {
        const r = autoConfirmed.get(id);
        facts.autoConfirmedReservation = r
          ? { externalStatus: r.external_status as string, checkInYmd: (r.check_in as string | null) ?? null }
          : null;
      }
    }
    if (n.ref_type === "booking_request" && n.ref_id) {
      const r = bookingRequests.get(n.ref_id);
      facts.bookingRequest = r
        ? { status: r.status as string, checkInYmd: (r.check_in_date as string | null) ?? null }
        : null;
    }
    if (n.type === "channel_request_pending") {
      const id = suffixOf(n, "channel_request:");
      if (id) {
        const r = requestReservations.get(id);
        facts.channelReservation = r ? { externalStatus: r.external_status as string } : null;
      }
    }
    if (n.type === "inbound_booking_conflict") {
      const id = suffixOf(n, "channel_conflict:");
      if (id) facts.conflictStillOpen = openConflicts.has(id);
    }
    if (n.type === "channel_cancellation_pending") {
      const ref = suffixOf(n, "cancel_request:");
      if (ref) facts.cancellationRequestPending = pendingCancelRefs.has(ref);
    }
    if (n.dedup_key?.startsWith("gmail_forwarding:")) {
      facts.emailForwardingVerified = verifiedOrgs.has(n.organization_id);
    }

    const reason = notificationDismissReason(n, facts, opts);
    if (!reason) continue;
    const list = toDismiss.get(reason) ?? [];
    list.push(n.id);
    toDismiss.set(reason, list);
    const org = (byOrg[n.organization_id] ??= { issues: 0, notifications: 0 });
    org.notifications++;
  }

  if (dryRun) {
    const byReason: Record<string, number> = {};
    let total = 0;
    for (const [reason, ids] of toDismiss) {
      byReason[reason] = ids.length;
      total += ids.length;
    }
    return { total, byReason };
  }

  const byReason: Record<string, number> = {};
  let total = 0;
  const nowIso = now.toISOString();
  for (const [reason, ids] of toDismiss) {
    for (const chunk of chunks(ids)) {
      const { data: done, error: updErr } = await admin
        .from("notifications")
        .update({ dismissed_at: nowIso })
        .in("id", chunk)
        .is("dismissed_at", null)
        .select("id");
      if (updErr) {
        console.warn("[alerts/sweep] no se pudieron archivar notificaciones", updErr.message);
        continue;
      }
      const count = done?.length ?? 0;
      total += count;
      byReason[reason] = (byReason[reason] ?? 0) + count;
    }
  }
  return { total, byReason };
}

// ─────────────────────────────────────────────────────────────────────────────

async function loadById(
  admin: AdminClient,
  table: string,
  columns: string,
  ids: (string | null | undefined)[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const wanted = unique(ids.filter((id): id is string => typeof id === "string" && UUID.test(id)));
  for (const chunk of chunks(wanted)) {
    const { data, error } = await admin.from(table).select(columns).in("id", chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      out.set(row.id as string, row);
    }
  }
  return out;
}

/**
 * Todas las filas, de a páginas: la API de Supabase corta cada respuesta en
 * 1000 filas aunque se pida más (había 2134 notificaciones activas y el barrido
 * veía las 1000 más viejas).
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Lotes chicos: los ids viajan en la URL del GET de PostgREST. */
function chunks<T>(xs: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
