"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { isAdminLevel } from "@/lib/permissions";
import { UNIT_REF_SELECT } from "@/lib/constants";
import type {
  UnitRef,
  UnitTip,
  UnitTipCategory,
  UnitTipReactionType,
} from "@/lib/types/database";

const STORAGE_BUCKET = "unit-tips";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB (matches bucket limit)
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

// ─── Schemas ───────────────────────────────────────────────────────────────

const categorySchema = z.enum([
  "general",
  "cocina",
  "bano",
  "dormitorio",
  "acceso",
  "electrodomesticos",
  "importante",
]);

const reactionSchema = z.enum(["helpful", "important", "love"]);

const createSchema = z.object({
  unit_id: z.string().uuid(),
  content: z.string().trim().min(3, "El consejo es muy corto").max(2000, "Máximo 2000 caracteres"),
  category: categorySchema.default("general"),
  photo_url: z.string().url().optional().nullable(),
});

export type CreateTipInput = z.infer<typeof createSchema>;

const editSchema = z.object({
  id: z.string().uuid(),
  content: z.string().trim().min(3).max(2000),
  category: categorySchema,
});

// ─── Tipos enriquecidos que devuelven los reads ────────────────────────────

export type TipAuthor = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export type TipReactionCounts = Record<UnitTipReactionType, number>;

export type EnrichedUnitTip = UnitTip & {
  unit: UnitRef;
  author: TipAuthor | null;
  reactions: TipReactionCounts;
  my_reactions: UnitTipReactionType[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function emptyReactionCounts(): TipReactionCounts {
  return { helpful: 0, important: 0, love: 0 };
}

/**
 * Lee la URL pública de un archivo del bucket. El bucket es público por
 * definición (ver migration 029), así que esto es deterministico y no falla.
 */
function publicPhotoUrl(path: string): string {
  const admin = createAdminClient();
  const { data } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Decodifica el path del bucket a partir de la URL pública. Devuelve null si
 * la URL no corresponde a nuestro bucket (defensa contra payloads inválidos).
 */
function pathFromPhotoUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function listUnitTips(filters?: {
  unitId?: string;
  category?: UnitTipCategory;
  limit?: number;
}): Promise<EnrichedUnitTip[]> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const limit = Math.min(filters?.limit ?? 50, 100);

  let q = admin
    .from("unit_tips")
    .select(`*, unit:units(${UNIT_REF_SELECT})`)
    .eq("organization_id", organization.id)
    .is("deleted_at", null);
  if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
  if (filters?.category) q = q.eq("category", filters.category);

  const { data, error } = await q
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const tips = (data ?? []) as (UnitTip & { unit: UnitRef })[];
  if (tips.length === 0) return [];

  const authorIds = Array.from(new Set(tips.map((t) => t.author_id)));
  const tipIds = tips.map((t) => t.id);

  const [{ data: authorsRaw }, { data: reactionsRaw }, { data: myReactionsRaw }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("user_id, full_name, avatar_url")
      .in("user_id", authorIds),
    admin
      .from("unit_tip_reactions")
      .select("tip_id, reaction")
      .in("tip_id", tipIds),
    admin
      .from("unit_tip_reactions")
      .select("tip_id, reaction")
      .in("tip_id", tipIds)
      .eq("user_id", session.userId),
  ]);

  const authorById = new Map<string, TipAuthor>(
    (authorsRaw ?? []).map((a) => [
      a.user_id as string,
      {
        user_id: a.user_id as string,
        full_name: (a.full_name as string | null) ?? null,
        avatar_url: (a.avatar_url as string | null) ?? null,
      },
    ])
  );

  const countsByTip = new Map<string, TipReactionCounts>();
  for (const r of reactionsRaw ?? []) {
    const tipId = (r as { tip_id: string }).tip_id;
    const reaction = (r as { reaction: UnitTipReactionType }).reaction;
    if (!countsByTip.has(tipId)) countsByTip.set(tipId, emptyReactionCounts());
    countsByTip.get(tipId)![reaction]++;
  }

  const myByTip = new Map<string, UnitTipReactionType[]>();
  for (const r of myReactionsRaw ?? []) {
    const tipId = (r as { tip_id: string }).tip_id;
    const reaction = (r as { reaction: UnitTipReactionType }).reaction;
    if (!myByTip.has(tipId)) myByTip.set(tipId, []);
    myByTip.get(tipId)!.push(reaction);
  }

  return tips.map((t) => ({
    ...t,
    author: authorById.get(t.author_id) ?? null,
    reactions: countsByTip.get(t.id) ?? emptyReactionCounts(),
    my_reactions: myByTip.get(t.id) ?? [],
  }));
}

export async function getUnitTip(id: string): Promise<EnrichedUnitTip | null> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("unit_tips")
    .select(`*, unit:units(${UNIT_REF_SELECT})`)
    .eq("organization_id", organization.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const tip = data as UnitTip & { unit: UnitRef };

  const [{ data: authorRaw }, { data: reactionsRaw }, { data: myReactionsRaw }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("user_id, full_name, avatar_url")
      .eq("user_id", tip.author_id)
      .maybeSingle(),
    admin
      .from("unit_tip_reactions")
      .select("reaction")
      .eq("tip_id", id),
    admin
      .from("unit_tip_reactions")
      .select("reaction")
      .eq("tip_id", id)
      .eq("user_id", session.userId),
  ]);

  const counts = emptyReactionCounts();
  for (const r of reactionsRaw ?? []) counts[(r as { reaction: UnitTipReactionType }).reaction]++;

  return {
    ...tip,
    author: authorRaw
      ? {
          user_id: authorRaw.user_id as string,
          full_name: (authorRaw.full_name as string | null) ?? null,
          avatar_url: (authorRaw.avatar_url as string | null) ?? null,
        }
      : null,
    reactions: counts,
    my_reactions: (myReactionsRaw ?? []).map((r) => (r as { reaction: UnitTipReactionType }).reaction),
  };
}

