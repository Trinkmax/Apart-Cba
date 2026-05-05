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
  state_or_province: z.string().optional().nullable(),
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

export interface GuestProfileBooking {
  id: string;
  status: string;
  source: string;
  check_in_date: string;
  check_out_date: string;
  guests_count: number;
  currency: string;
  total_amount: number;
  paid_amount: number;
  unit: { id: string; code: string; name: string } | null;
}

export interface GuestProfileConciergeRequest {
  id: string;
  request_type: string | null;
  description: string;
  status: string;
  priority: string;
  scheduled_for: string | null;
  completed_at: string | null;
  cost: number | null;
  cost_currency: string | null;
}

export interface GuestProfile extends Guest {
  bookings: GuestProfileBooking[];
  concierge_requests: GuestProfileConciergeRequest[];
}

export async function getGuestProfile(id: string): Promise<GuestProfile | null> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const [guestRes, bookingsRes, conciergeRes] = await Promise.all([
    admin
      .from("guests")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    admin
      .from("bookings")
      .select(
        `id, status, source, check_in_date, check_out_date, guests_count, currency, total_amount, paid_amount, unit:units(id, code, name)`
      )
      .eq("guest_id", id)
      .eq("organization_id", organization.id)
      .order("check_in_date", { ascending: false }),
    admin
      .from("concierge_requests")
      .select(
        `id, request_type, description, status, priority, scheduled_for, completed_at, cost, cost_currency`
      )
      .eq("guest_id", id)
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false }),
  ]);

  if (guestRes.error) throw new Error(guestRes.error.message);
  if (!guestRes.data) return null;
  if (bookingsRes.error) throw new Error(bookingsRes.error.message);
  if (conciergeRes.error) throw new Error(conciergeRes.error.message);

  return {
    ...(guestRes.data as Guest),
    bookings: (bookingsRes.data ?? []) as unknown as GuestProfileBooking[],
    concierge_requests: (conciergeRes.data ?? []) as GuestProfileConciergeRequest[],
  };
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

/**
 * Rename rápido de huésped — solo cambia full_name. Pensado para edición
 * inline desde la lista (más rápido que abrir el profile completo).
 */
export async function renameGuest(id: string, fullName: string): Promise<Guest> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const trimmed = fullName.trim();
  if (trimmed.length < 2) {
    throw new Error("El nombre debe tener al menos 2 caracteres");
  }
  if (trimmed.length > 200) {
    throw new Error("El nombre es demasiado largo");
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guests")
    .update({ full_name: trimmed })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/huespedes");
  revalidatePath(`/dashboard/huespedes/${id}`);
  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
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
