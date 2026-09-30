"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarHeart, Loader2, MailCheck } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { AuthHeading } from "@/components/marketplace/shell/auth-shell";
import { authErrorMessage, classifyAuthError } from "@/components/marketplace/shell/auth-errors";
import {
  CheckboxRow,
  EmailInput,
  Field,
  FormAlert,
  PasswordInput,
  inputClass,
} from "@/components/marketplace/shell/form-fields";
import { DEFAULT_AFTER_LOGIN } from "@/components/marketplace/shell/safe-redirect";
import { notifyAuthChanged } from "@/components/marketplace/shell/use-guest-identity";
import {
  requestGuestPasswordReset,
  resendGuestConfirmation,
  signInGuest,
  signUpGuest,
} from "@/lib/actions/guest-auth";
import { createClient } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Link a otra pantalla de cuenta conservando el `?redirect` validado. */
function withRedirect(path: string, redirectParam: string | null, extra?: string): string {
  const qs = [redirectParam ? `redirect=${encodeURIComponent(redirectParam)}` : null, extra ?? null]
    .filter(Boolean)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function emailError(value: string): string | null {
  const v = value.trim();
  if (!v) return "Escribí tu email.";
  if (!EMAIL_RE.test(v)) return "Revisá el email: parece que tiene un error.";
  return null;
}

/** Botón principal de los formularios de cuenta (forest, ancho completo). */
function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <ApartButton type="submit" variant="primary" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 aria-hidden className="size-5 motion-safe:animate-spin" /> : null}
      {children}
    </ApartButton>
  );
}

const linkClass =
  "rounded font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 outline-none transition-colors hover:decoration-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/30";

/** Botón con cuenta regresiva (para no reenviar mails de a ráfagas). */
function useCooldown(seconds: number) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);
  return { left, start: () => setLeft(seconds) };
}

/* ------------------------------------------------------------------ */
/* "Revisá tu mail" (cuenta sin confirmar)                             */
/* ------------------------------------------------------------------ */

