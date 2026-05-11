"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";

const profileUpdateSchema = z.object({
  full_name: z.string().min(2, "Nombre muy corto").max(120),
  phone: z.string().max(40).optional().nullable(),
  preferred_locale: z.enum(["es-AR", "en", "pt-BR"]).default("es-AR"),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export async function updateUserProfile(
  input: ProfileUpdateInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone ?? null,
      preferred_locale: parsed.data.preferred_locale,
    })
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/m/perfil");
  return { ok: true };
}

const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

export async function uploadAvatar(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No se recibió archivo" };
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    return { ok: false, error: "Tipo no soportado (JPG/PNG/WebP)" };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, error: "Archivo > 2 MB" };
  }

  const admin = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${session.userId}/${Date.now()}.${ext}`;

  // Borrar avatar previo si existe
  const { data: profile } = await admin
    .from("user_profiles")
    .select("avatar_url")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (profile?.avatar_url) {
    const prevPath = extractPathFromPublicUrl(profile.avatar_url, "avatars");
    if (prevPath) {
      await admin.storage.from("avatars").remove([prevPath]).catch(() => null);
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: publicData } = admin.storage.from("avatars").getPublicUrl(path);
  const publicUrl = publicData.publicUrl;

  const { error: updateError } = await admin
    .from("user_profiles")
    .update({ avatar_url: publicUrl })
    .eq("user_id", session.userId);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/m/perfil");
  return { ok: true, url: publicUrl };
}

export async function deleteAvatar(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("avatar_url")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (profile?.avatar_url) {
    const prevPath = extractPathFromPublicUrl(profile.avatar_url, "avatars");
    if (prevPath) {
      await admin.storage.from("avatars").remove([prevPath]).catch(() => null);
    }
  }
  await admin.from("user_profiles").update({ avatar_url: null }).eq("user_id", session.userId);
  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/m/perfil");
  return { ok: true };
}

function extractPathFromPublicUrl(url: string, bucket: string): string | null {
  // ...storage/v1/object/public/{bucket}/{path}
  const idx = url.indexOf(`/${bucket}/`);
  if (idx === -1) return null;
  return url.slice(idx + bucket.length + 2);
}
