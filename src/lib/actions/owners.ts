"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { Owner } from "@/lib/types/database";

export type OwnerListItem = Owner & {
  unit_owners: { unit: { id: string; code: string; name: string } }[];
};

const ownerSchema = z.object({
  full_name: z.string().min(2, "Nombre requerido"),
  document_type: z.string().optional().nullable(),
  document_number: z.string().optional().nullable(),
  email: z.string().email("Email inválido").optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  cbu: z.string().optional().nullable(),
  alias_cbu: z.string().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  preferred_currency: z.string().default("ARS_EFECTIVO"),
  notes: z.string().optional().nullable(),
});

export type OwnerInput = z.infer<typeof ownerSchema>;

export async function listOwners(): Promise<OwnerListItem[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("owners")
    .select("*, unit_owners(unit:units(id, code, name))")
    .eq("organization_id", organization.id)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data as OwnerListItem[]) ?? [];
}

export async function getOwner(id: string): Promise<Owner | null> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("owners")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Owner) ?? null;
}

export async function getOwnerWithUnits(id: string) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("owners")
    .select(`*, unit_owners(id, ownership_pct, is_primary, commission_pct_override, unit:units(id, code, name, status))`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createOwner(input: OwnerInput): Promise<Owner> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = ownerSchema.parse(input);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("owners")
    .insert({
      ...validated,
      email: validated.email || null,
      organization_id: organization.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/propietarios");
  return data as Owner;
}

export async function updateOwner(id: string, input: OwnerInput): Promise<Owner> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = ownerSchema.parse(input);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("owners")
    .update({ ...validated, email: validated.email || null })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/propietarios");
  revalidatePath(`/dashboard/propietarios/${id}`);
  return data as Owner;
}

export async function archiveOwner(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("owners")
    .update({ active: false })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/propietarios");
}

export async function deleteOwner(id: string): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("owners")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "No se puede eliminar: el propietario tiene liquidaciones u otros datos asociados."
      );
    }
    throw new Error(error.message);
  }
  revalidatePath("/dashboard/propietarios");
}

export async function unlinkUnitFromOwner(
  unitOwnerId: string,
  ownerId: string
): Promise<void> {
  await requireSession();
  await getCurrentOrg();
  const admin = createAdminClient();

  const { data: uo } = await admin
    .from("unit_owners")
    .select("unit_id")
    .eq("id", unitOwnerId)
    .maybeSingle();

  const { error } = await admin
    .from("unit_owners")
    .delete()
    .eq("id", unitOwnerId);
  if (error) throw new Error(error.message);

  revalidatePath(`/dashboard/propietarios/${ownerId}`);
  revalidatePath("/dashboard/propietarios");
  if (uo) revalidatePath(`/dashboard/unidades/${uo.unit_id}`);
}

/**
 * Asigna una unidad a un propietario (lado propietario). Espejo de
 * linkOwnerToUnit pero revalidando la ficha del propietario.
 */
export async function linkUnitToOwner(
  ownerId: string,
  unitId: string,
  ownership_pct: number,
  is_primary: boolean = false,
  commission_pct_override: number | null = null,
): Promise<void> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: unit } = await admin
    .from("units")
    .select("id")
    .eq("id", unitId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!unit) throw new Error("Unidad no encontrada");

  const { data: existing } = await admin
    .from("unit_owners")
    .select("id")
    .eq("unit_id", unitId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (existing) {
    throw new Error("Esa unidad ya está asignada a este propietario");
  }

  if (is_primary) {
    await admin
      .from("unit_owners")
      .update({ is_primary: false })
      .eq("unit_id", unitId);
  }

  const { error } = await admin.from("unit_owners").insert({
    unit_id: unitId,
    owner_id: ownerId,
    ownership_pct,
    is_primary,
    commission_pct_override,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/dashboard/propietarios/${ownerId}`);
  revalidatePath(`/dashboard/unidades/${unitId}`);
  revalidatePath("/dashboard/propietarios");
}
