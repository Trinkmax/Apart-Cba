"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateGuestProfile } from "@/lib/actions/guest-auth";
import type { GuestProfile } from "@/lib/types/database";

export function GuestProfileForm({
  profile,
  email,
}: {
  profile: GuestProfile;
  email: string;
}) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [documentType, setDocumentType] = useState(profile.document_type ?? "");
  const [documentNumber, setDocumentNumber] = useState(profile.document_number ?? "");
  const [city, setCity] = useState(profile.city ?? "");
  const [country, setCountry] = useState(profile.country ?? "AR");
  const [marketing, setMarketing] = useState(profile.marketing_consent);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateGuestProfile({
        full_name: fullName,
        phone: phone || null,
        document_type: documentType || null,
        document_number: documentNumber || null,
        city: city || null,
        country: country || null,
        birth_date: profile.birth_date,
        marketing_consent: marketing,
      });
      if (!r.ok) {
        toast.error("No se pudo guardar", { description: r.error });
        return;
      }
      toast.success("Perfil actualizado");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="Nombre completo">
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={inputCls}
          required
          disabled={pending}
        />
      </Field>
      <Field label="Email" hint="No se puede cambiar por ahora. Si lo necesitás, contactá soporte.">
        <input value={email} disabled className={`${inputCls} bg-neutral-50 text-neutral-500`} />
      </Field>
      <Field label="Teléfono">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputCls}
          disabled={pending}
          placeholder="+54 9 ..."
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo de documento">
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className={inputCls}
            disabled={pending}
          >
            <option value="">Elegí</option>
            <option value="DNI">DNI</option>
            <option value="Pasaporte">Pasaporte</option>
            <option value="CUIT">CUIT</option>
            <option value="Otro">Otro</option>
          </select>
        </Field>
        <Field label="Número">
          <input
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            className={inputCls}
            disabled={pending}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Ciudad">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputCls}
            disabled={pending}
          />
        </Field>
        <Field label="País">
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={inputCls}
            disabled={pending}
          />
        </Field>
      </div>
      <label className="flex items-start gap-3 pt-2 cursor-pointer">
        <input
          type="checkbox"
          checked={marketing}
          onChange={(e) => setMarketing(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-neutral-300"
        />
        <span className="text-sm text-neutral-600">
          Quiero recibir novedades y ofertas exclusivas por email.
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-900 text-white px-6 h-11 text-sm font-medium hover:bg-neutral-800 disabled:opacity-60"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : null}
        Guardar cambios
      </button>
    </form>
  );
}

const inputCls =
  "w-full h-11 px-3 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-neutral-700 mb-1">{label}</div>
      {children}
      {hint ? <div className="text-xs text-neutral-500 mt-1">{hint}</div> : null}
    </label>
  );
}
