import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_AFTER_LOGIN, safeRedirectPath } from "@/components/marketplace/shell/safe-redirect";

/**
 * Callback de Supabase Auth para la web (confirmación de cuenta y recuperación
 * de contraseña). Canjea el `code` (PKCE) por una sesión y sigue a `next`
 * (sólo rutas internas).
 *
 * NO se acepta `token_hash`: un link con token_hash crea la sesión en
 * cualquier navegador que lo abra, así que alguien podría hacer entrar a otra
 * persona a SU cuenta ("login CSRF") y ver lo que pida. El `code` de PKCE sólo
 * sirve en el navegador que inició el flujo.
 *
 * `flow` lo agrega `guest-auth.ts` al armar el link:
 * - signup:   si el canje falla con un `code` en la mano, el email YA quedó
 *             confirmado (Supabase sólo manda `code` después de verificar): lo
 *             que falta es el code_verifier, que vive en el navegador donde se
 *             creó la cuenta. Pasa siempre que el mail se abre en el celular.
 *             → /ingresar?confirmado=1 ("Tu email quedó confirmado. Ingresá.")
 * - recovery: sin sesión no hay cómo cambiar la contraseña → pedir otro link.
 *
 * Los redirects son al mismo origen del request: ahí quedaron las cookies.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const otpType = params.get("type");
  const flow = params.get("flow") === "recovery" || otpType === "recovery" ? "recovery" : "signup";
  const next = safeRedirectPath(
    params.get("next"),
    flow === "recovery" ? "/reset-password" : DEFAULT_AFTER_LOGIN,
  );
  const go = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const expired = () => go(flow === "recovery" ? "/ingresar?error=auth&recuperar=1" : "/ingresar?error=auth");

  // Link vencido o ya usado: Supabase vuelve con ?error=…&error_code=otp_expired.
  if (params.get("error") || params.get("error_code")) return expired();

  const supabase = await createClient();

  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return go(next);
    if (flow === "signup") {
      const back = next === DEFAULT_AFTER_LOGIN ? "" : `&redirect=${encodeURIComponent(next)}`;
      return go(`/ingresar?confirmado=1${back}`);
    }
    return expired();
  }

  return expired();
}
