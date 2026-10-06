"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { createPerson, updatePerson } from "@/lib/actions/rentals-people";
import { toastActionFailure } from "@/lib/action-failure";
import { parseAmountInput } from "@/lib/format";
import { formatMoneyEditable } from "@/components/bookings/money-input";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import type { RentalDocType, RentalPerson, RentalPersonType } from "@/lib/types/database";
import { sameFormValues } from "./form-draft";
import { clearDraft, readDraft, usePersistDraft } from "./use-form-draft";
import { cuitWarning, formatDocNumber } from "./person-helpers";
import { personStateFromDraft } from "./person-draft";
import type { PersonInput } from "./person-types";
import { PersonFormFields } from "./person-form-fields";

/**
 * Formulario de inquilino / garante (vive adentro de PersonFormDialog y se
 * monta cada vez que se abre). Estado controlado + useTransition + server
 * action, el patrón del panel. Un alta arranca de lo que quedó sin guardar en
 * la pestaña (borrador), si hay; si no, limpia.
 */

export interface PersonFormState {
  person_type: RentalPersonType;
  full_name: string;
  doc_type: RentalDocType;
  doc_number: string;
  tax_id: string;
  birth_date: string;
  nationality: string;
  email: string;
  phone: string;
  phone_alt: string;
  address: string;
  city: string;
  province: string;
  occupation: string;
  employer: string;
  employer_phone: string;
  income: string;
  income_currency: "ARS" | "USD";
  notes: string;
}

export type SetPersonField = <K extends keyof PersonFormState>(key: K, value: PersonFormState[K]) => void;

/** El PhoneInput trabaja en formato internacional (+54…): un teléfono viejo se normaliza al abrir. */
function toE164(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (v.startsWith("+")) return `+${v.replace(/\D+/g, "")}`;
  const d = toWhatsappDigits(v);
  return d ? `+${d}` : "";
}

function initialState(person: RentalPerson | null | undefined, defaultName?: string): PersonFormState {
  const type = person?.person_type ?? "fisica";
  const docType = person?.doc_type ?? (type === "juridica" ? "CUIT" : "DNI");
  return {
    person_type: type,
    full_name: person?.full_name ?? defaultName?.trim() ?? "",
    doc_type: docType,
    doc_number: formatDocNumber(docType, person?.doc_number),
    tax_id: formatDocNumber("CUIT", person?.tax_id),
    birth_date: person?.birth_date ?? "",
    nationality: person?.nationality ?? "",
    email: person?.email ?? "",
    phone: toE164(person?.phone),
    phone_alt: person?.phone_alt ?? "",
    address: person?.address ?? "",
    city: person?.city ?? "",
    province: person?.province ?? "",
    occupation: person?.occupation ?? "",
    employer: person?.employer ?? "",
    employer_phone: person?.employer_phone ?? "",
    income: formatMoneyEditable(person?.monthly_income),
    income_currency: person?.income_currency === "USD" ? "USD" : "ARS",
    notes: person?.notes ?? "",
  };
}

export interface PersonFormProps {
  person?: RentalPerson | null;
  intent?: "inquilino" | "garante";
  defaultName?: string;
  onDone: (person: RentalPerson) => void;
  onCancel: () => void;
  /** Alta que choca con alguien ya cargado: "Usar esta persona". */
  onUseExisting?: (person: RentalPerson) => void;
  /** Borrador del alta en sessionStorage (null = sin borrador, p. ej. al editar). */
  draftKey?: string | null;
  /** Avisa si hay algo sin guardar y si se está guardando: el diálogo pregunta antes de cerrar. */
  onStatusChange?: (dirty: boolean, busy: boolean) => void;
}

