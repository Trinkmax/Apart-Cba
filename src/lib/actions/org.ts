"use server";

import { cache } from "react";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
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

const currentOrgLoader = cache(async (): Promise<{
  organization: Organization;
  role: UserRole;
}> => {
  const session = await requireSession();
  if (session.memberships.length === 0 && !session.profile.is_superadmin) {
    redirect("/sin-acceso");
  }

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ORG_COOKIE)?.value;

  if (cookieOrgId) {
    const m = session.memberships.find((mem) => mem.organization_id === cookieOrgId);
    if (m) return { organization: m.organization, role: m.role };
  }

  if (session.memberships.length > 0) {
    return {
      organization: session.memberships[0].organization,
      role: session.memberships[0].role,
    };
  }

  redirect("/superadmin");
});

export async function getCurrentOrg(): Promise<{
  organization: Organization;
  role: UserRole;
}> {
  return currentOrgLoader();
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

// ════════════════════════════════════════════════════════════════════════════
// Perfil de la organización (nombre, razón social, CUIT, color, logo)
// ════════════════════════════════════════════════════════════════════════════

const ORG_LOGO_BUCKET = "org-logos";
const LOGO_MAX_BYTES = 4 * 1024 * 1024; // 4MB
const LOGO_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

const organizationProfileSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(120),
  legal_name: z
    .string()
    .trim()
    .max(160)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable(),
  tax_id: z
    .string()
    .trim()
    .max(40)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable(),
  primary_color: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v.toLowerCase()))
    .nullable()
    .refine((v) => v === null || HEX_COLOR_RE.test(v), {
      message: "Color inválido (#RRGGBB)",
    }),
});

export type OrganizationProfileInput = z.input<typeof organizationProfileSchema>;

export async function updateOrganizationProfile(
  input: OrganizationProfileInput
): Promise<void> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") {
    throw new Error("Solo un administrador puede cambiar la configuración");
  }
  const validated = organizationProfileSchema.parse(input);
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      name: validated.name,
      legal_name: validated.legal_name,
      tax_id: validated.tax_id,
      primary_color: validated.primary_color,
    })
    .eq("id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

function extFromLogoFile(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/svg+xml") return "svg";
  return "jpg";
}

function objectPathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/object/public/${ORG_LOGO_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

export async function uploadOrganizationLogo(formData: FormData): Promise<string> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") {
    throw new Error("Solo un administrador puede cambiar el logo");
  }
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Archivo requerido");
  if (file.size === 0) throw new Error("El archivo está vacío");
  if (file.size > LOGO_MAX_BYTES)
    throw new Error("El logo supera el límite de 4MB");
  if (!LOGO_ALLOWED_MIME.has(file.type))
    throw new Error(`Tipo de archivo no permitido (${file.type || "desconocido"})`);

  const ext = extFromLogoFile(file);
  const objectPath = `${organization.id}/${randomUUID()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const admin = createAdminClient();
  const { error: uploadErr } = await admin.storage
    .from(ORG_LOGO_BUCKET)
    .upload(objectPath, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
  if (uploadErr) throw new Error(uploadErr.message);

  const { data: publicUrl } = admin.storage
    .from(ORG_LOGO_BUCKET)
    .getPublicUrl(objectPath);

  const previousUrl = organization.logo_url;
  const { error: updateErr } = await admin
    .from("organizations")
    .update({ logo_url: publicUrl.publicUrl })
    .eq("id", organization.id);
  if (updateErr) {
    await admin.storage.from(ORG_LOGO_BUCKET).remove([objectPath]).catch(() => {});
    throw new Error(updateErr.message);
  }

  if (previousUrl) {
    const prevPath = objectPathFromPublicUrl(previousUrl);
    if (prevPath) {
      await admin.storage.from(ORG_LOGO_BUCKET).remove([prevPath]).catch(() => {});
    }
  }

  revalidatePath("/", "layout");
  return publicUrl.publicUrl;
}

export async function getOrganizationBranding(): Promise<{
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  logo_url: string | null;
  primary_color: string | null;
}> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  return {
    name: organization.name,
    legal_name: organization.legal_name,
    tax_id: organization.tax_id,
    logo_url: organization.logo_url,
    primary_color: organization.primary_color,
  };
}

export async function removeOrganizationLogo(): Promise<void> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") {
    throw new Error("Solo un administrador puede cambiar el logo");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ logo_url: null })
    .eq("id", organization.id);
  if (error) throw new Error(error.message);
  if (organization.logo_url) {
    const path = objectPathFromPublicUrl(organization.logo_url);
    if (path) {
      await admin.storage.from(ORG_LOGO_BUCKET).remove([path]).catch(() => {});
    }
  }
  revalidatePath("/", "layout");
}
