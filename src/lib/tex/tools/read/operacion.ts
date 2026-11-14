/**
 * La operación: `avisos` (la campana), `limpieza`, `tickets` (mantenimiento)
 * y `tareas` (conserjería).
 *
 * Visibilidad por fila: las actions ya recortan lo que ve cada rol (limpieza y
 * mantenimiento sólo ven lo que tienen asignado). Los links salen según el rol:
 * el personal de campo vive en /m y el propietario sólo abre su lista blanca.
 */
import { z } from "zod/v4";
import { getUnreadCount, listNotifications } from "@/lib/actions/notifications";
import { listCleaningTasks, listUnitCleanliness } from "@/lib/actions/cleaning";
import { listUnitRefs } from "@/lib/actions/units";
import { listOrgMemberNames } from "@/lib/actions/team";
import { listTickets } from "@/lib/actions/tickets";
import { listConciergeRequests } from "@/lib/actions/concierge";
import { isPathAllowedForOwner } from "@/lib/auth/route-access";
import { isAdminLevel } from "@/lib/permissions";
import type { UnitCleanliness } from "@/lib/cleaning/cleanliness";
import type { UserRole } from "@/lib/types/database";
import type { CardTone } from "../../types";
import { attempt, defineRead, hrefs, type ReadResult } from "../../tool";
import { clip, isInternalHref, money, shortDate } from "../../format";
import { resolveUnit } from "../_resolve";
import {
  localTime,
  localYmd,
  priorityTone,
  priorityWeight,
  ticketPriorityLabel,
  ticketStatusLabel,
  unitLabel,
} from "./_shared";

type UnitRefRow = {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  floor?: string | null;
  apartment?: string | null;
  tower?: string | null;
};

const isField = (role: UserRole) => role === "limpieza" || role === "mantenimiento";

/** Nombres del equipo (sólo para admin/recepción: el resto ve únicamente lo suyo). */
async function memberNames(role: UserRole): Promise<Map<string, string | null>> {
  if (!isAdminLevel(role)) return new Map();
  const r = await attempt(() => listOrgMemberNames());
  return new Map((r.ok ? r.value : []).map((m) => [m.user_id, m.full_name]));
}

function assigneeName(names: Map<string, string | null>, userId: string | null | undefined, selfId: string, selfName: string) {
  if (!userId) return "sin asignar";
  if (userId === selfId) return selfName || "vos";
  return names.get(userId) ?? "alguien del equipo";
}

/** "Belgrano 123 · piso 4 B" para el personal de campo. */
function whereLabel(u: UnitRefRow | null | undefined): string | undefined {
  if (!u?.address) return undefined;
  const flat = [u.tower ? `torre ${u.tower}` : null, u.floor ? `piso ${u.floor}` : null, u.apartment].filter(Boolean).join(" ");
  return [u.address, flat].filter(Boolean).join(" · ");
}

// ── Avisos ───────────────────────────────────────────────────────────────────

const SEVERITY: Record<string, { label: string; tone: CardTone; rank: number }> = {
  critical: { label: "Crítico", tone: "bad", rank: 0 },
  warning: { label: "Atención", tone: "warn", rank: 1 },
  info: { label: "Novedad", tone: "info", rank: 2 },
  success: { label: "Listo", tone: "good", rank: 3 },
};

