"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { createProperty, getPropertyFormOptions, quickCreateOwner, updateProperty } from "@/lib/actions/rentals-properties";
import { toastActionFailure } from "@/lib/action-failure";
import { parseAmountInput } from "@/lib/format";
import { joinNamesEs } from "@/lib/rentals/renewal";
import { checkPropertyInput, checkQuickOwnerInput, newClientId, OTHER_PERSON_HINT } from "@/lib/rentals/property-input";
import { formatMoneyEditable } from "@/components/bookings/money-input";
import type {
  RentalProperty,
  RentalPropertyAvailability,
  RentalPropertyServiceAccount,
  RentalPropertyType,
} from "@/lib/types/database";
import { sameFormValues } from "@/components/rentals/people/form-draft";
import { clearDraft, readDraft, usePersistDraft } from "@/components/rentals/people/use-form-draft";
import { findCodeClash, validateOwnership } from "./property-helpers";
import {
  adoptCreatedOwners,
  findOwnerByName,
  newKey,
  ownerRowsFrom,
  ownershipRowsOf,
  withProvisionalIds,
  type OwnershipRow,
  type OwnerRowState,
} from "./owner-rows";
import { dropUnknownOwners, propertyStateFromDraft } from "./property-draft";
import { ownerPickerId } from "./owners-editor";
import { quickOwnerFieldId, type QuickOwnerError } from "./quick-owner-panel";
import type { OwnerOption, PropertyCodeRef, PropertyInput, PropertyOwnerInput, QuickOwnerInput, SavedPropertyOwner } from "./property-types";
import { PropertyFormBody } from "./property-form-body";

/**
 * Formulario de propiedad (vive adentro de PropertyFormDialog; se monta al
 * abrir). Carga al abrirse los propietarios de la org y los códigos usados
 * para validar en vivo; el servidor vuelve a validar todo al guardar. Un solo
 * "Guardar propiedad" guarda todo: también crea a los propietarios nuevos
 * tipeados en el formulario. En un alta, lo tipeado se guarda como borrador.
 */

export interface ServiceRowState extends RentalPropertyServiceAccount {
  key: string;
}

export interface PropertyFormState {
  /** Alta: id con el que se va a crear (viaja en el borrador; ver `newClientId`). */
  client_id: string;
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
    client_id: p?.id ?? newClientId(),
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
  onDone: (property: RentalProperty, owners: SavedPropertyOwner[]) => void;
  onCancel: () => void;
  /** Borrador del alta en sessionStorage (null = sin borrador, p. ej. al editar). */
  draftKey?: string | null;
  /**
   * Avisa si hay algo sin guardar y si se está guardando: el diálogo pregunta
   * antes de cerrar. `createdOwners`: propietarios que este formulario ya creó
   * (quedan en Propietarios aunque la propiedad no se guarde).
   */
  onStatusChange?: (dirty: boolean, busy: boolean, createdOwners: string[]) => void;
}

export type PropertyFieldError = { field?: string; message: string; suggestion?: string } | null;

const text = (v: string) => (v.trim() ? v.trim() : null);

