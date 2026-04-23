"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { MaintenanceTicket, TicketStatus } from "@/lib/types/database";

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
}) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("maintenance_tickets")
    .select(`*, unit:units(id, code, name)`)
    .eq("organization_id", organization.id);
  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
  if (filters?.openOnly) q = q.not("status", "in", "(resuelto,cerrado)");
  const { data, error } = await q.order("opened_at", { ascending: false });
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
  revalidatePath("/dashboard/mantenimiento");
  revalidatePath("/dashboard/unidades/kanban");
  return data as MaintenanceTicket;
}

export async function updateTicket(id: string, input: TicketInput) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = ticketSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_tickets")
    .update(validated)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${id}`);
  revalidatePath("/dashboard/unidades/kanban");
  return data as MaintenanceTicket;
}

export async function changeTicketStatus(id: string, status: TicketStatus) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const update: Record<string, unknown> = { status };
  if (status === "resuelto") update.resolved_at = new Date().toISOString();
  if (status === "cerrado") update.closed_at = new Date().toISOString();
  const { error } = await admin
    .from("maintenance_tickets")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${id}`);
}
