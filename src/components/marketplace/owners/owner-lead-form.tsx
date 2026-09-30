"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { submitOwnerLead } from "@/lib/actions/owner-leads";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { BrandDot } from "@/components/marketplace/brand/brand-shapes";
import { cn } from "@/lib/utils";
import {
  OWNER_LEAD_LIMITS,
  OWNER_LEAD_ROOMS,
  type OwnerLeadField,
  type OwnerLeadInput,
} from "./owner-lead-options";

const INPUT = cn(
  "block w-full rounded-2xl border border-cream-400 bg-white px-4 text-base text-ink-900 placeholder:text-ink-400",
  "outline-none transition-[border-color,box-shadow] duration-200",
  "focus-visible:border-forest-500 focus-visible:ring-[3px] focus-visible:ring-forest-500/25",
  "aria-[invalid=true]:border-[#b42318] aria-[invalid=true]:ring-[3px] aria-[invalid=true]:ring-[#b42318]/10",
);

type FormValues = Record<Exclude<keyof OwnerLeadInput, "website">, string>;

const EMPTY: FormValues = {
  name: "",
  phone: "",
  email: "",
  address: "",
  rooms: "",
  message: "",
};

/**
 * Formulario de propietarios → `submitOwnerLead`. Sin cuenta ni login: el
 * equipo recibe un mail y un aviso en el panel y le escribe al dueño.
 * Los errores vuelven por campo (aria-invalid + mensaje asociado) y el
 * resultado se anuncia con aria-live.
 */
