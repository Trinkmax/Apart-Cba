"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ProcessSteps } from "@/components/marketplace/brand/process-steps";
import { CheckboxRow, EmailInput, Field, FormAlert, inputClass } from "@/components/marketplace/shell/form-fields";
import { BrandDialogContent } from "@/components/marketplace/reservation/brand-dialog";
import { CheckoutSummary, type CheckoutSummaryData } from "@/components/marketplace/reservation/checkout-summary";
import { stayRangeShort, guestsLabel, nightsLabel } from "@/components/marketplace/reservation/format";
import { submitCheckout } from "@/lib/actions/marketplace-bookings";
import type { CheckoutField } from "@/lib/marketplace/contracts";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { cn } from "@/lib/utils";

export interface CheckoutFormProps {
  summary: CheckoutSummaryData;
  responseHours: number;
  houseRules: string | null;
  /** "de 14 a 22 h". */
  checkInWindow: string | null;
  cancellation: { title: string; body: string };
  /** Con sesión: datos de la cuenta para prellenar (el email queda fijo). */
  guest: { fullName: string; email: string; phone: string; document: string } | null;
  /** /ingresar?redirect=<este checkout>. */
  signInHref: string;
}

type FieldErrors = Partial<Record<CheckoutField, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const digitsCount = (s: string) => s.replace(/\D+/g, "").length;

/** Orden de los campos en pantalla (para enfocar el primero con error). */
const FIELD_ORDER: CheckoutField[] = ["full_name", "email", "phone", "document", "special_requests", "agreed_to_rules"];

/**
 * Borrador de los datos del huésped en la pestaña (sessionStorage): si sale a
 * elegir otras fechas o a ingresar y vuelve, no tiene que escribir todo de
 * nuevo. El documento NO se guarda. Se borra al enviar el pedido.
 */
const DRAFT_KEY = "apart:checkout-datos";

interface CheckoutDraft {
  fullName: string;
  email: string;
  phone: string;
  message: string;
}

