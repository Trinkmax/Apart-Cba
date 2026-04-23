"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { Owner } from "@/lib/types/database";

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
  preferred_currency: z.string().default("ARS"),
  notes: z.string().optional().nullable(),
});

export type OwnerInput = z.infer<typeof ownerSchema>;

export async function listOwners(): Promise<Owner[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("owners")
    .select("*")
    .eq("organization_id", organization.id)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data as Owner[]) ?? [];
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
    .select(`*, unit_owners(ownership_pct, is_primary, commission_pct_override, unit:units(id, code, name, status))`)
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
