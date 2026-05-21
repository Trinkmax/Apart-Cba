"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { ALLOWED_DNI_MIME, MAX_DNI_BYTES } from "@/lib/dni-upload";
import { requireSession } from "./auth";

const BUCKET = "team-dni";
const SIGNED_URL_TTL_SECONDS = 60;

type Side = "front" | "back";

const sideSchema = z.enum(["front", "back"]);
const userIdSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Helper: validar si el caller puede gestionar el DNI de `targetUserId`.
// - Ok si target === self.
// - Ok si caller es admin activo de una org de la cual target también es miembro activo.
// - Si no, throw.
// ---------------------------------------------------------------------------
async function assertCanManageDni(targetUserId: string): Promise<void> {
  const session = await requireSession();
  if (session.userId === targetUserId) return;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_members")
    .select("organization_id, role, active")
    .eq("user_id", session.userId)
    .eq("role", "admin")
    .eq("active", true);
  if (error) throw new Error(error.message);

  const adminOrgIds = (data ?? []).map((r) => r.organization_id);
  if (adminOrgIds.length === 0) {
    throw new Error("No tenés permiso para gestionar el DNI de este usuario");
  }

  const { data: shared, error: sharedErr } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", targetUserId)
    .eq("active", true)
    .in("organization_id", adminOrgIds)
    .limit(1);
  if (sharedErr) throw new Error(sharedErr.message);

  if (!shared || shared.length === 0) {
    throw new Error("No tenés permiso para gestionar el DNI de este usuario");
  }
}

function extFromMime(mime: string): "jpg" | "png" | "webp" | null {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

function revalidateAll() {
  revalidatePath("/dashboard/perfil");
  revalidatePath("/m/perfil");
  revalidatePath("/dashboard/configuracion/equipo");
}

// ---------------------------------------------------------------------------
// uploadDni — recibe FormData con: file, userId, side
// ---------------------------------------------------------------------------
export async function uploadDni(
  formData: FormData
): Promise<{ ok: true; side: Side; path: string } | { ok: false; error: string }> {
  const userIdRaw = formData.get("userId");
  const sideRaw = formData.get("side");
  const file = formData.get("file");

  const userIdParsed = userIdSchema.safeParse(userIdRaw);
  const sideParsed = sideSchema.safeParse(sideRaw);
  if (!userIdParsed.success) return { ok: false, error: "userId inválido" };
  if (!sideParsed.success) return { ok: false, error: "side inválido" };
  if (!(file instanceof File)) return { ok: false, error: "No se recibió archivo" };

  if (!ALLOWED_DNI_MIME.includes(file.type)) {
    return { ok: false, error: "Solo JPG, PNG o WebP" };
  }
  if (file.size > MAX_DNI_BYTES) {
    return { ok: false, error: "Máximo 5 MB" };
  }
  const ext = extFromMime(file.type);
  if (!ext) return { ok: false, error: "Tipo no soportado" };

  try {
    await assertCanManageDni(userIdParsed.data);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const userId = userIdParsed.data;
  const side = sideParsed.data;
  const path = `${userId}/${side}.${ext}`;

  const admin = createAdminClient();

  // Si ya hay un archivo previo del mismo lado con otra extensión, lo borramos.
  const { data: profile } = await admin
    .from("user_profiles")
    .select("dni_front_path, dni_back_path")
    .eq("user_id", userId)
    .maybeSingle();
  const prevPath = side === "front" ? profile?.dni_front_path : profile?.dni_back_path;
  if (prevPath && prevPath !== path) {
    await admin.storage.from(BUCKET).remove([prevPath]).catch(() => null);
  }

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, error: uploadError.message };

  const updateField = side === "front" ? "dni_front_path" : "dni_back_path";
  const { error: updateError } = await admin
    .from("user_profiles")
    .update({ [updateField]: path, dni_updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (updateError) return { ok: false, error: updateError.message };

  revalidateAll();
  return { ok: true, side, path };
}

// ---------------------------------------------------------------------------
// deleteDni — borra un lado.
// ---------------------------------------------------------------------------
export async function deleteDni(input: {
  userId: string;
  side: Side;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const userIdParsed = userIdSchema.safeParse(input.userId);
  const sideParsed = sideSchema.safeParse(input.side);
  if (!userIdParsed.success) return { ok: false, error: "userId inválido" };
  if (!sideParsed.success) return { ok: false, error: "side inválido" };

  try {
    await assertCanManageDni(userIdParsed.data);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const userId = userIdParsed.data;
  const side = sideParsed.data;
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("user_profiles")
    .select("dni_front_path, dni_back_path")
    .eq("user_id", userId)
    .maybeSingle();
  const prevPath = side === "front" ? profile?.dni_front_path : profile?.dni_back_path;
  if (prevPath) {
    await admin.storage.from(BUCKET).remove([prevPath]).catch(() => null);
  }

  const updateField = side === "front" ? "dni_front_path" : "dni_back_path";
  const { error } = await admin
    .from("user_profiles")
    .update({ [updateField]: null, dni_updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// getDniSignedUrls — URLs firmadas a 60s para frente y dorso (los que existan).
// ---------------------------------------------------------------------------
export interface DniSideUrl {
  url: string;
  updatedAt: string | null;
}

export async function getDniSignedUrls(
  userId: string
): Promise<{ front: DniSideUrl | null; back: DniSideUrl | null }> {
  const userIdParsed = userIdSchema.safeParse(userId);
  if (!userIdParsed.success) return { front: null, back: null };
  await assertCanManageDni(userIdParsed.data); // tira si no tiene permiso

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("dni_front_path, dni_back_path, dni_updated_at")
    .eq("user_id", userIdParsed.data)
    .maybeSingle();
  if (!profile) return { front: null, back: null };

  async function signOne(path: string | null): Promise<DniSideUrl | null> {
    if (!path) return null;
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return { url: data.signedUrl, updatedAt: profile?.dni_updated_at ?? null };
  }

  const [front, back] = await Promise.all([
    signOne(profile.dni_front_path),
    signOne(profile.dni_back_path),
  ]);

  return { front, back };
}
