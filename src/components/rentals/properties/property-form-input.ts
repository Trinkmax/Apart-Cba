import { parseAmountInput } from "@/lib/format";
import { ownershipRowsOf, withProvisionalIds } from "./owner-rows";
import { savedPropertyDiffs, type SavedPropertySnapshot } from "./property-helpers";
import type { PropertyInput } from "./property-types";
import type { PropertyFormState } from "./property-form";

/**
 * Del formulario de la propiedad a lo que se manda al servidor (sin los
 * titulares, que se arman aparte). Lógica pura: la usa el guardado y también
 * la comparación con una propiedad que ya había quedado guardada.
 */

export type PropertyFormParse =
  | { ok: true; base: Omit<PropertyInput, "owners"> }
  | { ok: false; field: string; message: string };

const text = (v: string) => (v.trim() ? v.trim() : null);

/** Entero tipeado ("3") → número; vacío → null; basura → undefined (error). */
function intOrNull(v: string): number | null | undefined {
  if (!v.trim()) return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function parsePropertyForm(form: PropertyFormState, isEdit: boolean): PropertyFormParse {
  if (form.street.trim().length < 2) return { ok: false, field: "street", message: "Escribí la calle." };
  const ints = { rooms: intOrNull(form.rooms), bedrooms: intOrNull(form.bedrooms), bathrooms: intOrNull(form.bathrooms) };
  for (const [k, v] of Object.entries(ints)) if (v === undefined) return { ok: false, field: k, message: "Tiene que ser un número entero." };
  const covered = form.covered_m2.trim() ? parseAmountInput(form.covered_m2) : null;
  if (form.covered_m2.trim() && (covered == null || covered <= 0)) return { ok: false, field: "covered_m2", message: "Revisá los m²." };
  const total = form.total_m2.trim() ? parseAmountInput(form.total_m2) : null;
  if (form.total_m2.trim() && (total == null || total <= 0)) return { ok: false, field: "total_m2", message: "Revisá los m²." };
  const listing = form.listing_rent.trim() ? parseAmountInput(form.listing_rent) : null;
  if (form.listing_rent.trim() && (listing == null || listing <= 0)) {
    return { ok: false, field: "listing_rent", message: "Revisá el precio: escribilo así, 450.000" };
  }
  return {
    ok: true,
    base: {
      // Alta: siempre el mismo id para esta propiedad (queda en el borrador): reintentar no la duplica.
      id: isEdit ? null : form.client_id,
      code: form.code.trim(),
      property_type: form.property_type,
      street: form.street.trim(),
      street_number: text(form.street_number),
      floor: text(form.floor),
      apartment: text(form.apartment),
      tower: text(form.tower),
      neighborhood: text(form.neighborhood),
      city: form.city.trim() || "Córdoba",
      province: form.province.trim() || "Córdoba",
      postal_code: text(form.postal_code),
      rooms: ints.rooms ?? null,
      bedrooms: ints.bedrooms ?? null,
      bathrooms: ints.bathrooms ?? null,
      covered_m2: covered,
      total_m2: total,
      furnished: form.furnished,
      has_garage: form.has_garage,
      consortium_name: text(form.consortium_name),
      consortium_phone: text(form.consortium_phone),
      consortium_email: text(form.consortium_email),
      functional_unit: text(form.functional_unit),
      cadastral_id: text(form.cadastral_id),
      services: form.services
        .filter((s) => s.provider?.trim() || s.account_number?.trim() || s.holder?.trim() || s.notes?.trim())
        .map((s) => ({
          kind: s.kind,
          provider: s.provider?.trim() || null,
          account_number: s.account_number?.trim() || null,
          holder: s.holder?.trim() || null,
          notes: s.notes?.trim() || null,
        })),
      listing_rent: listing,
      listing_currency: listing != null ? form.listing_currency : null,
      availability: form.availability,
      mandate_signed_at: form.mandate_signed_at || null,
      notes: text(form.notes),
    },
  };
}

/**
 * Qué tiene el formulario distinto de la propiedad que ya había quedado
 * guardada con su mismo id (ver `savedPropertyDiffs`). Los propietarios
 * nuevos cuentan con el id con el que se iban a crear: si se crearon y
 * quedaron en la propiedad, son los mismos. Si lo tipeado no se puede leer
 * (un m² mal escrito), se avisa igual que hay algo distinto.
 */
export function formDiffsFromSaved(form: PropertyFormState, saved: SavedPropertySnapshot): string[] {
  const parsed = parsePropertyForm(form, false);
  if (!parsed.ok) return ["algunos datos"];
  const owners = withProvisionalIds(ownershipRowsOf(form.owners)).map((r) => ({ owner_id: r.owner_id, ownership_pct: r.ownership_pct, is_primary: r.is_primary }));
  return savedPropertyDiffs(saved, { ...parsed.base, owners });
}
