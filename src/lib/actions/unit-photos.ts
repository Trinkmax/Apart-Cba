"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";

const PHOTOS_BUCKET = "unit-photos";

async function assertUnitInOrg(unitId: string): Promise<{ orgId: string }> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .select("organization_id")
    .eq("id", unitId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unidad no encontrada");
  if (data.organization_id !== organization.id) {
    throw new Error("La unidad no pertenece a tu organización");
  }
  return { orgId: organization.id };
}

function publicUrlFor(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://localhost.supabase.co";
  return `${base}/storage/v1/object/public/${PHOTOS_BUCKET}/${path}`;
}

const uploadInputSchema = z.object({
  unit_id: z.string().uuid(),
  file_name: z.string().max(200),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64_data: z.string().min(10),
  alt_text: z.string().max(200).optional().nullable(),
});

/**
 * Sube una foto al bucket unit-photos y crea la fila en unit_photos.
 * El cliente la pasa como base64 (Data URL stripped). Para fotos grandes
 * sería mejor pre-signed upload, pero esto basta para la mayoría.
 */
export async function uploadUnitPhoto(input: z.infer<typeof uploadInputSchema>) {
  const session = await requireSession();
  const parsed = uploadInputSchema.parse(input);
  const { orgId } = await assertUnitInOrg(parsed.unit_id);

  const admin = createAdminClient();

  // Decodificar base64
  const buffer = Buffer.from(parsed.base64_data, "base64");
  if (buffer.length === 0) throw new Error("Imagen vacía");
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("La foto supera los 10 MB");
  }

  const ext =
    parsed.content_type === "image/png"
      ? "png"
      : parsed.content_type === "image/webp"
        ? "webp"
        : "jpg";
  const safeName = parsed.file_name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .slice(0, 80);
  const path = `${orgId}/${parsed.unit_id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}.${ext}`;

  const { error: upErr } = await admin.storage
    .from(PHOTOS_BUCKET)
    .upload(path, buffer, {
      contentType: parsed.content_type,
      upsert: false,
    });
  if (upErr) throw new Error(`Error subiendo: ${upErr.message}`);

  // Determinar sort_order y si es la primera (auto cover)
  const { data: existing } = await admin
    .from("unit_photos")
    .select("id, sort_order")
    .eq("unit_id", parsed.unit_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;
  const isFirst = (existing ?? []).length === 0;

  const publicUrl = publicUrlFor(path);

  const { data, error } = await admin
    .from("unit_photos")
    .insert({
      unit_id: parsed.unit_id,
      organization_id: orgId,
      storage_path: path,
      public_url: publicUrl,
      sort_order: nextOrder,
      is_cover: isFirst,
      alt_text: parsed.alt_text ?? null,
      size_bytes: buffer.length,
      uploaded_by: session.userId,
    })
    .select()
    .single();

  if (error) {
    // Cleanup
    await admin.storage.from(PHOTOS_BUCKET).remove([path]);
    throw new Error(error.message);
  }

  // Sync cover_image_url en units si es la primera
  if (isFirst) {
    await admin
      .from("units")
      .update({ cover_image_url: publicUrl })
      .eq("id", parsed.unit_id);
  }

  revalidatePath(`/dashboard/unidades/${parsed.unit_id}/marketplace`);
  revalidatePath(`/dashboard/unidades/${parsed.unit_id}`);
  return { ok: true, photo: data };
}

export async function deleteUnitPhoto(photoId: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: photo, error } = await admin
    .from("unit_photos")
    .select("*")
    .eq("id", photoId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!photo) throw new Error("Foto no encontrada");

  await admin.storage.from(PHOTOS_BUCKET).remove([photo.storage_path]);
  const { error: delErr } = await admin
    .from("unit_photos")
    .delete()
    .eq("id", photoId);
  if (delErr) throw new Error(delErr.message);

  // Si era la cover, re-asignar a la siguiente
  if (photo.is_cover) {
    const { data: next } = await admin
      .from("unit_photos")
      .select("id, public_url")
      .eq("unit_id", photo.unit_id)
      .order("sort_order", { ascending: true })
      .limit(1);
    if (next && next.length > 0) {
      await admin
        .from("unit_photos")
        .update({ is_cover: true })
        .eq("id", next[0].id);
      await admin
        .from("units")
        .update({ cover_image_url: next[0].public_url })
        .eq("id", photo.unit_id);
    } else {
      await admin
        .from("units")
        .update({ cover_image_url: null })
        .eq("id", photo.unit_id);
    }
  }

  revalidatePath(`/dashboard/unidades/${photo.unit_id}/marketplace`);
  return { ok: true };
}

export async function reorderUnitPhotos(unitId: string, orderedIds: string[]) {
  await requireSession();
  const { orgId } = await assertUnitInOrg(unitId);
  const admin = createAdminClient();

  // Sanity: validar que todos los ids pertenecen a esta unit
  const { data: existing } = await admin
    .from("unit_photos")
    .select("id")
    .eq("unit_id", unitId)
    .eq("organization_id", orgId);
  const existingIds = new Set((existing ?? []).map((p) => p.id));
  for (const id of orderedIds) {
    if (!existingIds.has(id)) {
      throw new Error("Hay fotos que no corresponden a esta unidad");
    }
  }

  // Update en batch
  for (let i = 0; i < orderedIds.length; i++) {
    await admin
      .from("unit_photos")
      .update({ sort_order: i })
      .eq("id", orderedIds[i])
      .eq("organization_id", orgId);
  }

  revalidatePath(`/dashboard/unidades/${unitId}/marketplace`);
  return { ok: true };
}

export async function setUnitPhotoCover(photoId: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: photo, error } = await admin
    .from("unit_photos")
    .select("*")
    .eq("id", photoId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!photo) throw new Error("Foto no encontrada");

  // 1) Quitar el cover existente
  await admin
    .from("unit_photos")
    .update({ is_cover: false })
    .eq("unit_id", photo.unit_id)
    .eq("is_cover", true);

  // 2) Setear esta como cover
  await admin
    .from("unit_photos")
    .update({ is_cover: true })
    .eq("id", photoId);

  // 3) Sincronizar en units.cover_image_url
  await admin
    .from("units")
    .update({ cover_image_url: photo.public_url })
    .eq("id", photo.unit_id);

  revalidatePath(`/dashboard/unidades/${photo.unit_id}/marketplace`);
  return { ok: true };
}
