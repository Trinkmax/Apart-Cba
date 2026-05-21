"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import type { OtaListing, OtaListingWithUnit, Unit } from "@/lib/types/database";

const providerEnum = z.enum(["airbnb", "booking", "expedia", "vrbo", "otro"]);

const createSchema = z.object({
  unit_id: z.string().uuid("Unidad inválida"),
  provider: providerEnum,
  external_listing_id: z.string().trim().min(1, "ID externo requerido").max(200),
  external_listing_url: z.string().url("URL inválida").optional().nullable(),
  external_account_email: z.string().email("Email inválido").optional().nullable(),
  label: z.string().trim().max(120).optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().uuid(),
  active: z.boolean().optional(),
});

function zodErrorMessage(err: z.ZodError): string {
  const first = err.issues[0];
  if (!first) return "Datos inválidos";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

function logActionError(context: string, e: unknown) {
  console.error(`[ota-listings:${context}]`, e);
}

export type ListOtaListingsResult =
  | { ok: true; listings: OtaListingWithUnit[] }
  | { ok: false; error: string };

export async function listOtaListings(): Promise<ListOtaListingsResult> {
  try {
    const { organization } = await getCurrentOrg();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("ota_listings")
      .select(`*, unit:units(id, code, name)`)
      .eq("organization_id", organization.id)
      .order("provider", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) {
      logActionError("listOtaListings", error);
      return { ok: false, error: error.message };
    }
    return {
      ok: true,
      listings: (data ?? []) as unknown as (OtaListing & { unit: Pick<Unit, "id" | "code" | "name"> })[],
    };
  } catch (e) {
    logActionError("listOtaListings:catch", e);
    return { ok: false, error: (e as Error).message ?? "Error desconocido" };
  }
}

export type CreateOtaListingResult =
  | { ok: true; listing: OtaListing }
  | { ok: false; error: string };

export async function createOtaListing(
  input: z.infer<typeof createSchema>,
): Promise<CreateOtaListingResult> {
  try {
    await requireSession();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodErrorMessage(parsed.error) };

    const { organization } = await getCurrentOrg();
    const admin = createAdminClient();

    // Verificar que la unidad existe en la org
    const { data: unit } = await admin
      .from("units")
      .select("id")
      .eq("id", parsed.data.unit_id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (!unit) return { ok: false, error: "La unidad no pertenece a la organización actual" };

    const { data, error } = await admin
      .from("ota_listings")
      .insert({
        organization_id: organization.id,
        unit_id: parsed.data.unit_id,
        provider: parsed.data.provider,
        external_listing_id: parsed.data.external_listing_id,
        external_listing_url: parsed.data.external_listing_url ?? null,
        external_account_email: parsed.data.external_account_email ?? null,
        label: parsed.data.label ?? null,
        active: true,
      })
      .select("*")
      .single();

    if (error) {
      logActionError("createOtaListing:insert", error);
      if (error.code === "23505") {
        return { ok: false, error: "Ya existe un mapeo con ese ID externo para este proveedor" };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/dashboard/channel-manager");
    return { ok: true, listing: data as OtaListing };
  } catch (e) {
    logActionError("createOtaListing:catch", e);
    return { ok: false, error: (e as Error).message ?? "Error desconocido" };
  }
}

export type UpdateOtaListingResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateOtaListing(
  input: z.infer<typeof updateSchema>,
): Promise<UpdateOtaListingResult> {
  try {
    await requireSession();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodErrorMessage(parsed.error) };

    const { organization } = await getCurrentOrg();
    const admin = createAdminClient();

    const { id, ...rest } = parsed.data;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await admin
      .from("ota_listings")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", organization.id);

    if (error) {
      logActionError("updateOtaListing", error);
      if (error.code === "23505") {
        return { ok: false, error: "Ya existe un mapeo con ese ID externo para este proveedor" };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/dashboard/channel-manager");
    return { ok: true };
  } catch (e) {
    logActionError("updateOtaListing:catch", e);
    return { ok: false, error: (e as Error).message ?? "Error desconocido" };
  }
}

export type DeleteOtaListingResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteOtaListing(id: string): Promise<DeleteOtaListingResult> {
  try {
    await requireSession();
    if (!z.string().uuid().safeParse(id).success) {
      return { ok: false, error: "ID inválido" };
    }

    const { organization } = await getCurrentOrg();
    const admin = createAdminClient();
    const { error } = await admin
      .from("ota_listings")
      .delete()
      .eq("id", id)
      .eq("organization_id", organization.id);

    if (error) {
      logActionError("deleteOtaListing", error);
      return { ok: false, error: error.message };
    }

    revalidatePath("/dashboard/channel-manager");
    return { ok: true };
  } catch (e) {
    logActionError("deleteOtaListing:catch", e);
    return { ok: false, error: (e as Error).message ?? "Error desconocido" };
  }
}
