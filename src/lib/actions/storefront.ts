"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getBlockedDates, getUnavailableUnitIds } from "@/lib/marketplace/availability";
import { addMonthsIso, validateStayRange } from "@/lib/marketplace/catalog";
import type { AvailabilityResult, BlockedDatesResult } from "@/lib/marketplace/contracts";
import { todayIsoAR } from "@/lib/marketplace/pricing";
import { getStorefrontCatalog, getStorefrontUnitRef } from "@/lib/marketplace/storefront";
import { getGuestSession } from "./guest-auth";

/**
 * Acciones públicas de la vidriera que el cliente llama después de cargar una
 * página estática (home, /buscar, /u/[slug]): lo que depende de la fecha de
 * hoy o de quién mira no puede ir en el HTML cacheado.
 */

/** Meses hacia adelante que pinta el calendario de una ficha. */
const BLOCKED_DATES_MONTHS = 12;

/**
 * Unidades de la vidriera que NO están libres en [checkIn, checkOut).
 * Sin caché: es la foto del momento (reservas, pedidos vigentes y
 * solicitudes de canal que retienen). El pedido lo vuelve a verificar.
 */
export async function getCatalogAvailability(input: {
  checkIn: string;
  checkOut: string;
}): Promise<AvailabilityResult> {
  const range = validateStayRange(
    { checkIn: input?.checkIn, checkOut: input?.checkOut },
    todayIsoAR(),
  );
  if (!range.ok) return { ok: false, error: range.error };

  try {
    const catalog = await getStorefrontCatalog();
    const unitIds = catalog.listings.map((l) => l.id);
    if (unitIds.length === 0) return { ok: true, unavailable: [] };
    const unavailable = await getUnavailableUnitIds({
      unitIds,
      checkInIso: range.checkIn,
      checkOutIso: range.checkOut,
    });
    return { ok: true, unavailable };
  } catch (err) {
    console.error("[storefront] getCatalogAvailability", err);
    return {
      ok: false,
      error: "No pudimos chequear la disponibilidad. Probá de nuevo en unos minutos.",
    };
  }
}

/**
 * Noches ocupadas de una unidad de la vidriera, de hoy (horario de Argentina)
 * a 12 meses. Para deshabilitar fechas en el calendario de la ficha; la
 * verificación que vale es la del pedido.
 */
export async function getUnitBlockedDates(unitId: string): Promise<BlockedDatesResult> {
  try {
    const unit = await getStorefrontUnitRef(typeof unitId === "string" ? unitId : "");
    if (!unit) return { ok: false, error: "Este departamento no está disponible en la web." };

    const from = todayIsoAR();
    const to = addMonthsIso(from, BLOCKED_DATES_MONTHS);
    const blocked = await getBlockedDates({ unitId: unit.id, fromIso: from, toIso: to });
    return { ok: true, blocked, from, to };
  } catch (err) {
    console.error("[storefront] getUnitBlockedDates", err);
    return {
      ok: false,
      error: "No pudimos cargar el calendario. Probá de nuevo en unos minutos.",
    };
  }
}

/**
 * Ids de las unidades que el huésped guardó en favoritos ([] sin sesión o si
 * la lectura falla: los corazones se ven vacíos, nada más).
 */
export async function getMyWishlistIds(): Promise<string[]> {
  try {
    const session = await getGuestSession();
    if (!session) return [];
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("wishlists")
      .select("unit_id")
      .eq("user_id", session.userId)
      .limit(1000);
    if (error) {
      console.error("[storefront] getMyWishlistIds", error.message);
      return [];
    }
    return Array.from(new Set((data ?? []).map((r) => r.unit_id as string)));
  } catch (err) {
    console.error("[storefront] getMyWishlistIds", err);
    return [];
  }
}
