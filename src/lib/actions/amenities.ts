"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { Amenity } from "@/lib/types/database";

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
