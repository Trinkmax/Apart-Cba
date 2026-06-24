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

/**
 * Revalida las superficies PÚBLICAS donde se ven las fotos/videos de una unidad
 * (la página de detalle `/u/[slug]` y el listado `/buscar`), que —a diferencia de
 * `/dashboard/*`— no son `no-store`. Best-effort: no lanza si falla.
 */
async function revalidatePublicUnit(
  admin: ReturnType<typeof createAdminClient>,
  unitId: string,
) {
  try {
    const { data } = await admin
      .from("units")
      .select("slug")
      .eq("id", unitId)
      .maybeSingle();
    if (data?.slug) revalidatePath(`/u/${data.slug}`);
    revalidatePath("/buscar");
  } catch {
    // no bloquear la mutación por un fallo de revalidación
  }
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

  // sort_order global (imágenes + videos); auto-cover sólo si todavía no hay imágenes.
  const { data: existing } = await admin
    .from("unit_photos")
    .select("id, sort_order, media_type")
    .eq("unit_id", parsed.unit_id);

  const nextOrder =
    (existing ?? []).reduce((max, p) => Math.max(max, p.sort_order), -1) + 1;
  const isFirst = !(existing ?? []).some((p) => p.media_type === "image");

  const publicUrl = publicUrlFor(path);

  const { data, error } = await admin
    .from("unit_photos")
    .insert({
      unit_id: parsed.unit_id,
      organization_id: orgId,
      storage_path: path,
      public_url: publicUrl,
      media_type: "image",
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
  await revalidatePublicUnit(admin, parsed.unit_id);
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

  // Borrar el objeto principal y, si es video, también su poster del Storage.
  const toRemove = [photo.storage_path];
  if (photo.media_type === "video" && photo.poster_url) {
    const marker = `/object/public/${PHOTOS_BUCKET}/`;
    const idx = photo.poster_url.indexOf(marker);
    if (idx !== -1) toRemove.push(photo.poster_url.slice(idx + marker.length));
  }
  await admin.storage.from(PHOTOS_BUCKET).remove(toRemove);

  const { error: delErr } = await admin
    .from("unit_photos")
    .delete()
    .eq("id", photoId);
  if (delErr) throw new Error(delErr.message);

  // Si era la cover, re-asignar a la siguiente IMAGEN (un video no puede ser portada)
  if (photo.is_cover) {
    const { data: next } = await admin
      .from("unit_photos")
      .select("id, public_url")
      .eq("unit_id", photo.unit_id)
      .eq("media_type", "image")
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
  await revalidatePublicUnit(admin, photo.unit_id);
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
  await revalidatePublicUnit(admin, unitId);
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
  if (photo.media_type === "video") {
    throw new Error("Un video no puede ser la portada");
  }

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
  await revalidatePublicUnit(admin, photo.unit_id);
  return { ok: true };
}

// ─── Videos (upload directo a Storage vía signed URL) ──────────────────────────
//
// El video se comprime en el navegador (ffmpeg.wasm → H.264/AAC mp4) y puede pesar
// bastante más que los 15 MB del límite de los server actions. Por eso no pasa por
// base64: el service role firma una URL de subida y el cliente sube el blob directo
// al Storage con `uploadToSignedUrl`. Después `recordUnitVideo` registra la fila.

const videoUploadUrlsSchema = z.object({
  unit_id: z.string().uuid(),
});

/**
 * Devuelve signed upload URLs (token + path) para el video comprimido y su poster.
 * El path queda fijado bajo `${orgId}/${unitId}/` — `recordUnitVideo` revalida ese
 * prefijo, así que el cliente no puede registrar objetos fuera de su organización.
 */
export async function createUnitVideoUploadUrls(
  input: z.infer<typeof videoUploadUrlsSchema>,
) {
  await requireSession();
  const parsed = videoUploadUrlsSchema.parse(input);
  const { orgId } = await assertUnitInOrg(parsed.unit_id);
  const admin = createAdminClient();

  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const videoPath = `${orgId}/${parsed.unit_id}/${stamp}-video.mp4`;
  const posterPath = `${orgId}/${parsed.unit_id}/${stamp}-poster.jpg`;

  const [videoSigned, posterSigned] = await Promise.all([
    admin.storage.from(PHOTOS_BUCKET).createSignedUploadUrl(videoPath),
    admin.storage.from(PHOTOS_BUCKET).createSignedUploadUrl(posterPath),
  ]);

  if (videoSigned.error || !videoSigned.data) {
    throw new Error(`No se pudo preparar la subida: ${videoSigned.error?.message ?? ""}`);
  }
  if (posterSigned.error || !posterSigned.data) {
    throw new Error(`No se pudo preparar la subida: ${posterSigned.error?.message ?? ""}`);
  }

  return {
    ok: true as const,
    video: { path: videoSigned.data.path, token: videoSigned.data.token },
    poster: { path: posterSigned.data.path, token: posterSigned.data.token },
  };
}

const recordVideoSchema = z.object({
  unit_id: z.string().uuid(),
  video_path: z.string().min(3),
  poster_path: z.string().min(3).nullable().optional(),
  duration_ms: z.coerce.number().int().nonnegative().max(60 * 60 * 1000).optional().nullable(),
  size_bytes: z.coerce.number().int().nonnegative().optional().nullable(),
  width: z.coerce.number().int().positive().max(8000).optional().nullable(),
  height: z.coerce.number().int().positive().max(8000).optional().nullable(),
  alt_text: z.string().max(200).optional().nullable(),
});

/**
 * Registra en unit_photos un video ya subido (media_type='video'). Valida que los
 * paths pertenezcan a la carpeta de la unidad/organización para que no se puedan
 * registrar objetos ajenos. Un video nunca es portada (lo impide el CHECK en BD).
 */
export async function recordUnitVideo(input: z.infer<typeof recordVideoSchema>) {
  const session = await requireSession();
  const parsed = recordVideoSchema.parse(input);
  const { orgId } = await assertUnitInOrg(parsed.unit_id);
  const admin = createAdminClient();

  const prefix = `${orgId}/${parsed.unit_id}/`;
  if (!parsed.video_path.startsWith(prefix)) {
    throw new Error("Ruta de video inválida");
  }
  if (parsed.poster_path && !parsed.poster_path.startsWith(prefix)) {
    throw new Error("Ruta de poster inválida");
  }
  if (!parsed.video_path.endsWith(".mp4")) {
    throw new Error("El video debe ser mp4");
  }

  const { data: existing } = await admin
    .from("unit_photos")
    .select("sort_order")
    .eq("unit_id", parsed.unit_id);
  const nextOrder =
    (existing ?? []).reduce((max, p) => Math.max(max, p.sort_order), -1) + 1;

  const { data, error } = await admin
    .from("unit_photos")
    .insert({
      unit_id: parsed.unit_id,
      organization_id: orgId,
      storage_path: parsed.video_path,
      public_url: publicUrlFor(parsed.video_path),
      media_type: "video",
      poster_url: parsed.poster_path ? publicUrlFor(parsed.poster_path) : null,
      duration_ms: parsed.duration_ms ?? null,
      sort_order: nextOrder,
      is_cover: false,
      alt_text: parsed.alt_text ?? null,
      width: parsed.width ?? null,
      height: parsed.height ?? null,
      size_bytes: parsed.size_bytes ?? null,
      uploaded_by: session.userId,
    })
    .select()
    .single();

  if (error) {
    // Cleanup: borrar los objetos subidos si no se pudo crear la fila.
    const cleanup = [parsed.video_path];
    if (parsed.poster_path) cleanup.push(parsed.poster_path);
    await admin.storage.from(PHOTOS_BUCKET).remove(cleanup);
    throw new Error(error.message);
  }

  revalidatePath(`/dashboard/unidades/${parsed.unit_id}/marketplace`);
  revalidatePath(`/dashboard/unidades/${parsed.unit_id}`);
  await revalidatePublicUnit(admin, parsed.unit_id);
  return { ok: true, photo: data };
}
