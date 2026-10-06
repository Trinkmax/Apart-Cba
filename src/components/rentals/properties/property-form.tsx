"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createProperty, getPropertyFormOptions, quickCreateOwner, updateProperty } from "@/lib/actions/rentals-properties";
import { isStaleDeployError, toastActionFailure } from "@/lib/action-failure";
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
import { findCodeClash, savedPropertyDiffs, validateOwnership } from "./property-helpers";
import {
  adoptCreatedOwners,
  findOwnerByName,
  newKey,
  newOwnerNameProblem,
  ownerRowsFrom,
  ownershipRowsOf,
  withProvisionalIds,
  type OwnershipRow,
  type OwnerRowState,
} from "./owner-rows";
import { dropUnknownOwners, propertyStateFromDraft } from "./property-draft";
import { formDiffsFromSaved, parsePropertyForm } from "./property-form-input";
import { ownerPickerId } from "./owners-editor";
import { quickOwnerFieldId, type QuickOwnerError } from "./quick-owner-panel";
import type {
  CreatedOwnerRef,
  OwnerOption,
  PropertyCodeRef,
  PropertyFormOptions,
  PropertyInput,
  PropertyOwnerInput,
  QuickOwnerInput,
  SavedPropertyOwner,
} from "./property-types";
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
  /**
   * Propietarios nuevos que este formulario ya creó. Si la propiedad no llega
   * a guardarse, siguen en Propietarios: la fila, el "¿Descartar?" y el aviso
   * final lo dicen (el 05/10 quedaron dos sin propiedad y nadie se enteró).
   */
  created_owners: CreatedOwnerRef[];
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
    created_owners: [],
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
   * (quedan en Propietarios aunque la propiedad no se guarde). `savedCode`: el
   * alta ya había quedado guardada con ese código (lo que se cambió después, no).
   */
  onStatusChange?: (dirty: boolean, busy: boolean, createdOwners: string[], savedCode: string | null) => void;
}

export type PropertyFieldError = { field?: string; message: string; suggestion?: string } | null;

const byName = (a: OwnerOption, b: OwnerOption) => a.full_name.localeCompare(b.full_name, "es");

/**
 * Antes de crear a un propietario nuevo, la lista de propietarios y de
 * códigos se vuelve a leer si es más vieja que esto (o si nunca cargó): con
 * una lista vieja, un nombre o un código que alguien cargó recién pasaban el
 * control, el primer propietario se creaba y el siguiente paso fallaba.
 */
const OPTIONS_FRESH_MS = 60_000;

/** Hubo un deploy con el formulario abierto: guardar falla hasta recargar (un alta vuelve del borrador; una edición, no). */
const staleSaveMessage = (isEdit: boolean) =>
  isEdit
    ? "Se actualizó el sistema: recargá la página para guardar. Ojo: al recargar se pierde lo que cambiaste acá."
    : "Se actualizó el sistema: recargá la página para guardar. Lo que cargaste vuelve a aparecer.";

/** Suma propietarios creados sin repetir (por id). */
function withCreated(list: CreatedOwnerRef[], add: readonly CreatedOwnerRef[]): CreatedOwnerRef[] {
  const out = [...list];
  for (const o of add) if (!out.some((x) => x.id === o.id)) out.push({ id: o.id, full_name: o.full_name });
  return out;
}