export function CheckEmailPanel({
  email,
  redirectTo,
  intro,
  primaryAction,
  onBack,
  backLabel = "Me equivoqué de email",
}: {
  email: string;
  /** A dónde vuelve el link del mail (ruta interna ya validada). */
  redirectTo: string;
  /** Texto de arriba; por defecto, el de cuenta recién creada. */
  intro?: string;
  /** "Ya confirmé": link o acción. */
  primaryAction: { label: string; href?: string; onClick?: () => void };
  onBack?: () => void;
  backLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const cooldown = useCooldown(45);

  function resend() {
    setStatus(null);
    startTransition(async () => {
      const r = await resendGuestConfirmation(email, redirectTo);
      if (r.ok) {
        setStatus({ tone: "ok", text: "Listo, te lo mandamos de nuevo. Puede tardar un par de minutos." });
        cooldown.start();
      } else {
        setStatus({ tone: "error", text: r.error });
      }
    });
  }

  return (
    <div className="space-y-7">
      <div className="flex size-16 items-center justify-center rounded-b-xl rounded-t-full bg-leaf-200 text-forest-700">
        <MailCheck aria-hidden className="size-7" />
      </div>
      <AuthHeading title="Revisá tu mail" accent="Falta un paso: confirmar que el email es tuyo." />
      <div className="space-y-3 text-[1rem] leading-relaxed text-ink-700">
        <p>
          {intro ?? "Te mandamos un link a"}{" "}
          <strong className="break-all font-semibold text-ink-900">{email}</strong>. Tocalo y listo: tu
          cuenta queda activa.
        </p>
        <p className="text-ink-500">Si no lo ves en unos minutos, mirá en spam o en promociones.</p>
      </div>

      <div aria-live="polite">{status ? <FormAlert tone={status.tone}>{status.text}</FormAlert> : null}</div>

      <div className="flex flex-col gap-3">
        {primaryAction.href ? (
          <ApartButton asChild variant="primary" size="lg" className="w-full">
            <Link href={primaryAction.href}>{primaryAction.label}</Link>
          </ApartButton>
        ) : (
          <ApartButton type="button" variant="primary" size="lg" className="w-full" onClick={primaryAction.onClick}>
            {primaryAction.label}
          </ApartButton>
        )}
        <ApartButton
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={resend}
          disabled={pending || cooldown.left > 0}
          aria-busy={pending}
        >
          {pending ? <Loader2 aria-hidden className="size-5 motion-safe:animate-spin" /> : null}
          {cooldown.left > 0 ? `Reenviar en ${cooldown.left} s` : "Reenviar el mail"}
        </ApartButton>
      </div>

      {onBack ? (
        <button type="button" onClick={onBack} className={`${linkClass} inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem]`}>
          <ArrowLeft aria-hidden className="size-4" />
          {backLabel}
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Olvidé mi contraseña (paso inline de /ingresar)                     */
/* ------------------------------------------------------------------ */

function ForgotPasswordStep({
  initialEmail,
  expired = false,
  onBack,
}: {
  initialEmail: string;
  /** Llegó desde un link de recuperación vencido. */
  expired?: boolean;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = emailError(email);
    setFieldError(invalid);
    setError(null);
    if (invalid) return;
    startTransition(async () => {
      const r = await requestGuestPasswordReset(email.trim());
      if (r.ok) setSentTo(email.trim());
      else setError(r.error);
    });
  }

  if (sentTo) {
    return (
      <div className="space-y-7">
        <div className="flex size-16 items-center justify-center rounded-b-xl rounded-t-full bg-leaf-200 text-forest-700">
          <MailCheck aria-hidden className="size-7" />
        </div>
        <AuthHeading title="Te mandamos un mail" accent="Con un link para elegir una contraseña nueva." />
        <div role="status" className="space-y-3 text-[1rem] leading-relaxed text-ink-700">
          <p>
            Si <strong className="break-all font-semibold text-ink-900">{sentTo}</strong> tiene una cuenta, en
            unos minutos te llega el link.
          </p>
          <p className="text-ink-500">
            Abrilo desde este mismo navegador. Si no lo ves, mirá en spam o en promociones.
          </p>
        </div>
        <ApartButton type="button" variant="secondary" size="lg" className="w-full" onClick={onBack}>
          Volver a ingresar
        </ApartButton>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-7">
      <AuthHeading title="Recuperá tu contraseña" accent="Te mandamos un link para elegir una nueva." />
      {expired && !error ? <FormAlert>El link venció o ya se usó. Pedí uno nuevo.</FormAlert> : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field label="Email" error={fieldError}>
        {({ id, describedBy, invalid }) => (
          <EmailInput
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            autoComplete="email"
            autoFocus
            required
            placeholder="tu@email.com"
            value={email}
            onValueChange={setEmail}
            disabled={pending}
          />
        )}
      </Field>
      <SubmitButton pending={pending}>Mandame el link</SubmitButton>
      <button type="button" onClick={onBack} className={`${linkClass} inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem]`}>
        <ArrowLeft aria-hidden className="size-4" />
        Volver a ingresar
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Aviso: para reservar no hace falta cuenta                           */
/* ------------------------------------------------------------------ */

export function NoAccountNeeded({ className }: { className?: string }) {
  return (
    <aside className={`flex gap-3.5 rounded-3xl bg-leaf-100 px-5 py-4 ring-1 ring-leaf-300 ${className ?? ""}`}>
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-forest-700">
        <CalendarHeart aria-hidden className="size-[1.125rem]" />
      </span>
      <div className="space-y-1.5 text-[0.9375rem] leading-snug text-forest-800">
        <p>
          <strong className="font-bold">¿Querés reservar?</strong> No hace falta cuenta: pedís tus fechas y te
          confirmamos.{" "}
          <Link href="/buscar" className={linkClass}>
            Ver alojamientos
          </Link>
        </p>
        <p>
          <strong className="font-bold">¿Pediste sin cuenta?</strong> Seguís tu pedido desde el link que te
          mandamos por mail.
        </p>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Ingresar                                                            */
/* ------------------------------------------------------------------ */

type SignInStep = "signin" | "forgot" | "check_email";

export function GuestSignInForm({
  redirectTo = DEFAULT_AFTER_LOGIN,
  redirectParam = null,
  linkError = false,
  confirmed = false,
  startInRecovery = false,
}: {
  /** Destino después de ingresar (ya validado en el server). */
  redirectTo?: string;
  /** `?redirect` original validado, para conservarlo en los links. */
  redirectParam?: string | null;
  /** `?error=auth`: el link del mail venció o ya se usó. */
  linkError?: boolean;
  /** `?confirmado=1`: el email quedó confirmado (link abierto en otro navegador). */
  confirmed?: boolean;
  /** `?recuperar=1`: abrir directo "Olvidé mi contraseña". */
  startInRecovery?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<SignInStep>(startInRecovery ? "forgot" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [showLinkError, setShowLinkError] = useState(linkError);
  const [resent, setResent] = useState(true);

  if (step === "forgot") {
    return (
      <ForgotPasswordStep
        initialEmail={email}
        expired={showLinkError}
        onBack={() => {
          setShowLinkError(false);
          setStep("signin");
        }}
      />
    );
  }
  if (step === "check_email") {
    return (
      <CheckEmailPanel
        email={email.trim().toLowerCase()}
        redirectTo={redirectTo}
        intro={
          resent
            ? "Todavía no confirmaste tu email. Te reenviamos el link a"
            : "Todavía no confirmaste tu email. Buscá el link que te mandamos a"
        }
        primaryAction={{ label: "Ya confirmé, ingresar", onClick: () => setStep("signin") }}
        onBack={() => setStep("signin")}
        backLabel="Volver"
      />
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = {
      email: emailError(email),
      password: password ? null : "Escribí tu contraseña.",
    };
    setFieldErrors(next);
    setError(null);
    if (next.email || next.password) return;
    startTransition(async () => {
      const r = await signInGuest({ email: email.trim(), password, redirect: redirectTo });
      if (r.ok) {
        notifyAuthChanged();
        router.replace(redirectTo);
        router.refresh();
        return;
      }
      if (r.code === "email_not_confirmed") {
        setShowLinkError(false);
        setResent(r.resent !== false);
        setStep("check_email");
        return;
      }
      setError({ text: r.error, code: r.code });
    });
  }

  const credentialsWrong = error?.code === "invalid_credentials";

  return (
    <div className="space-y-7">
      <AuthHeading title="Hola de nuevo" accent="Entrá para ver tus reservas y favoritos." />

      {confirmed ? (
        <FormAlert tone="ok" title="Tu email quedó confirmado.">
          Ingresá con tu contraseña para seguir.
        </FormAlert>
      ) : null}
      {showLinkError ? <FormAlert>El link venció o ya se usó. Pedí uno nuevo.</FormAlert> : null}
      {!confirmed ? <NoAccountNeeded /> : null}

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {error ? <FormAlert>{error.text}</FormAlert> : null}
        <Field label="Email" error={fieldErrors.email}>
          {({ id, describedBy, invalid }) => (
            <EmailInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || credentialsWrong}
              autoComplete="email"
              required
              placeholder="tu@email.com"
              value={email}
              onValueChange={setEmail}
              disabled={pending}
            />
          )}
        </Field>
        <Field label="Contraseña" error={fieldErrors.password}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || credentialsWrong}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          )}
        </Field>
        <div className="-mt-1 flex justify-end">
          <button type="button" onClick={() => setStep("forgot")} className={`${linkClass} min-h-11 text-[0.9375rem]`}>
            Olvidé mi contraseña
          </button>
        </div>
        <SubmitButton pending={pending}>Ingresar</SubmitButton>
      </form>

      <p className="text-center text-[0.9375rem] text-ink-700">
        ¿Primera vez por acá?{" "}
        <Link href={withRedirect("/registrarse", redirectParam)} className={linkClass}>
          Creá tu cuenta
        </Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Crear cuenta                                                        */
/* ------------------------------------------------------------------ */

type SignUpErrors = Partial<Record<"full_name" | "email" | "phone" | "password", string | null>>;

function validateSignUp(v: { fullName: string; email: string; phone: string; password: string }): SignUpErrors {
  const digits = v.phone.replace(/\D+/g, "");
  return {
    full_name: v.fullName.trim().length >= 2 ? null : "Escribí tu nombre y apellido.",
    email: emailError(v.email),
    phone: v.phone.trim() === "" || digits.length >= 8 ? null : "Revisá el WhatsApp: faltan números.",
    password: v.password.length >= 8 ? null : "La contraseña tiene que tener al menos 8 caracteres.",
  };
}

export function GuestSignUpForm({
  redirectTo = DEFAULT_AFTER_LOGIN,
  redirectParam = null,
}: {
  redirectTo?: string;
  redirectParam?: string | null;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<SignUpErrors>({});
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (sentTo) {
    return (
      <CheckEmailPanel
        email={sentTo}
        redirectTo={redirectTo}
        primaryAction={{ label: "Ya confirmé, ingresar", href: withRedirect("/ingresar", redirectParam) }}
        onBack={() => {
          setSentTo(null);
          setPassword("");
        }}
      />
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = validateSignUp({ fullName, email, phone, password });
    setErrors(next);
    setError(null);
    if (Object.values(next).some(Boolean)) return;
    startTransition(async () => {
      const r = await signUpGuest({
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        marketing_consent: marketing,
        redirect: redirectTo,
      });
      if (!r.ok) {
        if (r.code === "invalid_email") setErrors({ email: r.error });
        else if (r.code === "weak_password") setErrors({ password: r.error });
        else setError({ text: r.error, code: r.code });
        return;
      }
      if (r.needsConfirmation) {
        setSentTo(r.email);
        return;
      }
      notifyAuthChanged();
      router.replace(redirectTo);
      router.refresh();
    });
  }

  return (
    <div className="space-y-7">
      <AuthHeading title="Creá tu cuenta" accent="Para seguir tus reservas y guardar tus favoritos." />

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {error ? (
          <FormAlert>
            {error.text}
            {error.code === "already_registered" ? (
              <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Link href={withRedirect("/ingresar", redirectParam)} className={linkClass}>
                  Ingresar
                </Link>
                <Link href={withRedirect("/ingresar", redirectParam, "recuperar=1")} className={linkClass}>
                  Recuperar la contraseña
                </Link>
              </span>
            ) : null}
          </FormAlert>
        ) : null}

        <Field label="Nombre y apellido" error={errors.full_name}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="name"
              autoCapitalize="words"
              required
              maxLength={120}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Email" error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <EmailInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="email"
              required
              placeholder="tu@email.com"
              value={email}
              onValueChange={setEmail}
              disabled={pending}
            />
          )}
        </Field>
        <Field label="WhatsApp" optional hint="Lo usamos para coordinar tu estadía." error={errors.phone}>
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
        <Field label="Contraseña" hint="Mínimo 8 caracteres." error={errors.password}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          )}
        </Field>
        <CheckboxRow checked={marketing} onCheckedChange={setMarketing} disabled={pending}>
          Quiero recibir novedades de apart por mail. <span className="text-ink-500">(opcional)</span>
        </CheckboxRow>

        <SubmitButton pending={pending}>Crear mi cuenta</SubmitButton>

        <p className="text-center text-sm leading-relaxed text-ink-500">
          Al crear tu cuenta aceptás los{" "}
          <Link href="/legal/terminos" className={linkClass}>
            Términos y condiciones
          </Link>{" "}
          y la{" "}
          <Link href="/legal/privacidad" className={linkClass}>
            Política de privacidad
          </Link>
          .
        </p>
      </form>

      <p className="text-center text-[0.9375rem] text-ink-700">
        ¿Ya tenés cuenta?{" "}
        <Link href={withRedirect("/ingresar", redirectParam)} className={linkClass}>
          Ingresá
        </Link>
      </p>
      <p className="text-center text-sm text-ink-500">
        Para reservar no hace falta cuenta: pedís tus fechas y te confirmamos.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nueva contraseña (vuelta del mail de recuperación)                  */
/* ------------------------------------------------------------------ */

export function ResetPasswordForm() {
  const router = useRouter();
  const [session, setSession] = useState<"checking" | "ok" | "missing">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // La sesión la dejó /auth/callback al canjear el link del mail.
  useEffect(() => {
    let alive = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (alive) setSession(data.session ? "ok" : "missing");
      })
      .catch(() => {
        if (alive) setSession("missing");
      });
    return () => {
      alive = false;
    };
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = {
      password: password.length >= 8 ? null : "La contraseña tiene que tener al menos 8 caracteres.",
      confirm: confirm === password ? null : "Las contraseñas no coinciden.",
    };
    setErrors(next);
    setError(null);
    if (next.password || next.confirm) return;
    startTransition(async () => {
      const { error: err } = await createClient().auth.updateUser({ password });
      if (err) {
        if (/session missing/i.test(err.message ?? "")) {
          setSession("missing");
          return;
        }
        const kind = classifyAuthError(err);
        const text = authErrorMessage(err, "update_password");
        if (kind === "weak_password" || kind === "same_password") setErrors({ password: text });
        else setError(text);
        return;
      }
      notifyAuthChanged();
      setDone(true);
      router.refresh();
    });
  }

  if (session === "checking") {
    return (
      <div aria-busy className="space-y-5" aria-label="Cargando">
        <div className="h-10 w-3/4 rounded-2xl bg-cream-200 motion-safe:animate-pulse" />
        <div className="h-6 w-2/3 rounded-xl bg-cream-200 motion-safe:animate-pulse" />
        <div className="h-12 rounded-2xl bg-cream-200 motion-safe:animate-pulse" />
        <div className="h-12 rounded-2xl bg-cream-200 motion-safe:animate-pulse" />
      </div>
    );
  }

  if (session === "missing") {
    return (
      <div className="space-y-7">
        <AuthHeading title="Pedí un link nuevo" accent="Por seguridad, cada link sirve una sola vez." />
        <FormAlert>El link venció o ya se usó. Pedí uno nuevo.</FormAlert>
        <p className="text-[0.9375rem] leading-relaxed text-ink-500">
          Abrí el mail desde el mismo navegador donde lo pediste.
        </p>
        <ApartButton asChild variant="primary" size="lg" className="w-full">
          <Link href="/ingresar?recuperar=1">Pedir otro link</Link>
        </ApartButton>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-7">
        <AuthHeading title="Todo listo" accent="Tu contraseña nueva ya quedó guardada." />
        <FormAlert tone="ok">A partir de ahora ingresá con la contraseña nueva.</FormAlert>
        <ApartButton asChild variant="primary" size="lg" className="w-full">
          <Link href="/mi-cuenta">Ir a mis reservas</Link>
        </ApartButton>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-7">
      <AuthHeading title="Elegí una contraseña nueva" accent="Y listo, volvés a tu cuenta." />
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="space-y-5">
        <Field label="Contraseña nueva" hint="Mínimo 8 caracteres." error={errors.password}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="new-password"
              autoFocus
              required
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          )}
        </Field>
        <Field label="Repetila" error={errors.confirm}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="new-password"
              required
              maxLength={72}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={pending}
            />
          )}
        </Field>
      </div>
      <SubmitButton pending={pending}>Guardar contraseña</SubmitButton>
    </form>
  );
}
