"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can } from "@/lib/permissions";
import type {
  DailyReport,
  DailyReportStatus,
  MobileParteDiarioPayload,
  ParteDiarioBookingRow,
  ParteDiarioCleaningRow,
  ParteDiarioCleanerLoad,
  ParteDiarioConciergeRow,
  ParteDiarioMaintenanceRow,
  ParteDiarioPayload,
  ParteDiarioRecipient,
  ParteDiarioSettings,
  ParteDiarioSnapshot,
  UserRole,
} from "@/lib/types/database";

// ─── Helpers de fecha en timezone de la org ─────────────────────────────────
// Cada org puede operar en su propia ciudad → todo cómputo de "hoy" o "mañana"
// debe pivotar sobre su zona horaria, no sobre UTC ni sobre el server.

function ymdInTimezone(date: Date, timezone: string): string {
  // Intl.DateTimeFormat 'en-CA' produce YYYY-MM-DD predictible.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function todayInTz(timezone: string): string {
  return ymdInTimezone(new Date(), timezone);
}

function tomorrowInTz(timezone: string): string {
  return addDaysToYmd(todayInTz(timezone), 1);
}

function dateLabelEs(ymd: string): string {
  // Render bonito en español: "Miércoles 7 de mayo".
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12)); // mediodía UTC para evitar saltos
  const weekday = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    timeZone: "UTC",
  }).format(dt);
  const day = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
  const month = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    timeZone: "UTC",
  }).format(dt);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${cap(weekday)} ${day} de ${month}`;
}

// ─── Settings: lectura + upsert ─────────────────────────────────────────────

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).optional(),
  draft_hour: z.coerce.number().int().min(0).max(23).optional(),
  reminder_hour: z.coerce.number().int().min(0).max(23).nullable().optional(),
  channel_id: z.string().uuid().nullable().optional(),
  template_name: z.string().min(1).optional(),
  template_language: z.string().min(2).max(8).optional(),
  auto_create_cleaning_tasks: z.boolean().optional(),
  auto_assign_cleaning: z.boolean().optional(),
  organization_label: z.string().nullable().optional(),
});

export type ParteDiarioSettingsInput = z.infer<typeof settingsSchema>;

async function ensureSettings(orgId: string, fallbackLabel: string | null) {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("parte_diario_settings")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (existing) return existing as ParteDiarioSettings;

  const { data: created, error } = await admin
    .from("parte_diario_settings")
    .insert({ organization_id: orgId, organization_label: fallbackLabel })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return created as ParteDiarioSettings;
}

export async function getParteDiarioSettings(): Promise<ParteDiarioSettings> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "view")) throw new Error("Sin permisos para ver el parte diario");
  return ensureSettings(organization.id, organization.name);
}

export async function updateParteDiarioSettings(
  input: ParteDiarioSettingsInput,
): Promise<ParteDiarioSettings> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");
  const validated = settingsSchema.parse(input);

  await ensureSettings(organization.id, organization.name);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("parte_diario_settings")
    .update(validated)
    .eq("organization_id", organization.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/parte-diario");
  revalidatePath("/dashboard/parte-diario/configuracion");
  return data as ParteDiarioSettings;
}

// ─── Snapshot computado: el "contenido" del parte ───────────────────────────

const ASSIGNABLE_CLEANING_ROLES: UserRole[] = ["limpieza", "recepcion", "mantenimiento"];

async function loadCleanerLoads(
  orgId: string,
  reportDate: string,
): Promise<ParteDiarioCleanerLoad[]> {
  const admin = createAdminClient();
  // Miembros activos con rol asignable a limpieza
  const { data: members } = await admin
    .from("organization_members")
    .select("user_id, role, active")
    .eq("organization_id", orgId)
    .eq("active", true)
    .in("role", ASSIGNABLE_CLEANING_ROLES);
  const memberRows = (members ?? []) as { user_id: string; role: UserRole }[];
  if (memberRows.length === 0) return [];

  const userIds = memberRows.map((m) => m.user_id);
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in("user_id", userIds);
  const profileById = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, (p.full_name as string) ?? "Sin nombre"]),
  );

  // Tareas asignadas a cada uno para el reportDate
  const { data: tasks } = await admin
    .from("cleaning_tasks")
    .select("assigned_to")
    .eq("organization_id", orgId)
    .eq("scheduled_for", reportDate)
    .in("status", ["pendiente", "en_progreso"]);
  const counts = new Map<string, number>();
  for (const t of tasks ?? []) {
    const u = (t as { assigned_to: string | null }).assigned_to;
    if (!u) continue;
    counts.set(u, (counts.get(u) ?? 0) + 1);
  }

  return memberRows.map((m) => ({
    user_id: m.user_id,
    full_name: profileById.get(m.user_id) ?? "Sin nombre",
    role: m.role,
    count: counts.get(m.user_id) ?? 0,
  }));
}

async function buildSnapshot(
  orgId: string,
  organizationName: string,
  reportDate: string,
): Promise<ParteDiarioSnapshot> {
  const admin = createAdminClient();

  // ─── Bookings que aplican al reportDate ──────────────────────────────────
  // CH OUT: bookings cuyo check_out_date == reportDate y status no cancelado.
  // CH IN:  bookings cuyo check_in_date == reportDate y status no cancelado.
  const [outRes, inRes] = await Promise.all([
    admin
      .from("bookings")
      .select(
        `id, unit_id, guest_id, status, mode, check_in_date, check_out_date,
         unit:units(id, code, name),
         guest:guests(id, full_name)`,
      )
      .eq("organization_id", orgId)
      .eq("check_out_date", reportDate)
      .in("status", ["confirmada", "check_in", "check_out"]),
    admin
      .from("bookings")
      .select(
        `id, unit_id, guest_id, status, mode, check_in_date, check_out_date,
         unit:units(id, code, name),
         guest:guests(id, full_name)`,
      )
      .eq("organization_id", orgId)
      .eq("check_in_date", reportDate)
      .in("status", ["confirmada", "check_in"]),
  ]);

  type BookingJoin = {
    id: string;
    unit_id: string;
    guest_id: string | null;
    status: ParteDiarioBookingRow["status"];
    mode: ParteDiarioBookingRow["mode"];
    check_in_date: string;
    check_out_date: string;
    unit: { id: string; code: string; name: string } | null;
    guest: { id: string; full_name: string } | null;
  };
  const mapBooking = (b: BookingJoin): ParteDiarioBookingRow => ({
    booking_id: b.id,
    unit_id: b.unit_id,
    unit_code: b.unit?.code ?? "—",
    unit_name: b.unit?.name ?? "—",
    guest_name: b.guest?.full_name ?? null,
    mode: b.mode,
    status: b.status,
    is_owner_use: b.guest_id === null,
    check_in_date: b.check_in_date,
    check_out_date: b.check_out_date,
  });

  const checkOuts = ((outRes.data ?? []) as unknown as BookingJoin[])
    .map(mapBooking)
    .sort((a, b) => a.unit_code.localeCompare(b.unit_code));
  const checkIns = ((inRes.data ?? []) as unknown as BookingJoin[])
    .map(mapBooking)
    .sort((a, b) => a.unit_code.localeCompare(b.unit_code));

  // ─── SUCIOS = cleaning_tasks programadas para reportDate ─────────────────
  // Más "ghost rows" para check-outs sin cleaning_task creada todavía.
  const { data: cleaningRows } = await admin
    .from("cleaning_tasks")
    .select(
      `id, unit_id, scheduled_for, status, assigned_to, booking_out_id,
       unit:units(id, code, name)`,
    )
    .eq("organization_id", orgId)
    .eq("scheduled_for", reportDate)
    .in("status", ["pendiente", "en_progreso", "completada"]);

  type CleaningJoin = {
    id: string;
    unit_id: string;
    scheduled_for: string;
    status: NonNullable<ParteDiarioCleaningRow["status"]>;
    assigned_to: string | null;
    booking_out_id: string | null;
    unit: { id: string; code: string; name: string } | null;
  };

  // Resolver nombres de los assigned_to en una sola query
  const cleaningJoinRows = (cleaningRows ?? []) as unknown as CleaningJoin[];
  const assigneeIds = Array.from(
    new Set(cleaningJoinRows.map((r) => r.assigned_to).filter((v): v is string => !!v)),
  );
  const assigneeNameById = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", assigneeIds);
    for (const p of profs ?? []) {
      assigneeNameById.set(
        (p as { user_id: string }).user_id,
        ((p as { full_name: string | null }).full_name) ?? "Sin nombre",
      );
    }
  }

  // Mapeo de booking_out_id → guest name + check_out_time para mostrar contexto
  const outBookingIds = Array.from(
    new Set(cleaningJoinRows.map((r) => r.booking_out_id).filter((v): v is string => !!v)),
  );
  const bookingMetaById = new Map<string, { guest_name: string | null; check_out_time: string | null }>();
  if (outBookingIds.length > 0) {
    const { data: bks } = await admin
      .from("bookings")
      .select(`id, check_out_time, guest:guests(id, full_name)`)
      .in("id", outBookingIds);
    for (const b of bks ?? []) {
      const row = b as unknown as {
        id: string;
        check_out_time: string | null;
        guest: { full_name: string } | null;
      };
      bookingMetaById.set(row.id, {
        guest_name: row.guest?.full_name ?? null,
        check_out_time: row.check_out_time,
      });
    }
  }

  const realCleanings: ParteDiarioCleaningRow[] = cleaningJoinRows.map((c) => {
    const meta = c.booking_out_id ? bookingMetaById.get(c.booking_out_id) : undefined;
    return {
      task_id: c.id,
      unit_id: c.unit_id,
      unit_code: c.unit?.code ?? "—",
      unit_name: c.unit?.name ?? "—",
      scheduled_for: c.scheduled_for,
      status: c.status,
      assigned_to: c.assigned_to,
      assigned_to_name: c.assigned_to ? assigneeNameById.get(c.assigned_to) ?? null : null,
      booking_out_id: c.booking_out_id,
      guest_name: meta?.guest_name ?? null,
      check_out_time: meta?.check_out_time ?? null,
    };
  });

  // Ghost rows: check-outs del día sin cleaning_task creada. Usamos el booking
  // como portador para que el admin pueda crear la tarea con un click desde la UI.
  const realUnitIds = new Set(realCleanings.map((c) => c.unit_id));
  const ghosts: ParteDiarioCleaningRow[] = checkOuts
    .filter((b) => !realUnitIds.has(b.unit_id))
    .map((b) => ({
      task_id: null,
      unit_id: b.unit_id,
      unit_code: b.unit_code,
      unit_name: b.unit_name,
      scheduled_for: reportDate,
      status: null,
      assigned_to: null,
      assigned_to_name: null,
      booking_out_id: b.booking_id,
      guest_name: b.guest_name,
      check_out_time: null,
    }));

  const sucios = [...realCleanings, ...ghosts].sort((a, b) =>
    a.unit_code.localeCompare(b.unit_code),
  );

  // ─── ARREGLOS = maintenance_tickets abiertos (sin filtro de priority) ────
  // ─── TAREAS PENDIENTES = concierge_requests abiertas (módulo "Tareas") ──
  // Esta separación matchea el sidebar (Mantenimiento vs Tareas) y mantiene
  // semántica clara: "Arreglos" = repair work, "Tareas" = pedidos operativos.
  const [{ data: tickets }, { data: requests }] = await Promise.all([
    admin
      .from("maintenance_tickets")
      .select(
        `id, unit_id, title, priority, status, opened_at, assigned_to,
         unit:units(id, code, name)`,
      )
      .eq("organization_id", orgId)
      .in("status", ["abierto", "en_progreso", "esperando_repuesto"])
      .order("priority", { ascending: false })
      .order("opened_at", { ascending: false }),
    admin
      .from("concierge_requests")
      .select(
        `id, unit_id, description, request_type, status, priority,
         scheduled_for, assigned_to, created_at,
         unit:units(id, code, name)`,
      )
      .eq("organization_id", orgId)
      .in("status", ["pendiente", "en_progreso"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  type TicketJoin = {
    id: string;
    unit_id: string;
    title: string;
    priority: ParteDiarioMaintenanceRow["priority"];
    status: ParteDiarioMaintenanceRow["status"];
    opened_at: string;
    assigned_to: string | null;
    unit: { id: string; code: string; name: string } | null;
  };
  type ConciergeJoin = {
    id: string;
    unit_id: string | null;
    description: string;
    request_type: string | null;
    status: ParteDiarioConciergeRow["status"];
    priority: ParteDiarioConciergeRow["priority"];
    scheduled_for: string | null;
    assigned_to: string | null;
    created_at: string;
    unit: { id: string; code: string; name: string } | null;
  };
  const ticketRows = (tickets ?? []) as unknown as TicketJoin[];
  const conciergeRows = (requests ?? []) as unknown as ConciergeJoin[];

  // Resolver nombres de assigned_to en una sola query para ambos sets.
  const allAssigneeIds = Array.from(
    new Set([
      ...ticketRows.map((t) => t.assigned_to),
      ...conciergeRows.map((c) => c.assigned_to),
    ].filter((v): v is string => !!v)),
  );
  const nameById = new Map<string, string>();
  if (allAssigneeIds.length > 0) {
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", allAssigneeIds);
    for (const p of profs ?? []) {
      nameById.set(
        (p as { user_id: string }).user_id,
        ((p as { full_name: string | null }).full_name) ?? "Sin nombre",
      );
    }
  }

  const arreglos: ParteDiarioMaintenanceRow[] = ticketRows.map((t) => ({
    ticket_id: t.id,
    unit_id: t.unit_id,
    unit_code: t.unit?.code ?? "—",
    unit_name: t.unit?.name ?? "—",
    title: t.title,
    priority: t.priority,
    status: t.status,
    opened_at: t.opened_at,
    assigned_to: t.assigned_to,
    assigned_to_name: t.assigned_to ? nameById.get(t.assigned_to) ?? null : null,
  }));

  const tareasPendientes: ParteDiarioConciergeRow[] = conciergeRows.map((c) => ({
    request_id: c.id,
    unit_id: c.unit_id,
    unit_code: c.unit?.code ?? null,
    unit_name: c.unit?.name ?? null,
    description: c.description,
    request_type: c.request_type,
    status: c.status,
    priority: c.priority,
    scheduled_for: c.scheduled_for,
    assigned_to: c.assigned_to,
    assigned_to_name: c.assigned_to ? nameById.get(c.assigned_to) ?? null : null,
    created_at: c.created_at,
  }));

  const cleanerLoads = await loadCleanerLoads(orgId, reportDate);

  return {
    date: reportDate,
    date_label: dateLabelEs(reportDate),
    organization_name: organizationName,
    check_outs: checkOuts,
    check_ins: checkIns,
    sucios,
    tareas_pendientes: tareasPendientes,
    arreglos,
    cleaner_loads: cleanerLoads,
  };
}

// ─── getParteDiario: lectura completa + ensure de daily_reports row ─────────

export async function getParteDiario(date?: string): Promise<ParteDiarioPayload> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "view")) throw new Error("Sin permisos");

  const settings = await ensureSettings(organization.id, organization.name);
  const reportDate = date ?? tomorrowInTz(settings.timezone);

  const admin = createAdminClient();
  const { data: report } = await admin
    .from("daily_reports")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("report_date", reportDate)
    .maybeSingle();

  const snapshot = await buildSnapshot(organization.id, organization.name, reportDate);

  return {
    ...snapshot,
    organization_name: settings.organization_label ?? organization.name,
    report: (report as DailyReport | null) ?? null,
    settings,
  };
}

// ─── Mobile briefing: solo las tareas asignadas a un user ───────────────────

export async function getParteDiarioForUser(
  userId?: string,
  date?: string,
): Promise<MobileParteDiarioPayload> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const targetUser = userId ?? session.userId;
  const settings = await ensureSettings(organization.id, organization.name);
  const reportDate = date ?? todayInTz(settings.timezone);

  const admin = createAdminClient();

  const [{ data: cleaningRows }, { data: tickets }, { data: requests }, { data: profile }] =
    await Promise.all([
      admin
        .from("cleaning_tasks")
        .select(
          `id, unit_id, scheduled_for, status, assigned_to, booking_out_id,
         unit:units(id, code, name)`,
        )
        .eq("organization_id", organization.id)
        .eq("assigned_to", targetUser)
        .eq("scheduled_for", reportDate)
        .in("status", ["pendiente", "en_progreso", "completada"])
        .order("scheduled_for"),
      admin
        .from("maintenance_tickets")
        .select(
          `id, unit_id, title, priority, status, opened_at, assigned_to,
         unit:units(id, code, name)`,
        )
        .eq("organization_id", organization.id)
        .eq("assigned_to", targetUser)
        .in("status", ["abierto", "en_progreso", "esperando_repuesto"])
        .order("priority", { ascending: false }),
      admin
        .from("concierge_requests")
        .select(
          `id, unit_id, description, request_type, status, priority,
         scheduled_for, assigned_to, created_at,
         unit:units(id, code, name)`,
        )
        .eq("organization_id", organization.id)
        .eq("assigned_to", targetUser)
        .in("status", ["pendiente", "en_progreso"])
        .order("priority", { ascending: false }),
      admin.from("user_profiles").select("full_name").eq("user_id", targetUser).maybeSingle(),
    ]);

  type CleaningJoin = {
    id: string;
    unit_id: string;
    scheduled_for: string;
    status: NonNullable<ParteDiarioCleaningRow["status"]>;
    assigned_to: string | null;
    booking_out_id: string | null;
    unit: { id: string; code: string; name: string } | null;
  };
  type TicketJoin = {
    id: string;
    unit_id: string;
    title: string;
    priority: ParteDiarioMaintenanceRow["priority"];
    status: ParteDiarioMaintenanceRow["status"];
    opened_at: string;
    assigned_to: string | null;
    unit: { id: string; code: string; name: string } | null;
  };
  type ConciergeJoin = {
    id: string;
    unit_id: string | null;
    description: string;
    request_type: string | null;
    status: ParteDiarioConciergeRow["status"];
    priority: ParteDiarioConciergeRow["priority"];
    scheduled_for: string | null;
    assigned_to: string | null;
    created_at: string;
    unit: { id: string; code: string; name: string } | null;
  };

  const outBookingIds = Array.from(
    new Set(
      ((cleaningRows ?? []) as unknown as CleaningJoin[])
        .map((r) => r.booking_out_id)
        .filter((v): v is string => !!v),
    ),
  );
  const bookingMetaById = new Map<string, { guest_name: string | null; check_out_time: string | null }>();
  if (outBookingIds.length > 0) {
    const { data: bks } = await admin
      .from("bookings")
      .select(`id, check_out_time, guest:guests(id, full_name)`)
      .in("id", outBookingIds);
    for (const b of bks ?? []) {
      const row = b as unknown as {
        id: string;
        check_out_time: string | null;
        guest: { full_name: string } | null;
      };
      bookingMetaById.set(row.id, {
        guest_name: row.guest?.full_name ?? null,
        check_out_time: row.check_out_time,
      });
    }
  }

  const cleanings: ParteDiarioCleaningRow[] = ((cleaningRows ?? []) as unknown as CleaningJoin[]).map(
    (c) => {
      const meta = c.booking_out_id ? bookingMetaById.get(c.booking_out_id) : undefined;
      return {
        task_id: c.id,
        unit_id: c.unit_id,
        unit_code: c.unit?.code ?? "—",
        unit_name: c.unit?.name ?? "—",
        scheduled_for: c.scheduled_for,
        status: c.status,
        assigned_to: c.assigned_to,
        assigned_to_name: null,
        booking_out_id: c.booking_out_id,
        guest_name: meta?.guest_name ?? null,
        check_out_time: meta?.check_out_time ?? null,
      };
    },
  );

  const maintenance: ParteDiarioMaintenanceRow[] = ((tickets ?? []) as unknown as TicketJoin[]).map(
    (t) => ({
      ticket_id: t.id,
      unit_id: t.unit_id,
      unit_code: t.unit?.code ?? "—",
      unit_name: t.unit?.name ?? "—",
      title: t.title,
      priority: t.priority,
      status: t.status,
      opened_at: t.opened_at,
      assigned_to: t.assigned_to,
      assigned_to_name: null,
    }),
  );

  const tareas: ParteDiarioConciergeRow[] = ((requests ?? []) as unknown as ConciergeJoin[]).map(
    (c) => ({
      request_id: c.id,
      unit_id: c.unit_id,
      unit_code: c.unit?.code ?? null,
      unit_name: c.unit?.name ?? null,
      description: c.description,
      request_type: c.request_type,
      status: c.status,
      priority: c.priority,
      scheduled_for: c.scheduled_for,
      assigned_to: c.assigned_to,
      assigned_to_name: null,
      created_at: c.created_at,
    }),
  );

  const completed = cleanings.filter((c) => c.status === "completada").length;

  const fullName =
    (profile as { full_name: string | null } | null)?.full_name ??
    session.profile.full_name ??
    "equipo";
  const firstName = fullName.split(" ")[0];

  return {
    date: reportDate,
    date_label: dateLabelEs(reportDate),
    greeting_name: firstName,
    cleanings,
    maintenance,
    tareas,
    completed_cleanings: completed,
    total_cleanings: cleanings.length,
  };
}

// ─── Asignación: pieza clave del flujo "noche anterior" ─────────────────────

export async function assignCleaningInDraft(taskId: string, userId: string | null) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { error } = await admin
    .from("cleaning_tasks")
    .update({ assigned_to: userId })
    .eq("id", taskId)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  await admin.from("cleaning_events").insert({
    cleaning_task_id: taskId,
    organization_id: organization.id,
    actor_id: session.userId,
    event_type: "assigned",
    metadata: { assigned_to: userId, source: "parte_diario" },
  });

  revalidatePath("/dashboard/parte-diario");
  revalidatePath("/dashboard/limpieza");
  revalidatePath("/m/parte-diario");
  revalidatePath("/m/limpieza");
}

const bulkAssignSchema = z.array(
  z.object({ taskId: z.string().uuid(), userId: z.string().uuid().nullable() }),
);

export async function bulkReassignCleanings(input: { taskId: string; userId: string | null }[]) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");
  const validated = bulkAssignSchema.parse(input);

  const admin = createAdminClient();

  // Sin transacciones nativas en supabase-js → ejecutamos en serie y registramos
  // cada cambio como evento. El front aplica optimistic update y rollback si falla.
  for (const { taskId, userId } of validated) {
    const { error } = await admin
      .from("cleaning_tasks")
      .update({ assigned_to: userId })
      .eq("id", taskId)
      .eq("organization_id", organization.id);
    if (error) throw new Error(error.message);
    await admin.from("cleaning_events").insert({
      cleaning_task_id: taskId,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "assigned",
      metadata: { assigned_to: userId, source: "parte_diario_bulk" },
    });
  }

  revalidatePath("/dashboard/parte-diario");
  revalidatePath("/dashboard/limpieza");
}

// ─── Crear tareas faltantes para los CH OUT del día ─────────────────────────

const DEFAULT_CHECKLIST = [
  "Cocina (vajilla, electrodomésticos)",
  "Baño (sanitarios, ducha, espejos)",
  "Dormitorios (cambio de sábanas)",
  "Living / comedor",
  "Pisos (aspirar / trapear)",
  "Toallas y blanquería",
  "Reposición amenities (papel, jabón, café)",
  "Ventilación / olores",
  "Verificación de inventario",
];

export async function createMissingCleaningTasksForDate(date: string): Promise<{ created: number }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");
  return createMissingCleaningTasksForDateInternal(organization.id, date, session.userId);
}

async function createMissingCleaningTasksForDateInternal(
  orgId: string,
  date: string,
  actorId: string | null,
): Promise<{ created: number }> {
  const admin = createAdminClient();

  // Bookings con check-out en `date`.
  const { data: outs } = await admin
    .from("bookings")
    .select("id, unit_id")
    .eq("organization_id", orgId)
    .eq("check_out_date", date)
    .in("status", ["confirmada", "check_in", "check_out"]);
  const bookingsByUnit = new Map<string, string>();
  for (const b of outs ?? []) {
    const row = b as { id: string; unit_id: string };
    bookingsByUnit.set(row.unit_id, row.id);
  }
  if (bookingsByUnit.size === 0) return { created: 0 };

  // Cleaning tasks ya existentes para esa fecha
  const { data: existing } = await admin
    .from("cleaning_tasks")
    .select("unit_id")
    .eq("organization_id", orgId)
    .eq("scheduled_for", date);
  const existingUnitIds = new Set((existing ?? []).map((r) => (r as { unit_id: string }).unit_id));

  let created = 0;
  for (const [unitId, bookingId] of bookingsByUnit.entries()) {
    if (existingUnitIds.has(unitId)) continue;
    const checklist = DEFAULT_CHECKLIST.map((item) => ({ item, done: false }));
    const { data: ins, error } = await admin
      .from("cleaning_tasks")
      .insert({
        organization_id: orgId,
        unit_id: unitId,
        booking_out_id: bookingId,
        scheduled_for: date,
        status: "pendiente",
        checklist,
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[parte-diario] no pude crear cleaning_task", error.message);
      continue;
    }
    await admin.from("cleaning_events").insert({
      cleaning_task_id: (ins as { id: string }).id,
      organization_id: orgId,
      actor_id: actorId,
      event_type: "created",
      to_status: "pendiente",
      metadata: { source: "parte_diario_auto", booking_out_id: bookingId },
    });
    created += 1;
  }

  revalidatePath("/dashboard/parte-diario");
  revalidatePath("/dashboard/limpieza");
  return { created };
}

// ─── Auto-asignación balanceada por carga ───────────────────────────────────

export async function autoAssignCleanings(date: string): Promise<{ assigned: number }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");
  return autoAssignCleaningsInternal(organization.id, date, session.userId);
}

async function autoAssignCleaningsInternal(
  orgId: string,
  date: string,
  actorId: string | null,
): Promise<{ assigned: number }> {
  const admin = createAdminClient();

  const { data: tasks } = await admin
    .from("cleaning_tasks")
    .select("id")
    .eq("organization_id", orgId)
    .eq("scheduled_for", date)
    .is("assigned_to", null)
    .in("status", ["pendiente", "en_progreso"]);
  const unassignedIds = (tasks ?? []).map((t) => (t as { id: string }).id);
  if (unassignedIds.length === 0) return { assigned: 0 };

  const loads = await loadCleanerLoads(orgId, date);
  if (loads.length === 0) return { assigned: 0 };

  // Min-heap improvisado: sort y pick first cada iteración.
  const heap = [...loads];
  let assigned = 0;
  for (const taskId of unassignedIds) {
    heap.sort((a, b) => a.count - b.count || a.full_name.localeCompare(b.full_name));
    const target = heap[0];
    const { error } = await admin
      .from("cleaning_tasks")
      .update({ assigned_to: target.user_id })
      .eq("id", taskId)
      .eq("organization_id", orgId);
    if (error) {
      console.warn("[parte-diario] no pude asignar", error.message);
      continue;
    }
    await admin.from("cleaning_events").insert({
      cleaning_task_id: taskId,
      organization_id: orgId,
      actor_id: actorId,
      event_type: "assigned",
      metadata: { assigned_to: target.user_id, source: "parte_diario_auto_balance" },
    });
    target.count += 1;
    assigned += 1;
  }

  revalidatePath("/dashboard/parte-diario");
  revalidatePath("/dashboard/limpieza");
  return { assigned };
}

// ─── Ciclo de vida del daily_report ─────────────────────────────────────────

export async function markParteDiarioRevisado(date: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("daily_reports")
    .upsert(
      {
        organization_id: organization.id,
        report_date: date,
        status: "revisado" as DailyReportStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: session.userId,
        generated_by: session.userId,
        generated_kind: "manual",
      },
      { onConflict: "organization_id,report_date" },
    );

  revalidatePath("/dashboard/parte-diario");
}

export async function markParteDiarioBorrador(date: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("daily_reports")
    .update({ status: "borrador" as DailyReportStatus, reviewed_at: null, reviewed_by: null })
    .eq("organization_id", organization.id)
    .eq("report_date", date);
  // session.userId mantenido a propósito en el log para que el activity_log lo capture
  void session;

  revalidatePath("/dashboard/parte-diario");
}

// ─── Genera el draft (idempotente). Llamado desde /dashboard o desde el cron ─

export async function generateParteDiarioManual(date?: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "create")) throw new Error("Sin permisos");
  const settings = await ensureSettings(organization.id, organization.name);
  const reportDate = date ?? tomorrowInTz(settings.timezone);

  const admin = createAdminClient();

  if (settings.auto_create_cleaning_tasks) {
    await createMissingCleaningTasksForDateInternal(organization.id, reportDate, session.userId);
  }
  if (settings.auto_assign_cleaning) {
    await autoAssignCleaningsInternal(organization.id, reportDate, session.userId);
  }

  await admin
    .from("daily_reports")
    .upsert(
      {
        organization_id: organization.id,
        report_date: reportDate,
        status: "borrador" as DailyReportStatus,
        generated_at: new Date().toISOString(),
        generated_by: session.userId,
        generated_kind: "manual",
      },
      { onConflict: "organization_id,report_date" },
    );

  revalidatePath("/dashboard/parte-diario");
  return { date: reportDate };
}

/**
 * Genera el borrador automáticamente para una org dada. Llamado desde el cron
 * `/api/cron/hourly-tick`. NO requiere sesión — el cron valida CRON_SECRET.
 * Idempotente: si ya hay un report row para ese día no lo pisa.
 */
export async function generateParteDiarioForCron(orgId: string, reportDate: string) {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return { skipped: true, reason: "org_not_found" };

  const settings = await ensureSettings(orgId, (org as { name: string }).name);

  // Si ya hay un report row para ese día, no pisamos.
  const { data: existing } = await admin
    .from("daily_reports")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("report_date", reportDate)
    .maybeSingle();

  if (settings.auto_create_cleaning_tasks) {
    await createMissingCleaningTasksForDateInternal(orgId, reportDate, null);
  }
  if (settings.auto_assign_cleaning) {
    await autoAssignCleaningsInternal(orgId, reportDate, null);
  }

  if (!existing) {
    await admin.from("daily_reports").insert({
      organization_id: orgId,
      report_date: reportDate,
      status: "borrador" as DailyReportStatus,
      generated_kind: "auto",
    });
  }

  return { skipped: false, generated: !existing };
}

// ─── Recordatorio: notification in-app si sigue en borrador ─────────────────

export async function fireParteDiarioReminder(orgId: string, reportDate: string) {
  const admin = createAdminClient();
  const { data: report } = await admin
    .from("daily_reports")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("report_date", reportDate)
    .maybeSingle();
  if (!report || (report as { status: string }).status !== "borrador") {
    return { skipped: true };
  }

  const dedupKey = `parte_diario:${orgId}:${reportDate}`;
  await admin
    .from("notifications")
    .insert({
      organization_id: orgId,
      type: "task_reminder",
      severity: "warning",
      title: "Parte diario sin enviar",
      body: `El parte para ${dateLabelEs(reportDate)} sigue en borrador. Revisalo y envialo cuando estés.`,
      ref_type: "daily_report",
      ref_id: (report as { id: string }).id,
      target_role: "admin",
      action_url: `/dashboard/parte-diario?date=${reportDate}`,
      dedup_key: dedupKey,
    })
    .select("id")
    .maybeSingle();

  return { skipped: false };
}

// ─── Recipients ─────────────────────────────────────────────────────────────

const recipientSchema = z.object({
  phone: z.string().min(8).max(32),
  label: z.string().max(80).optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
  active: z.boolean().optional(),
});
export type RecipientInput = z.infer<typeof recipientSchema>;

function normalizePhone(raw: string): string {
  // Conservamos solo dígitos para el external_id de Meta.
  return raw.replace(/[^\d]/g, "");
}

export async function listParteDiarioRecipients(): Promise<ParteDiarioRecipient[]> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "view")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("parte_diario_recipients")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ParteDiarioRecipient[];
}

export async function upsertParteDiarioRecipient(
  input: RecipientInput,
  id?: string,
): Promise<ParteDiarioRecipient> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");
  const validated = recipientSchema.parse(input);
  const phone = normalizePhone(validated.phone);
  if (phone.length < 8) throw new Error("Teléfono inválido");

  const admin = createAdminClient();
  const payload: Record<string, unknown> = {
    organization_id: organization.id,
    phone,
    label: validated.label ?? null,
    user_id: validated.user_id ?? null,
    active: validated.active ?? true,
  };

  let row;
  if (id) {
    const { data, error } = await admin
      .from("parte_diario_recipients")
      .update(payload)
      .eq("id", id)
      .eq("organization_id", organization.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    row = data;
  } else {
    const { data, error } = await admin
      .from("parte_diario_recipients")
      .upsert(payload, { onConflict: "organization_id,phone" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    row = data;
  }

  revalidatePath("/dashboard/parte-diario/destinatarios");
  return row as ParteDiarioRecipient;
}

export async function removeParteDiarioRecipient(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { error } = await admin
    .from("parte_diario_recipients")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/parte-diario/destinatarios");
}

export async function listAssignableCleaners(): Promise<
  { user_id: string; full_name: string; role: UserRole }[]
> {
  await requireSession();
  const { organization, role: currentRole } = await getCurrentOrg();
  if (!can(currentRole, "parte_diario", "view")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", organization.id)
    .eq("active", true)
    .in("role", ASSIGNABLE_CLEANING_ROLES);
  const memberRows = (members ?? []) as { user_id: string; role: UserRole }[];
  if (memberRows.length === 0) return [];

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in(
      "user_id",
      memberRows.map((m) => m.user_id),
    );
  const profileById = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, (p.full_name as string) ?? "Sin nombre"]),
  );

  return memberRows
    .map((m) => ({
      user_id: m.user_id,
      full_name: profileById.get(m.user_id) ?? "Sin nombre",
      role: m.role,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

// ─── ENVÍO: el botón rojo. Genera PDF, sube, fan-out por WA ─────────────────

export async function sendParteDiario(date: string): Promise<{ sent: number; failed: number }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) throw new Error("Sin permisos");

  const settings = await ensureSettings(organization.id, organization.name);
  if (!settings.channel_id) {
    throw new Error("Configurá un canal de WhatsApp en /dashboard/parte-diario/configuracion");
  }

  const snapshot = await buildSnapshot(
    organization.id,
    settings.organization_label ?? organization.name,
    date,
  );

  const admin = createAdminClient();

  // 1. PDF en memoria
  const { generateParteDiarioPDFBytes } = await import("@/lib/pdf/parte-diario-pdf");
  const pdfBytes = generateParteDiarioPDFBytes(snapshot);

  // 2. Upload a Supabase Storage (bucket público; el path UUID actúa como token)
  const objectPath = `${organization.id}/${date}/${crypto.randomUUID()}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from("parte-diario")
    .upload(objectPath, pdfBytes, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadErr) throw new Error(`Error subiendo PDF: ${uploadErr.message}`);

  const { data: pub } = admin.storage.from("parte-diario").getPublicUrl(objectPath);
  const pdfUrl = pub.publicUrl;

  // 3. Fan-out a recipients activos
  const { data: recipients } = await admin
    .from("parte_diario_recipients")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("active", true);
  const recipientList = (recipients ?? []) as ParteDiarioRecipient[];

  const { sendMessageNow } = await import("@/lib/crm/message-sender");
  const messageIds: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const r of recipientList) {
    const phone = normalizePhone(r.phone);
    try {
      // 3.a. Upsert contact
      const { data: contact, error: cErr } = await admin
        .from("crm_contacts")
        .upsert(
          {
            organization_id: organization.id,
            external_id: phone,
            external_kind: "phone",
            phone,
            contact_kind: "staff",
            name: r.label ?? null,
          },
          { onConflict: "organization_id,external_id,external_kind" },
        )
        .select("id")
        .single();
      if (cErr || !contact) throw new Error(`Contact upsert falló: ${cErr?.message}`);

      // 3.b. Upsert conversation
      const { data: conv, error: convErr } = await admin
        .from("crm_conversations")
        .upsert(
          {
            organization_id: organization.id,
            contact_id: contact.id,
            channel_id: settings.channel_id,
            status: "open",
          },
          { onConflict: "organization_id,contact_id,channel_id" },
        )
        .select("id")
        .single();
      if (convErr || !conv) throw new Error(`Conversation upsert falló: ${convErr?.message}`);

      // 3.c. Send template
      const result = await sendMessageNow({
        organizationId: organization.id,
        conversationId: conv.id,
        contactId: contact.id,
        channelId: settings.channel_id,
        body: {
          type: "template",
          templateName: settings.template_name,
          language: settings.template_language,
          components: [
            {
              type: "header",
              parameters: [
                {
                  type: "document",
                  document: { link: pdfUrl, filename: `parte-diario-${date}.pdf` },
                },
              ],
            },
            {
              type: "body",
              parameters: [
                { type: "text", text: r.label ?? "equipo" },
                { type: "text", text: settings.organization_label ?? organization.name },
                { type: "text", text: snapshot.date_label },
              ],
            },
          ],
        },
        senderUserId: session.userId,
        senderKind: "human",
        templateName: settings.template_name,
        templateVariables: {
          recipient: r.label ?? null,
          organization: settings.organization_label ?? organization.name,
          date_label: snapshot.date_label,
        },
      });
      messageIds.push(result.messageId);

      // Vincular contact_id al recipient si todavía no lo tenía
      if (!r.contact_id) {
        await admin
          .from("parte_diario_recipients")
          .update({ contact_id: contact.id })
          .eq("id", r.id);
      }

      sent += 1;
    } catch (err) {
      console.warn("[parte-diario/send] recipient failed", r.phone, err);
      failed += 1;
    }
  }

  // 4. Persistir snapshot + actualizar daily_reports
  await admin
    .from("daily_reports")
    .upsert(
      {
        organization_id: organization.id,
        report_date: date,
        status: "enviado" as DailyReportStatus,
        sent_at: new Date().toISOString(),
        sent_by: session.userId,
        pdf_url: pdfUrl,
        pdf_storage_path: objectPath,
        wa_message_ids: messageIds,
        payload: snapshot as unknown as Record<string, unknown>,
        generated_kind: "manual",
      },
      { onConflict: "organization_id,report_date" },
    );

  // Trigger inmediato del runner de outbox (fire-and-forget)
  try {
    const { triggerWorkflowRunner } = await import("@/lib/crm/runner-trigger");
    triggerWorkflowRunner();
  } catch {
    // best-effort
  }

  revalidatePath("/dashboard/parte-diario");
  return { sent, failed };
}

// ─── Listar canales WA disponibles para la página de configuración ──────────

export async function listMetaCloudChannels() {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "view")) throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_channels")
    .select("id, display_name, phone_number, status, provider")
    .eq("organization_id", organization.id)
    .eq("provider", "meta_cloud");
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    display_name: string;
    phone_number: string | null;
    status: string;
    provider: string;
  }[];
}
