"use server";

import { cache } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import {
  createClient,
  createAdminClient,
  createAuthAdminClient,
} from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/app-url";
import { authErrorMessage, classifyAuthError, type AuthErrorKind } from "@/components/marketplace/shell/auth-errors";
import { DEFAULT_AFTER_LOGIN, safeRedirectPath } from "@/components/marketplace/shell/safe-redirect";
import type { GuestProfile } from "@/lib/types/database";

/** IP real del cliente (Vercel la inyecta en x-forwarded-for). */
async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

/**
 * Rate limit best-effort. FAIL-OPEN: ante cualquier error del limiter, permite
 * el intento (nunca bloquea a un huésped legítimo por un bug del limiter).
 * Devuelve true si el intento está permitido.
 */
async function allowAuthAttempt(
  bucket: string,
  max: number,
  windowSecs: number
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hit_auth_rate_limit", {
      p_bucket: bucket,
      p_max: max,
      p_window_secs: windowSecs,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

const RATE_LIMITED_MSG =
  "Hubo demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.";

/**
 * Link del mail de confirmación / recuperación: pasa por /auth/callback (que
 * canjea el code por la sesión) y sigue a `next`. Usa la URL pública limpia
 * (getAppUrl), nunca el origin del request. REQUIERE que
 * `<app>/auth/callback` esté en la allowlist de Redirect URLs de Supabase Auth.
 */
function authCallbackUrl(next: string, flow: "signup" | "recovery"): string {
  // `flow` le dice al callback qué hacer si el canje falla: un link de
  // confirmación abierto en otro navegador no trae el code_verifier, pero el
  // email YA quedó confirmado (Supabase sólo manda `code` después de verificar).
  return absoluteUrl(`/auth/callback?next=${encodeURIComponent(next)}&flow=${flow}`);
}

export type GuestSession = {
  userId: string;
  email: string;
  profile: GuestProfile;
};

const emailField = z
  .string({ message: "Escribí tu email." })
  .trim()
  .min(1, "Escribí tu email.")
  .max(254, "Ese email es demasiado largo.")
  .email("Revisá el email: parece que tiene un error.");

const signUpSchema = z.object({
  email: emailField,
  password: z
    .string({ message: "Elegí una contraseña." })
    .min(8, "La contraseña tiene que tener al menos 8 caracteres.")
    .max(72, "La contraseña puede tener hasta 72 caracteres."),
  full_name: z
    .string({ message: "Escribí tu nombre." })
    .trim()
    .min(2, "Escribí tu nombre y apellido.")
    .max(120, "El nombre es demasiado largo."),
  phone: z
    .string()
    .trim()
    .max(30, "Revisá el WhatsApp: es demasiado largo.")
    .refine((v) => v === "" || v.replace(/\D+/g, "").length >= 8, "Revisá el WhatsApp: faltan números.")
    .optional()
    .or(z.literal("")),
  marketing_consent: z.boolean().default(false),
  /** A dónde volver después de confirmar el email (ruta interna). */
  redirect: z.string().max(512).optional().nullable(),
});

const signInSchema = z.object({
  email: emailField,
  password: z.string({ message: "Escribí tu contraseña." }).min(1, "Escribí tu contraseña."),
});

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label}: es demasiado largo.`).optional().nullable();

const updateProfileSchema = z.object({
  full_name: z
    .string({ message: "Escribí tu nombre." })
    .trim()
    .min(2, "Escribí tu nombre y apellido.")
    .max(120, "El nombre es demasiado largo."),
  phone: optionalText(30, "WhatsApp").refine(
    (v) => !v || v.replace(/\D+/g, "").length >= 8,
    "Revisá el WhatsApp: faltan números.",
  ),
  document_type: optionalText(20, "Tipo de documento"),
  document_number: optionalText(40, "Documento"),
  country: optionalText(80, "País"),
  city: optionalText(120, "Ciudad"),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Revisá la fecha de nacimiento.")
    .optional()
    .nullable()
    .or(z.literal("")),
  marketing_consent: z.boolean().optional(),
});

const guestSessionLoader = cache(async (): Promise<GuestSession | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;
  // Fail-closed ante email sin verificar: si el proyecto tiene "Confirm email"
  // activo, un signup con el email de otra persona no queda logueado hasta
  // confirmar. (Con confirmación desactivada, Supabase autoconfirma y esto pasa.)
  if (!user.email_confirmed_at) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("guest_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return null;
  return {
    userId: user.id,
    email: user.email,
    profile: profile as GuestProfile,
  };
});

export async function getGuestSession(): Promise<GuestSession | null> {
  return guestSessionLoader();
}

/**
 * Exige sesión de huésped. Sin sesión redirige a `/ingresar?redirect=<returnTo>`
 * para volver a la misma pantalla después de ingresar (`returnTo` se valida:
 * sólo rutas internas).
 */
export async function requireGuestSession(returnTo?: string): Promise<GuestSession> {
  const session = await guestSessionLoader();
  if (!session) {
    const back = returnTo ? safeRedirectPath(returnTo, "") : "";
    redirect(back ? `/ingresar?redirect=${encodeURIComponent(back)}` : "/ingresar");
  }
  return session;
}

export type SignUpResult =
  | { ok: true; needsConfirmation: boolean; email: string }
  | { ok: false; error: string; code?: AuthErrorKind };

/** Supabase devolvió un user recién creado (y no uno existente reenviado). */
function isFreshUser(createdAt: string | undefined): boolean {
  if (!createdAt) return false;
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) && Date.now() - ms < 2 * 60 * 1000;
}

export async function signUpGuest(input: z.input<typeof signUpSchema>): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }
  const email = parsed.data.email.toLowerCase();
  const next = safeRedirectPath(parsed.data.redirect, DEFAULT_AFTER_LOGIN);

  const ip = await clientIp();
  if (!(await allowAuthAttempt(`signup:${ip}`, 8, 3600))) {
    return { ok: false, error: RATE_LIMITED_MSG, code: "rate_limited" };
  }

  const supabase = await createClient();
  const phone = parsed.data.phone?.trim() || null;

  // 1) Crear usuario en auth.users. Con "Confirm email" activo Supabase NO
  // devuelve sesión: la persona tiene que tocar el link del mail, que vuelve
  // por /auth/callback a `next`.
  const { data, error } = await supabase.auth.signUp({
    email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: authCallbackUrl(next, "signup"),
      data: {
        full_name: parsed.data.full_name,
        is_marketplace_guest: true,
      },
    },
  });
  if (error) {
    const kind = classifyAuthError(error);
    if (kind === "unknown") console.error("[guest-auth] signUp", error.message);
    return { ok: false, error: authErrorMessage(error, "signup"), code: kind };
  }
  if (!data.user) {
    return { ok: false, error: authErrorMessage(null, "signup") };
  }

  // Supabase devuelve un user "ofuscado" con identities vacío cuando el email
  // ya existe y está confirmado (anti-enumeración). Sin este chequeo
  // intentaríamos crear un perfil para un user_id que no existe.
  if (!data.user.identities || data.user.identities.length === 0) {
    return {
      ok: false,
      error: authErrorMessage({ code: "user_already_exists" }, "signup"),
      code: "already_registered",
    };
  }

  // 2) Perfil de huésped (service role). Si la persona ya se había registrado
  // sin confirmar, el perfil existe: no es un error.
  const admin = createAdminClient();
  const { error: profileErr } = await admin.from("guest_profiles").upsert(
    {
      user_id: data.user.id,
      full_name: parsed.data.full_name,
      phone,
      marketing_consent: parsed.data.marketing_consent ?? false,
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );

  if (profileErr) {
    console.error("[guest-auth] guest_profiles insert", profileErr.message);
    // Limpieza best-effort, sólo si el usuario de auth lo acabamos de crear.
    if (isFreshUser(data.user.created_at)) {
      try {
        const authAdmin = createAuthAdminClient();
        await authAdmin.auth.admin.deleteUser(data.user.id);
      } catch {
        // ignore
      }
    }
    return { ok: false, error: authErrorMessage(null, "signup") };
  }

  return { ok: true, needsConfirmation: !data.session, email };
}

/** Reenvío del mail de confirmación, con rate limit propio (por IP+email y por IP). */
async function resendConfirmationFor(
  email: string,
  ip: string,
  redirectTo: string | null | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed =
    (await allowAuthAttempt(`resend:${ip}:${email}`, 3, 900)) &&
    (await allowAuthAttempt(`resend:ip:${ip}`, 10, 3600));
  if (!allowed) return { ok: false, error: RATE_LIMITED_MSG };
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: authCallbackUrl(safeRedirectPath(redirectTo, DEFAULT_AFTER_LOGIN), "signup") },
  });
  if (error) {
    if (classifyAuthError(error) === "unknown") console.error("[guest-auth] resend", error.message);
    return { ok: false, error: authErrorMessage(error, "resend") };
  }
  return { ok: true };
}

/**
 * "Reenviar" el mail de confirmación de la cuenta. No revela si el email
 * existe (Supabase responde igual en los dos casos).
 */
export async function resendGuestConfirmation(
  email: string,
  redirectTo?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = emailField.safeParse(email);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá el email." };
  }
  const ip = await clientIp();
  return resendConfirmationFor(parsed.data.toLowerCase(), ip, redirectTo);
}

export type SignInResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code?: AuthErrorKind;
      email?: string;
      /** Sólo con email_not_confirmed: si pudimos reenviar el link recién. */
      resent?: boolean;
    };

export async function signInGuest(input: {
  email: string;
  password: string;
  /** A dónde volver si hay que reenviar la confirmación. */
  redirect?: string | null;
}): Promise<SignInResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }
  const email = parsed.data.email.toLowerCase();

  const ip = await clientIp();
  if (!(await allowAuthAttempt(`login:${ip}:${email}`, 10, 300))) {
    return { ok: false, error: RATE_LIMITED_MSG, code: "rate_limited" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  if (error) {
    const kind = classifyAuthError(error);
    if (kind === "email_not_confirmed") {
      // Cuenta creada pero sin confirmar: le reenviamos el link y la pantalla
      // ofrece "Reenviar" por si no le llega.
      const resent = await resendConfirmationFor(email, ip, input.redirect);
      return {
        ok: false,
        code: kind,
        email,
        resent: resent.ok,
        error: resent.ok
          ? authErrorMessage(error, "signin")
          : "Todavía no confirmaste tu email. Buscá el mail que te mandamos (mirá también en spam) o pedí otro en unos minutos.",
      };
    }
    if (kind === "unknown") console.error("[guest-auth] signIn", error.status, error.message);
    return { ok: false, code: kind, error: authErrorMessage(error, "signin") };
  }
  if (!data.user) {
    return { ok: false, error: authErrorMessage(null, "signin") };
  }

  // Si el usuario ya existe en auth pero no tiene guest_profile, lo creamos
  // al vuelo (caso: staff PMS que también quiere usar la web).
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("guest_profiles")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!existing) {
    const fullName =
      (data.user.user_metadata?.full_name as string | undefined) ??
      data.user.email?.split("@")[0] ??
      "Huésped";
    await admin.from("guest_profiles").insert({
      user_id: data.user.id,
      full_name: fullName,
    });
  }

  // El layout de la web ya no depende de la sesión (el header la resuelve en
  // el navegador): no hace falta revalidar nada público.
  revalidatePath("/mi-cuenta");
  return { ok: true };
}

/**
 * Salir (server). El header de la web sale desde el navegador
 * (`useGuestSignOut`); esto queda para formularios server-side.
 */
export async function signOutGuest(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}

export type ProfileField =
  | "full_name"
  | "phone"
  | "document_type"
  | "document_number"
  | "country"
  | "city"
  | "birth_date";

export async function updateGuestProfile(
  input: z.input<typeof updateProfileSchema>
): Promise<{ ok: true } | { ok: false; error: string; field?: ProfileField }> {
  const session = await requireGuestSession("/mi-cuenta/perfil");
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Revisá los datos.",
      field: (issue?.path[0] as ProfileField | undefined) ?? undefined,
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("guest_profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      document_type: parsed.data.document_type || null,
      document_number: parsed.data.document_number || null,
      country: parsed.data.country || null,
      city: parsed.data.city || null,
      birth_date: parsed.data.birth_date || null,
      marketing_consent: parsed.data.marketing_consent,
    })
    .eq("user_id", session.userId);

  if (error) {
    console.error("[guest-auth] updateGuestProfile", error.message);
    return { ok: false, error: "No pudimos guardar tus datos. Probá de nuevo en unos minutos." };
  }
  revalidatePath("/mi-cuenta");
  revalidatePath("/mi-cuenta/perfil");
  return { ok: true };
}

/**
 * "Olvidé mi contraseña": manda el mail de recuperación. El link pasa por
 * /auth/callback (canjea el code por sesión) y sigue a /reset-password. No
 * revela si el email tiene cuenta.
 */
export async function requestGuestPasswordReset(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = emailField.safeParse(email);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá el email." };
  }
  const normalized = parsed.data.toLowerCase();
  const ip = await clientIp();
  if (!(await allowAuthAttempt(`reset:${ip}:${normalized}`, 5, 3600))) {
    return { ok: false, error: RATE_LIMITED_MSG };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
    redirectTo: authCallbackUrl("/reset-password", "recovery"),
  });
  if (error) {
    if (classifyAuthError(error) === "unknown") console.error("[guest-auth] resetPassword", error.message);
    return { ok: false, error: authErrorMessage(error, "reset") };
  }
  return { ok: true };
}