export function PersonForm({ person, intent, defaultName, onDone, onCancel, onUseExisting, draftKey = null, onStatusChange }: PersonFormProps) {
  const [init] = useState(() => {
    const blank = initialState(person, defaultName);
    const stored = person ? null : readDraft(draftKey);
    const restored = stored ? personStateFromDraft(blank, stored.form) : null;
    return restored && !sameFormValues(restored, blank)
      ? { blank, form: restored, restoredAt: stored?.savedAt ?? null }
      : { blank, form: blank, restoredAt: null };
  });
  const blank = init.blank;
  const [form, setForm] = useState<PersonFormState>(init.form);
  const [restoredAt, setRestoredAt] = useState<string | null>(init.restoredAt);
  const [pending, startTransition] = useTransition();
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [existing, setExisting] = useState<RentalPerson | null>(null);

  const dirty = !sameFormValues(form, blank);
  usePersistDraft(person ? null : draftKey, form, blank);
  useEffect(() => {
    onStatusChange?.(dirty, pending);
  }, [dirty, pending, onStatusChange]);

  function startOver() {
    clearDraft(draftKey);
    setForm(blank);
    setRestoredAt(null);
    setFieldError(null);
    setExisting(null);
  }

  const set: SetPersonField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (fieldError?.field === key) setFieldError(null);
    // Otro documento (o leído como otro tipo) puede no chocar: se vuelve a poder guardar y el servidor decide.
    if (key === "doc_number" || key === "tax_id" || key === "doc_type" || key === "person_type") setExisting(null);
  };

  function fail(field: string | undefined, message: string) {
    setFieldError({ field, message });
    if (!field) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`person-${field}`);
      // Si el campo está en una sección plegada, se abre antes de enfocarlo.
      el?.closest("details")?.setAttribute("open", "");
      el?.focus();
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (form.full_name.trim().length < 2) return fail("full_name", form.person_type === "juridica" ? "Escribí la razón social." : "Escribí el nombre y apellido.");
    const income = form.income.trim() ? parseAmountInput(form.income) : null;
    if (form.income.trim() && (income == null || income < 0)) return fail("monthly_income", "Revisá los ingresos: escribilos así, 850.000");
    const juridica = form.person_type === "juridica";
    const input: PersonInput = {
      person_type: form.person_type,
      full_name: form.full_name,
      doc_type: juridica ? "CUIT" : form.doc_type,
      doc_number: form.doc_number || null,
      tax_id: juridica ? null : form.tax_id || null,
      birth_date: juridica ? null : form.birth_date || null,
      nationality: juridica ? null : form.nationality || null,
      email: form.email || null,
      phone: form.phone || null,
      phone_alt: form.phone_alt || null,
      address: form.address || null,
      city: form.city || null,
      province: form.province || null,
      occupation: form.occupation || null,
      employer: juridica ? null : form.employer || null,
      employer_phone: juridica ? null : form.employer_phone || null,
      monthly_income: income,
      income_currency: income != null ? form.income_currency : null,
      notes: form.notes || null,
    };
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof createPerson>>;
      try {
        res = person ? await updatePerson(person.id, input) : await createPerson(input);
      } catch (error) {
        // No llegó respuesta (conexión o deploy nuevo). Un alta queda en el borrador de la pestaña; una edición, no.
        toastActionFailure(error, "No se pudo guardar", { afterReload: !person && draftKey ? "Lo que cargaste vuelve a aparecer." : undefined });
        return;
      }
      if (!res.ok) {
        fail(res.field, res.error);
        if (res.existing) setExisting(res.existing);
        else toast.error("No se pudo guardar", { description: res.error });
        return;
      }
      const who = intent === "garante" ? "Garante" : intent === "inquilino" ? "Inquilino" : "Persona";
      toast.success(person ? "Cambios guardados" : `${who} cargado`, { description: res.person.full_name });
      onDone(res.person);
    });
  }

  return (
    <PersonFormFields
      form={form}
      set={set}
      intent={intent}
      isEdit={Boolean(person)}
      pending={pending}
      fieldError={fieldError}
      cuitHint={form.person_type === "fisica" ? cuitWarning(form.tax_id) : form.doc_number ? cuitWarning(form.doc_number) : null}
      existing={existing}
      onUseExisting={!person && onUseExisting ? onUseExisting : undefined}
      restoredAt={restoredAt}
      onStartOver={startOver}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
