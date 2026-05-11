"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type {
  ConciergeEvent,
  ConciergeRequest,
  ConciergeStatus,
} from "@/lib/types/database";

const conciergeSchema = z.object({
  unit_id: z.string().uuid().optional().nullable(),
  booking_id: z.string().uuid().optional().nullable(),
  guest_id: z.string().uuid().optional().nullable(),
  request_type: z.string().optional().nullable(),
  description: z.string().min(2, "Descripción requerida"),
  status: z.enum(["pendiente", "en_progreso", "completada", "rechazada", "cancelada"]).default("pendiente"),
  priority: z.enum(["baja", "normal", "alta", "urgente"]).default("normal"),
  assigned_to: z.string().uuid().optional().nullable(),
  cost: z.coerce.number().min(0).optional().nullable(),
  cost_currency: z.string().default("ARS"),
  charge_to_guest: z.boolean().default(false),
  scheduled_for: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Alerta vinculada — se materializa como una row en `notifications` con
  // dedup_key = `task:<id>` para que sea idempotente y se pueda silenciar al
  // completar la tarea.
  alert_enabled: z.boolean().default(false),
  alert_severity: z
    .enum(["info", "warning", "critical"])
    .default("info"),
  /** Horas antes de `scheduled_for` para disparar la alerta (0 = mismo momento). */
  alert_offset_hours: z.coerce.number().int().min(0).max(24 * 14).default(0),
});

export type ConciergeInput = z.infer<typeof conciergeSchema>;

const REVALIDATE_PATHS = [
  "/dashboard/tareas",
  "/dashboard/conserjeria",
  "/dashboard/alertas",
  "/m/tareas",
  "/m/conserjeria",
];

function revalidateAll() {
  for (const p of REVALIDATE_PATHS) revalidatePath(p);
  revalidatePath("/", "layout"); // refresca campanita de notificaciones
}

/**
 * Crea o actualiza la notificación asociada a una tarea (idempotente vía dedup_key).
 * Si la tarea no tiene `scheduled_for` o `alert_enabled = false`, descarta la
 * notificación existente (si la había).
 */
async function syncTaskNotification(params: {
  taskId: string;
  organizationId: string;
  description: string;
  unitCode: string | null;
  scheduledFor: string | null;
  assignedTo: string | null;
  alertEnabled: boolean;
  alertSeverity: "info" | "warning" | "critical";
  alertOffsetHours: number;
  createdBy: string;
}): Promise<void> {
  const admin = createAdminClient();
  const dedupKey = `task:${params.taskId}`;

  // Si la alerta no aplica → dismiss y salir.
  if (!params.alertEnabled || !params.scheduledFor) {
    await admin
      .from("notifications")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("organization_id", params.organizationId)
      .eq("dedup_key", dedupKey)
      .is("dismissed_at", null);
    return;
  }

  const dueAt = new Date(params.scheduledFor);
  if (params.alertOffsetHours > 0) {
    dueAt.setHours(dueAt.getHours() - params.alertOffsetHours);
  }
  const dueAtISO = dueAt.toISOString();

  const titleUnit = params.unitCode ? `[${params.unitCode}] ` : "";
  const truncated =
    params.description.length > 80
      ? params.description.slice(0, 77) + "…"
      : params.description;
  const title = `${titleUnit}Tarea: ${truncated}`;
  const scheduledLocal = new Date(params.scheduledFor).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const offsetCopy =
    params.alertOffsetHours === 0
      ? "Recordatorio para el momento programado"
      : params.alertOffsetHours < 24
        ? `Recordatorio ${params.alertOffsetHours} h antes`
        : `Recordatorio ${Math.round(params.alertOffsetHours / 24)} día(s) antes`;
  const body = `${offsetCopy} · Programada para ${scheduledLocal}`;

  // Buscar existente
  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("dedup_key", dedupKey)
    .maybeSingle();

  const payload = {
    type: "task_reminder" as const,
    severity: params.alertSeverity,
    title,
    body,
    ref_type: "concierge_request",
    ref_id: params.taskId,
    action_url: `/dashboard/tareas?open=${params.taskId}`,
    due_at: dueAtISO,
    target_user_id: params.assignedTo,
  };

  if (existing) {
    await admin
      .from("notifications")
      .update({ ...payload, dismissed_at: null, read_at: null })
      .eq("id", existing.id);
  } else {
    await admin.from("notifications").insert({
      ...payload,
      organization_id: params.organizationId,
      dedup_key: dedupKey,
      created_by: params.createdBy,
    });
  }
}

