"use client";

import { useState, type ReactNode } from "react";
import { Building2, Check, ChevronDown, FileSignature, Hash, Loader2, MapPin, Ruler, Tag, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PROPERTY_TYPE_LABEL } from "@/lib/rentals/labels";
import { joinNamesEs } from "@/lib/rentals/renewal";
import type { RentalPropertyAvailability, RentalPropertyType } from "@/lib/types/database";
import { Field, FormSection } from "@/components/rentals/people/form-bits";
import { DraftRestoredNotice, FormDialogBody, FormDialogFooter, formDialogFormClass } from "@/components/rentals/people/form-dialog-shell";
import { PROPERTY_TEXT_MAX as MAX } from "@/lib/rentals/property-input";
import { findCodeClash, firstFreeCode, normalizePropertyCode, suggestPropertyCode } from "./property-helpers";
import type { OwnerOption, PropertyCodeRef } from "./property-types";
import type { PropertyFieldError, PropertyFormState, SetPropertyField } from "./property-form";
import type { QuickOwnerError } from "./quick-owner-panel";
import { OwnersEditor } from "./owners-editor";
import { ServicesEditor } from "./services-editor";

const AVAILABILITY_OPTIONS: { value: RentalPropertyAvailability; label: string; hint: string }[] = [
  { value: "disponible", label: "Disponible", hint: "Se puede alquilar." },
  { value: "reservada", label: "Reservada", hint: "Apalabrada, todavía sin contrato." },
  { value: "en_refaccion", label: "En refacción", hint: "No se puede mostrar por ahora." },
  { value: "retirada", label: "Fuera de alquiler", hint: "El dueño no la quiere alquilar por ahora." },
];

export interface PropertyFormBodyProps {
  form: PropertyFormState;
  set: SetPropertyField;
  isEdit: boolean;
  propertyId: string | null;
  ownerOptions: OwnerOption[] | null;
  codes: PropertyCodeRef[];
  loadError: string | null;
  fieldError: PropertyFieldError;
  /** Error de un propietario nuevo (en su fila). */
  draftError: QuickOwnerError | null;
  /** Propietarios creados en un guardado que después falló. */
  createdNames: string[];
  /** Se recuperó un borrador: cuándo se había guardado. */
  restoredAt: string | null;
  onStartOver: () => void;
  pending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-10 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed ? "border-teal-600/40 bg-teal-600/10 text-teal-800 dark:text-teal-200 font-medium" : "bg-card text-muted-foreground hover:text-foreground hover:bg-accent/40",
      )}
    >
      <span className={cn("size-4 rounded-[5px] border flex items-center justify-center", pressed ? "bg-teal-600 border-teal-600 text-white" : "border-input")}>
        {pressed && <Check size={11} strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}

function Fold({ title, icon, count, defaultOpen, children }: { title: string; icon: ReactNode; count?: number; defaultOpen: boolean; children: ReactNode }) {
  const [open] = useState(defaultOpen);
  return (
    <details className="group rounded-xl border" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 sm:px-4 min-h-11 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1">{title}</span>
        {count ? <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{count}</span> : null}
        <ChevronDown size={16} className="text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 sm:px-4 sm:pb-4 pt-1 space-y-3">{children}</div>
    </details>
  );
}