/** Entero tipeado ("3") → número; vacío → null; basura → undefined (error). */
function intOrNull(v: string): number | null | undefined {
  if (!v.trim()) return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

const byName = (a: OwnerOption, b: OwnerOption) => a.full_name.localeCompare(b.full_name, "es");

export function PropertyForm({ property, owners, onDone, onCancel, draftKey = null, onStatusChange }: PropertyFormProps) {
  // Un alta arranca de lo que quedó sin guardar en esta pestaña (si hay); una edición, siempre de la base.
  const [init] = useState(() => {
    const fresh = initialState(property, owners);
    const stored = property ? null : readDraft(draftKey);
    const restored = stored ? propertyStateFromDraft(fresh, stored.form) : null;
    // El id del alta viaja en el borrador: se compara con ese mismo id (si no, un borrador vacío "tendría algo").
    const blank = restored ? { ...fresh, client_id: restored.client_id } : fresh;
    return restored && !sameFormValues(restored, blank)
      ? { blank, form: restored, restoredAt: stored?.savedAt ?? null }
      : { blank: fresh, form: fresh, restoredAt: null };
  });
  const [form, setForm] = useState<PropertyFormState>(init.form);
  // Contra qué se compara para saber si hay algo sin guardar (al editar se completa con los titulares que trae el servidor).
  const [blank, setBlank] = useState<PropertyFormState>(init.blank);
  const [restoredAt, setRestoredAt] = useState<string | null>(init.restoredAt);
  const [ownerOptions, setOwnerOptions] = useState<OwnerOption[] | null>(null);
  const [codes, setCodes] = useState<PropertyCodeRef[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<PropertyFieldError>(null);
  const [draftError, setDraftError] = useState<QuickOwnerError | null>(null);
  // Propietarios nuevos que este formulario ya creó. Si la propiedad no llega a guardarse, siguen en
  // Propietarios: el aviso de la fila y el "¿Descartar?" lo dicen (el 05/10 quedaron dos sin propiedad).
  const [sessionCreated, setSessionCreated] = useState<OwnerOption[]>([]);
  const [pending, startTransition] = useTransition();
  const propertyId = property?.id ?? null;
  const ownersGiven = Boolean(owners?.length);
  const wasRestored = init.restoredAt != null;

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
        const rows = ownerRowsFrom(res.options.current_owners);
        setForm((f) => ({ ...f, owners: rows }));
        setBlank((b) => ({ ...b, owners: rows }));
      }
      if (wasRestored) {
        const known = new Set(res.options.owners.map((o) => o.id));
        // Un propietario nuevo del borrador que sí se había creado (se recargó en medio del guardado) vuelve elegido.
        const draftIds = new Set(init.form.owners.flatMap((r) => (!r.owner_id && r.draft ? [r.draft.id] : [])));
        const adopted = res.options.owners.filter((o) => draftIds.has(o.id));
        setForm((f) => ({ ...f, owners: adoptCreatedOwners(dropUnknownOwners(f.owners, known), adopted).rows }));
        if (adopted.length) setSessionCreated((prev) => [...prev, ...adopted.filter((o) => !prev.some((p) => p.id === o.id))]);
      }
    });
    return () => {
      alive = false;
    };
  }, [propertyId, ownersGiven, wasRestored, init]);

  const dirty = !sameFormValues(form, blank);
  usePersistDraft(property ? null : draftKey, form, blank);
  const createdOwnerNames = sessionCreated.map((o) => o.full_name);
  useEffect(() => {
    onStatusChange?.(dirty, pending, createdOwnerNames);
  }, [dirty, pending, onStatusChange, createdOwnerNames]);
  // El aviso "Listo: X quedó creado… falta guardar la propiedad", mientras siga elegido en una fila.
  const createdNames = sessionCreated.filter((o) => form.owners.some((r) => r.owner_id === o.id)).map((o) => o.full_name);

  function addOwnerOption(owner: OwnerOption) {
    setOwnerOptions((list) => (list?.some((o) => o.id === owner.id) ? list : [...(list ?? []), owner].sort(byName)));
  }

  function rememberCreated(list: OwnerOption[]) {
    if (!list.length) return;
    setSessionCreated((prev) => [...prev, ...list.filter((o) => !prev.some((p) => p.id === o.id))]);
  }

  /**
   * Después de un guardado que falló: la lista de propietarios y de códigos
   * vuelve a leerse (alguien pudo cargar ese dueño o ese código recién) y un
   * propietario nuevo que sí se había creado (se perdió la respuesta) pasa a
   * estar elegido en su fila. Sin conexión, queda lo que había.
   */
  async function refreshOptions(draftIds: Set<string>) {
    try {
      const res = await getPropertyFormOptions(propertyId);
      if (!res.ok) return;
      setOwnerOptions(res.options.owners);
      setCodes(res.options.codes);
      const adopted = res.options.owners.filter((o) => draftIds.has(o.id));
      if (!adopted.length) return;
      setForm((f) => {
        const next = adoptCreatedOwners(f.owners, adopted);
        return next.adopted.length ? { ...f, owners: next.rows } : f;
      });
      rememberCreated(adopted);
    } catch {
      /* sin conexión o sistema actualizado: queda la lista que había */
    }
  }

  const set: SetPropertyField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldError((e) => (e && (e.field === key || (key === "owners" && e.field === "owners")) ? null : e));
    if (key === "owners") setDraftError(null);
  };

  function fail(field: string | undefined, message: string, suggestion?: string) {
    setFieldError({ field, message, suggestion });
    if (!field) return;
    requestAnimationFrame(() => {
      // Falta el dueño: al buscador de la primera fila sin elegir (con Enter se abre).
      const emptyRow = field === "owners" ? form.owners.findIndex((r) => !r.owner_id && !r.draft) : -1;
      const el = document.getElementById(emptyRow >= 0 ? ownerPickerId(emptyRow) : `property-${field}`);
      // Si el campo está en una sección plegada, se abre antes de enfocarlo.
      el?.closest("details")?.setAttribute("open", "");
      el?.focus();
    });
  }

  function failDraft(rowKey: string, field: string | undefined, message: string) {
    setDraftError({ rowKey, field, message });
    requestAnimationFrame(() => document.getElementById(quickOwnerFieldId(rowKey, field ?? "full_name"))?.focus());
  }

  function startOver() {
    clearDraft(draftKey);
    // Formulario y referencia con el mismo id nuevo: si no, el vacío contaría como "algo sin guardar".
    const fresh = initialState(null, undefined);
    setForm(fresh);
    setBlank(fresh);
    setRestoredAt(null);
    setFieldError(null);
    setDraftError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setDraftError(null);
    if (form.street.trim().length < 2) return fail("street", "Escribí la calle.");
    const ints = { rooms: intOrNull(form.rooms), bedrooms: intOrNull(form.bedrooms), bathrooms: intOrNull(form.bathrooms) };
    for (const [k, v] of Object.entries(ints)) if (v === undefined) return fail(k, "Tiene que ser un número entero.");
    const covered = form.covered_m2.trim() ? parseAmountInput(form.covered_m2) : null;
    if (form.covered_m2.trim() && (covered == null || covered <= 0)) return fail("covered_m2", "Revisá los m².");
    const total = form.total_m2.trim() ? parseAmountInput(form.total_m2) : null;
    if (form.total_m2.trim() && (total == null || total <= 0)) return fail("total_m2", "Revisá los m².");
    const listing = form.listing_rent.trim() ? parseAmountInput(form.listing_rent) : null;
    if (form.listing_rent.trim() && (listing == null || listing <= 0)) return fail("listing_rent", "Revisá el precio: escribilo así, 450.000");

    // Todo lo que el servidor puede rechazar se mira ACÁ, antes de crear al primer propietario nuevo:
    // si algo fallaba recién después, el propietario quedaba creado y la propiedad no (lo del 05/10).
    const rows = ownershipRowsOf(form.owners);
    // Con una sola fila, "elegí el propietario en cada fila" no se entiende: se dice qué falta y cómo.
    if (!rows.some((r) => r.owner_id || r.draft)) return fail("owners", "Falta el propietario: buscalo en la lista o, si no está, creálo desde el mismo buscador.");
    const chosenIds = new Set(rows.map((r) => r.owner_id).filter(Boolean));
    const newOwners = new Map<string, QuickOwnerInput>();
    for (let i = 0; i < rows.length; i++) {
      const draft = rows[i].draft;
      if (!draft) continue;
      const name = draft.full_name.trim();
      if (name.length < 2) return failDraft(rows[i].key, "full_name", "Escribí el nombre del propietario nuevo.");
      const existing = findOwnerByName(ownerOptions, name, draft.id);
      if (existing) {
        return failDraft(
          rows[i].key,
          "full_name",
          chosenIds.has(existing.id)
            ? `${existing.full_name} ya está en otra fila de esta propiedad: si es la misma persona, quitá esta fila. ${OTHER_PERSON_HINT}`
            : `${existing.full_name} ya está en Propietarios: si es la misma persona, tocá «Usar ese propietario». ${OTHER_PERSON_HINT}`,
        );
      }
      const earlier = rows.slice(0, i).flatMap((r) => (r.draft ? [{ id: r.key, full_name: r.draft.full_name, phone: null, email: null, document_number: null }] : []));
      if (findOwnerByName(earlier, name)) return failDraft(rows[i].key, "full_name", `Ese nombre ya está en otra fila. ${OTHER_PERSON_HINT}`);
      const input: QuickOwnerInput = {
        id: draft.id,
        full_name: name,
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        cbu: draft.cbu.trim() || null,
        alias_cbu: draft.alias_cbu.trim() || null,
      };
      // Mismo control que el servidor: un mail mal escrito en el segundo dejaba creado al primero.
      const ownerCheck = checkQuickOwnerInput(input);
      if (!ownerCheck.ok) return failDraft(rows[i].key, ownerCheck.field, ownerCheck.error);
      newOwners.set(rows[i].key, input);
    }
    // Cada nuevo ocupa su fila con el id con el que se va a crear (así pasa el mismo control que el servidor).
    const provisional = withProvisionalIds(rows);
    const ownership = validateOwnership(provisional);
    if (!ownership.ok) return fail("owners", ownership.error);
    // El mismo choque de código que muestra el campo (el servidor lo rechazaría con el dueño ya creado).
    const clash = findCodeClash(codes, propertyId ?? form.client_id, form.code);
    if (clash) return fail("code", `Ya es el código de ${clash.label}.`, clash.fix);

    const base: Omit<PropertyInput, "owners"> = {
      // Alta: siempre el mismo id para esta propiedad (queda en el borrador): reintentar no la duplica.
      id: property ? null : form.client_id,
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
    };
    const toInput = (list: OwnershipRow[]): PropertyInput => ({
      ...base,
      owners: list.map((r) => ({ owner_id: r.owner_id, ownership_pct: r.ownership_pct, is_primary: r.is_primary })),
    });
    const propertyCheck = checkPropertyInput(toInput(provisional));
    if (!propertyCheck.ok) {
      fail(propertyCheck.field, propertyCheck.error);
      // El aviso flotante también: el campo puede estar en una sección plegada o no tener casillero propio.
      toast.error("Falta corregir algo antes de guardar", { description: propertyCheck.error });
      return;
    }

    const knownOwners = ownerOptions ?? [];
    const draftIds = new Set(Array.from(newOwners.values(), (o) => o.id).filter((id): id is string => Boolean(id)));
    startTransition(async () => {
      let stage: "owner" | "property" = newOwners.size ? "owner" : "property";
      try {
        // Primero los propietarios nuevos (un solo "Guardar" crea todo). Cada uno que se crea queda
        // elegido en su fila: si después algo falla, reintentar no lo duplica.
        let finalRows = rows;
        const created: OwnerOption[] = [];
        for (const r of rows) {
          const ownerInput = newOwners.get(r.key);
          if (!ownerInput) continue;
          const res = await quickCreateOwner(ownerInput);
          if (!res.ok) {
            // Ya existe con ese nombre (lo cargó otra persona recién o no estaba en la lista): que aparezca con «Usar ese propietario».
            if (res.existing) addOwnerOption(res.existing);
            failDraft(r.key, res.field, res.error);
            toast.error("No se pudo crear el propietario", { description: res.error });
            return;
          }
          const owner = res.owner;
          created.push(owner);
          rememberCreated([owner]);
          addOwnerOption(owner);
          finalRows = finalRows.map((x) => (x.key === r.key ? { ...x, owner_id: owner.id, draft: null } : x));
          setForm((f) => ({ ...f, owners: f.owners.map((x) => (x.key === r.key ? { ...x, owner_id: owner.id, draft: null } : x)) }));
        }
        stage = "property";
        const input = toInput(finalRows);
        const res = property ? await updateProperty(property.id, input) : await createProperty(input);
        if (!res.ok) {
          fail(res.field, res.error, res.suggestion);
          // El aviso flotante siempre: el campo puede estar dentro de una sección plegada.
          toast.error("No se pudo guardar la propiedad", { description: res.error });
          void refreshOptions(new Set());
          return;
        }
        const names = new Map([...knownOwners, ...created].map((o) => [o.id, o.full_name]));
        const saved: SavedPropertyOwner[] =
          res.already_saved && res.owners?.length
            ? res.owners
            : input.owners.map((o) => ({ ...o, full_name: names.get(o.owner_id) ?? "Propietario" }));
        if (res.already_saved) {
          // Reintento de un alta que ya había entrado (se perdió la respuesta): es la misma, no otra igual.
          toast.success("La propiedad ya estaba guardada", {
            description: `${res.property.code}: se había guardado en el intento anterior. Si después cambiaste algo, revisalo en la ficha.`,
          });
        } else {
          const createdLine = created.length
            ? ` · ${joinNamesEs(created.map((o) => o.full_name))} ${created.length === 1 ? "quedó cargado como propietario" : "quedaron cargados como propietarios"}`
            : "";
          toast.success(property ? "Cambios guardados" : "Propiedad cargada", { description: `${res.property.code}${createdLine}` });
        }
        onDone(res.property, saved);
      } catch (error) {
        // No llegó respuesta: se cortó la conexión o hubo un deploy (ahí reintentar no sirve: hay que recargar).
        // Lo tipeado sigue en el formulario (y en el borrador); un propietario ya creado quedó elegido en su fila.
        toastActionFailure(error, stage === "owner" ? "No se pudo crear el propietario" : "No se pudo guardar la propiedad", {
          retry: "Revisá la conexión y probá de nuevo: lo que cargaste sigue acá.",
          afterReload: property ? "Ojo: al recargar se pierde lo que cambiaste acá." : draftKey ? "Lo que cargaste vuelve a aparecer." : undefined,
        });
        void refreshOptions(draftIds);
      }
    });
  }

  return (
    <PropertyFormBody
      form={form}
      set={set}
      isEdit={Boolean(property)}
      propertyId={propertyId}
      ownerOptions={ownerOptions}
      codes={codes}
      loadError={loadError}
      fieldError={fieldError}
      draftError={draftError}
      createdNames={createdNames}
      restoredAt={restoredAt}
      onStartOver={startOver}
      pending={pending}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
