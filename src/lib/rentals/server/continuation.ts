import "server-only";
import { logRentalsError, type AdminClient } from "./access";

/**
 * Contratos con el cobro de la continuación encendido (`continuation_billing`,
 * 068f). Va en una consulta aparte y tolerante a propósito: si la migración
 * todavía no se aplicó, la columna no existe, y un select que la nombrara
 * dejaría sin datos el tablero de cobranzas o la grilla de comprobantes por
 * algo que sólo suma los meses de continuación (art. 1218). Sin el dato,
 * ningún contrato cobra continuación: lo mismo que antes de la 068f.
 */
export async function loadContinuationBilled(admin: AdminClient, orgId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("rental_contracts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("continuation_billing", true);
  if (error) {
    // 42703 / PGRST204: la columna todavía no existe (068f sin aplicar). No es un error.
    if (error.code !== "42703" && error.code !== "PGRST204") logRentalsError("contracts:continuationFlags", error);
    return new Set();
  }
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

/** Los mismos contratos con `continuation_billing` cargado (ver `loadContinuationBilled`). */
export async function withContinuationFlags<T extends { id: string }>(
  admin: AdminClient,
  orgId: string,
  contracts: T[],
): Promise<(T & { continuation_billing: boolean })[]> {
  if (!contracts.length) return [];
  const on = await loadContinuationBilled(admin, orgId);
  return contracts.map((c) => ({ ...c, continuation_billing: on.has(c.id) }));
}
