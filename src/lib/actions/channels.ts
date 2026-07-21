"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import { createSecret, getSecret, updateSecret } from "@/lib/crm/encryption";
import { assertSafeFeedUrl, safeFetchFeed, BlockedUrlError } from "@/lib/channels/ssrf";
import { parseIcs } from "@/lib/channels/ical-adapter";
import { runChannelDispatch } from "@/lib/channels/dispatch";
import { computeLinkHealth } from "@/lib/channels/health";
import { processStoredEvent, reprojectReservation } from "@/lib/channels/ingest";
import { reservationEventFromRow } from "@/lib/channels/dispatch";
import { sha256Hex } from "@/lib/channels/token";
import type {
  ChannelIssueRow,
  ChannelLinkHealth,
  ChannelLinkRow,
  ChannelReservationRow,
} from "@/lib/channels/types";

/**
 * Server actions de Canales de venta. Todas:
 *   requireSession() + getCurrentOrg() + can(role,'channels') + filtro por org.
 */

const CANALES_PATHS = ["/dashboard/canales", "/dashboard/reservas", "/dashboard/unidades/kanban"];

function revalidateCanales() {
  for (const p of CANALES_PATHS) revalidatePath(p);
}

async function requireChannelsAccess(action: "view" | "update" = "view") {
  await requireSession();
  const ctx = await getCurrentOrg();
  if (!can(ctx.role, "channels", action === "view" ? "view" : "update")) {
    throw new Error("No tenés permisos para administrar Canales de venta");
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────

export interface ChannelLinkOverview extends ChannelLinkRow {
  unit: { id: string; code: string; name: string };
  health_state: ChannelLinkHealth;
  open_issues: number;
  critical_issues: number;
}

export interface ChannelsOverview {
  links: ChannelLinkOverview[];
  issues: (ChannelIssueRow & {
    unit: { id: string; code: string; name: string } | null;
  })[];
  settings: {
    email_ingest_enabled: boolean;
    email_verified_at: string | null;
    last_email_at: string | null;
  } | null;
  emailAddress: string | null;
  awaitingData: number;
  units: { id: string; code: string; name: string }[];
}

export async function getChannelsOverview(): Promise<ChannelsOverview> {
  const { organization } = await requireChannelsAccess("view");
  const admin = createAdminClient();

  const [linksRes, issuesRes, settingsRes, orgRes, unitsRes, awaitingRes] = await Promise.all([
    admin
      .from("channel_links")
      .select("*, unit:units(id, code, name)")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: true }),
    admin
      .from("channel_issues")
      .select("*, link:channel_links(unit:units(id, code, name))")
      .eq("organization_id", organization.id)
      .eq("status", "open")
      .order("severity", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("channel_settings")
      .select("email_ingest_enabled, email_verified_at, last_email_at")
      .eq("organization_id", organization.id)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("inbound_email_token")
      .eq("id", organization.id)
      .single(),
    admin
      .from("units")
      .select("id, code, name")
      .eq("organization_id", organization.id)
      .eq("active", true)
      .order("code"),
    admin
      .from("channel_reservations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("external_status", "active")
      .not("booking_id", "is", null)
      .eq("guest", "{}"),
  ]);

  const rawLinks = (linksRes.data ?? []) as (ChannelLinkRow & {
    unit: { id: string; code: string; name: string };
  })[];
  const issues = (issuesRes.data ?? []).map(
    (i: ChannelIssueRow & { link: { unit: { id: string; code: string; name: string } } | null }) => ({
      ...i,
      unit: i.link?.unit ?? null,
    }),
  );

  const issuesByLink = new Map<string, { open: number; critical: number }>();
  for (const i of issues) {
    if (!i.link_id) continue;
    const cur = issuesByLink.get(i.link_id) ?? { open: 0, critical: 0 };
    cur.open++;
    if (i.severity === "critical") cur.critical++;
    issuesByLink.set(i.link_id, cur);
  }

  const links: ChannelLinkOverview[] = rawLinks.map((l) => {
    const iss = issuesByLink.get(l.id) ?? { open: 0, critical: 0 };
    return {
      ...l,
      health_state: computeLinkHealth(l, { hasCriticalIssue: iss.critical > 0 }),
      open_issues: iss.open,
      critical_issues: iss.critical,
    };
  });

  const domain = (process.env.INBOUND_EMAIL_DOMAIN ?? "").trim();
  const token = orgRes.data?.inbound_email_token as string | undefined;
  const emailAddress = domain && token ? `ota-${token}@${domain}` : null;

  return {
    links,
    issues,
    settings: settingsRes.data ?? null,
    emailAddress,
    awaitingData: awaitingRes.count ?? 0,
    units: unitsRes.data ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Asistente de conexión (persistente: los drafts viven en channel_links)
// ─────────────────────────────────────────────────────────────────────────────

const createDraftSchema = z.object({
  channel: z.enum(["airbnb", "booking"]),
  unit_ids: z.array(z.string().uuid()).min(1).max(60),
});

export async function createDraftLinks(input: z.infer<typeof createDraftSchema>) {
  const { organization } = await requireChannelsAccess("update");
  const validated = createDraftSchema.parse(input);
  const admin = createAdminClient();

  // unidades de la org (valida pertenencia) + token de export existente
  const { data: units, error: unitsErr } = await admin
    .from("units")
    .select("id, code, ical_export_token")
    .eq("organization_id", organization.id)
    .in("id", validated.unit_ids);
  if (unitsErr) throw new Error(unitsErr.message);
  if (!units || units.length !== validated.unit_ids.length) {
    throw new Error("Alguna unidad no pertenece a esta organización");
  }

  const { data: existing } = await admin
    .from("channel_links")
    .select("id, unit_id")
    .eq("organization_id", organization.id)
    .eq("channel", validated.channel)
    .in("unit_id", validated.unit_ids);
  const existingByUnit = new Set((existing ?? []).map((l) => l.unit_id as string));

  const created: string[] = [];
  for (const u of units) {
    if (existingByUnit.has(u.id)) continue;
    // reusa el token per-unit para que la URL legacy siga siendo válida
    const token = u.ical_export_token as string;
    const { data: link, error } = await admin
      .from("channel_links")
      .insert({
        organization_id: organization.id,
        unit_id: u.id,
        channel: validated.channel,
        status: "draft",
        export_token_hash: sha256Hex(token),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // el nombre del secreto usa el id del link (único por fila): recrear una
    // conexión borrada no colisiona en Vault
    const secretId = await createSecret(`channels_v2_export_link_${link.id}`, token);
    await admin.from("channel_links").update({ export_secret_id: secretId }).eq("id", link.id);
    created.push(link.id);
  }

  revalidateCanales();
  return { created: created.length, skipped: existingByUnit.size };
}

const feedSchema = z.object({
  link_id: z.string().uuid(),
  feed_url: z.string().url("URL inválida").max(2000),
});

/** Carga/actualiza el calendario ENTRANTE de una conexión (URL → Vault). */
export async function saveLinkFeed(input: z.infer<typeof feedSchema>) {
  const { organization } = await requireChannelsAccess("update");
  const validated = feedSchema.parse(input);
  const admin = createAdminClient();

  const link = await getOwnLink(admin, organization.id, validated.link_id);

  // Validación SSRF + fetch de prueba + parseo real antes de guardar
  try {
    await assertSafeFeedUrl(validated.feed_url);
  } catch (err) {
    throw new Error(
      err instanceof BlockedUrlError ? `Enlace rechazado: ${err.message}` : "Enlace inválido",
    );
  }
  let eventCount = 0;
  try {
    const res = await safeFetchFeed(validated.feed_url, { timeoutMs: 10_000 });
    if (res.status !== 200 || res.body === undefined) {
      throw new Error(`el calendario respondió HTTP ${res.status}`);
    }
    eventCount = parseIcs(res.body, link.channel).length;
  } catch (err) {
    const msg = err instanceof Error ? err.message.replace(/https?:\/\/\S+/gi, "[url]") : "error";
    throw new Error(`No se pudo leer el calendario: ${msg}`);
  }

  if (link.feed_secret_id) {
    await updateSecret(link.feed_secret_id, validated.feed_url);
  } else {
    const secretId = await createSecret(`channels_v2_feed_link_${link.id}`, validated.feed_url);
    await admin.from("channel_links").update({ feed_secret_id: secretId }).eq("id", link.id);
  }

  revalidateCanales();
  return { ok: true, events: eventCount };
}

/** Activa una conexión y dispara su primera sincronización inmediata. */
export async function activateLink(linkId: string) {
  const { organization } = await requireChannelsAccess("update");
  const admin = createAdminClient();
  const link = await getOwnLink(admin, organization.id, linkId);
  if (!link.feed_secret_id) {
    throw new Error("Cargá primero el calendario entrante de la OTA");
  }

  const { error } = await admin
    .from("channel_links")
    .update({ status: "active", next_poll_at: new Date().toISOString(), consecutive_failures: 0 })
    .eq("id", link.id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  // primera sincronización ya mismo (no espera al cron)
  await runChannelDispatch(admin, "manual", {
    organizationId: organization.id,
    linkIds: [link.id],
  });

  revalidateCanales();
  return { ok: true };
}

export async function pauseLink(linkId: string) {
  const { organization } = await requireChannelsAccess("update");
  const admin = createAdminClient();
  await getOwnLink(admin, organization.id, linkId);
  const { error } = await admin
    .from("channel_links")
    .update({ status: "paused" })
    .eq("id", linkId)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidateCanales();
}

export async function resumeLink(linkId: string) {
  const { organization } = await requireChannelsAccess("update");
  const admin = createAdminClient();
  const link = await getOwnLink(admin, organization.id, linkId);
  if (link.status !== "paused") throw new Error("La conexión no está pausada");
  const { error } = await admin
    .from("channel_links")
    .update({ status: "active", next_poll_at: new Date().toISOString(), consecutive_failures: 0 })
    .eq("id", linkId)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidateCanales();
}

export async function deleteLink(linkId: string) {
  const { organization } = await requireChannelsAccess("update");
  const admin = createAdminClient();
  const link = await getOwnLink(admin, organization.id, linkId);
  if (link.status === "active") {
    throw new Error("Pausá la conexión antes de eliminarla");
  }
  const { error } = await admin
    .from("channel_links")
    .delete()
    .eq("id", linkId)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidateCanales();
}

/** URL del calendario SALIENTE para pegar en la OTA (token desde Vault). */
export async function getLinkExportUrl(linkId: string): Promise<string> {
  const { organization } = await requireChannelsAccess("view");
  const admin = createAdminClient();
  const link = await getOwnLink(admin, organization.id, linkId);
  const token = await getSecret(link.export_secret_id);
  if (!token) throw new Error("La conexión no tiene token de exportación");
  const base = await resolveAppBaseUrl();
  return `${base}/api/channels/ical/${link.id}.ics?token=${token}`;
}

/** Sincronizar ahora (una conexión o todas las de la org). */
export async function syncChannelsNow(linkId?: string) {
  const { organization } = await requireChannelsAccess("update");
  const admin = createAdminClient();
  if (linkId) await getOwnLink(admin, organization.id, linkId);
  const summary = await runChannelDispatch(admin, "manual", {
    organizationId: organization.id,
    linkIds: linkId ? [linkId] : undefined,
  });
  revalidateCanales();
  revalidatePath("/dashboard/limpieza");
  return {
    processed: summary.processed,
    imported: summary.imported,
    updated: summary.updated,
    cancelled: summary.cancelled,
    conflicts: summary.conflicts,
    errors: summary.errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Incidencias
// ─────────────────────────────────────────────────────────────────────────────

const resolveIssueSchema = z.object({
  issue_id: z.string().uuid(),
  action: z.enum(["dismiss", "retry", "assign_unit", "resolve"]),
  reason: z.string().max(500).optional(),
  unit_id: z.string().uuid().optional(),
});

export async function resolveChannelIssue(input: z.infer<typeof resolveIssueSchema>) {
  const { organization } = await requireChannelsAccess("update");
  const session = await requireSession();
  const validated = resolveIssueSchema.parse(input);
  const admin = createAdminClient();

  const { data: issue, error: issueErr } = await admin
    .from("channel_issues")
    .select("*")
    .eq("id", validated.issue_id)
    .eq("organization_id", organization.id)
    .single();
  if (issueErr || !issue) throw new Error("Incidencia no encontrada");
  if (issue.status !== "open") return { ok: true, already: true };

  if (validated.action === "dismiss") {
    await admin
      .from("channel_issues")
      .update({
        status: "dismissed",
        resolution: validated.reason ?? "Descartada por el operador",
        resolved_by: session.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", issue.id);
    revalidateCanales();
    return { ok: true };
  }

  if (validated.action === "resolve") {
    await admin
      .from("channel_issues")
      .update({
        status: "resolved",
        resolution: validated.reason ?? "Resuelta por el operador",
        resolved_by: session.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", issue.id);
    revalidateCanales();
    return { ok: true };
  }

  if (validated.action === "assign_unit") {
    if (!validated.unit_id) throw new Error("Elegí una unidad");
    if (!issue.reservation_id) throw new Error("La incidencia no tiene reserva asociada");
    // la unidad debe ser de la org
    const { data: unit } = await admin
      .from("units")
      .select("id")
      .eq("id", validated.unit_id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (!unit) throw new Error("Unidad inválida");

    await admin
      .from("channel_reservations")
      .update({ unit_id: validated.unit_id })
      .eq("id", issue.reservation_id)
      .eq("organization_id", organization.id);

    const result = await reprojectReservation(admin, issue.reservation_id);
    if (result.outcome === "created" || result.outcome === "updated" || result.outcome === "duplicate") {
      await admin
        .from("channel_issues")
        .update({
          status: "resolved",
          resolution: "Unidad asignada por el operador",
          resolved_by: session.userId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", issue.id);
    }
    revalidateCanales();
    return { ok: true, outcome: result.outcome, bookingId: result.bookingId };
  }

  // retry: reprocesar el evento original (o re-proyectar la reserva)
  if (issue.event_id) {
    const { data: evRow } = await admin
      .from("channel_events")
      .select("*")
      .eq("id", issue.event_id)
      .maybeSingle();
    if (evRow) {
      const ev = reservationEventFromRow(evRow);
      if (ev) {
        const result = await processStoredEvent(admin, evRow.id, ev);
        if (result.outcome !== "error" && result.outcome !== "needs_review" && result.outcome !== "conflict") {
          await admin
            .from("channel_issues")
            .update({
              status: "resolved",
              resolution: "Reintento exitoso",
              resolved_by: session.userId,
              resolved_at: new Date().toISOString(),
            })
            .eq("id", issue.id);
        }
        revalidateCanales();
        return { ok: true, outcome: result.outcome };
      }
    }
  }
  if (issue.reservation_id) {
    const result = await reprojectReservation(admin, issue.reservation_id);
    if (result.outcome === "created" || result.outcome === "updated") {
      await admin
        .from("channel_issues")
        .update({
          status: "resolved",
          resolution: "Reintento exitoso",
          resolved_by: session.userId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", issue.id);
    }
    revalidateCanales();
    return { ok: true, outcome: result.outcome };
  }
  if (issue.link_id) {
    // reintento de conexión: forzar un sync de ese link
    await runChannelDispatch(admin, "manual", {
      organizationId: organization.id,
      linkIds: [issue.link_id],
    });
    revalidateCanales();
    return { ok: true, outcome: "retried" };
  }
  return { ok: false, error: "Nada que reintentar" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Detalle de conexión + email
// ─────────────────────────────────────────────────────────────────────────────

export interface LinkDetail {
  link: ChannelLinkRow & { unit: { id: string; code: string; name: string } };
  health_state: ChannelLinkHealth;
  reservations: ChannelReservationRow[];
  issues: ChannelIssueRow[];
  hasFeed: boolean;
}

export async function getLinkDetail(linkId: string): Promise<LinkDetail> {
  const { organization } = await requireChannelsAccess("view");
  const admin = createAdminClient();

  const { data: link, error } = await admin
    .from("channel_links")
    .select("*, unit:units(id, code, name)")
    .eq("id", linkId)
    .eq("organization_id", organization.id)
    .single();
  if (error || !link) throw new Error("Conexión no encontrada");

  const [reservationsRes, issuesRes] = await Promise.all([
    admin
      .from("channel_reservations")
      .select("*")
      .eq("link_id", linkId)
      .eq("organization_id", organization.id)
      .order("check_in", { ascending: false })
      .limit(30),
    admin
      .from("channel_issues")
      .select("*")
      .eq("link_id", linkId)
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const openCritical = (issuesRes.data ?? []).some(
    (i: ChannelIssueRow) => i.status === "open" && i.severity === "critical",
  );

  return {
    link: link as LinkDetail["link"],
    health_state: computeLinkHealth(link, { hasCriticalIssue: openCritical }),
    reservations: (reservationsRes.data ?? []) as ChannelReservationRow[],
    issues: (issuesRes.data ?? []) as ChannelIssueRow[],
    hasFeed: Boolean(link.feed_secret_id),
  };
}

/** Config de email por organización (se hace UNA vez, después solo estado). */
export async function toggleEmailIngest(enabled: boolean) {
  const { organization } = await requireChannelsAccess("update");
  const admin = createAdminClient();
  const { error } = await admin
    .from("channel_settings")
    .upsert(
      { organization_id: organization.id, email_ingest_enabled: enabled },
      { onConflict: "organization_id" },
    );
  if (error) throw new Error(error.message);
  revalidateCanales();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getOwnLink(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  linkId: string,
): Promise<ChannelLinkRow> {
  const { data, error } = await admin
    .from("channel_links")
    .select("*")
    .eq("id", linkId)
    .eq("organization_id", orgId)
    .single();
  if (error || !data) throw new Error("Conexión no encontrada");
  return data as ChannelLinkRow;
}

async function resolveAppBaseUrl(): Promise<string> {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (envBase) return envBase;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) return "";
  return `${proto}://${host}`;
}
