"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { Booking, BookingWithRelations, BookingStatus } from "@/lib/types/database";

const bookingSchema = z.object({
  unit_id: z.string().uuid("Unidad requerida"),
  guest_id: z.string().uuid().optional().nullable(),
  source: z.enum([
    "directo", "airbnb", "booking", "expedia", "vrbo", "whatsapp", "instagram", "otro",
  ]).default("directo"),
  external_id: z.string().optional().nullable(),
  status: z.enum(["pendiente","confirmada","check_in","check_out","cancelada","no_show"]).default("confirmada"),
  check_in_date: z.string().min(10, "Fecha check-in requerida"),
  check_in_time: z.string().default("15:00"),
  check_out_date: z.string().min(10, "Fecha check-out requerida"),
  check_out_time: z.string().default("11:00"),
  guests_count: z.coerce.number().int().min(1).default(1),
  currency: z.string().default("ARS"),
  total_amount: z.coerce.number().min(0).default(0),
  paid_amount: z.coerce.number().min(0).default(0),
  commission_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  cleaning_fee: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
  internal_notes: z.string().optional().nullable(),
});

export type BookingInput = z.infer<typeof bookingSchema>;

export async function listBookings(filters?: {
  status?: BookingStatus;
  unitId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<BookingWithRelations[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("bookings")
    .select(`*, unit:units(id, code, name), guest:guests(id, full_name, phone, email)`)
    .eq("organization_id", organization.id);
  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
  if (filters?.fromDate) q = q.gte("check_in_date", filters.fromDate);
  if (filters?.toDate) q = q.lte("check_in_date", filters.toDate);
  const { data, error } = await q.order("check_in_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as BookingWithRelations[]) ?? [];
}

/**
 * Bookings que *se solapan* con el rango [fromDate, toDate).
 * Útil para el PMS grid: incluye reservas que arrancan antes del rango pero
 * siguen activas dentro del mismo.
 */
export async function listBookingsInRange(
  fromDate: string,
  toDate: string
): Promise<BookingWithRelations[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(`*, unit:units(id, code, name), guest:guests(id, full_name, phone, email)`)
    .eq("organization_id", organization.id)
    .not("status", "in", "(cancelada,no_show)")
    .lt("check_in_date", toDate)
    .gt("check_out_date", fromDate)
    .order("check_in_date");
  if (error) throw new Error(error.message);
  return (data as BookingWithRelations[]) ?? [];
}

export async function getBooking(id: string) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(`*, unit:units(*), guest:guests(*), payments:booking_payments(*)`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createBooking(input: BookingInput): Promise<Booking> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = bookingSchema.parse(input);

  // Buscar comisión default de la unit si no fue dada
  if (validated.commission_pct === null || validated.commission_pct === undefined) {
    const admin = createAdminClient();
    const { data: unit } = await admin
      .from("units")
      .select("default_commission_pct")
      .eq("id", validated.unit_id)
      .maybeSingle();
    validated.commission_pct = unit?.default_commission_pct ?? 20;
  }

  const commission_amount = validated.total_amount * (validated.commission_pct! / 100);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .insert({
      ...validated,
      external_id: validated.external_id || null,
      commission_amount,
      organization_id: organization.id,
      created_by: session.userId,
    })
    .select()
    .single();
  if (error) {
    if (error.message.includes("bookings_no_overlap")) {
      throw new Error("Ya hay una reserva en esa unidad para esas fechas");
    }
    throw new Error(error.message);
  }

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  return data as Booking;
}

export async function updateBooking(id: string, input: BookingInput): Promise<Booking> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = bookingSchema.parse(input);
  const commission_amount =
    validated.commission_pct !== null && validated.commission_pct !== undefined
      ? validated.total_amount * (validated.commission_pct / 100)
      : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .update({
      ...validated,
      external_id: validated.external_id || null,
      commission_amount,
    })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${id}`);
  revalidatePath("/dashboard/unidades/kanban");
  return data as Booking;
}

export async function changeBookingStatus(id: string, newStatus: BookingStatus, reason?: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === "cancelada" && reason) update.cancelled_reason = reason;
  if (newStatus === "check_in") update.checked_in_at = new Date().toISOString();
  if (newStatus === "check_out") update.checked_out_at = new Date().toISOString();
  const { error } = await admin
    .from("bookings")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${id}`);
  revalidatePath("/dashboard/unidades/kanban");
}

/**
 * Mueve (y/o redimensiona) una reserva: cambia unit_id y/o fechas.
 * Devuelve error legible si hay solape con el constraint bookings_no_overlap.
 */
export async function moveBooking(input: {
  id: string;
  unit_id: string;
  check_in_date: string;
  check_out_date: string;
}): Promise<Booking> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("bookings")
    .update({
      unit_id: input.unit_id,
      check_in_date: input.check_in_date,
      check_out_date: input.check_out_date,
    })
    .eq("id", input.id)
    .eq("organization_id", organization.id)
    .select()
    .single();

  if (error) {
    if (error.message.includes("bookings_no_overlap")) {
      throw new Error("Conflicto: ya hay otra reserva en esa unidad para ese rango de fechas");
    }
    if (error.message.includes("bookings_dates_valid")) {
      throw new Error("El check-out debe ser posterior al check-in");
    }
    throw new Error(error.message);
  }

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  return data as Booking;
}
