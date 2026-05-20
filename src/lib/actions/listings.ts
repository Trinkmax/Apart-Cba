"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import type {
  MarketplaceAmenity,
  Unit,
  UnitPhoto,
  UnitPricingRule,
} from "@/lib/types/database";

// ─── Schemas ────────────────────────────────────────────────────────────────

const listingBasicsSchema = z.object({
  unit_id: z.string().uuid(),
  marketplace_title: z.string().min(8, "Necesitamos un título atractivo").max(120),
  marketplace_description: z.string().min(40, "La descripción debe tener al menos 40 caracteres").max(4000),
  marketplace_property_type: z.enum([
    "apartamento",
    "casa",
    "loft",
    "estudio",
    "habitacion",
    "duplex",
    "ph",
    "cabana",
  ]),
  bedrooms: z.coerce.number().int().min(0).max(20),
  bathrooms: z.coerce.number().int().min(0).max(20),
  max_guests: z.coerce.number().int().min(1).max(30),
  size_m2: z.coerce.number().min(0).max(1000).optional().nullable(),
  base_price: z.coerce.number().min(0, "Precio inválido"),
  marketplace_currency: z.string().min(3).max(4),
  cleaning_fee: z.coerce.number().min(0).optional().nullable(),
  min_nights: z.coerce.number().int().min(1).max(365).default(1),
  max_nights: z.coerce.number().int().min(1).max(365).optional().nullable(),
  cancellation_policy: z.enum(["flexible", "moderada", "estricta"]),
  house_rules: z.string().max(2000).optional().nullable(),
  check_in_window_start: z.string().default("15:00"),
  check_in_window_end: z.string().default("22:00"),
  instant_book: z.boolean().default(false),
});

const locationSchema = z.object({
  unit_id: z.string().uuid(),
  address: z.string().max(300).optional().nullable(),
  neighborhood: z.string().max(120).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
});

