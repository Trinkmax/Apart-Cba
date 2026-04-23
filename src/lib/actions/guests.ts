"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { Guest } from "@/lib/types/database";

const guestSchema = z.object({
  full_name: z.string().min(2, "Nombre requerido"),
  document_type: z.string().optional().nullable(),
  document_number: z.string().optional().nullable(),
  email: z.string().email("Email inválido").optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  country: z.string().default("AR"),
  city: z.string().optional().nullable(),
  birth_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type GuestInput = z.infer<typeof guestSchema>;

export async function listGuests(): Promise<Guest[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guests")
    .select("*")
    .eq("organization_id", organization.id)
    .order("last_stay_at", { ascending: false, nullsFirst: false })
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data as Guest[]) ?? [];
}

export async function searchGuests(query: string): Promise<Guest[]> {
  if (query.length < 2) return [];
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guests")
    .select("*")
    .eq("organization_id", organization.id)
    .or(
      `full_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%,document_number.ilike.%${query}%`
    )
    .limit(10);
  if (error) throw new Error(error.message);
  return (data as Guest[]) ?? [];
}

export async function getGuest(id: string) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guests")
    .select(`*, bookings(id, check_in_date, check_out_date, status, total_amount, currency, unit:units(id, code, name))`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createGuest(input: GuestInput): Promise<Guest> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = guestSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guests")
    .insert({
      ...validated,
      email: validated.email || null,
      birth_date: validated.birth_date || null,
      organization_id: organization.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/huespedes");
  return data as Guest;
}

export async function updateGuest(id: string, input: GuestInput): Promise<Guest> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = guestSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guests")
    .update({
      ...validated,
      email: validated.email || null,
      birth_date: validated.birth_date || null,
    })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/huespedes");
  revalidatePath(`/dashboard/huespedes/${id}`);
  return data as Guest;
}

export async function toggleBlacklistGuest(id: string, blacklist: boolean, reason?: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("guests")
    .update({ blacklisted: blacklist, blacklist_reason: blacklist ? reason ?? null : null })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/huespedes");
}
