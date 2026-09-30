"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import {
  rowToSummary,
  UNIT_SUMMARY_COLUMNS,
  withDisplayFields,
  type UnitRow,
} from "@/lib/marketplace/catalog";
import type { CatalogListing } from "@/lib/marketplace/contracts";
import {
  getStorefrontOrgIds,
  getStorefrontUnitRef,
  isUuid,
  loadPhotosAndAmenities,
  storefrontUnitsQuery,
} from "@/lib/marketplace/storefront";
import { getGuestSession, requireGuestSession } from "./guest-auth";

/*
 * Favoritos del huésped. Sólo se pueden guardar unidades de la vidriera
 * (publicadas, activas, de una organización que vende en la web) y sólo se
 * listan esas: una unidad que se despublica desaparece de "Favoritos" sin que
 * haya que borrar la fila.
 */

export type ToggleWishlistResult =
  | { ok: true; added: boolean }
  | {
      ok: false;
      /** auth = hay que ingresar; not_found = la unidad no está en la web. */
      reason?: "auth" | "not_found";
      error: string;
    };

const SAVE_ERROR = "No pudimos guardar el favorito. Probá de nuevo.";

function revalidateWishlistPages() {
  revalidatePath("/favoritos");
  revalidatePath("/mi-cuenta");
}

/**
 * Guarda o quita una unidad de favoritos. Quitar siempre se puede (es una
 * fila propia, aunque la unidad ya no esté en la web); guardar, sólo si la
 * unidad está en la vidriera.
 */
export async function toggleWishlist(unitId: string): Promise<ToggleWishlistResult> {
  const session = await getGuestSession();
  if (!session) {
    return { ok: false, reason: "auth", error: "Iniciá sesión para guardar favoritos." };
  }
  if (!isUuid(unitId)) {
    return { ok: false, reason: "not_found", error: "Este departamento ya no está en la web." };
  }

  try {
    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("wishlists")
      .select("unit_id")
      .eq("user_id", session.userId)
      .eq("unit_id", unitId)
      .maybeSingle();
    if (readError) {
      console.error("[wishlists] toggleWishlist read", readError.message);
      return { ok: false, error: SAVE_ERROR };
    }

    if (existing) {
      const { error } = await admin
        .from("wishlists")
        .delete()
        .eq("user_id", session.userId)
        .eq("unit_id", unitId);
      if (error) {
        console.error("[wishlists] toggleWishlist delete", error.message);
        return { ok: false, error: SAVE_ERROR };
      }
      revalidateWishlistPages();
      return { ok: true, added: false };
    }

    const unit = await getStorefrontUnitRef(unitId);
    if (!unit) {
      return { ok: false, reason: "not_found", error: "Este departamento ya no está en la web." };
    }
    const { error } = await admin
      .from("wishlists")
      .insert({ user_id: session.userId, unit_id: unit.id });
    // 23505 = ya estaba guardada (doble toque): el resultado es el mismo.
    if (error && error.code !== "23505") {
      console.error("[wishlists] toggleWishlist insert", error.message);
      return { ok: false, error: SAVE_ERROR };
    }
    revalidateWishlistPages();
    return { ok: true, added: true };
  } catch (err) {
    console.error("[wishlists] toggleWishlist", err);
    return { ok: false, error: SAVE_ERROR };
  }
}

/**
 * Ids guardados por el huésped (vacío sin sesión). Compatibilidad: las
 * pantallas nuevas usan `getMyWishlistIds()` de `@/lib/actions/storefront`.
 */
export async function listWishlistUnitIds(): Promise<Set<string>> {
  const session = await getGuestSession();
  if (!session) return new Set();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("wishlists")
    .select("unit_id")
    .eq("user_id", session.userId)
    .limit(1000);
  if (error) {
    console.error("[wishlists] listWishlistUnitIds", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.unit_id as string));
}

/** Tandas para `.in()`: la lista de ids viaja en la URL. */
const IN_CHUNK = 150;

/**
 * Favoritos del huésped con los datos de la tarjeta (resumen + display), del
 * más reciente al más viejo. Sólo unidades de la vidriera. Exige sesión
 * (redirige a /ingresar). Un error de lectura se LANZA: la página cae en su
 * error.tsx en vez de decir "todavía no guardaste lugares".
 */
export async function listWishlistDetails(): Promise<CatalogListing[]> {
  const session = await requireGuestSession("/favoritos");
  const admin = createAdminClient();

  const { data: wishRows, error: wishError } = await admin
    .from("wishlists")
    .select("unit_id, added_at")
    .eq("user_id", session.userId)
    .order("added_at", { ascending: false })
    .limit(500);
  if (wishError) throw new Error(`No se pudieron leer los favoritos: ${wishError.message}`);

  const ids = Array.from(new Set((wishRows ?? []).map((r) => r.unit_id as string)));
  if (ids.length === 0) return [];

  const orgIds = await getStorefrontOrgIds();
  if (orgIds.length === 0) return [];

  const tandas: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) tandas.push(ids.slice(i, i + IN_CHUNK));
  const results = await Promise.all(
    tandas.map((chunkIds) =>
      storefrontUnitsQuery(admin, orgIds, UNIT_SUMMARY_COLUMNS).in("id", chunkIds),
    ),
  );
  const rows: UnitRow[] = [];
  for (const res of results) {
    if (res.error) throw new Error(`No se pudieron leer los favoritos: ${res.error.message}`);
    rows.push(...((res.data ?? []) as unknown as UnitRow[]));
  }
  if (rows.length === 0) return [];

  const { photos, amenities } = await loadPhotosAndAmenities(
    admin,
    rows.map((r) => r.id),
  );
  const byId = new Map(rows.map((r) => [r.id, r] as const));

  // Orden de guardado (más reciente primero), no el de la consulta.
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is UnitRow => Boolean(r))
    .map((r) =>
      withDisplayFields(
        rowToSummary(r, photos.get(r.id)?.urls ?? [], amenities.get(r.id) ?? []),
      ),
    );
}
