"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Resend } from "resend";
import { requireSession } from "./auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BOOKING_STATUS_META } from "@/lib/constants";
import type {
  BookingStatus,
  BookingStatusColors,
  Organization,
  ResendDnsRecord,
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

// ════════════════════════════════════════════════════════════════════════
// Spec 2 — Identidad + Branding + Resend dominio + Templates
// ════════════════════════════════════════════════════════════════════════

const orgIdentitySchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  contact_phone: z.string().max(40).optional().nullable(),
  contact_email: z.string().email().max(200).optional().nullable().or(z.literal("")),
});

export type OrgIdentityInput = z.infer<typeof orgIdentitySchema>;

export async function updateOrgIdentity(
  input: OrgIdentityInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = orgIdentitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      address: parsed.data.address ?? null,
      contact_phone: parsed.data.contact_phone ?? null,
      contact_email: parsed.data.contact_email || null,
    })
    .eq("id", organization.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/configuracion/organizacion");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

const ALLOWED_LOGO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export async function uploadOrgLogo(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No se recibió archivo" };
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { ok: false, error: "Tipo no soportado (JPG/PNG/WebP/SVG)" };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "Archivo > 5 MB" };
  }

  const admin = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${organization.id}/${Date.now()}.${ext}`;

  const { data: prevOrg } = await admin
    .from("organizations")
    .select("logo_url")
    .eq("id", organization.id)
    .maybeSingle();
  if (prevOrg?.logo_url) {
    const prevPath = extractPathFromPublicUrl(prevOrg.logo_url, "org-logos");
    if (prevPath) {
      await admin.storage.from("org-logos").remove([prevPath]).catch(() => null);
    }
  }

  const buf = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from("org-logos")
    .upload(path, buf, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: publicData } = admin.storage.from("org-logos").getPublicUrl(path);
  const publicUrl = publicData.publicUrl;

  const { error: updateError } = await admin
    .from("organizations")
    .update({ logo_url: publicUrl })
    .eq("id", organization.id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/dashboard/configuracion/organizacion");
  revalidatePath("/dashboard", "layout");
  return { ok: true, url: publicUrl };
}

export async function deleteOrgLogo(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("logo_url")
    .eq("id", organization.id)
    .maybeSingle();
  if (org?.logo_url) {
    const prev = extractPathFromPublicUrl(org.logo_url, "org-logos");
    if (prev) await admin.storage.from("org-logos").remove([prev]).catch(() => null);
  }
  await admin.from("organizations").update({ logo_url: null }).eq("id", organization.id);

  revalidatePath("/dashboard/configuracion/organizacion");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

function extractPathFromPublicUrl(url: string, bucket: string): string | null {
  const idx = url.indexOf(`/${bucket}/`);
  if (idx === -1) return null;
  return url.slice(idx + bucket.length + 2);
}

// ════════════════════════════════════════════════════════════════════════
// Spec 2 — Resend domain management (Task 19+)
// ════════════════════════════════════════════════════════════════════════

let resendClient: Resend | null = null;
function getResendForOrg(): Resend {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no configurada");
  resendClient = new Resend(key);
  return resendClient;
}

const domainSchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
      "Dominio inválido"
    ),
  sender_name: z.string().min(1).max(120),
  sender_local_part: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/i, "Local part inválida"),
});

export type CreateOrgDomainInput = z.infer<typeof domainSchema>;

export async function createOrgDomain(
  input: CreateOrgDomainInput
): Promise<{ ok: true; dns_records: ResendDnsRecord[] } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = domainSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inputs inválidos" };
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("email_domain")
    .eq("id", organization.id)
    .maybeSingle();
  if (org?.email_domain) {
    return {
      ok: false,
      error: "Ya hay un dominio configurado. Reiniciá la configuración primero.",
    };
  }

  let createResult;
  try {
    createResult = await getResendForOrg().domains.create({ name: parsed.data.domain });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (createResult.error) return { ok: false, error: createResult.error.message };
  const dnsRecords = (createResult.data?.records ?? []) as unknown as ResendDnsRecord[];

  const { error: updateError } = await admin
    .from("organizations")
    .update({
      email_domain: parsed.data.domain,
      email_sender_name: parsed.data.sender_name,
      email_sender_local_part: parsed.data.sender_local_part,
      email_domain_dns_records: dnsRecords,
      email_domain_verified_at: null,
    })
    .eq("id", organization.id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/dashboard/configuracion/organizacion");
  return { ok: true, dns_records: dnsRecords };
}

export async function verifyOrgDomain(): Promise<
  { ok: true; verified: boolean } | { ok: false; error: string }
> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("email_domain")
    .eq("id", organization.id)
    .maybeSingle();
  if (!org?.email_domain) return { ok: false, error: "No hay dominio configurado" };

  let listResult;
  try {
    listResult = await getResendForOrg().domains.list();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (listResult.error) return { ok: false, error: listResult.error.message };
  const found = listResult.data?.data?.find((d) => d.name === org.email_domain);
  if (!found) return { ok: false, error: "Dominio no encontrado en Resend (¿lo borraste?)" };

  const verified = found.status === "verified";
  if (verified) {
    await admin
      .from("organizations")
      .update({ email_domain_verified_at: new Date().toISOString() })
      .eq("id", organization.id);
  }
  revalidatePath("/dashboard/configuracion/organizacion");
  return { ok: true, verified };
}

export async function deleteOrgDomain(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("email_domain")
    .eq("id", organization.id)
    .maybeSingle();
  if (!org?.email_domain) return { ok: true };  // nada que borrar

  // Buscar el ID del dominio en Resend para borrarlo
  try {
    const list = await getResendForOrg().domains.list();
    const found = list.data?.data?.find((d) => d.name === org.email_domain);
    if (found?.id) {
      await getResendForOrg().domains.remove(found.id);
    }
  } catch (e) {
    // si falla el delete remoto, igual limpiamos local
    console.warn("Error borrando dominio en Resend:", e);
  }

  await admin
    .from("organizations")
    .update({
      email_domain: null,
      email_sender_name: null,
      email_sender_local_part: null,
      email_domain_dns_records: null,
      email_domain_verified_at: null,
    })
    .eq("id", organization.id);

  revalidatePath("/dashboard/configuracion/organizacion");
  return { ok: true };
}
