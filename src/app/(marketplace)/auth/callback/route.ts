import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Callback de Supabase Auth para el marketplace (recovery de contraseña, y
 * cualquier flujo PKCE). Intercambia el `code` por una sesión (usando el
 * code_verifier guardado en cookie server-side) y redirige a `next`.
 *
 * Sólo permite `next` relativo interno para evitar open-redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/mi-cuenta";
  const safeNext =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/mi-cuenta";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/ingresar?error=auth`);
}
