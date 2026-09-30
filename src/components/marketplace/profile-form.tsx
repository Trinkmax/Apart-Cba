"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2, Mail } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import type { ShellContact } from "@/components/marketplace/shell/contact";
import { CheckboxRow, Field, FormAlert, inputClass } from "@/components/marketplace/shell/form-fields";
import { WhatsAppIcon } from "@/components/marketplace/shell/whatsapp-icon";
import { updateGuestProfile, type ProfileField } from "@/lib/actions/guest-auth";
import type { GuestProfile } from "@/lib/types/database";
import { cn } from "@/lib/utils";

const DOCUMENT_TYPES = ["DNI", "Pasaporte", "CUIT", "Otro"] as const;

/** Bloque del formulario: tarjeta de papel con título. */
function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-paper p-5 shadow-apart-sm ring-1 ring-cream-300 sm:p-7">
      <h2 className="text-lg font-bold tracking-[-0.01em] text-forest-700">{title}</h2>
      {description ? <p className="mt-1 text-[0.9375rem] leading-snug text-ink-500">{description}</p> : null}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

export function GuestProfileForm({
  profile,
  email,
  contact,
}: {
  profile: GuestProfile;
  email: string;
  contact: ShellContact;
}) {
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [documentType, setDocumentType] = useState(profile.document_type ?? "");
  const [documentNumber, setDocumentNumber] = useState(profile.document_number ?? "");
  const [city, setCity] = useState(profile.city ?? "");
  const [country, setCountry] = useState(profile.country ?? "");
  const [marketing, setMarketing] = useState(Boolean(profile.marketing_consent));
  const [fieldError, setFieldError] = useState<{ field: ProfileField | null; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const errorFor = (field: ProfileField) => (fieldError?.field === field ? fieldError.text : null);
  const touch = () => {
    if (saved) setSaved(false);
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setSaved(false);
    if (fullName.trim().length < 2) {
      setFieldError({ field: "full_name", text: "Escribí tu nombre y apellido." });
      return;
    }
    startTransition(async () => {
      const r = await updateGuestProfile({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        document_type: documentType || null,
        document_number: documentNumber.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
        birth_date: profile.birth_date,
        marketing_consent: marketing,
      });
      if (!r.ok) {
        setFieldError({ field: r.field ?? null, text: r.error });
        return;
      }
      setSaved(true);
    });
  }

  const generalError = fieldError && !fieldError.field ? fieldError.text : null;

  return (
    <form onSubmit={onSubmit} onChange={touch} noValidate className="space-y-5">
      <Section title="Tus datos" description="Con esto coordinamos tu llegada.">
        <Field label="Nombre y apellido" error={errorFor("full_name")}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="name"
              required
              maxLength={120}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="WhatsApp" optional hint="Lo usamos para coordinar tu estadía." error={errorFor("phone")}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="tel"
              inputMode="tel"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="tel"
              maxLength={30}
              placeholder="+54 9 351 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          )}
        </Field>
      </Section>

      <Section title="Documento">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <Field label="Tipo" optional error={errorFor("document_type")}>
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <select
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  disabled={pending}
                  className={cn(inputClass, "appearance-none pr-11")}
                >
                  <option value="">Elegí</option>
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  {documentType && !(DOCUMENT_TYPES as readonly string[]).includes(documentType) ? (
                    <option value={documentType}>{documentType}</option>
                  ) : null}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
              </div>
            )}
          </Field>
          <Field label="Número" optional error={errorFor("document_number")}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                autoComplete="off"
                maxLength={40}
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            )}
          </Field>
        </div>
      </Section>

      <Section title="Dónde vivís">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Ciudad" optional error={errorFor("city")}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                autoComplete="address-level2"
                maxLength={120}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="País" optional error={errorFor("country")}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                autoComplete="country-name"
                maxLength={80}
                placeholder="Argentina"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            )}
          </Field>
        </div>
      </Section>

      <Section title="Tu email">
        <div className="space-y-2">
          <p className="break-all rounded-2xl bg-cream-200 px-4 py-3 text-base font-semibold text-ink-900">{email}</p>
          <p className="text-[0.9375rem] leading-snug text-ink-500">
            Es con el que ingresás y donde te llegan los avisos de tus reservas. Para cambiarlo, escribinos.
          </p>
        </div>
        {contact.whatsappUrl || contact.emailUrl ? (
          <div className="flex flex-wrap gap-2.5">
            {contact.whatsappUrl ? (
              <ApartButton asChild variant="soft" size="sm">
                <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <WhatsAppIcon className="size-4" />
                  WhatsApp
                </a>
              </ApartButton>
            ) : null}
            {contact.emailUrl ? (
              <ApartButton asChild variant="soft" size="sm">
                <a href={contact.emailUrl}>
                  <Mail aria-hidden className="size-4" />
                  {contact.email}
                </a>
              </ApartButton>
            ) : null}
          </div>
        ) : null}
        <CheckboxRow checked={marketing} onCheckedChange={setMarketing} disabled={pending}>
          Quiero recibir novedades de apart por mail.
        </CheckboxRow>
      </Section>

      <div aria-live="polite" className="space-y-3">
        {generalError ? <FormAlert>{generalError}</FormAlert> : null}
        {saved ? <FormAlert tone="ok">Listo, guardamos tus datos.</FormAlert> : null}
      </div>

      <div className="flex justify-end">
        <ApartButton type="submit" variant="primary" size="lg" disabled={pending} aria-busy={pending} className="w-full sm:w-auto">
          {pending ? <Loader2 aria-hidden className="size-5 motion-safe:animate-spin" /> : null}
          Guardar cambios
        </ApartButton>
      </div>
    </form>
  );
}