async function dismissTaskNotification(
  taskId: string,
  organizationId: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("dedup_key", `task:${taskId}`)
    .is("dismissed_at", null);
}

export async function listAssignableMembers(): Promise<{ user_id: string; full_name: string | null }[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: members, error } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organization.id)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const ids = (members ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in("user_id", ids);
  const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  return ids
    .map((id) => byId.get(id) ?? { user_id: id, full_name: null })
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
}

export async function listConciergeRequests(filters?: {
  status?: ConciergeStatus;
  /** Si es `true`, devuelve sólo las tareas ya archivadas por el reset semanal. Default: sólo activas. */
  showArchived?: boolean;
}) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("concierge_requests")
    .select(`*, unit:units(id, code, name), guest:guests(id, full_name)`)
    .eq("organization_id", organization.id);
  if (filters?.showArchived) {
    q = q.not("archived_at", "is", null);
  } else {
    q = q.is("archived_at", null);
  }
  if (filters?.status) q = q.eq("status", filters.status);
  const { data, error } = filters?.showArchived
    ? await q.order("archived_at", { ascending: false })
    : await q.order("scheduled_for", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  // Adjuntar asignados (user_profiles) sin N+1
  const assignedIds = Array.from(
    new Set((data ?? []).map((r) => r.assigned_to).filter(Boolean) as string[])
  );
  let assigneesByUserId = new Map<string, { user_id: string; full_name: string | null }>();
  if (assignedIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", assignedIds);
    assigneesByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  }
  // Set de tareas con alerta activa — usado para mostrar badge en cards.
  const taskIds = (data ?? []).map((r) => r.id);
  let alertSet = new Set<string>();
  if (taskIds.length > 0) {
    const dedupKeys = taskIds.map((id) => `task:${id}`);
    const { data: alerts } = await admin
      .from("notifications")
      .select("dedup_key")
      .eq("organization_id", organization.id)
      .in("dedup_key", dedupKeys)
      .is("dismissed_at", null);
    alertSet = new Set(
      (alerts ?? []).map((a) => (a.dedup_key as string).replace(/^task:/, ""))
    );
  }
  return (data ?? []).map((r) => ({
    ...r,
    assignee: r.assigned_to ? assigneesByUserId.get(r.assigned_to) ?? null : null,
    has_alert: alertSet.has(r.id),
  }));
}

export async function createConciergeRequest(input: ConciergeInput) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = conciergeSchema.parse(input);
  const {
    alert_enabled,
    alert_severity,
    alert_offset_hours,
    ...persistable
  } = validated;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("concierge_requests")
    .insert({
      ...persistable,
      organization_id: organization.id,
      created_by: session.userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Generar alerta vinculada (idempotente). Resolvemos unit_code para mostrarlo
  // en el título — barato porque ya tenemos unit_id.
  let unitCode: string | null = null;
  if (persistable.unit_id) {
    const { data: u } = await admin
      .from("units")
      .select("code")
      .eq("id", persistable.unit_id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    unitCode = u?.code ?? null;
  }
  await syncTaskNotification({
    taskId: data.id,
    organizationId: organization.id,
    description: persistable.description,
    unitCode,
    scheduledFor: persistable.scheduled_for ?? null,
    assignedTo: persistable.assigned_to ?? null,
    alertEnabled: alert_enabled,
    alertSeverity: alert_severity,
    alertOffsetHours: alert_offset_hours,
    createdBy: session.userId,
  });

  await admin.from("concierge_events").insert({
    concierge_request_id: data.id,
    organization_id: organization.id,
    actor_id: session.userId,
    event_type: "created",
    to_status: persistable.status,
    metadata: { priority: persistable.priority, alert_enabled },
  });

  revalidateAll();
  return data as ConciergeRequest;
}

export async function changeConciergeStatus(id: string, status: ConciergeStatus) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: prev } = await admin
    .from("concierge_requests")
    .select("status")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  const update: Record<string, unknown> = { status };
  if (status === "completada") update.completed_at = new Date().toISOString();
  const { error } = await admin
    .from("concierge_requests")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  if (prev && prev.status !== status) {
    await admin.from("concierge_events").insert({
      concierge_request_id: id,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "status_changed",
      from_status: prev.status,
      to_status: status,
      metadata: { source: "kanban_or_chip" },
    });
  }

  // Cuando la tarea cierra (completada/cancelada/rechazada), silenciamos la alerta.
  if (
    status === "completada" ||
    status === "cancelada" ||
    status === "rechazada"
  ) {
    await dismissTaskNotification(id, organization.id);
  }
  revalidateAll();
}

