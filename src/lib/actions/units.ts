"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type {
  Unit,
  UnitOwner,
  UnitStatus,
  UnitWithRelations,
  Owner,
  Booking,
  Guest,
  MaintenanceTicket,
} from "@/lib/types/database";
import { TICKET_PRIORITY_META } from "@/lib/constants";

const unitSchema = z.object({
  code: z.string().min(1, "Código requerido"),
  name: z.string().min(1, "Nombre requerido"),
  address: z.string().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  floor: z.string().optional().nullable(),
  apartment: z.string().optional().nullable(),
  bedrooms: z.coerce.number().int().min(0).optional().nullable(),
  bathrooms: z.coerce.number().int().min(0).optional().nullable(),
  max_guests: z.coerce.number().int().min(1).optional().nullable(),
  size_m2: z.coerce.number().min(0).optional().nullable(),
  base_price: z.coerce.number().min(0).optional().nullable(),
  base_price_currency: z.string().default("ARS"),
  cleaning_fee: z.coerce.number().min(0).optional().nullable(),
  default_commission_pct: z.coerce.number().min(0).max(100).default(20),
  status: z
    .enum(["disponible", "reservado", "ocupado", "limpieza", "mantenimiento", "bloqueado"])
    .default("disponible"),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type UnitInput = z.infer<typeof unitSchema>;

/**
 * Lista todas las unidades de la org con datos enriquecidos:
 * primary_owner, next_booking (si existe), open_ticket (más urgente abierto).
 */
export async function listUnitsEnriched(): Promise<UnitWithRelations[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: units, error } = await admin
    .from("units")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("active", true)
    .order("position")
    .order("code");
  if (error) throw new Error(error.message);

  if (!units || units.length === 0) return [];
  const unitIds = units.map((u) => u.id);

  // Owners principales
  const { data: unitOwners } = await admin
    .from("unit_owners")
    .select("unit_id, owner:owners(*)")
    .in("unit_id", unitIds)
    .eq("is_primary", true);

  const ownerByUnit = new Map<string, Owner>();
  (unitOwners ?? []).forEach((uo) => {
    if (uo.owner) ownerByUnit.set(uo.unit_id, uo.owner as unknown as Owner);
  });

  // Next bookings (próx 30 días, confirmada o check_in)
  const today = new Date().toISOString().slice(0, 10);
  const { data: bookings } = await admin
    .from("bookings")
    .select("id, unit_id, guest_id, check_in_date, check_out_date, guests_count, guest:guests(id, full_name)")
    .in("unit_id", unitIds)
    .gte("check_in_date", today)
    .in("status", ["confirmada", "check_in"])
    .order("check_in_date");

  const nextBookingByUnit = new Map<string, NonNullable<UnitWithRelations["next_booking"]>>();
  (bookings ?? []).forEach((b) => {
    if (!nextBookingByUnit.has(b.unit_id)) {
      nextBookingByUnit.set(b.unit_id, b as unknown as NonNullable<UnitWithRelations["next_booking"]>);
    }
  });

  // Open tickets — más urgente por unit
  const { data: tickets } = await admin
    .from("maintenance_tickets")
    .select("id, unit_id, title, priority, status")
    .in("unit_id", unitIds)
    .not("status", "in", "(resuelto,cerrado)");

  const openTicketByUnit = new Map<string, NonNullable<UnitWithRelations["open_ticket"]>>();
  (tickets ?? []).forEach((t) => {
    const current = openTicketByUnit.get(t.unit_id);
    const w = TICKET_PRIORITY_META[t.priority as keyof typeof TICKET_PRIORITY_META]?.weight ?? 0;
    const cw = current
      ? TICKET_PRIORITY_META[current.priority as keyof typeof TICKET_PRIORITY_META]?.weight ?? 0
      : -1;
    if (w > cw) {
      openTicketByUnit.set(t.unit_id, t as unknown as NonNullable<UnitWithRelations["open_ticket"]>);
    }
  });

  return (units as Unit[]).map((u) => ({
    ...u,
    primary_owner: ownerByUnit.get(u.id) ?? null,
    next_booking: nextBookingByUnit.get(u.id) ?? null,
    open_ticket: openTicketByUnit.get(u.id) ?? null,
  }));
}

export async function getUnit(id: string) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .select(`*, unit_owners(id, ownership_pct, is_primary, commission_pct_override, owner:owners(*))`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createUnit(input: UnitInput): Promise<Unit> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = unitSchema.parse(input);
  const admin = createAdminClient();

  // Posición = última + 1 dentro de su columna
  const { data: maxRow } = await admin
    .from("units")
    .select("position")
    .eq("organization_id", organization.id)
    .eq("status", validated.status)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newPosition = (maxRow?.position ?? -1) + 1;

  const { data, error } = await admin
    .from("units")
    .insert({ ...validated, organization_id: organization.id, position: newPosition })
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/unidades");
  revalidatePath("/dashboard/unidades/kanban");
  return data as Unit;
}

export async function updateUnit(id: string, input: UnitInput): Promise<Unit> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = unitSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .update(validated)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/unidades");
  revalidatePath(`/dashboard/unidades/${id}`);
  revalidatePath("/dashboard/unidades/kanban");
  return data as Unit;
}

export async function archiveUnit(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("units")
    .update({ active: false })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/unidades");
}

/**
 * Cambia el status de una unidad (lo dispara el drag&drop del Kanban).
 * Registra automáticamente en unit_status_history vía trigger.
 */
export async function changeUnitStatus(
  unitId: string,
  newStatus: UnitStatus,
  reason: string = "Drag & drop"
): Promise<void> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  // Posición al final de la nueva columna
  const { data: maxRow } = await admin
    .from("units")
    .select("position")
    .eq("organization_id", organization.id)
    .eq("status", newStatus)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newPosition = (maxRow?.position ?? -1) + 1;

  const { error } = await admin
    .from("units")
    .update({
      status: newStatus,
      status_changed_by: session.userId,
      position: newPosition,
    })
    .eq("id", unitId)
    .eq("organization_id", organization.id);

  if (error) throw new Error(error.message);

  // Loguear motivo en history (el trigger ya creó la fila básica)
  if (reason) {
    await admin
      .from("unit_status_history")
      .update({ reason })
      .eq("unit_id", unitId)
      .order("created_at", { ascending: false })
      .limit(1);
  }

  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades");
}

export async function reorderUnits(
  status: UnitStatus,
  orderedIds: string[]
): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  // Update en lote — para 60 units es trivial
  await Promise.all(
    orderedIds.map((id, idx) =>
      admin
        .from("units")
        .update({ position: idx })
        .eq("id", id)
        .eq("organization_id", organization.id)
        .eq("status", status)
    )
  );

  revalidatePath("/dashboard/unidades/kanban");
}

export async function linkOwnerToUnit(
  unitId: string,
  ownerId: string,
  ownership_pct: number,
  is_primary: boolean = false,
  commission_pct_override: number | null = null
) {
  await requireSession();
  await getCurrentOrg();
  const admin = createAdminClient();

  if (is_primary) {
    // Asegurar que no haya otro primario
    await admin.from("unit_owners").update({ is_primary: false }).eq("unit_id", unitId);
  }

  const { error } = await admin.from("unit_owners").insert({
    unit_id: unitId,
    owner_id: ownerId,
    ownership_pct,
    is_primary,
    commission_pct_override,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/dashboard/unidades/${unitId}`);
}

export async function unlinkOwnerFromUnit(unitOwnerId: string, unitId: string) {
  await requireSession();
  await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin.from("unit_owners").delete().eq("id", unitOwnerId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/unidades/${unitId}`);
}
