/**
 * Operación del día (nov-2026): limpieza, arreglos (tickets de mantenimiento) y
 * tareas (conserjería).
 *
 * Varias de estas actions no chequean permisos ni pertenencia por adentro:
 * - `changeCleaningStatus` no mira a quién está asignada la tarea → para el rol
 *   limpieza se resuelve SÓLO entre las suyas (`listCleaningTasks` filtra por
 *   `assigned_to` para quien no es admin) y se vuelve a verificar al confirmar.
 * - `createTicket` / `createConciergeRequest` no validan que la unidad sea de la
 *   organización → la unidad sale siempre de `resolveUnit` (lista org-scoped).
 * - `changeTicketStatus` no mira la asignación → mantenimiento resuelve sólo
 *   entre sus tickets (`listTickets` ya los filtra) y se re-verifica.
 */
import { z } from "zod/v4";
import { changeCleaningStatus, listCleaningTasks, listUnitCleanliness, setUnitCleanliness } from "@/lib/actions/cleaning";
import { changeConciergeStatus, createConciergeRequest, listConciergeRequests } from "@/lib/actions/concierge";
import { changeTicketStatus, createTicket, listTickets } from "@/lib/actions/tickets";
import type { UnitCleanliness } from "@/lib/cleaning/cleanliness";
import { CLEANING_STATUS_META, TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { DEFAULT_ORG_TIMEZONE, ymdInTz, zonedTimeToUtc } from "@/lib/dates";
import { isAdminLevel } from "@/lib/permissions";
import type { CleaningStatus, ConciergePriority, ConciergeStatus, TicketPriority, TicketStatus } from "@/lib/types/database";
import { attempt, defineWrite, hrefs, type ChoiceOption, type ToolContext } from "../../tool";
import { clip, dateRange, fold, isYmd, shortDate } from "../../format";
import { resolveUnit, type UnitRef } from "../_resolve";
import { attemptResult, findBooking, idSchema, joinNotes, loadBooking, UUID_RE } from "./_shared";

type UnitJoin = { id: string; code: string; name: string } | null;

const tzOf = (ctx: ToolContext) => ctx.org.timezone || DEFAULT_ORG_TIMEZONE;

/** "sáb 14 nov · 15:30" de un timestamptz, visto en la zona de la organización. */
function localWhen(iso: string, ctx: ToolContext): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const time = new Intl.DateTimeFormat("es-AR", { timeZone: tzOf(ctx), hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${shortDate(ymdInTz(d, tzOf(ctx)), ctx.today)} · ${time}`;
}

/** Filas cuya unidad coincide con lo que dijo la persona (o el id de la fila / de la unidad, de una lista anterior). */
function matchByUnit<T extends { id: string; unit_id: string | null; unit: UnitJoin }>(rows: T[], query: string): T[] {
  const raw = query.trim();
  if (UUID_RE.test(raw)) return rows.filter((r) => r.id === raw || r.unit_id === raw);
  const q = fold(raw);
  if (!q) return rows;
  const exact = rows.filter((r) => fold(r.unit?.code) === q || fold(r.unit?.name) === q);
  if (exact.length > 0) return exact;
  return rows.filter((r) => {
    const code = fold(r.unit?.code);
    const name = fold(r.unit?.name);
    return code.includes(q) || name.includes(q) || (code.length >= 3 && q.includes(code));
  });
}

/** Todas las palabras dichas aparecen en el texto (sin tildes ni mayúsculas). */
function matchWords<T>(rows: T[], query: string, text: (r: T) => string): T[] {
  const ws = fold(query)
    .replace(/[.,;:¿?¡!"'()]/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2);
  if (ws.length === 0) return rows;
  return rows.filter((r) => {
    const t = fold(text(r));
    return ws.every((w) => t.includes(w));
  });
}

const unitText = (u: UnitJoin) => (u ? `${u.code} · ${u.name}` : "Sin unidad");

// ── marcar_limpieza ─────────────────────────────────────────────────────────

type CleaningRow = {
  id: string;
  unit_id: string;
  status: CleaningStatus;
  scheduled_for: string;
  assigned_to: string | null;
  unit: UnitJoin;
};

const OPEN_CLEANING = new Set<CleaningStatus>(["pendiente", "en_progreso"]);

function cleanlinessLabel(c: UnitCleanliness | null, today: string): string {
  if (!c) return "Limpia";
  if (c.due === "now") return c.overdueSince ? `Sucia, atrasada desde el ${shortDate(c.overdueSince, today)}` : "Sucia, para limpiar";
  if (c.due === "today") return "Sale alguien hoy";
  return "Sale alguien mañana";
}

export const marcarLimpieza = defineWrite({
  name: "marcar_limpieza",
  label: "Preparando la limpieza…",
  description:
    "Prepara el cambio de limpieza de una unidad para que la persona lo confirme. Administración y recepción: marcar una unidad limpia " +
    "(cierra lo pendiente de hoy y mañana) o sucia (le aparece a limpieza). Personal de limpieza: marcar terminada SU limpieza de esa unidad.",
  input: z.object({
    unidad: z.string().describe("Código o nombre de la unidad, o el id que la persona eligió de una lista."),
    estado: z.enum(["limpio", "sucio"]).describe("limpio = ya quedó limpia / terminé; sucio = hay que limpiarla."),
  }),
  payload: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("unidad"), unit_id: idSchema, target: z.enum(["limpio", "sucio"]) }),
    z.object({ mode: z.literal("tarea"), task_id: idSchema, unit_id: idSchema }),
  ]),
  resource: "cleaning",
  action: "update",
  async propose(input, ctx) {
    if (isAdminLevel(ctx.role)) {
      const u = await resolveUnit(input.unidad);
      if (u.ok !== true) return u;
      const unit = u.value;
      const cl = await attempt(() => listUnitCleanliness());
      if (!cl.ok) return cl;
      const now = cl.value[unit.id] ?? null;
      if (input.estado === "limpio" && !now) return { ok: false, error: `${unit.code} ya figura limpia: no hay nada pendiente para cerrar.` };
      if (input.estado === "sucio" && now?.due === "now") {
        return { ok: false, error: `${unit.code} ya figura ${cleanlinessLabel(now, ctx.today).toLowerCase()}.` };
      }
      const limpio = input.estado === "limpio";
      return {
        ok: true,
        payload: { mode: "unidad" as const, unit_id: unit.id, target: input.estado },
        summary: {
          title: limpio ? "Marcar la unidad como limpia" : "Marcar la unidad como sucia",
          lines: [
            { label: "Unidad", value: `${unit.code} · ${unit.name}` },
            { label: "Ahora figura", value: cleanlinessLabel(now, ctx.today) },
            { label: "Queda", value: limpio ? "Limpia" : "Sucia, para limpiar" },
          ],
          note: limpio
            ? "Cierra las limpiezas pendientes de hoy y de mañana. Si después se marca un check-out, vuelve a aparecer sucia."
            : "Le aparece al equipo de limpieza como pendiente.",
          confirmLabel: limpio ? "Marcar limpia" : "Marcar sucia",
        },
      };
    }

    // Personal de limpieza: sólo cierra una limpieza propia.
    if (input.estado === "sucio") {
      return { ok: false, error: "Desde acá sólo podés marcar terminada una limpieza tuya. Si una unidad quedó sucia, avisale a recepción." };
    }
    const t = await attempt(() => listCleaningTasks({}));
    if (!t.ok) return t;
    const mine = (t.value as CleaningRow[]).filter((r) => r.assigned_to === ctx.user.id && OPEN_CLEANING.has(r.status));
    if (mine.length === 0) return { ok: false, error: "No tenés limpiezas pendientes asignadas." };
    const byUnit = matchByUnit(mine, input.unidad);
    if (byUnit.length === 0) {
      const units = [...new Set(mine.map((r) => r.unit?.code).filter(Boolean))].slice(0, 10).join(", ");
      return { ok: false, error: `No tenés una limpieza pendiente en «${input.unidad}». Las tuyas: ${units}.` };
    }
    const day = (r: CleaningRow) => ymdInTz(new Date(r.scheduled_for), tzOf(ctx));
    let pick: CleaningRow | null = byUnit.length === 1 ? byUnit[0] : null;
    if (!pick && new Set(byUnit.map((r) => r.unit_id)).size === 1) {
      const due = byUnit.filter((r) => day(r) <= ctx.today);
      if (due.length === 1) pick = due[0];
    }
    if (!pick) {
      const options: ChoiceOption[] = [...byUnit]
        .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
        .slice(0, 8)
        .map((r) => ({ id: r.id, label: unitText(r.unit), detail: `${shortDate(day(r), ctx.today)} · ${CLEANING_STATUS_META[r.status].label}` }));
      return { ok: "choose", question: `Tenés ${byUnit.length} limpiezas pendientes que coinciden. ¿Cuál terminaste?`, options };
    }
    return {
      ok: true,
      payload: { mode: "tarea" as const, task_id: pick.id, unit_id: pick.unit_id },
      summary: {
        title: "Terminar una limpieza",
        lines: [
          { label: "Unidad", value: unitText(pick.unit) },
          { label: "Día", value: shortDate(day(pick), ctx.today) },
          { label: "Estado", value: `${CLEANING_STATUS_META[pick.status].label} → Completada` },
        ],
        note: day(pick) > ctx.today ? "Es una limpieza programada para más adelante." : undefined,
        confirmLabel: "Marcar terminada",
      },
    };
  },
  async execute(p, ctx) {
    if (p.mode === "unidad") {
      if (!isAdminLevel(ctx.role)) return { ok: false, error: "No tenés permiso para marcar unidades limpias o sucias." };
      const r = await attemptResult(() => setUnitCleanliness(p.unit_id, p.target));
      if (!r.ok) return r;
      const u = await resolveUnit(p.unit_id);
      const code = u.ok === true ? u.value.code : "La unidad";
      return {
        ok: true,
        message: p.target === "limpio" ? `Listo: ${code} figura limpia.` : `Listo: ${code} figura sucia, para limpiar.`,
        href: hrefs.cleaning(),
      };
    }
    const t = await attempt(() => listCleaningTasks({}));
    if (!t.ok) return t;
    const task = (t.value as CleaningRow[]).find((r) => r.id === p.task_id);
    if (!task || task.assigned_to !== ctx.user.id) return { ok: false, error: "Esa limpieza ya no está asignada a vos. No toqué nada." };
    if (!OPEN_CLEANING.has(task.status)) return { ok: false, error: "Esa limpieza ya figura terminada." };
    const r = await attempt(() => changeCleaningStatus(p.task_id, "completada"));
    if (!r.ok) return r;
    return { ok: true, message: `Limpieza terminada: ${unitText(task.unit)}.`, href: "/m/limpieza" };
  },
});

// ── crear_ticket ────────────────────────────────────────────────────────────

const TICKET_CATEGORIES = ["plomeria", "electricidad", "electrodomestico", "pintura", "otro"] as const;
const TICKET_CATEGORY_LABEL: Record<(typeof TICKET_CATEGORIES)[number], string> = {
  plomeria: "Plomería",
  electricidad: "Electricidad",
  electrodomestico: "Electrodoméstico",
  pintura: "Pintura",
  otro: "Otro",
};
const TICKET_PRIORITIES = ["baja", "media", "alta", "urgente"] as const;

export const crearTicket = defineWrite({
  name: "crear_ticket",
  label: "Preparando el arreglo…",
  description:
    "Prepara un ARREGLO (ticket de mantenimiento) en una unidad para que la persona lo confirme: algo roto o que hay que reparar " +
    "(pérdida, enchufe, electrodoméstico, pintura). Para encargos o recordatorios que no son reparaciones usá crear_tarea.",
  input: z.object({
    unidad: z.string().describe("Código o nombre de la unidad, o el id que la persona eligió de una lista."),
    titulo: z.string().min(2).max(120).describe("Qué hay que arreglar, corto (ej. «Pérdida en la canilla del baño»)."),
    detalle: z.string().max(1000).describe("Más detalle si lo dieron.").optional(),
    prioridad: z.enum(TICKET_PRIORITIES).describe("Si no la dijeron, media. urgente = deja la unidad inutilizable o hay daño en curso.").optional(),
    categoria: z.enum(TICKET_CATEGORIES).describe("Si es claro: plomeria, electricidad, electrodomestico, pintura u otro.").optional(),
  }),
  payload: z.object({
    unit_id: idSchema,
    title: z.string().min(2).max(120),
    description: z.string().max(1000).nullable(),
    priority: z.enum(TICKET_PRIORITIES),
    category: z.enum(TICKET_CATEGORIES).nullable(),
  }),
  resource: "tickets",
  action: "create",
  async propose(input, ctx) {
    const u = await resolveUnit(input.unidad);
    if (u.ok !== true) return u;
    const title = clip(input.titulo, 120);
    if (!title || title.length < 2) return { ok: false, error: "Decime qué hay que arreglar." };
    const description = clip(input.detalle, 1000) ?? null;
    const priority = input.prioridad ?? "media";
    const category = input.categoria ?? null;
    return {
      ok: true,
      payload: { unit_id: u.value.id, title, description, priority, category },
      summary: {
        title: "Cargar un arreglo",
        lines: [
          { label: "Unidad", value: `${u.value.code} · ${u.value.name}` },
          { label: "Arreglo", value: title },
          ...(description ? [{ label: "Detalle", value: description }] : []),
          { label: "Prioridad", value: TICKET_PRIORITY_META[priority].label },
          ...(category ? [{ label: "Categoría", value: TICKET_CATEGORY_LABEL[category] }] : []),
        ],
        note: isAdminLevel(ctx.role) ? undefined : "Queda sin asignar: lo asigna recepción.",
        confirmLabel: "Cargar arreglo",
      },
    };
  },
  async execute(p, ctx) {
    const u = await resolveUnit(p.unit_id);
    if (u.ok !== true) return { ok: false, error: "La unidad ya no existe o está archivada. No cargué nada." };
    const r = await attempt(() =>
      createTicket({
        unit_id: p.unit_id,
        title: p.title,
        description: p.description,
        category: p.category,
        priority: p.priority,
        status: "abierto",
        cost_currency: ctx.org.currency || "ARS",
        billable_to: "apartcba",
      }),
    );
    if (!r.ok) return r;
    return {
      ok: true,
      message: `Arreglo cargado: «${p.title}» en ${u.value.code}.`,
      href: isAdminLevel(ctx.role) ? hrefs.maintenance() : undefined,
      data: { ticket_id: r.value.id },
    };
  },
});

// ── cambiar_estado_ticket ───────────────────────────────────────────────────

type TicketRow = {
  id: string;
  unit_id: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  unit: UnitJoin;
};

const TICKET_STATUSES = ["abierto", "en_progreso", "esperando_repuesto", "resuelto", "cerrado"] as const;
const TICKET_CONFIRM: Record<TicketStatus, string> = {
  abierto: "Reabrir arreglo",
  en_progreso: "Pasar a en progreso",
  esperando_repuesto: "Marcar esperando repuesto",
  resuelto: "Marcar resuelto",
  cerrado: "Cerrar arreglo",
};

/** Desde qué estados tiene sentido pasar a `target` (uno cerrado sólo se reabre). */
const canMoveTo = (from: TicketStatus, target: TicketStatus) =>
  from !== target && (target === "abierto" || target === "cerrado" || from !== "cerrado");

export const cambiarEstadoTicket = defineWrite({
  name: "cambiar_estado_ticket",
  label: "Preparando el cambio del arreglo…",
  description:
    "Prepara el cambio de estado de un ARREGLO (ticket de mantenimiento) para que la persona lo confirme: en progreso, esperando repuesto, " +
    "resuelto, cerrado o reabrirlo. Lo encuentra por la unidad y/o palabras del título; si hay varios, pregunta.",
  input: z.object({
    arreglo: z
      .string()
      .describe("Palabras del título del arreglo (ej. «canilla», «aire acondicionado»), o el id que la persona eligió de una lista.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad del arreglo.").optional(),
    estado: z.enum(TICKET_STATUSES).describe("Estado al que pasa."),
  }),
  payload: z.object({
    ticket_id: idSchema,
    status: z.enum(TICKET_STATUSES),
    from_status: z.enum(TICKET_STATUSES),
  }),
  resource: "tickets",
  action: "update",
  async propose(input) {
    const arreglo = input.arreglo?.trim() ?? "";
    const unidad = input.unidad?.trim() ?? "";
    if (!arreglo && !unidad) return { ok: false, error: "Decime qué arreglo es (unas palabras del título) o de qué unidad." };
    const t = await attempt(() => listTickets({}));
    if (!t.ok) return t;
    const all = t.value as TicketRow[];
    const target = input.estado;

    let pool: TicketRow[];
    if (UUID_RE.test(arreglo)) {
      pool = all.filter((r) => r.id === arreglo);
      if (pool.length === 0) return { ok: false, error: "No encontré ese arreglo (o no está a tu cargo)." };
    } else {
      pool = all;
      if (unidad) pool = matchByUnit(pool, unidad);
      if (arreglo) pool = matchWords(pool, arreglo, (r) => `${r.title} ${r.description ?? ""} ${r.unit?.code ?? ""} ${r.unit?.name ?? ""}`);
    }
    const movable = pool.filter((r) => canMoveTo(r.status, target));
    if (movable.length === 0) {
      if (pool.length > 0) {
        const r = pool[0];
        return {
          ok: false,
          error:
            r.status === target
              ? `«${r.title}» (${r.unit?.code ?? "sin unidad"}) ya está ${TICKET_STATUS_META[target].label.toLowerCase()}.`
              : `«${r.title}» está cerrado: primero hay que reabrirlo.`,
        };
      }
      return { ok: false, error: "No encontré un arreglo que coincida. Decime la unidad o unas palabras del título." };
    }
    if (movable.length > 1) {
      return {
        ok: "choose",
        question: `Hay ${movable.length} arreglos que coinciden. ¿Cuál es?`,
        options: movable.slice(0, 8).map((r) => ({
          id: r.id,
          label: r.title,
          detail: `${r.unit?.code ?? "Sin unidad"} · ${TICKET_STATUS_META[r.status].label} · prioridad ${TICKET_PRIORITY_META[r.priority]?.label.toLowerCase() ?? r.priority}`,
        })),
      };
    }
    const r = movable[0];
    return {
      ok: true,
      payload: { ticket_id: r.id, status: target, from_status: r.status },
      summary: {
        title: "Cambiar el estado de un arreglo",
        lines: [
          { label: "Arreglo", value: r.title },
          { label: "Unidad", value: unitText(r.unit) },
          { label: "Estado", value: `${TICKET_STATUS_META[r.status].label} → ${TICKET_STATUS_META[target].label}` },
          { label: "Prioridad", value: TICKET_PRIORITY_META[r.priority]?.label ?? r.priority },
        ],
        confirmLabel: TICKET_CONFIRM[target],
      },
    };
  },
  async execute(p, ctx) {
    const t = await attempt(() => listTickets({}));
    if (!t.ok) return t;
    const r = (t.value as TicketRow[]).find((x) => x.id === p.ticket_id);
    if (!r) return { ok: false, error: "Ese arreglo ya no está (o no está a tu cargo). No toqué nada." };
    if (r.status !== p.from_status) {
      return { ok: false, error: `El arreglo cambió mientras tanto: ahora está ${TICKET_STATUS_META[r.status].label.toLowerCase()}. No toqué nada.` };
    }
    const res = await attempt(() => changeTicketStatus(p.ticket_id, p.status));
    if (!res.ok) return res;
    return {
      ok: true,
      message: `Arreglo «${r.title}» (${r.unit?.code ?? "sin unidad"}): ${TICKET_STATUS_META[p.status].label.toLowerCase()}.`,
      href: isAdminLevel(ctx.role) ? hrefs.maintenance() : hrefs.ticketField(p.ticket_id),
    };
  },
});

// ── crear_tarea ─────────────────────────────────────────────────────────────

const CONCIERGE_PRIORITIES = ["baja", "normal", "alta", "urgente"] as const;
const CONCIERGE_PRIORITY_LABEL: Record<ConciergePriority, string> = { baja: "Baja", normal: "Normal", alta: "Alta", urgente: "Urgente" };
const CONCIERGE_STATUS_LABEL: Record<ConciergeStatus, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completada: "Completada",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
};
const DEFAULT_TASK_TIME = "09:00";

export const crearTarea = defineWrite({
  name: "crear_tarea",
  label: "Preparando la tarea…",
  description:
    "Prepara una TAREA (conserjería: un encargo, recordatorio o pedido de un huésped, como llevar toallas, entregar llaves o comprar algo) " +
    "para que la persona la confirme. Puede ir atada a una unidad o a una reserva y tener día y hora. Para reparaciones usá crear_ticket.",
  input: z.object({
    descripcion: z.string().min(2).max(500).describe("Qué hay que hacer (ej. «Llevar juego de toallas extra»)."),
    unidad: z.string().describe("Código o nombre de la unidad, si es de un depto.").optional(),
    reserva: z.string().describe("Si es para un huésped: su nombre y apellido o el código de la reserva (o el id elegido de una lista).").optional(),
    fecha: z.string().describe("Día en que hay que hacerla, YYYY-MM-DD. Si no la dijeron, omitir.").optional(),
    hora: z.string().describe("Hora HH:MM (24 h), si la dijeron.").optional(),
    prioridad: z.enum(CONCIERGE_PRIORITIES).describe("Si no la dijeron, normal.").optional(),
  }),
  payload: z.object({
    description: z.string().min(2).max(500),
    unit_id: idSchema.nullable(),
    booking_id: idSchema.nullable(),
    guest_id: idSchema.nullable(),
    scheduled_for: z.string().max(40).nullable(),
    priority: z.enum(CONCIERGE_PRIORITIES),
  }),
  resource: "concierge",
  action: "create",
  async propose(input, ctx) {
    const description = clip(input.descripcion, 500);
    if (!description || description.length < 2) return { ok: false, error: "Decime qué hay que hacer." };

    let unit: UnitRef | null = null;
    let booking: { id: string; guestId: string | null; guest: string | null; checkIn: string; checkOut: string } | null = null;
    if (input.reserva?.trim()) {
      const f = await findBooking(input.reserva, { unidad: input.unidad, today: ctx.today });
      if (f.ok !== true) return f;
      const bk = await loadBooking(f.value.id);
      if (!bk.ok) return bk;
      const b = bk.value;
      booking = { id: b.id, guestId: b.guest_id, guest: b.guest?.full_name ?? null, checkIn: b.check_in_date, checkOut: b.check_out_date };
      unit = b.unit ? { id: b.unit.id, code: b.unit.code, name: b.unit.name } : null;
    } else if (input.unidad?.trim()) {
      const u = await resolveUnit(input.unidad);
      if (u.ok !== true) return u;
      unit = u.value;
    }

    const hora = input.hora?.trim() || undefined;
    if (hora && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(hora)) return { ok: false, error: "La hora va como HH:MM (ej. 15:30)." };
    const fecha = input.fecha?.trim() || (hora ? ctx.today : undefined);
    if (fecha && !isYmd(fecha)) return { ok: false, error: "El día va en formato YYYY-MM-DD." };
    const time = (hora ?? DEFAULT_TASK_TIME).padStart(5, "0");
    const scheduledFor = fecha ? zonedTimeToUtc(fecha, time, tzOf(ctx)).toISOString() : null;
    const priority = input.prioridad ?? "normal";

    return {
      ok: true,
      payload: {
        description,
        unit_id: unit?.id ?? null,
        booking_id: booking?.id ?? null,
        guest_id: booking?.guestId ?? null,
        scheduled_for: scheduledFor,
        priority,
      },
      summary: {
        title: "Crear una tarea",
        lines: [
          { label: "Tarea", value: description },
          ...(unit ? [{ label: "Unidad", value: `${unit.code} · ${unit.name}` }] : []),
          ...(booking
            ? [{ label: "Reserva", value: `${booking.guest ?? "Sin huésped"} · ${dateRange(booking.checkIn, booking.checkOut)}` }]
            : []),
          { label: "Para", value: fecha ? `${shortDate(fecha, ctx.today)} · ${time}` : "Sin fecha" },
          { label: "Prioridad", value: CONCIERGE_PRIORITY_LABEL[priority] },
        ],
        note: joinNotes([
          fecha && !hora && `Sin hora: queda para las ${DEFAULT_TASK_TIME}.`,
          fecha && fecha < ctx.today && "El día ya pasó.",
        ]),
        confirmLabel: "Crear tarea",
      },
    };
  },
  async execute(p, ctx) {
    if (p.unit_id) {
      const u = await resolveUnit(p.unit_id);
      if (u.ok !== true) return { ok: false, error: "La unidad ya no existe o está archivada. No creé nada." };
    }
    if (p.booking_id) {
      const b = await loadBooking(p.booking_id);
      if (!b.ok) return { ok: false, error: "La reserva ya no está. No creé nada." };
    }
    const r = await attempt(() =>
      createConciergeRequest({
        description: p.description,
        unit_id: p.unit_id,
        booking_id: p.booking_id,
        guest_id: p.guest_id,
        scheduled_for: p.scheduled_for,
        priority: p.priority,
        status: "pendiente",
        cost_currency: ctx.org.currency || "ARS",
        charge_to_guest: false,
        alert_enabled: false,
        alert_severity: "info",
        alert_offset_hours: 0,
      }),
    );
    if (!r.ok) return r;
    const when = p.scheduled_for ? ` para el ${localWhen(p.scheduled_for, ctx)}` : "";
    return {
      ok: true,
      message: `Tarea creada: «${clip(p.description, 80)}»${when}.`,
      href: hrefs.tasks(),
      data: { tarea_id: r.value.id },
    };
  },
});

// ── completar_tarea ─────────────────────────────────────────────────────────

type ConciergeRow = {
  id: string;
  description: string;
  status: ConciergeStatus;
  priority: ConciergePriority;
  scheduled_for: string | null;
  unit_id: string | null;
  unit: UnitJoin;
  guest: { id: string; full_name: string | null } | null;
};

const OPEN_TASK = new Set<ConciergeStatus>(["pendiente", "en_progreso"]);

export const completarTarea = defineWrite({
  name: "completar_tarea",
  label: "Preparando la tarea…",
  description:
    "Prepara marcar como COMPLETADA una tarea pendiente (conserjería) para que la persona lo confirme. La encuentra por palabras de la " +
    "descripción, la unidad o el huésped; si hay varias, pregunta. Para arreglos de mantenimiento usá cambiar_estado_ticket.",
  input: z.object({
    tarea: z
      .string()
      .describe("Palabras de la tarea (ej. «toallas», «llaves»), el huésped, o el id que la persona eligió de una lista."),
    unidad: z.string().describe("Código o nombre de la unidad, si hace falta para distinguir.").optional(),
  }),
  payload: z.object({
    request_id: idSchema,
    from_status: z.enum(["pendiente", "en_progreso"]),
  }),
  resource: "concierge",
  action: "update",
  async propose(input, ctx) {
    const l = await attempt(() => listConciergeRequests({}));
    if (!l.ok) return l;
    const all = l.value as unknown as ConciergeRow[];
    const q = input.tarea.trim();
    let pool: ConciergeRow[];
    if (UUID_RE.test(q)) {
      const hit = all.find((r) => r.id === q);
      if (!hit) return { ok: false, error: "No encontré esa tarea." };
      if (!OPEN_TASK.has(hit.status)) return { ok: false, error: `Esa tarea ya está ${CONCIERGE_STATUS_LABEL[hit.status].toLowerCase()}.` };
      pool = [hit];
    } else {
      pool = all.filter((r) => OPEN_TASK.has(r.status));
      if (input.unidad?.trim()) pool = matchByUnit(pool, input.unidad);
      pool = matchWords(pool, q, (r) => `${r.description} ${r.unit?.code ?? ""} ${r.unit?.name ?? ""} ${r.guest?.full_name ?? ""}`);
    }
    if (pool.length === 0) return { ok: false, error: `No encontré una tarea pendiente que coincida con «${q}».` };
    const when = (r: ConciergeRow) => (r.scheduled_for ? localWhen(r.scheduled_for, ctx) : "sin fecha");
    if (pool.length > 1) {
      return {
        ok: "choose",
        question: `Hay ${pool.length} tareas pendientes que coinciden. ¿Cuál es?`,
        options: pool.slice(0, 8).map((r) => ({
          id: r.id,
          label: clip(r.description, 70) ?? "Tarea",
          detail: `${r.unit?.code ?? "Sin unidad"} · ${when(r)} · ${CONCIERGE_STATUS_LABEL[r.status]}`,
        })),
      };
    }
    const r = pool[0];
    const fromStatus = r.status === "en_progreso" ? ("en_progreso" as const) : ("pendiente" as const);
    return {
      ok: true,
      payload: { request_id: r.id, from_status: fromStatus },
      summary: {
        title: "Completar una tarea",
        lines: [
          { label: "Tarea", value: clip(r.description, 200) ?? "Tarea" },
          ...(r.unit ? [{ label: "Unidad", value: unitText(r.unit) }] : []),
          ...(r.guest?.full_name ? [{ label: "Huésped", value: r.guest.full_name }] : []),
          { label: "Para", value: when(r) },
          { label: "Estado", value: `${CONCIERGE_STATUS_LABEL[r.status]} → Completada` },
        ],
        confirmLabel: "Marcar completada",
      },
    };
  },
  async execute(p) {
    const l = await attempt(() => listConciergeRequests({}));
    if (!l.ok) return l;
    const r = (l.value as unknown as ConciergeRow[]).find((x) => x.id === p.request_id);
    if (!r) return { ok: false, error: "Esa tarea ya no está. No toqué nada." };
    if (!OPEN_TASK.has(r.status)) {
      return { ok: false, error: `Esa tarea ya está ${CONCIERGE_STATUS_LABEL[r.status].toLowerCase()}. No toqué nada.` };
    }
    const res = await attempt(() => changeConciergeStatus(p.request_id, "completada"));
    if (!res.ok) return res;
    return { ok: true, message: `Tarea completada: «${clip(r.description, 80)}».`, href: hrefs.tasks() };
  },
});