/**
 * Helper liviano para el composer: id + code + name de las unidades activas
 * de la org (orden por code). Usado para el picker cuando el usuario crea
 * un consejo desde la sección /m/consejos (sin task de contexto).
 */
export async function listUnitsForTipsPicker(): Promise<UnitRef[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .select(UNIT_REF_SELECT)
    .eq("organization_id", organization.id)
    .eq("active", true)
    .order("code", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as UnitRef[];
}

// ─── Writes ────────────────────────────────────────────────────────────────

export async function createUnitTip(input: CreateTipInput): Promise<UnitTip> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = createSchema.parse(input);
  const admin = createAdminClient();

  // Sanity check: la unidad pertenece a la org actual.
  const { data: unit } = await admin
    .from("units")
    .select("id")
    .eq("id", validated.unit_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!unit) throw new Error("La unidad no existe o no pertenece a tu organización");

  const { data, error } = await admin
    .from("unit_tips")
    .insert({
      organization_id: organization.id,
      unit_id: validated.unit_id,
      author_id: session.userId,
      content: validated.content,
      category: validated.category,
      photo_url: validated.photo_url ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/m/consejos");
  revalidatePath(`/m/consejos/${validated.unit_id}`);
  revalidatePath("/m/limpieza");
  revalidatePath("/dashboard/limpieza");

  return data as UnitTip;
}

export async function editUnitTip(input: z.infer<typeof editSchema>): Promise<UnitTip> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const validated = editSchema.parse(input);
  const admin = createAdminClient();

  const { data: prev } = await admin
    .from("unit_tips")
    .select("id, author_id, created_at, unit_id")
    .eq("id", validated.id)
    .eq("organization_id", organization.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!prev) throw new Error("El consejo no existe");

  const isOwner = prev.author_id === session.userId;
  const hoursSinceCreated =
    (Date.now() - new Date(prev.created_at as string).getTime()) / (1000 * 60 * 60);
  const ownerCanEdit = isOwner && hoursSinceCreated < 24;
  if (!ownerCanEdit && !isAdminLevel(role)) {
    throw new Error("No podés editar este consejo (más de 24h o no es tuyo)");
  }

  const { data, error } = await admin
    .from("unit_tips")
    .update({ content: validated.content, category: validated.category })
    .eq("id", validated.id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/m/consejos");
  revalidatePath(`/m/consejos/${prev.unit_id}`);
  return data as UnitTip;
}

export async function deleteUnitTip(id: string): Promise<void> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: tip } = await admin
    .from("unit_tips")
    .select("id, author_id, photo_url, unit_id")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!tip) throw new Error("El consejo no existe");

  const isOwner = tip.author_id === session.userId;
  if (!isOwner && !isAdminLevel(role)) {
    throw new Error("Solo el autor o un administrador pueden eliminar este consejo");
  }

  const { error } = await admin
    .from("unit_tips")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  // Best-effort: borrar la foto del bucket. Si falla no aborta el delete del tip.
  const path = pathFromPhotoUrl(tip.photo_url as string | null);
  if (path) {
    try {
      await admin.storage.from(STORAGE_BUCKET).remove([path]);
    } catch (e) {
      console.warn("[unit-tips/delete] storage cleanup failed", e);
    }
  }

  revalidatePath("/m/consejos");
  revalidatePath(`/m/consejos/${tip.unit_id}`);
  revalidatePath("/m/limpieza");
  revalidatePath("/dashboard/limpieza");
}