export const avisos = defineRead({
  name: "avisos",
  label: "Mirando los avisos…",
  description:
    "Los avisos de la campana: primero lo que pide una acción (crítico, atención) y después las novedades. Cada aviso trae la pantalla " +
    "donde se resuelve. Usala para «¿hay algo urgente?», «¿qué avisos tengo?», «¿qué tengo que mirar?».",
  input: z.object({}),
  resource: "*",
  action: "view",
  async run(_input, ctx) {
    const [nR, cR] = await Promise.all([attempt(() => listNotifications("active", 30)), attempt(() => getUnreadCount())]);
    if (!nR.ok) return nR;
    const tz = ctx.org.timezone;
    const sev = (s: string) => SEVERITY[s] ?? SEVERITY.info;
    const list = [...nR.value].sort((a, b) => sev(a.severity).rank - sev(b.severity).rank || b.created_at.localeCompare(a.created_at));
    const actionable = list.filter((n) => sev(n.severity).rank <= 1);
    const hrefFor = (url: string | null): string | undefined => {
      const u = isInternalHref(url) ? url : null;
      if (isAdminLevel(ctx.role)) return u ?? hrefs.alerts();
      if (ctx.role === "owner_view") return u && isPathAllowedForOwner(u.split(/[?#]/)[0]) ? u : undefined;
      return u && u.startsWith("/m") ? u : undefined;
    };

    return {
      ok: true,
      data: {
        ...(cR.ok ? { piden_accion_sin_leer: cR.value } : {}),
        piden_accion: actionable.length,
        novedades: list.length - actionable.length,
        avisos: list.map((n) => ({
          titulo: clip(n.title, 120),
          detalle: clip(n.body, 160),
          gravedad: sev(n.severity).label,
          cuando: localYmd(n.created_at, tz),
          ...(n.read_at ? {} : { sin_leer: true }),
          ...(n.due_at ? { vence: localYmd(n.due_at, tz) } : {}),
        })),
      },
      card: {
        kind: "list",
        title: actionable.length ? `Avisos: ${actionable.length} para resolver` : "Avisos",
        icon: "bell",
        rows: list.slice(0, 12).map((n) => {
          const ymd = localYmd(n.created_at, tz);
          return {
            title: clip(n.title, 90) ?? "Aviso",
            subtitle: clip(n.body, 90),
            meta: ymd ? shortDate(ymd, ctx.today) : undefined,
            badge: { label: sev(n.severity).label, tone: sev(n.severity).tone },
            href: hrefFor(n.action_url),
          };
        }),
        more: Math.max(0, list.length - 12),
        empty: "No hay avisos abiertos.",
        footer: isAdminLevel(ctx.role) ? { label: "Ver todos los avisos", href: hrefs.alerts() } : undefined,
      },
    };
  },
});

// ── Limpieza ─────────────────────────────────────────────────────────────────

type CleaningRow = {
  id: string;
  unit_id: string;
  status: string;
  scheduled_for: string;
  assigned_to: string | null;
  notes: string | null;
  unit: UnitRefRow | null;
};

const DUE: Record<UnitCleanliness["due"], { label: string; rank: number }> = {
  now: { label: "sucia ahora", rank: 0 },
  today: { label: "sale el huésped hoy", rank: 1 },
  tomorrow: { label: "sale el huésped mañana", rank: 2 },
};

export const limpieza = defineRead({
  name: "limpieza",
  label: "Mirando la limpieza…",
  description:
    "Qué hay para limpiar. Para el equipo: las unidades sucias ahora, las que se liberan hoy y mañana (el aviso del día anterior), " +
    "con quién está asignada cada una, y las limpiezas programadas. Para el personal de limpieza: SUS limpiezas asignadas, con la dirección. " +
    "Usala para «¿qué hay que limpiar?», «¿quién limpia el 525?», «¿qué me toca hoy?».",
  input: z.object({}),
  resource: "cleaning",
  action: "view",
  async run(_input, ctx): Promise<ReadResult> {
    const tz = ctx.org.timezone;
    const when = (t: CleaningRow) => {
      const ymd = localYmd(t.scheduled_for, tz);
      return { ymd, label: [ymd ? shortDate(ymd, ctx.today) : null, localTime(t.scheduled_for, tz)].filter(Boolean).join(" ") };
    };

    if (!isAdminLevel(ctx.role)) {
      // listCleaningTasks ya devuelve sólo las tareas asignadas a esta persona.
      const r = await attempt(() => listCleaningTasks({}));
      if (!r.ok) return r;
      const mine = (r.value as unknown as CleaningRow[])
        .filter((t) => t.status === "pendiente" || t.status === "en_progreso")
        .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
      const href = ctx.role === "limpieza" ? "/m/limpieza" : "/m";
      return {
        ok: true,
        data: {
          mis_limpiezas: mine.length,
          limpiezas: mine.slice(0, 40).map((t) => {
            const w = when(t);
            return {
              unidad: unitLabel(t.unit),
              donde: whereLabel(t.unit),
              dia: w.ymd,
              hora: localTime(t.scheduled_for, tz),
              estado: t.status,
              ...(w.ymd && w.ymd < ctx.today ? { atrasada: true } : {}),
              notas: clip(t.notes, 140),
            };
          }),
        },
        card: {
          kind: "list",
          title: mine.length ? `Tus limpiezas (${mine.length})` : "Tus limpiezas",
          icon: "broom",
          rows: mine.slice(0, 12).map((t) => {
            const w = when(t);
            const late = Boolean(w.ymd && w.ymd < ctx.today);
            return {
              title: unitLabel(t.unit),
              subtitle: whereLabel(t.unit),
              meta: w.label,
              badge: late ? { label: "Atrasada", tone: "bad" } : t.status === "en_progreso" ? { label: "En curso", tone: "info" } : undefined,
              href,
            };
          }),
          more: Math.max(0, mine.length - 12),
          empty: "No tenés limpiezas pendientes.",
        },
      };
    }

    // Todas las tareas activas (no sólo las de hoy en adelante): una unidad sucia
    // por una limpieza atrasada tiene su tarea ANTES de hoy, con su asignada.
    const [cR, uR, tR, names] = await Promise.all([
      attempt(() => listUnitCleanliness()),
      attempt(() => listUnitRefs()),
      attempt(() => listCleaningTasks({})),
      memberNames(ctx.role),
    ]);
    if (!cR.ok) return cR;
    if (!uR.ok) return uR;
    const open = (tR.ok ? (tR.value as unknown as CleaningRow[]) : [])
      .filter((t) => t.status === "pendiente" || t.status === "en_progreso")
      .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
    const tasks = open.filter((t) => (localYmd(t.scheduled_for, tz) ?? "") >= ctx.today);
    const units = new Map(uR.value.map((u) => [u.id, u]));
    const taskByUnit = new Map<string, CleaningRow>();
    for (const t of open) if (!taskByUnit.has(t.unit_id)) taskByUnit.set(t.unit_id, t);
    const who = (userId: string | null | undefined) => assigneeName(names, userId, ctx.user.id, ctx.user.firstName);

    const dirty = Object.entries(cR.value)
      .filter(([unitId]) => units.has(unitId))
      .map(([unitId, c]) => ({ unit: units.get(unitId)!, c, task: taskByUnit.get(unitId) }))
      .sort(
        (a, b) =>
          DUE[a.c.due].rank - DUE[b.c.due].rank ||
          (a.c.overdueSince ?? "9999").localeCompare(b.c.overdueSince ?? "9999") ||
          a.unit.code.localeCompare(b.unit.code),
      );
    const count = (d: UnitCleanliness["due"]) => dirty.filter((x) => x.c.due === d).length;

    return {
      ok: true,
      data: {
        sucias_ahora: count("now"),
        se_liberan_hoy: count("today"),
        se_liberan_manana: count("tomorrow"),
        unidades: dirty.slice(0, 40).map((d) => ({
          unidad: unitLabel(d.unit),
          cuando: DUE[d.c.due].label,
          ...(d.c.overdueSince ? { atrasada_desde: d.c.overdueSince } : {}),
          asignada_a: d.task ? who(d.task.assigned_to) : "sin tarea creada",
        })),
        ...(tR.ok
          ? {
              limpiezas_programadas: tasks.slice(0, 40).map((t) => {
                const w = when(t);
                return { unidad: unitLabel(t.unit), dia: w.ymd, hora: localTime(t.scheduled_for, tz), estado: t.status, asignada_a: who(t.assigned_to) };
              }),
            }
          : { nota: "No pude leer las limpiezas programadas." }),
      },
      card: {
        kind: "list",
        title: dirty.length ? `Para limpiar (${dirty.length})` : "Para limpiar",
        icon: "broom",
        rows: dirty.slice(0, 14).map((d) => ({
          title: unitLabel(d.unit),
          subtitle: d.task ? (d.task.assigned_to ? `Asignada a ${who(d.task.assigned_to)}` : "Sin asignar") : "Sin tarea creada",
          badge:
            d.c.due === "now"
              ? d.c.overdueSince
                ? { label: "Atrasada", tone: "bad" }
                : { label: "Sucia", tone: "warn" }
              : d.c.due === "today"
                ? { label: "Sale hoy", tone: "info" }
                : { label: "Mañana", tone: "neutral" },
          href: hrefs.cleaning(),
        })),
        more: Math.max(0, dirty.length - 14),
        empty: "Todo limpio: no hay unidades para limpiar ni salidas hasta mañana.",
        footer: { label: "Ir a Limpieza", href: hrefs.cleaning() },
      },
    };
  },
});

// ── Mantenimiento ────────────────────────────────────────────────────────────

type TicketRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  opened_at: string;
  assigned_to: string | null;
  estimated_cost: number | string | null;
  cost_currency: string | null;
  billable_to: string;
  unit: UnitRefRow | null;
};

const TICKET_STATUSES = ["abierto", "en_progreso", "esperando_repuesto", "resuelto", "cerrado"] as const;
const BILLABLE: Record<string, string> = { owner: "el propietario", apartcba: "la administración", guest: "el huésped" };

export const tickets = defineRead({
  name: "tickets",
  label: "Mirando los arreglos…",
  description:
    "Los arreglos de mantenimiento (tickets): por defecto los abiertos, los urgentes primero, con unidad, estado, a quién están asignados " +
    "y quién paga. Se puede filtrar por estado o por unidad. Usala para «¿qué arreglos hay pendientes?», «¿qué pasa en el 525?». " +
    "El personal de mantenimiento ve sólo los suyos.",
  input: z.object({
    estado: z.enum(TICKET_STATUSES).describe("abierto, en_progreso, esperando_repuesto, resuelto o cerrado. Sin estado: todos los abiertos.").optional(),
    unidad: z.string().max(80).describe("Código o nombre de la unidad, si preguntan por una.").optional(),
  }),
  resource: "tickets",
  action: "view",
  async run(input, ctx): Promise<ReadResult> {
    let unitId: string | undefined;
    if (input.unidad?.trim()) {
      const u = await resolveUnit(input.unidad);
      if (u.ok === false) return u;
      if (u.ok === "choose") return { ok: true, data: { necesito_elegir: u.question, opciones: u.options } };
      unitId = u.value.id;
    }
    const closed = input.estado === "resuelto" || input.estado === "cerrado";
    const [tR, names] = await Promise.all([
      attempt(() => listTickets({ openOnly: !closed, status: input.estado, unitId })),
      memberNames(ctx.role),
    ]);
    if (!tR.ok) return tR;
    const tz = ctx.org.timezone;
    const rows = (tR.value as unknown as TicketRow[]).sort(
      (a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || a.opened_at.localeCompare(b.opened_at),
    );
    const who = (userId: string | null) => assigneeName(names, userId, ctx.user.id, ctx.user.firstName);
    const title = input.estado ? `Arreglos: ${ticketStatusLabel(input.estado).toLowerCase()}` : "Arreglos abiertos";

    return {
      ok: true,
      data: {
        total: rows.length,
        urgentes: rows.filter((t) => t.priority === "urgente").length,
        tickets: rows.slice(0, 40).map((t) => ({
          ticket_id: t.id,
          unidad: unitLabel(t.unit),
          titulo: clip(t.title, 120),
          detalle: clip(t.description, 140),
          prioridad: t.priority,
          estado: t.status,
          abierto_el: localYmd(t.opened_at, tz),
          asignado_a: who(t.assigned_to),
          ...(t.estimated_cost ? { costo_estimado: money(t.estimated_cost, t.cost_currency || ctx.org.currency) } : {}),
          paga: BILLABLE[t.billable_to] ?? t.billable_to,
        })),
      },
      card: {
        kind: "list",
        title: rows.length ? `${title} (${rows.length})` : title,
        icon: "wrench",
        rows: rows.slice(0, 12).map((t) => {
          const ymd = localYmd(t.opened_at, tz);
          return {
            title: clip(t.title, 70) ?? "Arreglo",
            subtitle: [t.unit?.code ?? unitLabel(t.unit), ticketStatusLabel(t.status), t.assigned_to ? who(t.assigned_to) : null]
              .filter(Boolean)
              .join(" · "),
            meta: ymd ? shortDate(ymd, ctx.today) : undefined,
            badge: { label: ticketPriorityLabel(t.priority), tone: priorityTone(t.priority) },
            href: hrefs.ticketField(t.id),
          };
        }),
        more: Math.max(0, rows.length - 12),
        empty: closed ? "No hay arreglos en ese estado." : "No hay arreglos abiertos.",
        footer: { label: "Ir a Mantenimiento", href: isField(ctx.role) ? "/m/mantenimiento" : hrefs.maintenance() },
      },
    };
  },
});

// ── Conserjería ──────────────────────────────────────────────────────────────

type ConciergeRow = {
  id: string;
  description: string;
  request_type: string | null;
  status: string;
  priority: string;
  scheduled_for: string | null;
  cost: number | string | null;
  cost_currency: string | null;
  unit: { code: string; name: string } | null;
  guest: { full_name: string } | null;
  assignee: { full_name: string | null } | null;
  has_alert: boolean;
};

const CONCIERGE_STATUSES = ["pendiente", "en_progreso", "completada", "rechazada", "cancelada"] as const;

export const tareas = defineRead({
  name: "tareas",
  label: "Mirando las tareas…",
  description:
    "Las tareas de conserjería (pedidos de huéspedes, traslados, compras, recordatorios del equipo): por defecto las pendientes y en curso, " +
    "por fecha. Usala para «¿qué tareas hay para hoy?», «¿quedó algo pendiente con los huéspedes?».",
  input: z.object({
    estado: z.enum(CONCIERGE_STATUSES).describe("pendiente, en_progreso, completada, rechazada o cancelada. Sin estado: pendientes y en curso.").optional(),
  }),
  resource: "concierge",
  action: "view",
  async run(input, ctx) {
    const r = await attempt(() => listConciergeRequests(input.estado ? { status: input.estado } : undefined));
    if (!r.ok) return r;
    const tz = ctx.org.timezone;
    const now = Date.now();
    const rows = (r.value as unknown as ConciergeRow[]).filter(
      (t) => input.estado || t.status === "pendiente" || t.status === "en_progreso",
    );
    const isOpen = (t: ConciergeRow) => t.status === "pendiente" || t.status === "en_progreso";

    return {
      ok: true,
      data: {
        total: rows.length,
        tareas: rows.slice(0, 40).map((t) => ({
          tarea_id: t.id,
          que: clip(t.description, 160),
          tipo: t.request_type ?? undefined,
          unidad: t.unit ? unitLabel(t.unit) : undefined,
          huesped: t.guest?.full_name ?? undefined,
          prioridad: t.priority,
          estado: t.status,
          para: t.scheduled_for ? `${localYmd(t.scheduled_for, tz)} ${localTime(t.scheduled_for, tz) ?? ""}`.trim() : undefined,
          ...(t.scheduled_for && isOpen(t) && Date.parse(t.scheduled_for) < now ? { atrasada: true } : {}),
          asignada_a: t.assignee?.full_name ?? "sin asignar",
          ...(t.cost ? { costo: money(t.cost, t.cost_currency || ctx.org.currency) } : {}),
          ...(t.has_alert ? { con_aviso: true } : {}),
        })),
      },
      card: {
        kind: "list",
        title: rows.length ? `Tareas (${rows.length})` : "Tareas",
        icon: "list",
        rows: rows.slice(0, 12).map((t) => {
          const ymd = t.scheduled_for ? localYmd(t.scheduled_for, tz) : null;
          return {
            title: clip(t.description, 70) ?? "Tarea",
            subtitle: [t.unit?.code, t.guest?.full_name, t.assignee?.full_name].filter(Boolean).join(" · ") || undefined,
            meta: ymd ? [shortDate(ymd, ctx.today), localTime(t.scheduled_for, tz)].filter(Boolean).join(" ") : undefined,
            badge:
              t.priority === "alta" || t.priority === "urgente"
                ? { label: t.priority === "urgente" ? "Urgente" : "Alta", tone: priorityTone(t.priority) }
                : t.status === "en_progreso"
                  ? { label: "En curso", tone: "info" }
                  : undefined,
            href: hrefs.tasks(),
          };
        }),
        more: Math.max(0, rows.length - 12),
        empty: input.estado ? "No hay tareas en ese estado." : "No hay tareas pendientes.",
        footer: { label: "Ir a Tareas", href: hrefs.tasks() },
      },
    };
  },
});