const pricingRuleSchema = z.object({
  unit_id: z.string().uuid(),
  name: z.string().min(2).max(80),
  rule_type: z.enum(["date_range", "weekday"]),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional().nullable(),
  price_multiplier: z.coerce.number().min(0.1).max(10).optional().nullable(),
  price_override: z.coerce.number().min(0).optional().nullable(),
  min_nights_override: z.coerce.number().int().min(1).max(60).optional().nullable(),
  priority: z.coerce.number().int().min(0).max(100).default(0),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Verifica que la unidad pertenece a la org activa. */
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

function revalidateListingPaths(unitId: string, slug?: string | null) {
  revalidatePath("/dashboard/unidades");
  revalidatePath(`/dashboard/unidades/${unitId}`);
  revalidatePath(`/dashboard/unidades/${unitId}/marketplace`);
  revalidatePath(`/dashboard/unidades/${unitId}/precios`);
  revalidatePath("/buscar");
  if (slug) revalidatePath(`/u/${slug}`);
}

function zodErrorMessage(err: z.ZodError): string {
  const first = err.issues[0];
  if (!first) return "Datos inválidos";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/** Logging server-side para diagnosticar — el toast del cliente muestra solo el mensaje limpio. */
function logActionError(context: string, e: unknown) {
  if (e instanceof Error) {
    console.error(`[listings:${context}]`, e.message, e.stack);
  } else {
    console.error(`[listings:${context}]`, e);
  }
}

// ─── Listing CRUD ────────────────────────────────────────────────────────────

export async function getListing(unitId: string) {
  await assertUnitInOrg(unitId);
  const admin = createAdminClient();
  const [unitRes, photosRes, amenitiesRes, rulesRes] = await Promise.all([
    admin.from("units").select("*").eq("id", unitId).maybeSingle(),
    admin
      .from("unit_photos")
      .select("*")
      .eq("unit_id", unitId)
      .order("is_cover", { ascending: false })
      .order("sort_order"),
    admin
      .from("unit_marketplace_amenities")
      .select("amenity_code")
      .eq("unit_id", unitId),
    admin
      .from("unit_pricing_rules")
      .select("*")
      .eq("unit_id", unitId)
      .order("priority", { ascending: false }),
  ]);

  if (unitRes.error) throw new Error(unitRes.error.message);

  return {
    unit: unitRes.data as Unit | null,
    photos: (photosRes.data ?? []) as UnitPhoto[],
    amenityCodes: (amenitiesRes.data ?? []).map((a) => a.amenity_code),
    rules: (rulesRes.data ?? []) as UnitPricingRule[],
  };
}

export async function listMarketplaceAmenitiesCatalog(): Promise<MarketplaceAmenity[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketplace_amenities")
    .select("*")
    .eq("active", true)
    .order("category")
    .order("display_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as MarketplaceAmenity[];
}

export type UpdateListingBasicsResult =
  | { ok: true; slug: string | null }
  | { ok: false; error: string };

export async function updateListingBasics(
  input: z.infer<typeof listingBasicsSchema>,
): Promise<UpdateListingBasicsResult> {
  try {
    await requireSession();
    const parsedResult = listingBasicsSchema.safeParse(input);
    if (!parsedResult.success) {
      return { ok: false, error: zodErrorMessage(parsedResult.error) };
    }
    const parsed = parsedResult.data;
    const { orgId } = await assertUnitInOrg(parsed.unit_id);

    const admin = createAdminClient();
    // Normalizar HH:MM:SS (que viene de Postgres `time`) a HH:MM
    const normalizeTime = (v: string) =>
      typeof v === "string" && v.length > 5 ? v.slice(0, 5) : v;

    // Generar slug si no existe o si cambió el título
    const { data: current, error: currentErr } = await admin
      .from("units")
      .select("slug, marketplace_title")
      .eq("id", parsed.unit_id)
      .maybeSingle();
    if (currentErr) {
      return { ok: false, error: `No se pudo leer la unidad: ${currentErr.message}` };
    }

    let slug = current?.slug ?? null;
    if (!slug || current?.marketplace_title !== parsed.marketplace_title) {
      const { data: slugResult, error: slugErr } = await admin.rpc(
        "generate_unit_slug",
        {
          p_seed: parsed.marketplace_title,
          p_unit_id: parsed.unit_id,
        },
      );
      if (slugErr) {
        return {
          ok: false,
          error: `No se pudo generar el slug: ${slugErr.message}`,
        };
      }
      slug = (slugResult as string | null) ?? null;
    }

    const { error } = await admin
      .from("units")
      .update({
        marketplace_title: parsed.marketplace_title,
        marketplace_description: parsed.marketplace_description,
        marketplace_property_type: parsed.marketplace_property_type,
        bedrooms: parsed.bedrooms,
        bathrooms: parsed.bathrooms,
        max_guests: parsed.max_guests,
        size_m2: parsed.size_m2 ?? null,
        base_price: parsed.base_price,
        marketplace_currency: parsed.marketplace_currency,
        cleaning_fee: parsed.cleaning_fee ?? null,
        min_nights: parsed.min_nights,
        max_nights: parsed.max_nights ?? null,
        cancellation_policy: parsed.cancellation_policy,
        house_rules: parsed.house_rules ?? null,
        check_in_window_start: normalizeTime(parsed.check_in_window_start),
        check_in_window_end: normalizeTime(parsed.check_in_window_end),
        instant_book: parsed.instant_book,
        slug,
      })
      .eq("id", parsed.unit_id)
      .eq("organization_id", orgId);

    if (error) {
      return { ok: false, error: `No se pudo guardar: ${error.message}` };
    }
    revalidateListingPaths(parsed.unit_id, slug);
    return { ok: true, slug };
  } catch (e) {
    logActionError("updateListingBasics", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado al guardar",
    };
  }
}

export type UpdateListingLocationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateListingLocation(
  input: z.infer<typeof locationSchema>,
): Promise<UpdateListingLocationResult> {
  try {
    await requireSession();
    const parsedResult = locationSchema.safeParse(input);
    if (!parsedResult.success) {
      return { ok: false, error: zodErrorMessage(parsedResult.error) };
    }
    const parsed = parsedResult.data;
    const { orgId } = await assertUnitInOrg(parsed.unit_id);

    const admin = createAdminClient();
    const { error } = await admin
      .from("units")
      .update({
        address: parsed.address ?? null,
        neighborhood: parsed.neighborhood ?? null,
        latitude: parsed.latitude ?? null,
        longitude: parsed.longitude ?? null,
      })
      .eq("id", parsed.unit_id)
      .eq("organization_id", orgId);

    if (error) {
      return { ok: false, error: `No se pudo guardar: ${error.message}` };
    }
    revalidateListingPaths(parsed.unit_id);
    return { ok: true };
  } catch (e) {
    logActionError("updateListingLocation", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado",
    };
  }
}

export type SetListingPublishedResult =
  | { ok: true }
  | { ok: false; error: string };

export async function setListingPublished(
  unitId: string,
  published: boolean,
): Promise<SetListingPublishedResult> {
  try {
    await requireSession();
    const { orgId } = await assertUnitInOrg(unitId);

    // Validar gates pre-publicación
    if (published) {
      const admin = createAdminClient();
      const [unitRes, photoRes] = await Promise.all([
        admin
          .from("units")
          .select("slug, marketplace_title, marketplace_description, base_price")
          .eq("id", unitId)
          .maybeSingle(),
        admin
          .from("unit_photos")
          .select("id")
          .eq("unit_id", unitId)
          .limit(1),
      ]);

      const u = unitRes.data;
      if (!u?.marketplace_title || !u.marketplace_description) {
        return { ok: false, error: "Falta completar título y descripción del listing" };
      }
      if (!u.base_price || Number(u.base_price) <= 0) {
        return { ok: false, error: "Falta un precio base válido" };
      }
      if ((photoRes.data ?? []).length === 0) {
        return { ok: false, error: "Necesitás al menos una foto para publicar" };
      }
      if (!u.slug) {
        return { ok: false, error: "La unidad no tiene slug — guardá los datos primero" };
      }
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("units")
      .update({ marketplace_published: published })
      .eq("id", unitId)
      .eq("organization_id", orgId);
    if (error) return { ok: false, error: `No se pudo actualizar: ${error.message}` };

    revalidateListingPaths(unitId);
    return { ok: true };
  } catch (e) {
    logActionError("setListingPublished", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado",
    };
  }
}

// ─── Amenities ───────────────────────────────────────────────────────────────

export type SetListingAmenitiesResult =
  | { ok: true }
  | { ok: false; error: string };

export async function setListingAmenities(
  unitId: string,
  amenityCodes: string[],
): Promise<SetListingAmenitiesResult> {
  try {
    await requireSession();
    await assertUnitInOrg(unitId);

    const admin = createAdminClient();
    // Estrategia: reemplazar todo el set para esta unidad
    const { error: delErr } = await admin
      .from("unit_marketplace_amenities")
      .delete()
      .eq("unit_id", unitId);
    if (delErr) return { ok: false, error: `No se pudo limpiar amenities: ${delErr.message}` };

    if (amenityCodes.length > 0) {
      const rows = amenityCodes.map((code) => ({ unit_id: unitId, amenity_code: code }));
      const { error: insErr } = await admin.from("unit_marketplace_amenities").insert(rows);
      if (insErr) return { ok: false, error: `No se pudieron guardar amenities: ${insErr.message}` };
    }
    revalidateListingPaths(unitId);
    return { ok: true };
  } catch (e) {
    logActionError("setListingAmenities", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado",
    };
  }
}

// ─── Pricing rules ───────────────────────────────────────────────────────────

export type CreatePricingRuleResult =
  | { ok: true; rule: UnitPricingRule }
  | { ok: false; error: string };

export async function createPricingRule(
  input: z.infer<typeof pricingRuleSchema>,
): Promise<CreatePricingRuleResult> {
  try {
    await requireSession();
    const parsedResult = pricingRuleSchema.safeParse(input);
    if (!parsedResult.success) {
      return { ok: false, error: zodErrorMessage(parsedResult.error) };
    }
    const parsed = parsedResult.data;
    const { orgId } = await assertUnitInOrg(parsed.unit_id);

    if (!parsed.price_multiplier && !parsed.price_override) {
      return { ok: false, error: "Necesitás especificar un multiplicador o precio absoluto" };
    }
    if (
      parsed.rule_type === "date_range" &&
      (!parsed.start_date || !parsed.end_date)
    ) {
      return { ok: false, error: "Las reglas por rango necesitan fecha inicio y fin" };
    }
    if (
      parsed.rule_type === "weekday" &&
      (!parsed.days_of_week || parsed.days_of_week.length === 0)
    ) {
      return { ok: false, error: "Las reglas por día de semana necesitan al menos un día" };
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("unit_pricing_rules")
      .insert({
        unit_id: parsed.unit_id,
        organization_id: orgId,
        name: parsed.name,
        rule_type: parsed.rule_type,
        start_date: parsed.start_date ?? null,
        end_date: parsed.end_date ?? null,
        days_of_week: parsed.days_of_week ?? null,
        price_multiplier: parsed.price_multiplier ?? null,
        price_override: parsed.price_override ?? null,
        min_nights_override: parsed.min_nights_override ?? null,
        priority: parsed.priority,
        active: true,
      })
      .select()
      .single();
    if (error) return { ok: false, error: `No se pudo crear la regla: ${error.message}` };
    revalidateListingPaths(parsed.unit_id);
    return { ok: true, rule: data as UnitPricingRule };
  } catch (e) {
    logActionError("createPricingRule", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado",
    };
  }
}

export type TogglePricingRuleResult =
  | { ok: true }
  | { ok: false; error: string };

export async function togglePricingRule(
  ruleId: string,
  active: boolean,
): Promise<TogglePricingRuleResult> {
  try {
    await requireSession();
    const { organization } = await getCurrentOrg();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("unit_pricing_rules")
      .update({ active })
      .eq("id", ruleId)
      .eq("organization_id", organization.id)
      .select("unit_id")
      .single();
    if (error) return { ok: false, error: `No se pudo actualizar: ${error.message}` };
    if (data?.unit_id) revalidateListingPaths(data.unit_id);
    return { ok: true };
  } catch (e) {
    logActionError("togglePricingRule", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado",
    };
  }
}

export type DeletePricingRuleResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deletePricingRule(ruleId: string): Promise<DeletePricingRuleResult> {
  try {
    await requireSession();
    const { organization } = await getCurrentOrg();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("unit_pricing_rules")
      .delete()
      .eq("id", ruleId)
      .eq("organization_id", organization.id)
      .select("unit_id")
      .single();
    if (error) return { ok: false, error: `No se pudo borrar: ${error.message}` };
    if (data?.unit_id) revalidateListingPaths(data.unit_id);
    return { ok: true };
  } catch (e) {
    logActionError("deletePricingRule", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado",
    };
  }
}
