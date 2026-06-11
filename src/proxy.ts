import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getProjectJwks } from "@/lib/supabase/jwks";

/**
 * Único trabajo de este proxy: mantener la sesión de Supabase fresca ANTES de
 * que el request llegue a RSC/actions. En Server Components las cookies
 * refrescadas se descartan (setAll es no-op), así que sin esto un access token
 * vencido se re-refresca en cada request — latencia extra y riesgo de logouts
 * esporádicos por reuso del refresh token rotado.
 *
 * No hace redirects ni gates de auth: eso sigue siendo responsabilidad de los
 * layouts (requireSession / requireGuestSession). Mantenerlo así evita los
 * loops de redirect clásicos de middleware+auth.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() verifica el JWT localmente (ES256 contra el JWKS cacheado a
  // nivel módulo) y solo va a la red para refrescar si el token venció.
  await supabase.auth.getClaims(undefined, { jwks: await getProjectJwks() });

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/m/:path*",
    "/superadmin/:path*",
    "/mi-cuenta/:path*",
    "/checkout/:path*",
  ],
};
