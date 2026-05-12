"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getGuestSession } from "./guest-auth";
import { checkUnitAvailability } from "@/lib/marketplace/availability";
import { computePricing, countNights } from "@/lib/marketplace/pricing";
import type {
  Booking,
  BookingRequest,
  UnitPricingRule,
} from "@/lib/types/database";
import { notifyHostNewBooking, notifyGuestBookingConfirmed } from "@/lib/marketplace/notifications";

const checkoutSchema = z.object({
  unit_id: z.string().uuid(),
  check_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_out_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests_count: z.coerce.number().int().min(1).max(30),
  // Datos del huésped (snapshot)
  full_name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).max(30),
  document: z.string().max(40).optional().nullable(),
  special_requests: z.string().max(1000).optional().nullable(),
  agreed_to_rules: z.boolean().refine((v) => v === true, "Tenés que aceptar las reglas"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type CheckoutResult =
  | {
      ok: true;
      kind: "booking";
      booking_id: string;
      slug: string;
      total: number;
    }
  | {
      ok: true;
      kind: "request";
      request_id: string;
      slug: string;
      total: number;
      expires_at: string;
    }
  | { ok: false; error: string };

/**
 * Punto de entrada del checkout marketplace.
 * Decide automáticamente si crear booking (instant_book) o booking_request.
 * Requiere sesión de huésped.
 */
export async function submitCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const session = await getGuestSession();
  if (!session) return { ok: false, error: "Iniciá sesión para reservar" };

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const data = parsed.data;

  // Validaciones de fecha básicas
  if (data.check_out_date <= data.check_in_date) {
    return { ok: false, error: "El check-out debe ser posterior al check-in" };
  }
  const nights = countNights(data.check_in_date, data.check_out_date);
  if (nights < 1) {
    return { ok: false, error: "Estadía mínima de 1 noche" };
  }

  const admin = createAdminClient();

  // Traer la unidad con todos los datos necesarios
  const { data: unit, error: unitErr } = await admin
    .from("units")
    .select(
      `
        id, organization_id, slug, marketplace_published, active, marketplace_title,
        base_price, cleaning_fee, marketplace_currency, max_guests, min_nights, max_nights,
        instant_book, check_in_window_start, check_in_window_end
      `
    )
    .eq("id", data.unit_id)
    .maybeSingle();
  if (unitErr) return { ok: false, error: unitErr.message };
  if (!unit || !unit.marketplace_published || !unit.active) {
    return { ok: false, error: "La unidad no está disponible" };
  }
  if (unit.max_guests && data.guests_count > unit.max_guests) {
    return { ok: false, error: `Esta propiedad acepta hasta ${unit.max_guests} huéspedes` };
  }
  if (nights < (unit.min_nights ?? 1)) {
    return { ok: false, error: `Mínimo de ${unit.min_nights} noche(s)` };
  }
  if (unit.max_nights && nights > unit.max_nights) {
    return { ok: false, error: `Máximo de ${unit.max_nights} noches` };
  }

  // Disponibilidad
  const avail = await checkUnitAvailability({
    unitId: data.unit_id,
    checkInIso: data.check_in_date,
    checkOutIso: data.check_out_date,
  });
  if (!avail.available) {
    return { ok: false, error: avail.reason ?? "Sin disponibilidad" };
  }

  // Calcular precio server-side (nunca confiar en el cliente)
  const { data: rules } = await admin
    .from("unit_pricing_rules")
    .select("*")
    .eq("unit_id", data.unit_id)
    .eq("active", true);

  const breakdown = computePricing({
    checkInIso: data.check_in_date,
    checkOutIso: data.check_out_date,
    basePrice: Number(unit.base_price ?? 0),
    cleaningFee: unit.cleaning_fee !== null ? Number(unit.cleaning_fee) : null,
    rules: (rules ?? []) as UnitPricingRule[],
  });
  const currency = unit.marketplace_currency ?? "ARS";

  // Camino A: instant_book → crear booking real directamente
  if (unit.instant_book) {
    return await createMarketplaceBooking({
      session,
      unit: {
        id: unit.id,
        organization_id: unit.organization_id,
        slug: unit.slug ?? unit.id,
        marketplace_title: unit.marketplace_title ?? "",
        check_in_window_start: unit.check_in_window_start ?? "15:00",
        check_in_window_end: unit.check_in_window_end ?? "22:00",
      },
      data,
      total: breakdown.total,
      cleaningFee: breakdown.cleaning_fee,
      currency,
      nights,
    });
  }

  // Camino B: request-to-book → crear booking_request
  return await createBookingRequest({
    session,
    unit: {
      id: unit.id,
      organization_id: unit.organization_id,
      slug: unit.slug ?? unit.id,
      marketplace_title: unit.marketplace_title ?? "",
      check_in_window_start: unit.check_in_window_start ?? "15:00",
      check_in_window_end: unit.check_in_window_end ?? "22:00",
    },
    data,
    total: breakdown.total,
    cleaningFee: breakdown.cleaning_fee,
    currency,
    nights,
  });
}

type SessionLite = { userId: string; email: string };
type UnitLite = {
  id: string;
  organization_id: string;
  slug: string;
  marketplace_title: string;
  check_in_window_start: string;
  check_in_window_end: string;
};

async function findOrCreateGuestForOrg(params: {
  organizationId: string;
  guest: { full_name: string; email: string; phone: string; document?: string | null };
}): Promise<string> {
  const admin = createAdminClient();
  // Match por email + org
  const { data: existing } = await admin
    .from("guests")
    .select("id, phone, document_number")
    .eq("organization_id", params.organizationId)
    .eq("email", params.guest.email)
    .maybeSingle();

  if (existing) {
    // Actualizar phone/document si vienen y faltaban
    const update: Record<string, unknown> = {};
    if (params.guest.phone && !existing.phone) update.phone = params.guest.phone;
    if (params.guest.document && !existing.document_number) {
      update.document_number = params.guest.document;
    }
    if (Object.keys(update).length > 0) {
      await admin.from("guests").update(update).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: created, error } = await admin
    .from("guests")
    .insert({
      organization_id: params.organizationId,
      full_name: params.guest.full_name,
      email: params.guest.email,
      phone: params.guest.phone,
      document_number: params.guest.document || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo crear el huésped: ${error.message}`);
  return created.id;
}

async function createMarketplaceBooking(params: {
  session: SessionLite;
  unit: UnitLite;
  data: CheckoutInput;
  total: number;
  cleaningFee: number;
  currency: string;
  nights: number;
}): Promise<CheckoutResult> {
  const admin = createAdminClient();

  const guestId = await findOrCreateGuestForOrg({
    organizationId: params.unit.organization_id,
    guest: {
      full_name: params.data.full_name,
      email: params.data.email,
      phone: params.data.phone,
      document: params.data.document ?? null,
    },
  });

  const { data: created, error } = await admin
    .from("bookings")
    .insert({
      organization_id: params.unit.organization_id,
      unit_id: params.unit.id,
      guest_id: guestId,
      source: "directo",
      status: "confirmada",
      mode: "temporario",
      check_in_date: params.data.check_in_date,
      check_in_time: params.unit.check_in_window_start,
      check_out_date: params.data.check_out_date,
      check_out_time: "11:00",
      guests_count: params.data.guests_count,
      currency: params.currency,
      total_amount: params.total,
      paid_amount: 0,
      cleaning_fee: params.cleaningFee,
      notes: params.data.special_requests || null,
      internal_notes: `Reserva marketplace por ${params.data.full_name} (${params.data.email})`,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("bookings_no_overlap")) {
      return { ok: false, error: "Justo se reservaron esas fechas. Probá con otras." };
    }
    return { ok: false, error: error.message };
  }

  const booking = created as Booking;

  // Notificaciones (best-effort)
  try {
    await notifyGuestBookingConfirmed({
      bookingId: booking.id,
      guestEmail: params.data.email,
      guestPhone: params.data.phone,
      guestName: params.data.full_name,
    });
    await notifyHostNewBooking({
      organizationId: params.unit.organization_id,
      bookingId: booking.id,
      unitId: params.unit.id,
      guestName: params.data.full_name,
      checkIn: params.data.check_in_date,
      checkOut: params.data.check_out_date,
      total: params.total,
      currency: params.currency,
    });
  } catch (e) {
    console.warn("[marketplace-bookings] notificaciones fallaron:", e);
  }

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/mi-cuenta");
  revalidatePath(`/u/${params.unit.slug}`);

  return {
    ok: true,
    kind: "booking",
    booking_id: booking.id,
    slug: params.unit.slug,
    total: params.total,
  };
}

async function createBookingRequest(params: {
  session: SessionLite;
  unit: UnitLite;
  data: CheckoutInput;
  total: number;
  cleaningFee: number;
  currency: string;
  nights: number;
}): Promise<CheckoutResult> {
  const admin = createAdminClient();

  const { data: created, error } = await admin
    .from("booking_requests")
    .insert({
      organization_id: params.unit.organization_id,
      unit_id: params.unit.id,
      guest_user_id: params.session.userId,
      guest_full_name: params.data.full_name,
      guest_email: params.data.email,
      guest_phone: params.data.phone,
      guest_document: params.data.document || null,
      check_in_date: params.data.check_in_date,
      check_in_time: params.unit.check_in_window_start,
      check_out_date: params.data.check_out_date,
      check_out_time: "11:00",
      guests_count: params.data.guests_count,
      currency: params.currency,
      total_amount: params.total,
      cleaning_fee: params.cleaningFee,
      nights: params.nights,
      special_requests: params.data.special_requests || null,
      status: "pendiente",
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const request = created as BookingRequest;

  try {
    await notifyHostNewBooking({
      organizationId: params.unit.organization_id,
      bookingId: request.id,
      unitId: params.unit.id,
      guestName: params.data.full_name,
      checkIn: params.data.check_in_date,
      checkOut: params.data.check_out_date,
      total: params.total,
      currency: params.currency,
      isRequest: true,
    });
  } catch (e) {
    console.warn("[marketplace-bookings] notificación host falló:", e);
  }

  revalidatePath("/dashboard/reservas-pendientes");
  revalidatePath("/mi-cuenta");

  return {
    ok: true,
    kind: "request",
    request_id: request.id,
    slug: params.unit.slug,
    total: params.total,
    expires_at: request.expires_at,
  };
}

/** Lista los bookings de un huésped autenticado (su historial). */
export async function listGuestBookings() {
  const session = await getGuestSession();
  if (!session) return { bookings: [], requests: [] };
  const admin = createAdminClient();

  const [bookingsRes, requestsRes] = await Promise.all([
    admin
      .from("bookings")
      .select(
        `id, organization_id, unit_id, check_in_date, check_out_date, total_amount, currency, status,
         unit:units(id, slug, marketplace_title, name, cover_image_url),
         organization:organizations(name)
        `
      )
      .eq("guest_id", null)
      .order("check_in_date", { ascending: false }),
    admin
      .from("booking_requests")
      .select(
        `*, unit:units(id, slug, marketplace_title, name, cover_image_url),
         organization:organizations(name)
        `
      )
      .eq("guest_user_id", session.userId)
      .order("created_at", { ascending: false }),
  ]);

  // Los bookings del marketplace los buscamos por email match en guests
  const { data: profile } = await admin
    .from("guest_profiles")
    .select("full_name")
    .eq("user_id", session.userId)
    .maybeSingle();

  const { data: guestRows } = await admin
    .from("guests")
    .select("id, organization_id")
    .eq("email", session.email);

  let allBookings: unknown[] = [];
  if ((guestRows ?? []).length > 0) {
    const ids = (guestRows ?? []).map((g) => g.id);
    const { data: bk } = await admin
      .from("bookings")
      .select(
        `id, organization_id, unit_id, check_in_date, check_out_date, total_amount, currency, status, paid_amount,
         unit:units(id, slug, marketplace_title, name, cover_image_url),
         organization:organizations(name)
        `
      )
      .in("guest_id", ids)
      .order("check_in_date", { ascending: false });
    allBookings = bk ?? [];
  }

  void bookingsRes; // silenciado, usamos el match por email
  void profile;

  return {
    bookings: allBookings,
    requests: requestsRes.data ?? [],
  };
}

export async function cancelGuestBookingRequest(requestId: string) {
  const session = await getGuestSession();
  if (!session) return { ok: false, error: "No autenticado" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("booking_requests")
    .update({ status: "cancelada" })
    .eq("id", requestId)
    .eq("guest_user_id", session.userId)
    .eq("status", "pendiente");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/mi-cuenta");
  return { ok: true };
}
