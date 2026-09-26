/**
 * Alcance del rol "Propietario" (owner_view).
 *
 * El rol dice "Solo lectura de sus unidades", pero hasta la migración 064 no
 * había vínculo entre la membresía y la ficha del propietario: un owner_view
 * veía la organización entera (Habitana, 24/09/2026). Ahora la membresía
 * guarda `owner_id` y todo lector que un owner_view alcanza filtra por acá.
 *
 * FALLA CERRADO: owner_view sin propietario vinculado → `unitIds` vacío, no ve
 * nada. Cualquier otro rol → `null` (sin restricción adicional).
 *
 * Módulo sólo de servidor (usa el service role). No importarlo desde un
 * componente cliente.
 */
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";

export type OwnerScope = {
  /** null = owner_view sin vincular (no ve nada). */
  ownerId: string | null;
  unitIds: string[];
};

export const getOwnerScope = cache(async (): Promise<OwnerScope | null> => {
  const { organization, role } = await getCurrentOrg();
  if (role !== "owner_view") return null;

  const ctx = await getSessionContext();
  const membership = ctx?.memberships.find((m) => m.organization_id === organization.id);
  const ownerId = membership?.owner_id ?? null;
  if (!ownerId) return { ownerId: null, unitIds: [] };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("unit_owners")
    .select("unit_id, unit:units!inner(organization_id)")
    .eq("owner_id", ownerId)
    .eq("unit.organization_id", organization.id);
  // Si no se pudo leer, no se muestra nada (nunca "todo").
  if (error) return { ownerId, unitIds: [] };
  const unitIds = [...new Set((data ?? []).map((r) => r.unit_id as string))];
  return { ownerId, unitIds };
});

/** true si el alcance permite ver esa unidad (staff: siempre). */
export function scopeAllowsUnit(scope: OwnerScope | null, unitId: string | null | undefined): boolean {
  if (!scope) return true;
  return !!unitId && scope.unitIds.includes(unitId);
}

/**
 * Lista para `.in("unit_id", …)`. PostgREST con una lista vacía arma un
 * `in.()` inválido, así que se usa un UUID que no existe para que la consulta
 * devuelva cero filas.
 */
export function scopeUnitIdsForQuery(scope: OwnerScope): string[] {
  return scope.unitIds.length > 0 ? scope.unitIds : ["00000000-0000-0000-0000-000000000000"];
}

/**
 * Argumentos para `.filter(...scopeFilter(scope))` en cualquier query de
 * PostgREST: con alcance, `<column> in (…)`; sin alcance (staff), un no-op
 * (`id` nunca es null). Se usa `.filter` crudo en vez de `.in` para no pelear
 * con los genéricos del builder en cadenas largas.
 */
export function scopeFilter(
  scope: OwnerScope | null,
  column = "unit_id",
): [string, string, string] {
  if (!scope) return ["id", "not.is", "null"];
  return [column, "in", `(${scopeUnitIdsForQuery(scope).join(",")})`];
}

/**
 * Como `scopeFilter` pero para tablas del propietario (`owner_settlements`,
 * `owners`): con alcance, `<column> = ownerId`; owner_view sin vincular no
 * matchea nada; staff, no-op.
 */
export function ownerFilter(
  scope: OwnerScope | null,
  column = "owner_id",
): [string, string, string] {
  if (!scope) return ["id", "not.is", "null"];
  return [column, "eq", scope.ownerId ?? "00000000-0000-0000-0000-000000000000"];
}
