"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can, isAdminLevel } from "@/lib/permissions";
import { pickChargeOwner, type UnitOwnerLite } from "@/lib/settlements/charge-owner";
import { UNIT_REF_SELECT } from "@/lib/constants";
import type { MaintenanceTicket, TicketEvent, TicketStatus } from "@/lib/types/database";

const ticketSchema = z.object({
  unit_id: z.string().uuid("Unidad requerida"),
  title: z.string().min(2, "Título requerido"),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  priority: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
  status: z.enum(["abierto", "en_progreso", "esperando_repuesto", "resuelto", "cerrado"]).default("abierto"),
  assigned_to: z.string().uuid().optional().nullable(),
  estimated_cost: z.coerce.number().min(0).optional().nullable(),
  actual_cost: z.coerce.number().min(0).optional().nullable(),
  cost_currency: z.string().default("ARS"),
  billable_to: z.enum(["owner", "apartcba", "guest"]).default("apartcba"),
  related_owner_id: z.string().uuid().optional().nullable(),
  // Contacto alternativo para coordinar el arreglo (por si el ocupante no está
  // en el depto). Queda guardado en el ticket para que el técnico lo tenga.
  contact_name: z.string().max(120).optional().nullable(),
  contact_phone: z.string().max(40).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type TicketInput = z.infer<typeof ticketSchema>;

export async function listTickets(filters?: {
  status?: TicketStatus;
  unitId?: string;
  openOnly?: boolean;
  /** Si es `true`, devuelve sólo los tickets ya archivados por el reset semanal. Default: sólo activos. */
  showArchived?: boolean;
}) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("maintenance_tickets")
    .select(`*, unit:units(${UNIT_REF_SELECT})`)
    .eq("organization_id", organization.id);
  // Visibilidad por fila: admin/recepción ven todo; el resto (mantenimiento)
  // solo ve los tickets asignados a esa persona.
  if (!isAdminLevel(role)) q = q.eq("assigned_to", session.userId);
  if (filters?.showArchived) {
    q = q.not("archived_at", "is", null);
  } else {
    q = q.is("archived_at", null);
  }
  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
  if (filters?.openOnly) q = q.not("status", "in", "(resuelto,cerrado)");
  const { data, error } = filters?.showArchived
    ? await q.order("archived_at", { ascending: false })
    : await q.order("opened_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getTicket(id: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_tickets")
    .select(`*, unit:units(${UNIT_REF_SELECT}), attachments:ticket_attachments(*), related_owner:owners(id, full_name)`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Visibilidad por fila: mantenimiento solo puede abrir sus propios tickets
  // (defensa ante acceso por URL directa); admin/recepción, cualquiera.
  if (data && !isAdminLevel(role) && data.assigned_to !== session.userId) return null;
  return data;
}

export async function createTicket(input: TicketInput) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = ticketSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_tickets")
    .insert({
      ...validated,
      organization_id: organization.id,
      opened_by: session.userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await admin.from("ticket_events").insert({
    ticket_id: (data as MaintenanceTicket).id,
    organization_id: organization.id,
    actor_id: session.userId,
    event_type: "created",
    to_status: validated.status,
    metadata: { title: validated.title, priority: validated.priority },
  });

  revalidatePath("/dashboard/mantenimiento");
  revalidatePath("/dashboard/unidades/kanban");

  try {
    const { publishCrmEvent } = await import("@/lib/crm/events");
    await publishCrmEvent({
      organizationId: organization.id,
      eventType: "ticket.created",
      payload: { ticket_id: (data as MaintenanceTicket).id, unit_id: validated.unit_id, priority: validated.priority, title: validated.title },
      refType: "ticket",
      refId: (data as MaintenanceTicket).id,
    });
  } catch (e) {
    console.warn("[tickets/createTicket] crm publish failed", e);
  }

  return data as MaintenanceTicket;
}

export async function updateTicket(id: string, input: TicketInput) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = ticketSchema.parse(input);
  const admin = createAdminClient();

  // Capturamos el estado previo para detectar transiciones y registrarlas en el historial
  const { data: prev } = await admin
    .from("maintenance_tickets")
    .select("status, assigned_to, actual_cost")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  const { data, error } = await admin
    .from("maintenance_tickets")
    .update(validated)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (prev) {
    if (prev.status !== validated.status) {
      await admin.from("ticket_events").insert({
        ticket_id: id,
        organization_id: organization.id,
        actor_id: session.userId,
        event_type: "status_changed",
        from_status: prev.status,
        to_status: validated.status,
        metadata: { source: "edit_form" },
      });
    } else {
      await admin.from("ticket_events").insert({
        ticket_id: id,
        organization_id: organization.id,
        actor_id: session.userId,
        event_type: "updated",
        metadata: { source: "edit_form" },
      });
    }
  }

  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${id}`);
  revalidatePath("/dashboard/unidades/kanban");
  return data as MaintenanceTicket;
}

/**
 * Permite al colaborador asignado (o a quien pueda editar tickets) cargar el
 * presupuesto/costo de una reparación sin tocar el resto del ticket. Es la
 * acción que usa mantenimiento desde el celular — incluso para trabajos ya
 * resueltos o archivados (carga "el viernes a la noche").
 *
 * `estimatedCost === undefined` → no se toca el presupuesto estimado (back-compat
 * con llamadas viejas de 3 argumentos). `null` → se limpia.
 */
export async function updateTicketCost(
  id: string,
  actualCost: number | null,
  costCurrency: string,
  estimatedCost?: number | null
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const admin = createAdminClient();

  // Guard: sólo el técnico asignado o quien tenga permiso de editar tickets.
  const { data: prev, error: prevErr } = await admin
    .from("maintenance_tickets")
    .select("assigned_to")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (prevErr) throw new Error(prevErr.message);
  if (!prev) throw new Error("Ticket no encontrado");
  const isAssignee = prev.assigned_to === session.userId;
  if (!isAssignee && !can(role, "tickets", "update")) {
    throw new Error("No tenés permiso para cargar el presupuesto de este ticket");
  }

  const patch: Record<string, unknown> = {
    actual_cost: actualCost,
    cost_currency: costCurrency,
  };
  if (estimatedCost !== undefined) patch.estimated_cost = estimatedCost;

  const { data, error } = await admin
    .from("maintenance_tickets")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await admin.from("ticket_events").insert({
    ticket_id: id,
    organization_id: organization.id,
    actor_id: session.userId,
    event_type: "cost_updated",
    metadata: {
      actual_cost: actualCost,
      cost_currency: costCurrency,
      ...(estimatedCost !== undefined ? { estimated_cost: estimatedCost } : {}),
    },
  });

  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${id}`);
  revalidatePath(`/m/mantenimiento/${id}`);
  revalidatePath("/m/mantenimiento");
  return data as MaintenanceTicket;
}

/**
 * Trabajos del usuario actual (técnico asignado) que ya están resueltos/cerrados
 * pero todavía NO tienen costo cargado — incluye los archivados por el reset
 * semanal. Es la lista "para presupuestar" del celular: el problema era que al
 * resolver un ticket desaparecía de /m/mantenimiento (filtra openOnly) y nunca
 * se le podía cargar el monto después.
 */
// ════════════════════════════════════════════════════════════════════════════
// Pago real del ticket → egreso en Caja. El costo del ticket ya se carga al
// propietario en la liquidación (vía el scan de maintenance_tickets); esto
// registra la SALIDA de plata (pago al técnico). El egreso lleva
// ref_type='ticket' y por eso queda EXCLUIDO del barrido de egresos→liquidación
// (no se descuenta dos veces al propietario).
// ════════════════════════════════════════════════════════════════════════════
const ticketPaymentSchema = z.object({
  ticket_id: z.string().uuid(),
  account_id: z.string().uuid("Elegí una cuenta de caja"),
  amount: z.coerce.number().positive().optional(),
  paid_at: z.string().optional(),
  notes: z.string().max(300).optional().nullable(),
});

export type TicketPaymentInput = z.input<typeof ticketPaymentSchema>;

export async function registerTicketPayment(input: TicketPaymentInput) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "cash", "create")) {
    throw new Error("No tenés permiso para registrar pagos en Caja.");
  }
  const v = ticketPaymentSchema.parse(input);
  const admin = createAdminClient();

  const { data: ticket } = await admin
    .from("maintenance_tickets")
    .select(
      "id, title, unit_id, actual_cost, cost_currency, billable_to, related_owner_id, paid_movement_id",
    )
    .eq("id", v.ticket_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!ticket) throw new Error("Ticket no encontrado");
  if (ticket.paid_movement_id) {
    throw new Error("Este ticket ya tiene un pago registrado en Caja");
  }

  const amount = v.amount ?? Number(ticket.actual_cost ?? 0);
  if (!(amount > 0)) {
    throw new Error("Cargá el costo real del ticket antes de registrar el pago");
  }
  const currency = ticket.cost_currency ?? "ARS";

  const { data: account } = await admin
    .from("cash_accounts")
    .select("id, currency, active, name")
    .eq("id", v.account_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!account) throw new Error("Cuenta de caja no encontrada");
  if (!account.active) throw new Error("La cuenta de caja está inactiva");
  if (account.currency !== currency) {
    throw new Error(
      `La cuenta es ${account.currency} pero el costo del ticket es en ${currency}`,
    );
  }

  // Si lo paga el propietario, imputamos al owner (related_owner_id o el
  // principal de la unidad) para el filtro por propietario en Caja.
  let ownerId: string | null = null;
  if (ticket.billable_to === "owner") {
    ownerId = ticket.related_owner_id ?? null;
    if (!ownerId) {
      const { data: uOwners } = await admin
        .from("unit_owners")
        .select("owner_id, is_primary, ownership_pct")
        .eq("unit_id", ticket.unit_id);
      ownerId = pickChargeOwner((uOwners ?? []) as UnitOwnerLite[]);
    }
  }

  const occurredAt = v.paid_at ?? new Date().toISOString();

  // 1) Egreso en Caja
  const { data: movement, error: movErr } = await admin
    .from("cash_movements")
    .insert({
      organization_id: organization.id,
      account_id: account.id,
      direction: "out",
      amount,
      currency,
      category: "maintenance",
      ref_type: "ticket",
      ref_id: ticket.id,
      unit_id: ticket.unit_id,
      owner_id: ownerId,
      billable_to: ticket.billable_to,
      description: v.notes?.trim()
        ? v.notes.trim()
        : `Pago mantenimiento: ${ticket.title}`,
      occurred_at: occurredAt,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (movErr) {
    throw new Error(`No se pudo registrar el egreso: ${movErr.message}`);
  }

  // 2) Linkear + (si estaba vacío) fijar el costo real. Guard atómico contra
  // doble pago: solo cierra si paid_movement_id sigue nulo.
  const patch: Record<string, unknown> = {
    paid_movement_id: movement.id,
    paid_at: occurredAt,
  };
  if (ticket.actual_cost == null) patch.actual_cost = amount;
  const { data: closed, error: updErr } = await admin
    .from("maintenance_tickets")
    .update(patch)
    .eq("id", v.ticket_id)
    .eq("organization_id", organization.id)
    .is("paid_movement_id", null)
    .select("id");
  if (updErr || !closed || closed.length === 0) {
    await admin.from("cash_movements").delete().eq("id", movement.id);
    throw new Error(
      updErr
        ? `No se pudo registrar el pago: ${updErr.message}`
        : "El ticket ya tiene un pago registrado (se registró en paralelo).",
    );
  }

  try {
    await admin.from("ticket_events").insert({
      ticket_id: v.ticket_id,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "cost_updated",
      metadata: { paid: amount, currency, account: account.name },
    });
  } catch {
    // el evento del timeline no es crítico
  }

  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${v.ticket_id}`);
  revalidatePath("/dashboard/caja");
  revalidatePath(`/dashboard/caja/${account.id}`);
  revalidatePath("/dashboard");
  return { ok: true as const, movement_id: movement.id as string };
}

export async function listMyTicketsToBudget() {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_tickets")
    .select(`*, unit:units(id, code, name)`)
    .eq("organization_id", organization.id)
    .eq("assigned_to", session.userId)
    .in("status", ["resuelto", "cerrado"])
    .is("actual_cost", null)
    .order("resolved_at", { ascending: false, nullsFirst: false })
    .order("opened_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function changeTicketStatus(id: string, status: TicketStatus) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: prev } = await admin
    .from("maintenance_tickets")
    .select("status")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  const update: Record<string, unknown> = { status };
  if (status === "resuelto") update.resolved_at = new Date().toISOString();
  if (status === "cerrado") update.closed_at = new Date().toISOString();
  const { error } = await admin
    .from("maintenance_tickets")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  if (prev && prev.status !== status) {
    await admin.from("ticket_events").insert({
      ticket_id: id,
      organization_id: organization.id,
      actor_id: session.userId,
      event_type: "status_changed",
      from_status: prev.status,
      to_status: status,
      metadata: { source: "kanban_or_chip" },
    });
  }

  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${id}`);

  if (status === "cerrado" || status === "resuelto") {
    try {
      const { publishCrmEvent } = await import("@/lib/crm/events");
      await publishCrmEvent({
        organizationId: organization.id,
        eventType: "ticket.closed",
        payload: { ticket_id: id, status },
        refType: "ticket",
        refId: id,
      });
    } catch (e) {
      console.warn("[tickets/changeTicketStatus] crm publish failed", e);
    }
  }
}

export async function listTicketEvents(ticketId: string): Promise<
  (TicketEvent & { actor: { full_name: string | null } | null })[]
> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const admin = createAdminClient();
  // Visibilidad por fila: mantenimiento solo ve el historial de sus tickets.
  if (!isAdminLevel(role)) {
    const { data: owner } = await admin
      .from("maintenance_tickets")
      .select("assigned_to")
      .eq("id", ticketId)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (!owner || owner.assigned_to !== session.userId) return [];
  }
  const { data, error } = await admin
    .from("ticket_events")
    .select("*")
    .eq("ticket_id", ticketId)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const events = (data ?? []) as TicketEvent[];

  // Hidratamos los actor_id con full_name desde user_profiles (un solo fetch).
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

export async function deleteTicket(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("maintenance_tickets")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/mantenimiento");
}