export function PropertyFormBody(props: PropertyFormBodyProps) {
  const { form, set, isEdit, propertyId, codes, fieldError, draftError, pending, onSubmit, onCancel } = props;
  const err = (f: string) => (fieldError?.field === f ? fieldError.message : null);

  // Código: sugerido desde la dirección y verificado contra los ya usados (el servidor vuelve a mirar).
  // En un alta, la propiedad ya tiene el id con el que se va a crear: si ya se guardó (respuesta perdida), su código no choca consigo mismo.
  const selfId = propertyId ?? form.client_id;
  const takenCodes = codes.filter((c) => c.id !== selfId).map((c) => c.code);
  const suggested = suggestPropertyCode(form);
  const typed = normalizePropertyCode(form.code);
  const autoCode = suggested ? firstFreeCode(suggested, takenCodes) : "";
  // La misma cuenta que hace el formulario al guardar (bloquea antes de crear a un propietario nuevo).
  const clash = findCodeClash(codes, selfId, form.code);
  const clashFix = clash?.fix ?? null;
  const serverFix = fieldError?.field === "code" ? fieldError.suggestion : undefined;
  const codeError = err("code") ?? (clash ? `Ya es el código de ${clash.label}.` : null);
  const codeFix = serverFix ?? clashFix;
  const codeHint = typed
    ? "Corto y único: con esto la encontrás en cualquier buscador."
    : autoCode
      ? `Si lo dejás vacío, se guarda como ${autoCode}.`
      : "Se arma solo con la dirección.";

  // El pie dice siempre qué falta o qué se va a guardar: nunca queda la duda de si ya se guardó.
  const ownerMissing = props.ownerOptions !== null && !form.owners.some((r) => r.owner_id || r.draft);
  const missing = [form.street.trim().length < 2 ? "la calle" : null, ownerMissing ? "el propietario" : null].filter((x): x is string => Boolean(x));
  const newOwners = form.owners.filter((r) => !r.owner_id && r.draft).length;
  const errorLine = draftError?.message ?? fieldError?.message ?? null;
  const status = pending ? (
    newOwners ? "Creando el propietario y guardando la propiedad…" : "Guardando…"
  ) : errorLine ? (
    <span className="line-clamp-2 text-rose-600 dark:text-rose-400">{errorLine}</span>
  ) : missing.length ? (
    `Para guardar falta ${joinNamesEs(missing)}.`
  ) : newOwners ? (
    `Al guardar se crea también ${newOwners === 1 ? "el propietario nuevo" : `a los ${newOwners} propietarios nuevos`}.`
  ) : null;

  return (
    <form onSubmit={onSubmit} className={formDialogFormClass} noValidate>
      <FormDialogBody>
        {props.restoredAt && <DraftRestoredNotice savedAt={props.restoredAt} onReset={props.onStartOver} />}
        <div className="space-y-6">
          <FormSection title="Dirección" icon={<MapPin size={14} />}>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] sm:grid-cols-[minmax(0,1fr)_120px] gap-3">
              <Field id="property-street" label="Calle" required error={err("street")}>
                <Input
                  id="property-street"
                  maxLength={MAX.street}
                  value={form.street}
                  onChange={(e) => set("street", e.target.value)}
                  placeholder="Dean Funes"
                  autoFocus={!isEdit}
                  autoComplete="off"
                  aria-invalid={Boolean(err("street")) || undefined}
                  className="h-10"
                />
              </Field>
              <Field id="property-street_number" label="Número" error={err("street_number")}>
                <Input id="property-street_number" maxLength={MAX.street_number} value={form.street_number} onChange={(e) => set("street_number", e.target.value)} placeholder="450" className="h-10" />
              </Field>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-[1fr_1fr_1fr_2fr] gap-3">
              <Field id="property-floor" label="Piso" error={err("floor")}>
                <Input id="property-floor" maxLength={MAX.floor} value={form.floor} onChange={(e) => set("floor", e.target.value)} placeholder="3 o PB" className="h-10" />
              </Field>
              <Field id="property-apartment" label="Depto." error={err("apartment")}>
                <Input id="property-apartment" maxLength={MAX.apartment} value={form.apartment} onChange={(e) => set("apartment", e.target.value)} placeholder="B" className="h-10" />
              </Field>
              <Field id="property-tower" label="Torre" error={err("tower")}>
                <Input id="property-tower" maxLength={MAX.tower} value={form.tower} onChange={(e) => set("tower", e.target.value)} className="h-10" />
              </Field>
              <Field id="property-neighborhood" label="Barrio" error={err("neighborhood")} className="col-span-3 sm:col-span-1">
                <Input id="property-neighborhood" maxLength={MAX.neighborhood} value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} placeholder="Nueva Córdoba" className="h-10" />
              </Field>
            </div>
          </FormSection>

          {/* El dueño va pegado a la dirección: es el otro dato obligatorio y antes quedaba debajo del pliegue. */}
          <FormSection
            title={form.owners.length > 1 ? "Propietarios" : "Propietario"}
            icon={<Users size={14} />}
            required
            hint="A quién se le rinde lo que se cobra. Si son varios, el % reparte cada cobro."
            className="border-t pt-5"
          >
            <OwnersEditor
              rows={form.owners}
              onChange={(rows) => set("owners", rows)}
              options={props.ownerOptions}
              error={err("owners")}
              loadError={props.loadError}
              draftError={draftError}
              createdNames={props.createdNames}
            />
          </FormSection>

          <FormSection title="Ciudad y código" icon={<Hash size={14} />} className="border-t pt-5">
            <div className="grid grid-cols-2 sm:grid-cols-[2fr_2fr_1fr] gap-3">
              <Field id="property-city" label="Ciudad" error={err("city")}>
                <Input id="property-city" maxLength={MAX.city} value={form.city} onChange={(e) => set("city", e.target.value)} className="h-10" />
              </Field>
              <Field id="property-province" label="Provincia" error={err("province")}>
                <Input id="property-province" maxLength={MAX.province} value={form.province} onChange={(e) => set("province", e.target.value)} className="h-10" />
              </Field>
              <Field id="property-postal_code" label="Cód. postal" error={err("postal_code")} className="col-span-2 sm:col-span-1">
                <Input id="property-postal_code" maxLength={MAX.postal_code} value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} placeholder="5000" className="h-10" />
              </Field>
            </div>
            <Field id="property-code" label="Código interno" error={codeError} hint={codeHint}>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="property-code"
                  value={form.code}
                  onChange={(e) => set("code", e.target.value.toUpperCase())}
                  placeholder={autoCode || "DEANFUNES450-3B"}
                  maxLength={40}
                  autoComplete="off"
                  aria-invalid={Boolean(codeError) || undefined}
                  className="h-10 font-mono tracking-wide flex-1 min-w-[180px]"
                />
                {codeError && codeFix ? (
                  <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => set("code", codeFix)}>
                    Usar <span className="font-mono">{codeFix}</span>
                  </Button>
                ) : !typed && autoCode ? (
                  <Button type="button" variant="outline" className="h-10" onClick={() => set("code", autoCode)}>
                    Usar el sugerido
                  </Button>
                ) : null}
              </div>
            </Field>
          </FormSection>

          <FormSection title="Cómo es" icon={<Ruler size={14} />} className="border-t pt-5">
            <Field id="property-property_type" label="Tipo" className="sm:max-w-56">
              <Select value={form.property_type} onValueChange={(v) => set("property_type", v as RentalPropertyType)}>
                <SelectTrigger id="property-property_type" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROPERTY_TYPE_LABEL) as RentalPropertyType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {PROPERTY_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              <Field id="property-rooms" label="Ambientes" error={err("rooms")}>
                <Input id="property-rooms" inputMode="numeric" value={form.rooms} onChange={(e) => set("rooms", e.target.value)} placeholder="3" className="h-10 tabular-nums" />
              </Field>
              <Field id="property-bedrooms" label="Dormitorios" error={err("bedrooms")}>
                <Input id="property-bedrooms" inputMode="numeric" value={form.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} placeholder="2" className="h-10 tabular-nums" />
              </Field>
              <Field id="property-bathrooms" label="Baños" error={err("bathrooms")}>
                <Input id="property-bathrooms" inputMode="numeric" value={form.bathrooms} onChange={(e) => set("bathrooms", e.target.value)} placeholder="1" className="h-10 tabular-nums" />
              </Field>
              <Field id="property-covered_m2" label="m² cubiertos" error={err("covered_m2")} className="col-span-1 sm:col-span-1">
                <Input id="property-covered_m2" inputMode="decimal" value={form.covered_m2} onChange={(e) => set("covered_m2", e.target.value)} placeholder="65" className="h-10 tabular-nums" />
              </Field>
              <Field id="property-total_m2" label="m² totales" error={err("total_m2")}>
                <Input id="property-total_m2" inputMode="decimal" value={form.total_m2} onChange={(e) => set("total_m2", e.target.value)} placeholder="72" className="h-10 tabular-nums" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle pressed={form.furnished} onClick={() => set("furnished", !form.furnished)}>
                Amoblado
              </Toggle>
              <Toggle pressed={form.has_garage} onClick={() => set("has_garage", !form.has_garage)}>
                Cochera
              </Toggle>
            </div>
          </FormSection>

          <FormSection title="Estado y precio" icon={<Tag size={14} />} className="border-t pt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                id="property-availability"
                label="Disponibilidad"
                hint={`${AVAILABILITY_OPTIONS.find((o) => o.value === form.availability)?.hint ?? ""} Con un contrato vigente se muestra como alquilada.`}
              >
                <Select value={form.availability} onValueChange={(v) => set("availability", v as RentalPropertyAvailability)}>
                  <SelectTrigger id="property-availability" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABILITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="property-listing_rent" label="Precio pretendido" error={err("listing_rent")} hint="Lo que pide el dueño mientras está vacante.">
                <div className="flex gap-2">
                  <Input
                    id="property-listing_rent"
                    type="text"
                    inputMode="decimal"
                    value={form.listing_rent}
                    onChange={(e) => set("listing_rent", e.target.value)}
                    placeholder="0,00"
                    aria-invalid={Boolean(err("listing_rent")) || undefined}
                    className="h-10 tabular-nums min-w-0"
                  />
                  <Select value={form.listing_currency} onValueChange={(v) => set("listing_currency", v as "ARS" | "USD")}>
                    <SelectTrigger className="h-10 w-[88px] shrink-0" aria-label="Moneda del precio">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Field>
            </div>
          </FormSection>

          <div className="space-y-2 border-t pt-5">
            <Fold
              title="Consorcio y catastro"
              icon={<Building2 size={15} />}
              defaultOpen={Boolean(form.consortium_name || form.consortium_phone || form.consortium_email || form.functional_unit || form.cadastral_id)}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field id="property-consortium_name" label="Consorcio o administración" error={err("consortium_name")}>
                  <Input id="property-consortium_name" maxLength={MAX.consortium_name} value={form.consortium_name} onChange={(e) => set("consortium_name", e.target.value)} placeholder="Administración Gómez" className="h-10" />
                </Field>
                <Field id="property-functional_unit" label="Unidad funcional" error={err("functional_unit")} hint="Figura en la liquidación de expensas.">
                  <Input id="property-functional_unit" maxLength={MAX.functional_unit} value={form.functional_unit} onChange={(e) => set("functional_unit", e.target.value)} placeholder="UF 12" className="h-10" />
                </Field>
                <Field id="property-consortium_phone" label="Teléfono del consorcio" error={err("consortium_phone")}>
                  <Input id="property-consortium_phone" maxLength={MAX.consortium_phone} inputMode="tel" value={form.consortium_phone} onChange={(e) => set("consortium_phone", e.target.value)} className="h-10" />
                </Field>
                <Field id="property-consortium_email" label="Mail del consorcio" error={err("consortium_email")}>
                  <Input id="property-consortium_email" type="email" inputMode="email" value={form.consortium_email} onChange={(e) => set("consortium_email", e.target.value)} className="h-10" />
                </Field>
                <Field id="property-cadastral_id" label="Catastro / cuenta de Rentas" error={err("cadastral_id")} className="sm:col-span-2">
                  <Input id="property-cadastral_id" maxLength={MAX.cadastral_id} value={form.cadastral_id} onChange={(e) => set("cadastral_id", e.target.value)} placeholder="11-01-…" className="h-10 font-mono" />
                </Field>
              </div>
            </Fold>

            <Fold title="Servicios e impuestos" icon={<Zap size={15} />} count={form.services.length} defaultOpen={form.services.length > 0}>
              <ServicesEditor rows={form.services} onChange={(rows) => set("services", rows)} />
            </Fold>

            <Fold title="Mandato y notas" icon={<FileSignature size={15} />} defaultOpen={Boolean(form.mandate_signed_at || form.notes)}>
              <Field
                id="property-mandate_signed_at"
                label="Mandato de administración firmado el"
                error={err("mandate_signed_at")}
                hint="Ley 9445: para administrar hace falta el mandato escrito del dueño. Subí el documento en la ficha."
              >
                <Input id="property-mandate_signed_at" type="date" value={form.mandate_signed_at} onChange={(e) => set("mandate_signed_at", e.target.value)} className="h-10 w-full sm:w-56" />
              </Field>
              <Field id="property-notes" label="Notas internas" error={err("notes")} hint="Sólo las ve el equipo.">
                <Textarea id="property-notes" maxLength={MAX.notes} value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Llaves en la oficina, horario para mostrar…" />
              </Field>
            </Fold>
          </div>
        </div>
      </FormDialogBody>

      <FormDialogFooter status={status}>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="flex-1 gap-2 sm:flex-none">
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {isEdit ? "Guardar cambios" : "Guardar propiedad"}
        </Button>
      </FormDialogFooter>
    </form>
  );
}
