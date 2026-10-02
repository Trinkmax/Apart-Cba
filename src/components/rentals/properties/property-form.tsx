"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { createProperty, getPropertyFormOptions, updateProperty } from "@/lib/actions/rentals-properties";
import { parseAmountInput, parsePercentInput } from "@/lib/format";
import { formatMoneyEditable } from "@/components/bookings/money-input";
import type {
  RentalProperty,
  RentalPropertyAvailability,
  RentalPropertyServiceAccount,
  RentalPropertyType,
} from "@/lib/types/database";
import { validateOwnership } from "./property-helpers";
import { newKey, ownerRowsFrom, type OwnerRowState } from "./owner-rows";
import type { OwnerOption, PropertyCodeRef, PropertyInput, PropertyOwnerInput } from "./property-types";
import { PropertyFormBody } from "./property-form-body";

/**
 * Formulario de propiedad (vive adentro de PropertyFormDialog; se monta al
 * abrir). Carga al abrirse los propietarios de la org y los códigos usados
 * para validar en vivo; el servidor vuelve a validar todo al guardar.
 */

export interface ServiceRowState extends RentalPropertyServiceAccount {
  key: string;
}

export interface PropertyFormState {
  code: string;
  property_type: RentalPropertyType;
  street: string;
  street_number: string;
  floor: string;
  apartment: string;
  tower: string;
  neighborhood: string;
  city: string;
  province: string;
  postal_code: string;
  rooms: string;
  bedrooms: string;
  bathrooms: string;
  covered_m2: string;
  total_m2: string;
  furnished: boolean;
  has_garage: boolean;
  consortium_name: string;
  consortium_phone: string;
  consortium_email: string;
  functional_unit: string;
  cadastral_id: string;
  services: ServiceRowState[];
  listing_rent: string;
  listing_currency: "ARS" | "USD";
  availability: RentalPropertyAvailability;
  mandate_signed_at: string;
  notes: string;
  owners: OwnerRowState[];
}

export type SetPropertyField = <K extends keyof PropertyFormState>(key: K, value: PropertyFormState[K]) => void;

function initialState(p: RentalProperty | null | undefined, owners: PropertyOwnerInput[] | undefined): PropertyFormState {
  const num = (v: number | null | undefined) => (v == null ? "" : String(v));
  return {
    code: p?.code ?? "",
    property_type: p?.property_type ?? "departamento",
    street: p?.street ?? "",
    street_number: p?.street_number ?? "",
    floor: p?.floor ?? "",
    apartment: p?.apartment ?? "",
    tower: p?.tower ?? "",
    neighborhood: p?.neighborhood ?? "",
    city: p?.city ?? "Córdoba",
    province: p?.province ?? "Córdoba",
    postal_code: p?.postal_code ?? "",
    rooms: num(p?.rooms),
    bedrooms: num(p?.bedrooms),
    bathrooms: num(p?.bathrooms),
    covered_m2: p?.covered_m2 != null ? String(Number(p.covered_m2)).replace(".", ",") : "",
    total_m2: p?.total_m2 != null ? String(Number(p.total_m2)).replace(".", ",") : "",
    furnished: p?.furnished ?? false,
    has_garage: p?.has_garage ?? false,
    consortium_name: p?.consortium_name ?? "",
    consortium_phone: p?.consortium_phone ?? "",
    consortium_email: p?.consortium_email ?? "",
    functional_unit: p?.functional_unit ?? "",
    cadastral_id: p?.cadastral_id ?? "",
    services: (Array.isArray(p?.services) ? p.services : []).map((s) => ({ ...s, key: newKey() })),
    listing_rent: formatMoneyEditable(p?.listing_rent),
    listing_currency: p?.listing_currency === "USD" ? "USD" : "ARS",
    availability: p?.availability ?? "disponible",
    mandate_signed_at: p?.mandate_signed_at ?? "",
    notes: p?.notes ?? "",
    owners: ownerRowsFrom(owners),
  };
}

export interface PropertyFormProps {
  property?: RentalProperty | null;
  owners?: PropertyOwnerInput[];
  onDone: (property: RentalProperty) => void;
  onCancel: () => void;
}

export type PropertyFieldError = { field?: string; message: string; suggestion?: string } | null;

const text = (v: string) => (v.trim() ? v.trim() : null);

