import { AVAILABILITY_META, PROPERTY_TYPE_LABEL, SERVICE_KIND_META } from "@/lib/rentals/labels";
import type { RentalPropertyAvailability, RentalPropertyType, RentalServiceKind } from "@/lib/types/database";
import { isUuid, newClientId } from "@/lib/rentals/property-input";
import { mergeDraft, oneOf } from "@/components/rentals/people/form-draft";
import { newKey, type NewOwnerDraft, type OwnerRowState } from "./owner-rows";
import type { PropertyFormState, ServiceRowState } from "./property-form";
import type { CreatedOwnerRef } from "./property-types";

/**
 * Del borrador guardado (sessionStorage) al estado del formulario de alta de
 * propiedad. Todo pasa por un filtro: lo que no encaja queda como en un alta
 * vacía, y las filas reciben ids nuevos.
 */

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function ownerDraftOf(v: unknown): NewOwnerDraft | null {
  if (!isRecord(v)) return null;
  // El id viaja con el borrador: si ese propietario ya se había creado, reintentar no lo duplica.
  const id = isUuid(v.id) ? v.id : newClientId();
  return { id, full_name: str(v.full_name), phone: str(v.phone), email: str(v.email), cbu: str(v.cbu), alias_cbu: str(v.alias_cbu) };
}

export function ownerRowsFromDraft(v: unknown): OwnerRowState[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const rows: OwnerRowState[] = v.filter(isRecord).map((r) => {
    const draft = ownerDraftOf(r.draft);
    const ownerId = str(r.owner_id);
    return { key: newKey(), owner_id: ownerId, pct: str(r.pct), is_primary: r.is_primary === true, draft: ownerId ? null : draft };
  });
  if (!rows.length) return undefined;
  // Siempre un principal: sin él la validación pide algo que no se ve en una sola fila.
  if (!rows.some((r) => r.is_primary)) rows[0] = { ...rows[0], is_primary: true };
  return rows;
}

const SERVICE_KINDS = Object.keys(SERVICE_KIND_META) as RentalServiceKind[];

export function serviceRowsFromDraft(v: unknown): ServiceRowState[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter(isRecord)
    .filter((s) => typeof s.kind === "string" && (SERVICE_KINDS as string[]).includes(s.kind))
    .map((s) => ({
      key: newKey(),
      kind: s.kind as RentalServiceKind,
      provider: strOrNull(s.provider),
      account_number: strOrNull(s.account_number),
      holder: strOrNull(s.holder),
      notes: strOrNull(s.notes),
    }));
}

/** Los propietarios que el formulario ya había creado: sólo ids válidos, sin repetir. */
export function createdOwnersFromDraft(v: unknown): CreatedOwnerRef[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CreatedOwnerRef[] = [];
  for (const o of v) {
    if (!isRecord(o) || !isUuid(o.id) || typeof o.full_name !== "string" || !o.full_name.trim()) continue;
    if (!out.some((x) => x.id === o.id)) out.push({ id: o.id, full_name: o.full_name.trim() });
  }
  return out.slice(0, 20);
}

export function propertyStateFromDraft(blank: PropertyFormState, stored: Record<string, unknown>): PropertyFormState {
  return mergeDraft(blank, stored, {
    // El id de la propiedad también: si ya se había guardado, el reintento devuelve esa en vez de otra igual.
    client_id: (v) => (isUuid(v) ? v : undefined),
    property_type: oneOf(Object.keys(PROPERTY_TYPE_LABEL) as RentalPropertyType[]),
    availability: oneOf(Object.keys(AVAILABILITY_META) as RentalPropertyAvailability[]),
    listing_currency: oneOf(["ARS", "USD"] as const),
    owners: ownerRowsFromDraft,
    services: serviceRowsFromDraft,
    created_owners: createdOwnersFromDraft,
  });
}

/**
 * Al recuperar un borrador, un propietario que ya no está en la lista (lo
 * archivaron o borraron entretanto) se suelta: si no, el buscador se ve vacío
 * pero el guardado falla con "ya no existe".
 */
export function dropUnknownOwners(rows: OwnerRowState[], knownIds: ReadonlySet<string>): OwnerRowState[] {
  return rows.map((r) => (r.owner_id && !knownIds.has(r.owner_id) ? { ...r, owner_id: "" } : r));
}
