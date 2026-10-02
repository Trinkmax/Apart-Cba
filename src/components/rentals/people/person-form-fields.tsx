"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, BriefcaseBusiness, Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PhoneInput } from "@/components/forms/guest/phone-input";
import { cn } from "@/lib/utils";
import type { RentalDocType, RentalPerson } from "@/lib/types/database";
import { Field, Segmented } from "./form-bits";
import { docLabel } from "./person-helpers";
import type { PersonFormState, SetPersonField } from "./person-form";

const DOC_TYPES: { value: RentalDocType; label: string }[] = [
  { value: "DNI", label: "DNI" },
  { value: "CUIL", label: "CUIL" },
  { value: "CUIT", label: "CUIT" },
  { value: "PASAPORTE", label: "Pasaporte" },
  { value: "OTRO", label: "Otro" },
];

export interface PersonFormFieldsProps {
  form: PersonFormState;
  set: SetPersonField;
  intent?: "inquilino" | "garante";
  isEdit: boolean;
  pending: boolean;
  fieldError: { field?: string; message: string } | null;
  cuitHint: string | null;
  existing: RentalPerson | null;
  onUseExisting?: (person: RentalPerson) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export function PersonFormFields({
  form,
  set,
  intent,
  isEdit,
  pending,
  fieldError,
  cuitHint,
  existing,
  onUseExisting,
  onSubmit,
  onCancel,
}: PersonFormFieldsProps) {
  const juridica = form.person_type === "juridica";
  const err = (f: string) => (fieldError?.field === f ? fieldError.message : null);
  // "Más datos" arranca abierto si ya hay algo cargado ahí (edición).
  const [moreOpen] = useState(
    Boolean(form.address || form.city || form.province || form.birth_date || form.nationality || form.phone_alt || form.notes),
  );
  const submitLabel = isEdit ? "Guardar cambios" : intent === "garante" ? "Cargar garante" : intent === "inquilino" ? "Cargar inquilino" : "Guardar";

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Segmented
        ariaLabel="Tipo de persona"
        value={form.person_type}
        onChange={(v) => {
          set("person_type", v);
          if (v === "juridica") set("doc_type", "CUIT");
          else if (form.doc_type === "CUIT") set("doc_type", "DNI");
        }}
        options={[
          { value: "fisica", label: "Persona" },
          { value: "juridica", label: "Empresa" },
        ]}
      />

      <Field id="person-full_name" label={juridica ? "Razón social" : "Nombre y apellido"} required error={err("full_name")}>
        <Input
          id="person-full_name"
          value={form.full_name}
          onChange={(e) => set("full_name", e.target.value)}
          placeholder={juridica ? "Distribuidora del Centro S.A." : "Juana Pérez"}
          autoFocus={!isEdit}
          autoComplete="off"
          aria-invalid={Boolean(err("full_name")) || undefined}
          className="h-10"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {juridica ? (
          <Field id="person-doc_number" label="CUIT" error={err("doc_number")} warn={cuitHint} className="sm:col-span-2">
            <Input
              id="person-doc_number"
              inputMode="numeric"
              value={form.doc_number}
              onChange={(e) => set("doc_number", e.target.value)}
              placeholder="30-71234567-8"
              className="h-10 tabular-nums"
            />
          </Field>
        ) : (
          <>
            <Field id="person-doc_number" label="Documento" error={err("doc_number")}>
              <div className="flex gap-2">
                <Select value={form.doc_type} onValueChange={(v) => set("doc_type", v as RentalDocType)}>
                  <SelectTrigger className="h-10 w-[118px] shrink-0" aria-label="Tipo de documento">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  id="person-doc_number"
                  inputMode={form.doc_type === "PASAPORTE" || form.doc_type === "OTRO" ? "text" : "numeric"}
                  value={form.doc_number}
                  onChange={(e) => set("doc_number", e.target.value)}
                  placeholder={form.doc_type === "DNI" ? "30.123.456" : form.doc_type === "PASAPORTE" ? "AAA123456" : "20-30123456-7"}
                  aria-invalid={Boolean(err("doc_number")) || undefined}
                  className="h-10 tabular-nums min-w-0"
                />
              </div>
            </Field>
            <Field id="person-tax_id" label="CUIT / CUIL" hint="Para el contrato y los recibos." error={err("tax_id")} warn={cuitHint}>
              <Input
                id="person-tax_id"
                inputMode="numeric"
                value={form.tax_id}
                onChange={(e) => set("tax_id", e.target.value)}
                placeholder="20-30123456-7"
                className="h-10 tabular-nums"
              />
            </Field>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field id="person-phone" label="Teléfono / WhatsApp" error={err("phone")}>
          <PhoneInput id="person-phone" value={form.phone || null} onChange={(v) => set("phone", v ?? "")} placeholder="351 123 4567" />
        </Field>
        <Field id="person-email" label="Mail" error={err("email")}>
          <Input
            id="person-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="juana@mail.com"
            aria-invalid={Boolean(err("email")) || undefined}
            className="h-10"
          />
        </Field>
      </div>

      <section
        className={cn(
          "rounded-xl border p-3 sm:p-4 space-y-3 transition-colors",
          intent === "garante" ? "border-amber-500/40 bg-amber-500/[0.06]" : "bg-muted/30",
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "size-8 shrink-0 rounded-lg flex items-center justify-center",
              intent === "garante" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground",
            )}
          >
            <BriefcaseBusiness size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{juridica ? "Actividad e ingresos" : "Trabajo e ingresos"}</p>
            <p className="text-xs text-muted-foreground leading-snug">
              {intent === "garante"
                ? "Es lo que se mira en una garantía con recibo de sueldo: dónde trabaja y cuánto gana."
                : "Sirve para ver si el alquiler le queda cómodo: lo habitual es ganar 3 veces el alquiler."}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="person-occupation" label={juridica ? "Actividad" : "Ocupación"} error={err("occupation")}>
            <Input
              id="person-occupation"
              value={form.occupation}
              onChange={(e) => set("occupation", e.target.value)}
              placeholder={juridica ? "Comercio de indumentaria" : "Docente, empleada de comercio…"}
              className="h-10"
            />
          </Field>
          {!juridica && (
            <Field id="person-employer" label="Dónde trabaja" error={err("employer")}>
              <Input
                id="person-employer"
                value={form.employer}
                onChange={(e) => set("employer", e.target.value)}
                placeholder="Empresa o empleador"
                className="h-10"
              />
            </Field>
          )}
          <Field
            id="person-monthly_income"
            label={juridica ? "Ingresos mensuales (aprox.)" : "Ingresos mensuales"}
            error={err("monthly_income")}
            hint={intent === "garante" ? "Lo que figura en el recibo de sueldo, en mano." : undefined}
          >
            <div className="flex gap-2">
              <Input
                id="person-monthly_income"
                type="text"
                inputMode="decimal"
                value={form.income}
                onChange={(e) => set("income", e.target.value)}
                placeholder="0,00"
                aria-invalid={Boolean(err("monthly_income")) || undefined}
                className="h-10 tabular-nums min-w-0"
              />
              <Select value={form.income_currency} onValueChange={(v) => set("income_currency", v as "ARS" | "USD")}>
                <SelectTrigger className="h-10 w-[88px] shrink-0" aria-label="Moneda de los ingresos">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Field>
          {!juridica && (
            <Field id="person-employer_phone" label="Teléfono del trabajo" error={err("employer_phone")}>
              <Input
                id="person-employer_phone"
                inputMode="tel"
                value={form.employer_phone}
                onChange={(e) => set("employer_phone", e.target.value)}
                placeholder="Para pedir referencias"
                className="h-10"
              />
            </Field>
          )}
        </div>
      </section>

      <details className="group rounded-xl border" open={moreOpen}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 sm:px-4 text-sm font-medium min-h-11 [&::-webkit-details-marker]:hidden">
          Domicilio y otros datos
          <ChevronDown size={16} className="text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-3 pb-3 sm:px-4 sm:pb-4 space-y-3">
          <Field id="person-address" label={juridica ? "Domicilio legal" : "Domicilio"} error={err("address")}>
            <Input id="person-address" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Calle, número, piso" className="h-10" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="person-city" label="Ciudad" error={err("city")}>
              <Input id="person-city" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Córdoba" className="h-10" />
            </Field>
            <Field id="person-province" label="Provincia" error={err("province")}>
              <Input id="person-province" value={form.province} onChange={(e) => set("province", e.target.value)} placeholder="Córdoba" className="h-10" />
            </Field>
          </div>
          {!juridica && (
            <div className="grid grid-cols-2 gap-3">
              <Field id="person-birth_date" label="Fecha de nacimiento" error={err("birth_date")}>
                <Input id="person-birth_date" type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} className="h-10" />
              </Field>
              <Field id="person-nationality" label="Nacionalidad" error={err("nationality")}>
                <Input id="person-nationality" value={form.nationality} onChange={(e) => set("nationality", e.target.value)} placeholder="Argentina" className="h-10" />
              </Field>
            </div>
          )}
          <Field id="person-phone_alt" label="Otro teléfono" error={err("phone_alt")}>
            <Input id="person-phone_alt" inputMode="tel" value={form.phone_alt} onChange={(e) => set("phone_alt", e.target.value)} className="h-10" />
          </Field>
          <Field id="person-notes" label="Notas internas" error={err("notes")} hint="Sólo las ve el equipo.">
            <Textarea id="person-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
          </Field>
        </div>
      </details>

      {existing && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-3 space-y-2" role="alert">
          <p className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              <strong className="font-semibold">{existing.full_name}</strong>
              {docLabel(existing.doc_type, existing.doc_number) ? ` (${docLabel(existing.doc_type, existing.doc_number)})` : ""} ya está
              cargada{existing.active ? "" : " y archivada"}. Usá esa ficha para no duplicar su historial.
            </span>
          </p>
          <div className="flex flex-wrap gap-2 pl-6">
            {onUseExisting && (
              <Button type="button" size="sm" className="gap-1.5" onClick={() => onUseExisting(existing)}>
                <Check size={14} /> Usar esta persona
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={`/dashboard/alquileres/personas/${existing.id}`}>Ver su ficha</Link>
            </Button>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