export async function updateConciergeRequest(id: string, input: Partial<ConciergeInput>) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const {
    alert_enabled,
    alert_severity,
    alert_offset_hours,
    ...persistable
  } = input;

  const { data: prev } = await admin
    .from("concierge_requests")
    .select("status")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  const { data, error } = await admin
    .from("concierge_requests")
    .update(persistable)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  const newStatus = persistable.status;
  if (prev && newStatus && prev.status !== newStatus) {
    await admin.from("concierge_events").insert({
      concierge_request_id: id,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "status_changed",
      from_status: prev.status,
      to_status: newStatus,
      metadata: { source: "edit_form" },
    });
  } else {
    await admin.from("concierge_events").insert({
      concierge_request_id: id,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "updated",
      metadata: { source: "edit_form" },
    });
  }

  // Re-sincronizar alerta sólo si el caller tocó alguno de los campos
  // relevantes (alert_*, scheduled_for, description, unit_id, assigned_to).
  const touchedAlert =
    alert_enabled !== undefined ||
    alert_severity !== undefined ||
    alert_offset_hours !== undefined ||
    persistable.scheduled_for !== undefined ||
    persistable.description !== undefined ||
    persistable.unit_id !== undefined ||
    persistable.assigned_to !== undefined;
  if (touchedAlert) {
    let unitCode: string | null = null;
    if (data.unit_id) {
      const { data: u } = await admin
        .from("units")
        .select("code")
        .eq("id", data.unit_id)
        .eq("organization_id", organization.id)
        .maybeSingle();
      unitCode = u?.code ?? null;
    }
    await syncTaskNotification({
      taskId: id,
      organizationId: organization.id,
      description: data.description,
      unitCode,
      scheduledFor: data.scheduled_for ?? null,
      assignedTo: data.assigned_to ?? null,
      alertEnabled: alert_enabled ?? false,
      alertSeverity: alert_severity ?? "info",
      alertOffsetHours: alert_offset_hours ?? 0,
      createdBy: session.userId,
    });
  }

  revalidateAll();
  return data as ConciergeRequest;
}

export async function deleteConciergeRequest(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("concierge_requests")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  await dismissTaskNotification(id, organization.id);
  revalidateAll();
}

/**
 * Lee el estado actual de la alerta asociada a una tarea (si existe).
 * Útil para hidratar el form de edición con los valores actuales del switch.
 */
export async function getTaskAlertSnapshot(taskId: string): Promise<{
  enabled: boolean;
  severity: "info" | "warning" | "critical";
  offsetHours: number;
} | null> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: notif } = await admin
    .from("notifications")
    .select("severity, due_at")
    .eq("organization_id", organization.id)
    .eq("dedup_key", `task:${taskId}`)
    .is("dismissed_at", null)
    .maybeSingle();
  if (!notif) return null;
  const { data: task } = await admin
    .from("concierge_requests")
    .select("scheduled_for")
    .eq("id", taskId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  let offsetHours = 0;
  if (task?.scheduled_for && notif.due_at) {
    const diffMs =
      new Date(task.scheduled_for).getTime() - new Date(notif.due_at).getTime();
    offsetHours = Math.max(0, Math.round(diffMs / 3_600_000));
  }
  const sev =
    notif.severity === "warning" || notif.severity === "critical"
      ? notif.severity
      : "info";
  return { enabled: true, severity: sev, offsetHours };
}

export async function listConciergeEvents(requestId: string): Promise<
  (ConciergeEvent & { actor: { full_name: string | null } | null })[]
> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("concierge_events")
    .select("*")
    .eq("concierge_request_id", requestId)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const events = (data ?? []) as ConciergeEvent[];

  const actorIds = Array.from(
    new Set(events.map((e) => e.actor_id).filter((v): v is string => !!v))
  );
  let byId = new Map<string, { full_name: string | null }>();
  if (actorIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", actorIds);
    byId = new Map(
      (profiles ?? []).map((p) => [
        p.user_id as string,
        { full_name: (p.full_name as string | null) ?? null },
      ])
    );
  }

  return events.map((e) => ({
    ...e,
    actor: e.actor_id ? byId.get(e.actor_id) ?? { full_name: null } : null,
  }));
}
