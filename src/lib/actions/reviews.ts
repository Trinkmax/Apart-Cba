"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { getGuestSession, requireGuestSession } from "./guest-auth";
import type { Review } from "@/lib/types/database";

const reviewSchema = z.object({
  booking_id: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  cleanliness_rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  communication_rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  location_rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  value_rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  comment: z.string().max(2000).optional().nullable(),
});

/**
 * Crea una review desde el huésped, posterior al check_out.
 */
export async function submitReview(input: z.infer<typeof reviewSchema>): Promise<
  { ok: true; review: Review } | { ok: false; error: string }
> {
  const session = await requireGuestSession();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const admin = createAdminClient();

  // Verificar que el booking exista, esté completado y pertenezca al guest
  const { data: booking, error: bkErr } = await admin
    .from("bookings")
    .select(
      `
        id, organization_id, unit_id, status, check_out_date,
        guest:guests(email)
      `
    )
    .eq("id", parsed.data.booking_id)
    .maybeSingle();
  if (bkErr) return { ok: false, error: bkErr.message };
  if (!booking) return { ok: false, error: "Reserva no encontrada" };

  // Validar que sea el huésped real (match por email)
  const guestEmail = (booking.guest as unknown as { email?: string } | null)?.email;
  if (!guestEmail || guestEmail !== session.email) {
    return { ok: false, error: "Solo el huésped puede dejar la reseña" };
  }
  if (booking.status !== "check_out") {
    return { ok: false, error: "Podés dejar la reseña una vez completada la estadía" };
  }

  // Una review por booking — chequear UNIQUE
  const { data: existing } = await admin
    .from("reviews")
    .select("id")
    .eq("booking_id", parsed.data.booking_id)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: "Ya dejaste una reseña para esta reserva" };
  }

  const { data: created, error } = await admin
    .from("reviews")
    .insert({
      organization_id: booking.organization_id,
      unit_id: booking.unit_id,
      booking_id: booking.id,
      guest_user_id: session.userId,
      guest_name_snapshot: session.profile.full_name,
      guest_avatar_snapshot: session.profile.avatar_url,
      rating: parsed.data.rating,
      cleanliness_rating: parsed.data.cleanliness_rating ?? null,
      communication_rating: parsed.data.communication_rating ?? null,
      location_rating: parsed.data.location_rating ?? null,
      value_rating: parsed.data.value_rating ?? null,
      comment: parsed.data.comment ?? null,
      published: true,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/mi-cuenta");
  revalidatePath(`/u/[slug]`, "page");
  return { ok: true, review: created as Review };
}

const responseSchema = z.object({
  review_id: z.string().uuid(),
  host_response: z.string().min(2).max(2000),
});

/** El host (staff de la org) responde a una review. */
export async function respondToReview(
  input: z.infer<typeof responseSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("reviews")
    .update({
      host_response: parsed.data.host_response.trim(),
      host_responded_at: new Date().toISOString(),
      host_responded_by: session.userId,
    })
    .eq("id", parsed.data.review_id)
    .eq("organization_id", organization.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/reviews");
  revalidatePath(`/u/[slug]`, "page");
  return { ok: true };
}

/** Lista las reviews de una org (vista host). */
export async function listOrgReviews(): Promise<Review[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reviews")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Review[];
}

/** Bookings que el huésped puede reseñar (completados, sin review). */
export async function listReviewableBookings(): Promise<
  Array<{
    booking_id: string;
    unit_slug: string;
    unit_title: string;
    cover_url: string | null;
    check_out_date: string;
    organization_name: string;
  }>
> {
  const session = await getGuestSession();
  if (!session) return [];
  const admin = createAdminClient();

  const { data: guestRows } = await admin
    .from("guests")
    .select("id")
    .eq("email", session.email);
  const ids = (guestRows ?? []).map((g) => g.id);
  if (ids.length === 0) return [];

  const { data } = await admin
    .from("bookings")
    .select(
      `id, check_out_date, unit:units(id, slug, marketplace_title, cover_image_url, name), organization:organizations(name)`
    )
    .in("guest_id", ids)
    .eq("status", "check_out")
    .order("check_out_date", { ascending: false });

  const bookings = data ?? [];
  if (bookings.length === 0) return [];

  const { data: existing } = await admin
    .from("reviews")
    .select("booking_id")
    .in(
      "booking_id",
      bookings.map((b) => b.id)
    );
  const reviewed = new Set((existing ?? []).map((r) => r.booking_id));

  return bookings
    .filter((b) => !reviewed.has(b.id))
    .map((b) => {
      const u = b.unit as unknown as {
        id: string;
        slug: string | null;
        marketplace_title: string | null;
        cover_image_url: string | null;
        name: string;
      } | null;
      const o = b.organization as unknown as { name: string } | null;
      return {
        booking_id: b.id,
        unit_slug: u?.slug ?? u?.id ?? "",
        unit_title: u?.marketplace_title ?? u?.name ?? "Unidad",
        cover_url: u?.cover_image_url ?? null,
        check_out_date: b.check_out_date,
        organization_name: o?.name ?? "",
      };
    });
}