export async function togglePinTip(id: string): Promise<void> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) {
    throw new Error("Solo admin/recepción pueden destacar consejos");
  }
  const admin = createAdminClient();

  const { data: tip } = await admin
    .from("unit_tips")
    .select("id, pinned_at, unit_id")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!tip) throw new Error("El consejo no existe");

  const isPinned = !!tip.pinned_at;
  const { error } = await admin
    .from("unit_tips")
    .update({
      pinned_at: isPinned ? null : new Date().toISOString(),
      pinned_by: isPinned ? null : session.userId,
    })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  revalidatePath("/m/consejos");
  revalidatePath(`/m/consejos/${tip.unit_id}`);
}

// ─── Reactions ─────────────────────────────────────────────────────────────

export async function reactToTip(tipId: string, reaction: UnitTipReactionType): Promise<void> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = z.object({ tipId: z.string().uuid(), reaction: reactionSchema }).parse({ tipId, reaction });
  const admin = createAdminClient();

  // upsert (idempotente vía UNIQUE constraint)
  const { error } = await admin
    .from("unit_tip_reactions")
    .upsert(
      {
        tip_id: validated.tipId,
        organization_id: organization.id,
        user_id: session.userId,
        reaction: validated.reaction,
      },
      { onConflict: "tip_id,user_id,reaction", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}

export async function unreactToTip(tipId: string, reaction: UnitTipReactionType): Promise<void> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = z.object({ tipId: z.string().uuid(), reaction: reactionSchema }).parse({ tipId, reaction });
  const admin = createAdminClient();

  const { error } = await admin
    .from("unit_tip_reactions")
    .delete()
    .eq("tip_id", validated.tipId)
    .eq("organization_id", organization.id)
    .eq("user_id", session.userId)
    .eq("reaction", validated.reaction);
  if (error) throw new Error(error.message);
}

// ─── Photo upload ──────────────────────────────────────────────────────────

/**
 * Sube una foto al bucket `unit-tips`. La foto queda en
 *   {org_id}/_pending/{userId}-{ts}-{rand}.{ext}
 * y devuelve el URL público que el composer luego envía como `photo_url` al
 * crear el tip. Si nunca se asocia a un tip, queda huérfana hasta que un
 * cron la limpie (out of scope para este MVP).
 */
export async function uploadTipPhoto(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const { organization } = await getCurrentOrg();

    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Falta el archivo" };

    if (!ALLOWED_MIME.includes(file.type)) {
      return { ok: false, error: `Formato no soportado (${file.type}). Usá JPG, PNG o WebP.` };
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return { ok: false, error: `La imagen es muy grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo 10 MB.` };
    }

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `${organization.id}/_pending/${session.userId}-${ts}-${rand}.${ext}`;

    const admin = createAdminClient();
    const { error } = await admin.storage.from(STORAGE_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) return { ok: false, error: error.message };

    return { ok: true, url: publicPhotoUrl(path) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