/** "X quedó en Propietarios sin esta propiedad: si no va, eliminalo desde ahí." (vacío si no hay ninguno). */
function orphanNote(list: readonly CreatedOwnerRef[], withoutProperty: boolean): string {
  if (!list.length) return "";
  const one = list.length === 1;
  return `${joinNamesEs(list.map((o) => o.full_name))} ${one ? "quedó" : "quedaron"} en Propietarios${withoutProperty ? " sin esta propiedad" : ""}: si no ${one ? "va, eliminalo" : "van, eliminalos"} desde ahí.`;
}

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
  const [archivedOwners, setArchivedOwners] = useState<OwnerOption[] | null>(null);
  const [codes, setCodes] = useState<PropertyCodeRef[]>([]);
  // Cuándo se leyó bien la lista por última vez (null = nunca).
  const [optionsAt, setOptionsAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; stale: boolean } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [fieldError, setFieldError] = useState<PropertyFieldError>(null);
  const [draftError, setDraftError] = useState<QuickOwnerError | null>(null);
  // Hubo un deploy con el formulario abierto: guardar falla hasta recargar. Lo dice el pie, con su botón.
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  // Este alta ya había quedado guardada (se perdió la respuesta, o se recargó en medio del guardado).
  const [alreadySaved, setAlreadySaved] = useState<{ property: RentalProperty; owners: SavedPropertyOwner[]; diffs: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const propertyId = property?.id ?? null;
  const ownersGiven = Boolean(owners?.length);
  const wasRestored = init.restoredAt != null;
  const isEdit = Boolean(property);
  // Lo último del formulario, para lo que llega después (la lista de propietarios, que tarda).
  const latestForm = useRef(form);
  useEffect(() => {
    latestForm.current = form;
  }, [form]);

  function applyLists(opts: PropertyFormOptions) {
    setOwnerOptions(opts.owners);
    setArchivedOwners(opts.archived_owners ?? []);
    setCodes(opts.codes);
    setOptionsAt(Date.now());
    setLoadError(null);
  }

  useEffect(() => {
    let alive = true;
    // Un borrador recuperado manda su id: si esa propiedad ya quedó guardada, se dice en vez de cargarla otra vez.
    getPropertyFormOptions(propertyId, wasRestored ? init.form.client_id : null)
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setLoadError({ message: res.error, stale: false });
          // El buscador igual se puede usar: el servidor no deja crear a alguien que ya está.
          setOwnerOptions((list) => list ?? []);
          return;
        }
        const opts = res.options;
        setOwnerOptions(opts.owners);
        setArchivedOwners(opts.archived_owners ?? []);
        setCodes(opts.codes);
        setOptionsAt(Date.now());
        setLoadError(null);
        // Edición sin titulares en las props: se traen del servidor (si no se tocaron mientras tanto).
        if (!ownersGiven && opts.current_owners?.length) {
          const rows = ownerRowsFrom(opts.current_owners);
          setForm((f) => (sameFormValues(f.owners, init.form.owners) ? { ...f, owners: rows } : f));
          setBlank((b) => ({ ...b, owners: rows }));
        }
        if (!wasRestored) return;
        const f = latestForm.current;
        const known = new Set(opts.owners.map((o) => o.id));
        // Un propietario nuevo del borrador que sí se había creado (se recargó en medio del guardado) vuelve elegido.
        const draftIds = new Set(init.form.owners.flatMap((r) => (!r.owner_id && r.draft ? [r.draft.id] : [])));
        const adopted = opts.owners.filter((o) => draftIds.has(o.id));
        const next: PropertyFormState = {
          ...f,
          owners: adoptCreatedOwners(dropUnknownOwners(f.owners, known), adopted).rows,
          // Los que ya se habían creado se siguen avisando (si alguien los borró entretanto, ya no existen).
          created_owners: withCreated(f.created_owners, adopted).filter((o) => known.has(o.id)),
        };
        setForm(next);
        if (opts.saved) {
          const diffs = formDiffsFromSaved(next, opts.saved);
          setAlreadySaved({ ...opts.saved, diffs });
          setRestoredAt(null);
          if (!diffs.length) {
            // Es lo mismo que quedó guardado: cerrar no pierde nada.
            clearDraft(draftKey);
            setBlank(next);
          }
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const stale = isStaleDeployError(error);
        setLoadError({
          stale,
          message: stale ? "Se actualizó el sistema: recargá la página para ver la lista de propietarios." : "No se pudo cargar la lista de propietarios: revisá la conexión.",
        });
        if (stale) setStaleNotice(staleSaveMessage(Boolean(propertyId)));
        setOwnerOptions((list) => list ?? []);
      });
    return () => {
      alive = false;
    };
  }, [propertyId, ownersGiven, wasRestored, init, draftKey, loadAttempt]);

  const loadAction = loadError
    ? loadError.stale
      ? { label: "Recargar", onClick: () => window.location.reload() }
      : {
          label: "Reintentar",
          onClick: () => {
            setLoadError(null);
            setLoadAttempt((n) => n + 1);
          },
        }
    : null;

  const dirty = !sameFormValues(form, blank);
  usePersistDraft(property ? null : draftKey, form, blank);
  const sessionCreated = form.created_owners;
  const createdOwnerNames = sessionCreated.map((o) => o.full_name);
  const savedCode = alreadySaved?.property.code ?? null;
  useEffect(() => {
    onStatusChange?.(dirty, pending, createdOwnerNames, savedCode);
  }, [dirty, pending, onStatusChange, createdOwnerNames, savedCode]);

  function addOwnerOption(owner: OwnerOption) {
    setOwnerOptions((list) => (list?.some((o) => o.id === owner.id) ? list : [...(list ?? []), owner].sort(byName)));
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
      applyLists(res.options);
      const adopted = res.options.owners.filter((o) => draftIds.has(o.id));
      if (!adopted.length) return;
      setForm((f) => {
        const next = adoptCreatedOwners(f.owners, adopted);
        return next.adopted.length ? { ...f, owners: next.rows, created_owners: withCreated(f.created_owners, next.adopted) } : f;
      });
    } catch {
      /* sin conexión: queda la lista que había */
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
    // Los propietarios que ya se crearon no se borran: se avisa (quedaban en Propietarios sin que nadie se enterara).
    const orphans = form.created_owners.filter((o) => !alreadySaved?.owners.some((s) => s.owner_id === o.id));
    clearDraft(draftKey);
    // Formulario y referencia con el mismo id nuevo: si no, el vacío contaría como "algo sin guardar".
    const fresh = initialState(null, undefined);
    setForm(fresh);
    setBlank(fresh);
    setRestoredAt(null);
    setAlreadySaved(null);
    setFieldError(null);
    setDraftError(null);
    if (orphans.length) toast(orphanNote(orphans, false));
  }

  function openSaved() {
    if (!alreadySaved) return;
    onDone(alreadySaved.property, alreadySaved.owners);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setDraftError(null);
    const parsed = parsePropertyForm(form, isEdit);
    if (!parsed.ok) return fail(parsed.field, parsed.message);

    // Todo lo que el servidor puede rechazar se mira ACÁ, antes de crear al primer propietario nuevo:
    // si algo fallaba recién después, el propietario quedaba creado y la propiedad no (lo del 05/10).
    const rows = ownershipRowsOf(form.owners);
    // Con una sola fila, "elegí el propietario en cada fila" no se entiende: se dice qué falta y cómo.
    if (!rows.some((r) => r.owner_id || r.draft)) return fail("owners", "Falta el propietario: buscalo en la lista o, si no está, creálo desde el mismo buscador.");
    const newOwners = new Map<string, QuickOwnerInput>();
    for (let i = 0; i < rows.length; i++) {
      const draft = rows[i].draft;
      if (!draft) continue;
      const name = draft.full_name.trim();
      if (name.length < 2) return failDraft(rows[i].key, "full_name", "Escribí el nombre del propietario nuevo.");
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
    // Un nuevo con el nombre de uno que ya está (en la lista o archivado): se mira para TODOS antes de crear al primero.
    const nameProblem = newOwnerNameProblem(rows, ownerOptions, archivedOwners);
    if (nameProblem) return failDraft(nameProblem.rowKey, "full_name", nameProblem.message);
    // Cada nuevo ocupa su fila con el id con el que se va a crear (así pasa el mismo control que el servidor).
    const provisional = withProvisionalIds(rows);
    const ownership = validateOwnership(provisional);
    if (!ownership.ok) return fail("owners", ownership.error);
    // El mismo choque de código que muestra el campo (el servidor lo rechazaría con el dueño ya creado).
    const selfId = propertyId ?? form.client_id;
    const clash = findCodeClash(codes, selfId, form.code);
    if (clash) return fail("code", `Ya es el código de ${clash.label}.`, clash.fix);

    const toInput = (list: OwnershipRow[]): PropertyInput => ({
      ...parsed.base,
      owners: list.map((r) => ({ owner_id: r.owner_id, ownership_pct: r.ownership_pct, is_primary: r.is_primary })),
    });
    const propertyCheck = checkPropertyInput(toInput(provisional));
    if (!propertyCheck.ok) {
      fail(propertyCheck.field, propertyCheck.error);
      // El aviso flotante también: el campo puede estar en una sección plegada o no tener casillero propio.
      toast.error("Falta corregir algo antes de guardar", { description: propertyCheck.error });
      return;
    }

    let knownOwners = ownerOptions ?? [];
    const draftIds = new Set(Array.from(newOwners.values(), (o) => o.id).filter((id): id is string => Boolean(id)));
    const listIsOld = optionsAt == null || Date.now() - optionsAt > OPTIONS_FRESH_MS;
    const createdBefore = form.created_owners;
    startTransition(async () => {
      let stage: "owner" | "property" = newOwners.size ? "owner" : "property";
      try {
        if (newOwners.size && listIsOld) {
          // Con la lista vieja (o que no cargó), un nombre o un código que alguien cargó recién pasaba el
          // control: se relee y se vuelve a mirar ANTES de crear a nadie. Sin poder leerla, no se crea.
          const fresh = await getPropertyFormOptions(propertyId);
          if (!fresh.ok) {
            fail("owners", "No pudimos revisar si los propietarios nuevos ya están cargados. Probá de nuevo en un momento.");
            return;
          }
          applyLists(fresh.options);
          knownOwners = fresh.options.owners;
          const again = newOwnerNameProblem(rows, fresh.options.owners, fresh.options.archived_owners);
          if (again) return failDraft(again.rowKey, "full_name", again.message);
          const clashNow = findCodeClash(fresh.options.codes, selfId, form.code);
          if (clashNow) return fail("code", `Ya es el código de ${clashNow.label}.`, clashNow.fix);
        }
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
          addOwnerOption(owner);
          finalRows = finalRows.map((x) => (x.key === r.key ? { ...x, owner_id: owner.id, draft: null } : x));
          setForm((f) => ({
            ...f,
            owners: f.owners.map((x) => (x.key === r.key ? { ...x, owner_id: owner.id, draft: null } : x)),
            created_owners: withCreated(f.created_owners, [owner]),
          }));
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
        let saved = res.property;
        let savedOwners: SavedPropertyOwner[] | null = res.already_saved && res.owners?.length ? res.owners : null;
        let replayNote: string | null = null;
        if (res.already_saved) {
          // Reintento de un alta que ya había entrado (se perdió la respuesta). Vale lo que se ve ahora: si
          // entretanto se cambió algo (otro dueño, la dirección), se guarda encima; si no, quedaba lo viejo.
          const diffs = savedPropertyDiffs({ property: res.property, owners: res.owners ?? [] }, input);
          if (diffs.length) {
            // Antes de intentarlo: si esto también falla, el aviso de arriba y el "¿Descartar?" ya dicen que quedó guardada.
            setAlreadySaved({ property: res.property, owners: res.owners ?? [], diffs });
            const upd = await updateProperty(res.property.id, input);
            if (!upd.ok) {
              fail(upd.field, upd.error, upd.suggestion);
              toast.error(`La propiedad ya estaba guardada como ${res.property.code}`, {
                description: `Pero no se pudo guardar lo que cambiaste después (${joinNamesEs(diffs)}): ${upd.error}`,
              });
              return;
            }
            saved = upd.property;
            savedOwners = null;
            replayNote = `ya se había guardado en el intento anterior; quedó con lo de ahora (${joinNamesEs(diffs)}).`;
          } else {
            replayNote = "se había guardado en el intento anterior.";
          }
        }
        const names = new Map([...knownOwners, ...created].map((o) => [o.id, o.full_name]));
        const finalOwners: SavedPropertyOwner[] = savedOwners ?? input.owners.map((o) => ({ ...o, full_name: names.get(o.owner_id) ?? "Propietario" }));
        // Creados por este formulario y sacados después de la propiedad: siguen en Propietarios.
        const orphans = orphanNote(createdBefore.filter((o) => !finalOwners.some((f) => f.owner_id === o.id)), true);
        if (replayNote) {
          toast.success("La propiedad ya estaba guardada", { description: `${saved.code}: ${replayNote}${orphans ? ` ${orphans}` : ""}` });
        } else {
          const createdLine = created.length
            ? ` · ${joinNamesEs(created.map((o) => o.full_name))} ${created.length === 1 ? "quedó cargado como propietario" : "quedaron cargados como propietarios"}`
            : "";
          toast.success(isEdit ? "Cambios guardados" : "Propiedad cargada", { description: `${saved.code}${createdLine}${orphans ? ` · ${orphans}` : ""}` });
        }
        onDone(saved, finalOwners);
      } catch (error) {
        // No llegó respuesta: se cortó la conexión o hubo un deploy (ahí reintentar no sirve: hay que recargar).
        // Lo tipeado sigue en el formulario (y en el borrador); un propietario ya creado quedó elegido en su fila.
        const stale = isStaleDeployError(error);
        // El aviso flotante no se puede tocar con el diálogo abierto: el pie dice lo mismo, con su botón «Recargar».
        if (stale) setStaleNotice(staleSaveMessage(isEdit));
        toastActionFailure(error, stage === "owner" ? "No se pudo crear el propietario" : "No se pudo guardar la propiedad", {
          retry: "Revisá la conexión y probá de nuevo: lo que cargaste sigue acá.",
          afterReload: isEdit ? "Ojo: al recargar se pierde lo que cambiaste acá." : draftKey ? "Lo que cargaste vuelve a aparecer." : undefined,
        });
        if (!stale) void refreshOptions(draftIds);
      }
    });
  }

  return (
    <PropertyFormBody
      form={form}
      set={set}
      isEdit={isEdit}
      propertyId={propertyId}
      ownerOptions={ownerOptions}
      archivedOwners={archivedOwners}
      codes={codes}
      loadError={loadError?.message ?? null}
      loadAction={loadAction}
      fieldError={fieldError}
      draftError={draftError}
      sessionCreated={sessionCreated}
      staleNotice={staleNotice}
      alreadySaved={alreadySaved ? { code: alreadySaved.property.code, diffs: alreadySaved.diffs, onOpen: openSaved } : null}
      restoredAt={restoredAt}
      onStartOver={startOver}
      pending={pending}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
