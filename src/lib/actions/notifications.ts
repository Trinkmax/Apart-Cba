"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type {
  Notification,
  NotificationSeverity,
  NotificationType,
} from "@/lib/types/database";

// ════════════════════════════════════════════════════════════════════════════
// Listar notificaciones (con filtro por estado).
// ════════════════════════════════════════════════════════════════════════════
export type NotificationFilter = "active" | "unread" | "dismissed" | "all";

export async function listNotifications(
  filter: NotificationFilter = "active",
  limit = 50
): Promise<Notification[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("notifications")
    .select("*")
    .eq("organization_id", organization.id);
  if (filter === "active") q = q.is("dismissed_at", null);
  if (filter === "unread")
    q = q.is("dismissed_at", null).is("read_at", null);
  if (filter === "dismissed") q = q.not("dismissed_at", "is", null);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as Notification[]) ?? [];
}

export async function getUnreadCount(): Promise<number> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", organization.id)
    .is("read_at", null)
    .is("dismissed_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ════════════════════════════════════════════════════════════════════════════
// Marcar como leída/dismiss.
// ════════════════════════════════════════════════════════════════════════════
export async function markNotificationAsRead(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .is("read_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/alertas");
  revalidatePath("/", "layout");
}

export async function markAllNotificationsAsRead(): Promise<number> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const nowISO = new Date().toISOString();
  const { data, error } = await admin
    .from("notifications")
    .update({ read_at: nowISO })
    .eq("organization_id", organization.id)
    .is("read_at", null)
    .is("dismissed_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/alertas");
  revalidatePath("/", "layout");
  return data?.length ?? 0;
}

export async function dismissNotification(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/alertas");
  revalidatePath("/", "layout");
}

export async function dismissAllNotifications(): Promise<number> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const nowISO = new Date().toISOString();
  const { data, error } = await admin
    .from("notifications")
    .update({ dismissed_at: nowISO })
    .eq("organization_id", organization.id)
    .is("dismissed_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/alertas");
  revalidatePath("/", "layout");
  return data?.length ?? 0;
}

// ════════════════════════════════════════════════════════════════════════════
// Crear notificación manual.
// ════════════════════════════════════════════════════════════════════════════
const createSchema = z.object({
  type: z.enum([
    "payment_due",
    "payment_overdue",
    "payment_received",
    "lease_ending_soon",
    "lease_split_created",
    "manual",
    "other",
  ]),
  severity: z.enum(["info", "warning", "critical", "success"]).default("info"),
  title: z.string().min(1, "Título requerido").max(200),
  body: z.string().max(1000).optional().nullable(),
  ref_type: z.string().max(64).optional().nullable(),
  ref_id: z.string().uuid().optional().nullable(),
  action_url: z.string().max(500).optional().nullable(),
  due_at: z.string().optional().nullable(),
  target_user_id: z.string().uuid().optional().nullable(),
  target_role: z
    .enum(["admin", "recepcion", "mantenimiento", "limpieza", "owner_view"])
    .optional()
    .nullable(),
  dedup_key: z.string().max(200).optional().nullable(),
});

export type CreateNotificationInput = z.infer<typeof createSchema>;

export async function createNotification(
  input: CreateNotificationInput
): Promise<Notification> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = createSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .insert({
      ...validated,
      organization_id: organization.id,
      created_by: session.userId,
    })
    .select()
    .single();
  if (error) {
    // Si choca con dedup_key, no es un error real — la notificación ya existe.
    if (error.code === "23505") {
      const { data: existing } = await admin
        .from("notifications")
        .select("*")
        .eq("organization_id", organization.id)
        .eq("dedup_key", validated.dedup_key!)
        .maybeSingle();
      if (existing) return existing as Notification;
    }
    throw new Error(error.message);
  }
  revalidatePath("/dashboard/alertas");
  revalidatePath("/", "layout");
  return data as Notification;
}

// ════════════════════════════════════════════════════════════════════════════
// Generador de recordatorios de cobro (invocado por el cron).
// Crea notificaciones para cuotas que vencen en N días hábiles.
// Idempotente vía dedup_key.
// Llamado SIN session (cron-only) — usa createAdminClient directamente.
// ════════════════════════════════════════════════════════════════════════════
export interface PaymentReminderResult {
  organization_id: string;
  scanned_orgs: number;
  upcoming_created: number;
  overdue_created: number;
  marked_overdue: number;
}