/** Entero tipeado ("3") → número; vacío → null; basura → undefined (error). */
function intOrNull(v: string): number | null | undefined {
  if (!v.trim()) return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function PropertyForm({ property, owners, onDone, onCancel }: PropertyFormProps) {
  const [form, setForm] = useState<PropertyFormState>(() => initialState(property, owners));
  const [ownerOptions, setOwnerOptions] = useState<OwnerOption[] | null>(null);
  const [codes, setCodes] = useState<PropertyCodeRef[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<PropertyFieldError>(null);
  const [pending, startTransition] = useTransition();
  const propertyId = property?.id ?? null;
  const ownersGiven = Boolean(owners?.length);

  useEffect(() => {
    let alive = true;
    getPropertyFormOptions(propertyId).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setLoadError(res.error);
        setOwnerOptions([]);
        return;
      }
      setOwnerOptions(res.options.owners);
      setCodes(res.options.codes);
      // Edición sin titulares en las props: se traen del servidor.
      if (!ownersGiven && res.options.current_owners?.length) {
        setForm((f) => ({ ...f, owners: ownerRowsFrom(res.options.current_owners) }));
      }
    });
    return () => {
      alive = false;
    };
  }, [propertyId, ownersGiven]);

  const set: SetPropertyField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldError((e) => (e && (e.field === key || (key === "owners" && e.field === "owners")) ? null : e));
  };

  function fail(field: string | undefined, message: string, suggestion?: string) {
    setFieldError({ field, message, suggestion });
    if (!field) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`property-${field}`);
      // Si el campo está en una sección plegada, se abre antes de enfocarlo.
      el?.closest("details")?.setAttribute("open", "");
      el?.focus();
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (form.street.trim().length < 2) return fail("street", "Escribí la calle.");
    const ints = { rooms: intOrNull(form.rooms), bedrooms: intOrNull(form.bedrooms), bathrooms: intOrNull(form.bathrooms) };
    for (const [k, v] of Object.entries(ints)) if (v === undefined) return fail(k, "Tiene que ser un número entero.");
    const covered = form.covered_m2.trim() ? parseAmountInput(form.covered_m2) : null;
    if (form.covered_m2.trim() && (covered == null || covered <= 0)) return fail("covered_m2", "Revisá los m².");
    const total = form.total_m2.trim() ? parseAmountInput(form.total_m2) : null;
    if (form.total_m2.trim() && (total == null || total <= 0)) return fail("total_m2", "Revisá los m².");
    const listing = form.listing_rent.trim() ? parseAmountInput(form.listing_rent) : null;
    if (form.listing_rent.trim() && (listing == null || listing <= 0)) return fail("listing_rent", "Revisá el precio: escribilo así, 450.000");
    let ownerRows = form.owners
      .filter((o) => o.owner_id || o.pct.trim())
      .map((o) => ({ owner_id: o.owner_id, ownership_pct: parsePercentInput(o.pct) ?? Number.NaN, is_primary: o.is_primary }));
    // Un solo dueño: es el 100 % y el principal (el formulario ni pregunta).
    if (ownerRows.length === 1) ownerRows = [{ ...ownerRows[0], ownership_pct: 100, is_primary: true }];
    const ownership = validateOwnership(ownerRows);
    if (!ownership.ok) return fail("owners", ownership.error);

    const input: PropertyInput = {
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
      owners: ownerRows,
    };
    startTransition(async () => {
      const res = property ? await updateProperty(property.id, input) : await createProperty(input);
      if (!res.ok) {
        fail(res.field, res.error, res.suggestion);
        // El aviso flotante siempre: el campo puede estar dentro de una sección plegada.
        toast.error("No se pudo guardar la propiedad", { description: res.error });
        return;
      }
      toast.success(property ? "Cambios guardados" : "Propiedad cargada", { description: `${res.property.code}` });
      onDone(res.property);
    });
  }

  return (
    <PropertyFormBody
      form={form}
      set={set}
      isEdit={Boolean(property)}
      propertyId={propertyId}
      ownerOptions={ownerOptions}
      onOwnerCreated={(o) => setOwnerOptions((list) => [...(list ?? []), o].sort((a, b) => a.full_name.localeCompare(b.full_name, "es")))}
      codes={codes}
      loadError={loadError}
      fieldError={fieldError}
      pending={pending}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
