"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
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
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("maintenance_tickets")
    .select(`*, unit:units(id, code, name)`)
    .eq("organization_id", organization.id);
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
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_tickets")
    .select(`*, unit:units(id, code, name), attachments:ticket_attachments(*), related_owner:owners(id, full_name)`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
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
 * Permite al colaborador asignado (o al admin) actualizar solo el costo real
 * sin tocar otros campos del ticket. Útil desde la vista mobile.
 */
export async function updateTicketCost(
  id: string,
  actualCost: number | null,
  costCurrency: string
) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_tickets")
    .update({
      actual_cost: actualCost,
      cost_currency: costCurrency,
    })
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
    metadata: { actual_cost: actualCost, cost_currency: costCurrency },
  });

  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${id}`);
  revalidatePath(`/m/mantenimiento/${id}`);
  revalidatePath("/m/mantenimiento");
  return data as MaintenanceTicket;
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
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
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