export async function generatePaymentReminders(
  daysAhead = 5
): Promise<PaymentReminderResult[]> {
  const admin = createAdminClient();
  const results: PaymentReminderResult[] = [];

  // 1. Marcar cuotas vencidas
  const { data: overdueResult } = await admin.rpc("mark_schedule_overdue");
  const markedOverdue = Number(overdueResult ?? 0);

  // 2. Por org: identificar cuotas que vencen en `daysAhead` días hábiles
  const { data: orgs } = await admin
    .from("organizations")
    .select("id")
    .eq("active", true);

  for (const org of orgs ?? []) {
    const todayISO = new Date().toISOString().slice(0, 10);
    // Calcular due_date máximo: business_days_before(due_date, daysAhead) <= today
    // Equivale a: due_date está dentro de los próximos `daysAhead` días hábiles desde hoy.
    // Para simplificar, hacemos un margen de daysAhead * 1.6 días naturales (peor caso findes).
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + Math.ceil(daysAhead * 1.6) + 2);
    const horizonISO = horizon.toISOString().slice(0, 10);

    const { data: schedules } = await admin
      .from("booking_payment_schedule")
      .select(
        "id, booking_id, sequence_number, total_count, due_date, expected_amount, currency, status, organization_id, booking:bookings(id, mode, status, guest:guests(full_name), unit:units(code, name))"
      )
      .eq("organization_id", org.id)
      .in("status", ["pending", "partial"])
      .gte("due_date", todayISO)
      .lte("due_date", horizonISO);

    let upcomingCreated = 0;
    for (const s of schedules ?? []) {
      const dueDate = new Date(s.due_date + "T12:00:00");
      // contar días hábiles hasta due_date
      let businessDays = 0;
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      while (d.toISOString().slice(0, 10) < s.due_date) {
        d.setDate(d.getDate() + 1);
        const dow = d.getDay(); // 0=dom, 6=sab
        if (dow !== 0 && dow !== 6) businessDays += 1;
      }
      if (businessDays > daysAhead) continue;

      const dedup = `payment_due:${s.id}:${s.due_date}`;
      const guest = ((s.booking as { guest?: { full_name?: string } } | null)
        ?.guest?.full_name) ?? "Inquilino";
      const unit = (s.booking as { unit?: { code?: string } } | null)?.unit
        ?.code;
      const dueDateStr = dueDate.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "short",
      });

      const { error: insErr } = await admin.from("notifications").insert({
        organization_id: org.id,
        type: "payment_due",
        severity: businessDays <= 1 ? "critical" : "warning",
        title: `Próximo cobro · cuota ${s.sequence_number}/${s.total_count}`,
        body: `${guest}${unit ? ` · Unidad ${unit}` : ""} · ${s.currency} ${Number(s.expected_amount).toLocaleString("es-AR", { maximumFractionDigits: 0 })} · vence ${dueDateStr}`,
        ref_type: "booking_payment_schedule",
        ref_id: s.id,
        action_url: `/dashboard/reservas/${s.booking_id}`,
        due_at: new Date(s.due_date + "T12:00:00").toISOString(),
        dedup_key: dedup,
      });
      if (!insErr) upcomingCreated += 1;
    }

    // 3. Notificaciones para overdue (1 sola por cuota, dedup por id)
    const { data: overdueSchedules } = await admin
      .from("booking_payment_schedule")
      .select(
        "id, booking_id, sequence_number, total_count, due_date, expected_amount, paid_amount, currency, organization_id, booking:bookings(guest:guests(full_name), unit:units(code))"
      )
      .eq("organization_id", org.id)
      .eq("status", "overdue");

    let overdueCreated = 0;
    for (const s of overdueSchedules ?? []) {
      const dedup = `payment_overdue:${s.id}`;
      const guest = ((s.booking as { guest?: { full_name?: string } } | null)
        ?.guest?.full_name) ?? "Inquilino";
      const unit = (s.booking as { unit?: { code?: string } } | null)?.unit
        ?.code;
      const remaining =
        Number(s.expected_amount) - Number(s.paid_amount ?? 0);
      const { error: insErr } = await admin.from("notifications").insert({
        organization_id: org.id,
        type: "payment_overdue",
        severity: "critical",
        title: `Cuota vencida · ${s.sequence_number}/${s.total_count}`,
        body: `${guest}${unit ? ` · Unidad ${unit}` : ""} · debía ${s.due_date} · saldo ${s.currency} ${remaining.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`,
        ref_type: "booking_payment_schedule",
        ref_id: s.id,
        action_url: `/dashboard/reservas/${s.booking_id}`,
        due_at: new Date(s.due_date + "T12:00:00").toISOString(),
        dedup_key: dedup,
      });
      if (!insErr) overdueCreated += 1;
    }

    results.push({
      organization_id: org.id,
      scanned_orgs: orgs?.length ?? 0,
      upcoming_created: upcomingCreated,
      overdue_created: overdueCreated,
      marked_overdue: markedOverdue,
    });
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers para llamar desde otros server actions
// ════════════════════════════════════════════════════════════════════════════
export async function notifyOrg(
  organizationId: string,
  payload: {
    type: NotificationType;
    severity?: NotificationSeverity;
    title: string;
    body?: string;
    ref_type?: string;
    ref_id?: string;
    action_url?: string;
    dedup_key?: string;
  }
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    organization_id: organizationId,
    type: payload.type,
    severity: payload.severity ?? "info",
    title: payload.title,
    body: payload.body,
    ref_type: payload.ref_type,
    ref_id: payload.ref_id,
    action_url: payload.action_url,
    dedup_key: payload.dedup_key,
  });
  if (error && error.code !== "23505") {
    console.error("notifyOrg failed", error);
  }
}
