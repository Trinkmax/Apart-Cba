"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "./auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BOOKING_STATUS_META } from "@/lib/constants";
import type {
  BookingStatus,
  BookingStatusColors,
  Organization,
  UserRole,
} from "@/lib/types/database";

const BOOKING_STATUSES = Object.keys(BOOKING_STATUS_META) as BookingStatus[];

const ORG_COOKIE = "apartcba_org";

/**
 * Devuelve la org activa del usuario (vía cookie o primera membership).
 */
export async function getCurrentOrg(): Promise<{
  organization: Organization;
  role: UserRole;
}> {
  const session = await requireSession();
  if (session.memberships.length === 0 && !session.profile.is_superadmin) {
    redirect("/sin-acceso");
  }

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ORG_COOKIE)?.value;

  // Si la cookie apunta a una membership válida, usarla
  if (cookieOrgId) {
    const m = session.memberships.find((mem) => mem.organization_id === cookieOrgId);
    if (m) return { organization: m.organization, role: m.role };
  }

  // Si no, primera membership activa
  if (session.memberships.length > 0) {
    return {
      organization: session.memberships[0].organization,
      role: session.memberships[0].role,
    };
  }

  // Superadmin sin memberships (caso borde) — no debería poder operar sin elegir org
  redirect("/superadmin");
}

export async function setCurrentOrg(orgId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  revalidatePath("/", "layout");
}

// ════════════════════════════════════════════════════════════════════════════
// Configuración de la organización
// ════════════════════════════════════════════════════════════════════════════

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const hexSchema = z
  .string()
  .regex(HEX_COLOR_RE, "Formato inválido (#RRGGBB)");

/**
 * Actualiza el override de colores de status de la org activa.
 * Solo admin (`can(role, "settings", "update")`).
 *
 * Pasar `null` o string vacío en una clave la quita del override (vuelve a usar
 * el default del frontend). El argumento puede ser parcial.
 */
export async function updateBookingStatusColors(
  input: BookingStatusColors
): Promise<void> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") {
    throw new Error("Solo un administrador puede cambiar la configuración");
  }
  // Sanear: descartar claves inválidas / strings vacíos.
  const cleaned: BookingStatusColors = {};
  for (const s of BOOKING_STATUSES) {
    const v = input[s];
    if (typeof v === "string" && v.trim()) {
      const parsed = hexSchema.safeParse(v.trim());
      if (!parsed.success) {
        throw new Error(`Color inválido para "${s}": esperado formato #RRGGBB`);
      }
      cleaned[s] = v.trim().toLowerCase();
    }
  }
  const admin = createAdminClient();
  // Si quedó vacío, persistimos null (revierte todo al default).
  const value = Object.keys(cleaned).length > 0 ? cleaned : null;
  const { error } = await admin
    .from("organizations")
    .update({ booking_status_colors: value })
    .eq("id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}