const noopSubscribe = () => () => {};
/** "" = no hay borrador (o no se pudo leer); null = todavía en el server / hidratando. */
function readDraftRaw(): string {
  try {
    return window.sessionStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
const serverDraftRaw = () => null;

function parseDraft(raw: string): Partial<CheckoutDraft> | null {
  if (!raw) return null;
  try {
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== "object") return null;
    const pick = (k: keyof CheckoutDraft) => {
      const v = (d as Record<string, unknown>)[k];
      return typeof v === "string" ? v.slice(0, 1000) : undefined;
    };
    return { fullName: pick("fullName"), email: pick("email"), phone: pick("phone"), message: pick("message") };
  } catch {
    return null;
  }
}

function writeDraft(d: CheckoutDraft | null) {
  try {
    if (d && Object.values(d).some((v) => v.trim())) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Sin storage (navegación privada, bloqueado): el formulario anda igual.
  }
}

function validate(v: { fullName: string; email: string; phone: string; agreed: boolean }, emailLocked: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (v.fullName.trim().length < 2) errors.full_name = "Escribí tu nombre y apellido.";
  if (!emailLocked) {
    const email = v.email.trim();
    if (!email) errors.email = "Escribí tu email.";
    else if (!EMAIL_RE.test(email)) errors.email = "Revisá el email: parece que falta algo.";
  }
  const phoneDigits = digitsCount(v.phone);
  if (phoneDigits === 0) errors.phone = "Dejanos tu WhatsApp para poder confirmarte.";
  else if (phoneDigits < 8) errors.phone = "Revisá el WhatsApp: faltan números.";
  if (!v.agreed) errors.agreed_to_rules = "Para seguir, confirmá que leíste las reglas y la política de cancelación.";
  return errors;
}

/** Un bloque del formulario con su título. */
function FormSection({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-xl font-extrabold tracking-[-0.015em] text-forest-700 sm:text-[1.375rem]">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Checkout de la web: el huésped deja sus datos y manda el pedido SIN pagar y
 * SIN cuenta (lead-first). Con sesión, se prellenan los datos y el email queda
 * fijo. El servidor vuelve a validar todo (fechas, precio, disponibilidad).
 */
export function CheckoutForm({
  summary,
  responseHours,
  houseRules,
  checkInWindow,
  cancellation,
  guest,
  signInHref,
}: CheckoutFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const emailLocked = Boolean(guest?.email);
  const instant = summary.unit.instant;

  const [fullName, setFullName] = useState(guest?.fullName ?? "");
  const [email, setEmail] = useState(guest?.email ?? "");
  const [phone, setPhone] = useState(guest?.phone ?? "");
  const [documentId, setDocumentId] = useState(guest?.document ?? "");
  const [message, setMessage] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [website, setWebsite] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<{ text: string; datesAction: boolean } | null>(null);
  const [dialog, setDialog] = useState<"rules" | "cancellation" | null>(null);
  const [ctaInView, setCtaInView] = useState(false);
  const [pending, startTransition] = useTransition();

  // Borrador: se lee recién en el cliente (el snapshot del server es null, así
  // no hay diferencias al hidratar) y se aplica UNA vez, sólo en los campos
  // vacíos (lo que trae la cuenta manda).
  const draftRaw = useSyncExternalStore(noopSubscribe, readDraftRaw, serverDraftRaw);
  const [draftApplied, setDraftApplied] = useState(false);
  if (draftRaw !== null && !draftApplied) {
    setDraftApplied(true);
    const d = parseDraft(draftRaw);
    if (d) {
      if (!fullName && d.fullName) setFullName(d.fullName);
      if (!emailLocked && !email && d.email) setEmail(d.email);
      if (!phone && d.phone) setPhone(d.phone);
      if (!message && d.message) setMessage(d.message);
    }
  }

  // Cada cambio actualiza el borrador (después de restaurarlo, para no pisarlo).
  useEffect(() => {
    if (!draftApplied) return;
    writeDraft({ fullName, email: emailLocked ? "" : email, phone, message });
  }, [draftApplied, fullName, email, phone, message, emailLocked]);

  // La barra fija del celular se esconde cuando el botón del formulario ya se ve.
  useEffect(() => {
    const el = ctaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCtaInView(entry.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function clearFieldError(field: CheckoutField) {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function focusField(field: CheckoutField) {
    const form = formRef.current;
    // El checkbox de CheckboxRow no lleva name: se lo busca por tipo.
    const el =
      field === "agreed_to_rules"
        ? form?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        : form?.elements.namedItem(field);
    if (el instanceof HTMLElement) {
      el.focus();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function showGeneralError(text: string, datesAction: boolean) {
    setError({ text, datesAction });
    window.setTimeout(() => {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 30);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const errors = validate({ fullName, email, phone, agreed }, emailLocked);
    setFieldErrors(errors);
    const firstInvalid = FIELD_ORDER.find((f) => errors[f]);
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    startTransition(async () => {
      try {
        const res = await submitCheckout({
          unit_id: summary.unit.id,
          check_in_date: summary.stay.checkIn,
          check_out_date: summary.stay.checkOut,
          guests_count: summary.stay.guests,
          full_name: fullName.trim(),
          email: (guest?.email ?? email).trim(),
          phone: phone.trim(),
          document: documentId.trim() || null,
          special_requests: message.trim() || null,
          agreed_to_rules: agreed,
          website: website || null,
        });
        if (res.ok) {
          writeDraft(null);
          router.push(`${res.status_path}?nuevo=1`);
          return;
        }
        const field = res.field;
        if (field && field !== "dates" && field !== "guests_count") {
          const next: FieldErrors = {};
          next[field] = res.error;
          setFieldErrors(next);
          focusField(field);
          return;
        }
        showGeneralError(res.error, field === "dates" || field === "guests_count");
      } catch {
        showGeneralError("No pudimos enviar el pedido. Revisá tu conexión y probá de nuevo.", false);
      }
    });
  }

  const cur = summary.money.currency || "ARS";
  const ctaLabel = instant ? "Reservar" : "Enviar pedido";
  const senaLabel = summary.money.sena ? formatCurrency(summary.money.sena, cur) : null;

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-12 xl:gap-16">
        {/* Celular: resumen plegable arriba del formulario. */}
        <details className="group rounded-3xl bg-paper shadow-apart-sm ring-1 ring-cream-300 lg:hidden">
          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-3xl px-4 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/30 [&::-webkit-details-marker]:hidden">
            <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-b-lg rounded-t-full bg-cream-200">
              {summary.unit.coverUrl ? (
                <Image src={summary.unit.coverUrl} alt="" fill sizes="40px" className="object-cover" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.8125rem] font-semibold text-ink-500">Tu estadía en {summary.unit.title}</span>
              <span className="block truncate text-[0.9375rem] font-bold text-forest-700">
                {stayRangeShort(summary.stay.checkIn, summary.stay.checkOut)}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[0.9375rem] font-extrabold tabular-nums text-forest-700">
                {formatCurrency(summary.money.total, cur)}
              </span>
              <span className="flex items-center justify-end gap-0.5 text-xs font-semibold text-ink-500">
                <span className="group-open:hidden">Ver detalle</span>
                <span className="hidden group-open:inline">Ocultar</span>
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </span>
          </summary>
          <div className="px-4 pb-5">
            <CheckoutSummary data={summary} showHeader={false} className="border-t border-cream-300 pt-4" />
          </div>
        </details>

        <form ref={formRef} id="checkout-form" onSubmit={onSubmit} noValidate className="min-w-0 space-y-10">
          {error ? (
            <div ref={errorRef} tabIndex={-1} className="outline-none">
              <FormAlert tone="error" title="No pudimos enviar el pedido">
                <p>{error.text}</p>
                {error.datesAction ? (
                  <Link
                    href={summary.changeDatesHref}
                    className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
                  >
                    Elegir otras fechas
                  </Link>
                ) : null}
              </FormAlert>
            </div>
          ) : null}

          <FormSection
            id="checkout-datos"
            title="Tus datos"
            aside={
              !guest ? (
                <p className="text-sm text-ink-500">
                  ¿Tenés cuenta?{" "}
                  <Link
                    href={signInHref}
                    className="font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700"
                  >
                    Ingresá para completar más rápido
                  </Link>
                </p>
              ) : null
            }
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Nombre y apellido" error={fieldErrors.full_name} className="sm:col-span-2">
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    name="full_name"
                    type="text"
                    autoComplete="name"
                    autoCapitalize="words"
                    maxLength={120}
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      clearFieldError("full_name");
                    }}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    aria-required
                    className={inputClass}
                  />
                )}
              </Field>
              <Field
                label="Email"
                error={fieldErrors.email}
                hint={emailLocked ? "Usamos el mail de tu cuenta." : "Te mandamos el link para seguir tu pedido."}
              >
                {({ id, describedBy, invalid }) =>
                  emailLocked ? (
                    <input
                      id={id}
                      name="email"
                      type="email"
                      value={guest?.email ?? ""}
                      readOnly
                      aria-describedby={describedBy}
                      className={cn(inputClass, "bg-cream-200/60 text-ink-700")}
                    />
                  ) : (
                    <EmailInput
                      id={id}
                      name="email"
                      autoComplete="email"
                      maxLength={200}
                      value={email}
                      onValueChange={(v) => {
                        setEmail(v);
                        clearFieldError("email");
                      }}
                      aria-invalid={invalid || undefined}
                      aria-describedby={describedBy}
                      aria-required
                    />
                  )
                }
              </Field>
              <Field
                label="WhatsApp"
                error={fieldErrors.phone}
                hint="Te confirmamos por acá. Con código de área, por ejemplo 351 555-1234."
              >
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={40}
                    placeholder="+54 9 351 555-1234"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      clearFieldError("phone");
                    }}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    aria-required
                    className={inputClass}
                  />
                )}
              </Field>
              <Field
                label="DNI o pasaporte"
                optional
                error={fieldErrors.document}
                hint="Para el registro de huéspedes. Si preferís, nos lo pasás después."
              >
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    name="document"
                    type="text"
                    autoComplete="off"
                    maxLength={40}
                    value={documentId}
                    onChange={(e) => {
                      setDocumentId(e.target.value);
                      clearFieldError("document");
                    }}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    className={inputClass}
                  />
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection id="checkout-mensaje" title="Contanos algo">
            <Field label="Tu mensaje para el equipo" optional error={fieldErrors.special_requests}>
              {({ id, describedBy, invalid }) => (
                <textarea
                  id={id}
                  name="special_requests"
                  rows={4}
                  maxLength={1000}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    clearFieldError("special_requests");
                  }}
                  placeholder="¿A qué venís a Córdoba? ¿A qué hora pensás llegar?"
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  className={cn(inputClass, "h-auto min-h-28 resize-y py-3 leading-relaxed")}
                />
              )}
            </Field>
          </FormSection>

          <FormSection id="checkout-sigue" title="Cómo sigue">
            <div className="rounded-3xl bg-paper p-5 ring-1 ring-cream-300 sm:p-6">
              <ProcessSteps layout="vertical" responseHours={responseHours} senaLabel={senaLabel} instant={instant} />
              {summary.money.resto > 0 ? (
                <p className="mt-5 border-t border-cream-300 pt-4 text-[0.9375rem] text-ink-700">
                  Al llegar pagás{" "}
                  <span className="font-bold tabular-nums text-forest-700">{formatCurrency(summary.money.resto, cur)}</span>, en
                  efectivo o por transferencia.
                </p>
              ) : null}
            </div>
          </FormSection>

          <div className="space-y-3">
            <CheckboxRow
              checked={agreed}
              onCheckedChange={(v) => {
                setAgreed(v);
                clearFieldError("agreed_to_rules");
              }}
            >
              <span id="agreed-label">
                Leí las{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setDialog("rules");
                  }}
                  className="font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700"
                >
                  reglas de la casa
                </button>{" "}
                y la{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setDialog("cancellation");
                  }}
                  className="font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700"
                >
                  política de cancelación
                </button>
                .
              </span>
            </CheckboxRow>
            {fieldErrors.agreed_to_rules ? (
              <p role="alert" className="text-sm font-medium text-[#b42318]">
                {fieldErrors.agreed_to_rules}
              </p>
            ) : null}
            <p className="text-[0.8125rem] leading-relaxed text-ink-500">
              Al enviar aceptás los{" "}
              <Link href="/legal/terminos" target="_blank" className="underline underline-offset-4 hover:text-forest-700">
                términos
              </Link>{" "}
              y la{" "}
              <Link href="/legal/privacidad" target="_blank" className="underline underline-offset-4 hover:text-forest-700">
                política de privacidad
              </Link>
              .
            </p>
          </div>

          {/* Honeypot anti-bots: invisible para personas y lectores de pantalla. */}
          <div aria-hidden className="pointer-events-none absolute -left-[9999px] top-auto size-px overflow-hidden">
            <label>
              Tu sitio web
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>

          <div ref={ctaRef} className="space-y-3 border-t border-cream-300 pt-6">
            <ApartButton
              type="submit"
              variant="cta"
              size="xl"
              disabled={pending}
              aria-busy={pending}
              className="w-full sm:w-auto sm:min-w-72"
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Enviando…" : ctaLabel}
            </ApartButton>
            <p className="text-[0.9375rem] font-semibold text-forest-700">No pagás nada ahora.</p>
            <p className="text-sm leading-relaxed text-ink-500">
              {instant
                ? "Tu reserva queda confirmada al instante. En el link de tu reserva te decimos cómo transferir la seña."
                : `Te confirmamos en menos de ${hoursLabel(responseHours)}, por WhatsApp y por mail.`}
            </p>
          </div>
        </form>

        <aside aria-label="Resumen de tu estadía" className="hidden lg:block">
          <div className="sticky top-24 rounded-3xl bg-paper p-6 shadow-apart-lg ring-1 ring-cream-300">
            <CheckoutSummary data={summary} />
          </div>
        </aside>
      </div>

      {/* Celular: botón fijo abajo (se esconde cuando el del formulario ya se ve). */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-cream-300 bg-paper/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-apart-lg backdrop-blur transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:hidden",
          ctaInView && "pointer-events-none translate-y-full",
        )}
        aria-hidden={ctaInView || undefined}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0">
            <p className="text-[0.8125rem] text-ink-500">
              Total · {nightsLabel(summary.stay.nights)} · {guestsLabel(summary.stay.guests)}
            </p>
            <p className="text-lg font-extrabold leading-tight tabular-nums text-forest-700">
              {formatCurrency(summary.money.total, cur)}
            </p>
          </div>
          <ApartButton
            type="submit"
            form="checkout-form"
            variant="cta"
            size="lg"
            disabled={pending}
            tabIndex={ctaInView ? -1 : undefined}
            className="ml-auto flex-1 sm:flex-none"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending ? "Enviando…" : ctaLabel}
          </ApartButton>
        </div>
        <p className="mt-1.5 text-center text-xs font-semibold text-forest-700">No pagás nada ahora.</p>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => (!open ? setDialog(null) : undefined)}>
        {dialog === "rules" ? (
          <BrandDialogContent title="Reglas de la casa" className="sm:max-w-xl">
            {houseRules ? (
              <p className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-700">{houseRules}</p>
            ) : (
              <p className="text-[0.9375rem] leading-relaxed text-ink-700">
                Este departamento no tiene reglas especiales. Te pedimos lo de siempre: cuidemos el lugar y respetemos
                el descanso de los vecinos.
              </p>
            )}
            {checkInWindow ? (
              <p className="rounded-2xl bg-cream-200/70 px-4 py-3 text-[0.9375rem] text-ink-700">
                <span className="font-semibold text-forest-700">Check-in:</span> {checkInWindow}.
              </p>
            ) : null}
            <ApartButton type="button" variant="primary" size="lg" onClick={() => setDialog(null)} className="w-full sm:w-auto sm:self-end">
              Entendido
            </ApartButton>
          </BrandDialogContent>
        ) : dialog === "cancellation" ? (
          <BrandDialogContent title={cancellation.title} className="sm:max-w-xl">
            <p className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-700">{cancellation.body}</p>
            {!instant ? (
              <p className="text-sm leading-relaxed text-ink-500">
                Mientras tu pedido espera confirmación, podés cancelarlo sin costo desde el link de seguimiento.
              </p>
            ) : null}
            <ApartButton type="button" variant="primary" size="lg" onClick={() => setDialog(null)} className="w-full sm:w-auto sm:self-end">
              Entendido
            </ApartButton>
          </BrandDialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