export function OwnerLeadForm({
  responseHours,
  whatsappUrl,
  className,
}: {
  responseHours: number;
  /** wa.me del equipo con mensaje precargado; null si no hay número. */
  whatsappUrl: string | null;
  className?: string;
}) {
  const uid = useId();
  const [values, setValues] = useState(EMPTY);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<{ message: string; field?: OwnerLeadField } | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const doneRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setValues((v) => ({ ...v, [field]: value }));
    if (error?.field === field) setError(null);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await submitOwnerLead({ ...values, rooms: values.rooms || null, website });
        if (res.ok) {
          setDone(true);
          return;
        }
        setError({ message: res.error, field: res.field });
        if (res.field) {
          formRef.current?.querySelector<HTMLElement>(`[name="${res.field}"]`)?.focus();
        }
      } catch {
        setError({ message: "No pudimos enviar tu mensaje. Revisá tu conexión y probá de nuevo." });
      }
    });
  };

  const hours = responseHours === 1 ? "1 hora" : `${responseHours} horas`;

  if (done) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "relative overflow-hidden rounded-3xl bg-forest-700 p-7 text-cream shadow-apart-lg sm:p-10",
          className,
        )}
      >
        <span aria-hidden className="absolute -right-10 -top-10 size-36 rounded-full border-[14px] border-leaf-300/25" />
        <h3
          ref={doneRef}
          tabIndex={-1}
          className="relative font-apart text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.025em] outline-none sm:text-[2rem]"
        >
          ¡Gracias, {values.name.trim().split(/\s+/)[0]}!
        </h3>
        <p className="relative mt-3 font-apart-serif text-xl italic leading-snug text-leaf-300">
          Te escribimos en menos de {hours}.
        </p>
        <p className="relative mt-4 max-w-md text-[0.9375rem] leading-relaxed text-cream/85">
          Nos llegó tu mensaje. Te contactamos por WhatsApp o por mail para conocer el departamento y contarte
          cómo trabajamos.
        </p>
        {whatsappUrl ? (
          <ApartButton asChild variant="inverse" size="lg" className="relative mt-7">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden />
              Escribinos por WhatsApp
            </a>
          </ApartButton>
        ) : null}
      </div>
    );
  }

  const errFor = (f: OwnerLeadField) => (error?.field === f ? error.message : null);
  const general = error && !error.field ? error.message : null;
  const roomsError = errFor("rooms");

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${uid}-title`}
      className={cn("relative rounded-3xl bg-paper p-6 shadow-apart-md ring-1 ring-cream-300 sm:p-8", className)}
    >
      <h3
        id={`${uid}-title`}
        className="font-apart text-2xl font-extrabold leading-[1.1] tracking-[-0.02em] text-forest-700 sm:text-[1.75rem]"
      >
        Contanos de tu departamento
        <BrandDot />
      </h3>
      <p className="mt-2 font-apart-serif text-lg italic leading-snug text-forest-600">
        Te escribimos en menos de {hours}.
      </p>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <Field id={`${uid}-name`} label="Nombre y apellido" error={errFor("name")} className="sm:col-span-2">
          {(a11y) => (
            <input
              {...a11y}
              name="name"
              type="text"
              autoComplete="name"
              required
              maxLength={OWNER_LEAD_LIMITS.name}
              value={values.name}
              onChange={set("name")}
              className={cn(INPUT, "h-12")}
            />
          )}
        </Field>
        <Field id={`${uid}-phone`} label="WhatsApp" hint="Con código de área, por ejemplo 351 555-1234." error={errFor("phone")}>
          {(a11y) => (
            <input
              {...a11y}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              maxLength={32}
              value={values.phone}
              onChange={set("phone")}
              className={cn(INPUT, "h-12 tabular-nums")}
            />
          )}
        </Field>
        <Field id={`${uid}-email`} label="Email" error={errFor("email")}>
          {(a11y) => (
            <input
              {...a11y}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={OWNER_LEAD_LIMITS.email}
              value={values.email}
              onChange={set("email")}
              className={cn(INPUT, "h-12")}
            />
          )}
        </Field>
        <Field
          id={`${uid}-address`}
          label="Barrio o dirección del departamento"
          error={errFor("address")}
          className="sm:col-span-2"
        >
          {(a11y) => (
            <input
              {...a11y}
              name="address"
              type="text"
              autoComplete="off"
              required
              maxLength={OWNER_LEAD_LIMITS.address}
              placeholder="Por ejemplo: Nueva Córdoba, o la dirección exacta"
              value={values.address}
              onChange={set("address")}
              className={cn(INPUT, "h-12")}
            />
          )}
        </Field>

        <fieldset className="sm:col-span-2" aria-describedby={roomsError ? `${uid}-rooms-error` : undefined}>
          <legend className="mb-2 text-sm font-bold text-forest-700">
            Ambientes <span className="ml-1 font-medium text-ink-500">(opcional)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {OWNER_LEAD_ROOMS.map((r) => (
              <label key={r} className="relative">
                <input
                  type="radio"
                  name="rooms"
                  value={r}
                  checked={values.rooms === r}
                  onChange={set("rooms")}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "inline-flex min-h-11 cursor-pointer select-none items-center rounded-full bg-white px-4 text-sm font-semibold text-forest-700 ring-1 ring-cream-400",
                    "transition-colors duration-200 hover:ring-forest-700/40",
                    "peer-checked:bg-forest-700 peer-checked:text-cream peer-checked:ring-forest-700",
                    "peer-focus-visible:ring-[3px] peer-focus-visible:ring-forest-500/40",
                  )}
                >
                  {r}
                </span>
              </label>
            ))}
          </div>
          {roomsError ? (
            <p id={`${uid}-rooms-error`} className="mt-1.5 text-[0.8125rem] font-semibold text-[#b42318]">
              {roomsError}
            </p>
          ) : null}
        </fieldset>

        <Field id={`${uid}-message`} label="Mensaje" optional error={errFor("message")} className="sm:col-span-2">
          {(a11y) => (
            <textarea
              {...a11y}
              name="message"
              rows={4}
              maxLength={OWNER_LEAD_LIMITS.message}
              placeholder="Lo que quieras contarnos: si hoy está alquilado, desde cuándo estaría disponible, si está amoblado…"
              value={values.message}
              onChange={set("message")}
              className={cn(INPUT, "min-h-28 resize-y py-3 leading-relaxed")}
            />
          )}
        </Field>
      </div>

      {/* Honeypot: fuera de pantalla y oculto a lectores; una persona nunca lo completa. */}
      <div aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          No completar
          <input
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      {general ? (
        <p role="alert" className="mt-6 rounded-2xl bg-[#fdecea] px-4 py-3 text-sm font-medium leading-relaxed text-[#b42318]">
          {general}
        </p>
      ) : null}

      <div className="mt-7 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.8125rem] leading-relaxed text-ink-500 sm:max-w-[16rem]">
          Usamos tus datos sólo para escribirte por tu departamento.
        </p>
        <ApartButton type="submit" variant="cta" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Send aria-hidden />}
          {pending ? "Enviando…" : "Enviar"}
        </ApartButton>
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? "Enviando tu mensaje…" : ""}
      </p>
    </form>
  );
}

type FieldA11y = { id: string; "aria-invalid"?: true; "aria-describedby"?: string };

function Field({
  id,
  label,
  hint,
  optional = false,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  error: string | null;
  className?: string;
  children: (a11y: FieldA11y) => React.ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-bold text-forest-700">
        {label}
        {optional ? <span className="ml-1 font-medium text-ink-500">(opcional)</span> : null}
      </label>
      {children({ id, ...(error ? { "aria-invalid": true as const } : {}), ...(describedBy ? { "aria-describedby": describedBy } : {}) })}
      {error ? (
        <p id={errorId} className="mt-1.5 text-[0.8125rem] font-semibold text-[#b42318]">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-[0.8125rem] text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
