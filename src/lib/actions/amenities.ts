"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type {
  Amenity,
  InventoryMovement,
  InventoryMovementType,
  UnitAmenity,
} from "@/lib/types/database";

const amenitySchema = z.object({
  name: z.string().min(2),
  category: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  consumable: z.boolean().default(false),
  unit_label: z.string().optional().nullable(),
  default_par_level: z.coerce.number().int().min(0).default(1),
  notes: z.string().optional().nullable(),
});

export type AmenityInput = z.infer<typeof amenitySchema>;

export async function listAmenities(): Promise<Amenity[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("amenities")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("active", true)
    .order("category", { nullsFirst: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data as Amenity[]) ?? [];
}

export async function createAmenity(input: AmenityInput) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = amenitySchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("amenities")
    .insert({ ...validated, organization_id: organization.id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/inventario");
  return data as Amenity;
}

export async function updateAmenity(id: string, input: AmenityInput) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = amenitySchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("amenities")
    .update(validated)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/inventario");
  return data as Amenity;
}

export async function deleteAmenity(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("amenities")
    .update({ active: false })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/inventario");
}

// ─── Stock por unidad ──────────────────────────────────────────────────────

export interface UnitAmenityRow extends UnitAmenity {
  // lo dejamos plano; la UI compone la matriz
}

export async function listUnitAmenities(): Promise<UnitAmenity[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  // Filtramos por organization vía join con units
  const { data, error } = await admin
    .from("unit_amenities")
    .select("*, units!inner(organization_id)")
    .eq("units.organization_id", organization.id);
  if (error) throw new Error(error.message);
  return (data as (UnitAmenity & { units: unknown })[]).map((r) => {
    const { units: _omit, ...rest } = r as UnitAmenity & { units?: unknown };
    return rest as UnitAmenity;
  });
}

const movementSchema = z.object({
  unit_id: z.string().uuid(),
  amenity_id: z.string().uuid(),
  movement_type: z.enum(["restock", "consume", "adjust", "initial"]),
  quantity_delta: z.coerce.number().int(),
  notes: z.string().optional().nullable(),
});

export type MovementInput = z.infer<typeof movementSchema>;

export async function recordMovement(input: MovementInput) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = movementSchema.parse(input);

  if (validated.quantity_delta === 0) {
    throw new Error("La cantidad no puede ser 0");
  }
  if (validated.movement_type === "consume" && validated.quantity_delta > 0) {
    validated.quantity_delta = -Math.abs(validated.quantity_delta);
  }
  if (
    (validated.movement_type === "restock" || validated.movement_type === "initial") &&
    validated.quantity_delta < 0
  ) {
    validated.quantity_delta = Math.abs(validated.quantity_delta);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inventory_movements")
    .insert({
      ...validated,
      organization_id: organization.id,
      performed_by: session.userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/inventario");
  revalidatePath("/dashboard/unidades");
  return data as InventoryMovement;
}

export async function setUnitStock(input: {
  unit_id: string;
  amenity_id: string;
  target_quantity: number;
  notes?: string | null;
}) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  // Buscar stock actual para calcular delta
  const { data: existing } = await admin
    .from("unit_amenities")
    .select("current_quantity")
    .eq("unit_id", input.unit_id)
    .eq("amenity_id", input.amenity_id)
    .maybeSingle();

  const current = (existing?.current_quantity as number | undefined) ?? 0;
  const delta = input.target_quantity - current;
  if (delta === 0) return null;

  const { data, error } = await admin
    .from("inventory_movements")
    .insert({
      unit_id: input.unit_id,
      amenity_id: input.amenity_id,
      movement_type: "adjust" as InventoryMovementType,
      quantity_delta: delta,
      notes: input.notes ?? null,
      organization_id: organization.id,
      performed_by: session.userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/inventario");
  return data as InventoryMovement;
}

export async function listInventoryMovements(filters?: {
  unitId?: string;
  amenityId?: string;
  limit?: number;
}): Promise<
  (InventoryMovement & {
    unit: { id: string; code: string; name: string };
    amenity: { id: string; name: string; icon: string | null; unit_label: string | null };
  })[]
> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("inventory_movements")
    .select(
      `*,
       unit:units(id, code, name),
       amenity:amenities(id, name, icon, unit_label)`
    )
    .eq("organization_id", organization.id)
    .order("performed_at", { ascending: false })
    .limit(filters?.limit ?? 200);
  if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
  if (filters?.amenityId) q = q.eq("amenity_id", filters.amenityId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as never) ?? [];
}

export async function bulkRestock(input: {
  unit_ids: string[];
  amenity_id: string;
  quantity: number;
}) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  if (!input.unit_ids.length) return [];
  if (input.quantity <= 0) throw new Error("La cantidad debe ser positiva");
  const admin = createAdminClient();
  const rows = input.unit_ids.map((unit_id) => ({
    unit_id,
    amenity_id: input.amenity_id,
    movement_type: "restock" as InventoryMovementType,
    quantity_delta: input.quantity,
    organization_id: organization.id,
    performed_by: session.userId,
  }));
  const { data, error } = await admin
    .from("inventory_movements")
    .insert(rows)
    .select();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/inventario");
  return data as InventoryMovement[];
}

export async function seedUnitDefaults(unitId: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: amenities } = await admin
    .from("amenities")
    .select("id, default_par_level, consumable")
    .eq("organization_id", organization.id)
    .eq("active", true);
  if (!amenities?.length) return [];
  const rows = (amenities as { id: string; default_par_level: number | null; consumable: boolean }[])
    .filter((a) => a.consumable)
    .map((a) => ({
      unit_id: unitId,
      amenity_id: a.id,
      par_level: a.default_par_level ?? 1,
      current_quantity: 0,
    }));
  if (!rows.length) return [];
  const { error } = await admin.from("unit_amenities").upsert(rows, {
    onConflict: "unit_id,amenity_id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/inventario");
  return rows;
}
