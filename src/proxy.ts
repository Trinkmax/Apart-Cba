import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getProjectJwks } from "@/lib/supabase/jwks";
import {
  DEADLINE,
  createSupabaseTimeoutPicker,
  fetchWithTimeout,
  withDeadline,
} from "@/lib/supabase/fetch-with-timeout";

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
 *
 * Fail-open ante Supabase caído (incidente 2026-08-29: /auth/v1/token con
 * promedios de 23-36 s, el proxy colgaba y 500eaba todo el dashboard): acá
 * sólo intentamos refrescar; si no se puede en el plazo, dejamos pasar el
 * request con las cookies que ya trae. Los layouts siguen siendo el gate: con
 * Supabase caído su getClaims/getUser devuelve error → null → redirect a
 * /login o /ingresar en segundos, sin perder la cookie (el error es
 * retryable y auth-js no borra la sesión), así que al recuperarse el usuario
 * entra sin reloguear.
 */

/** Timeout de cada request a /auth/v1 desde el proxy (sano: 300-700 ms). */
const PROXY_AUTH_TIMEOUT_MS = 3_000;

/**
 * Plazo total de la invocación. Hace falta además del timeout por request:
 * con el access token vencido, auth-js reintenta el refresh con backoff
 * durante ~30 s ante errores retryable (que es lo que produce un abort), y
 * un solo timeout no acota eso.
 */
const PROXY_DEADLINE_MS = 5_000;

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Señal de invocación: al vencer el deadline se aborta, y cualquier
  // reintento posterior de auth-js falla al instante sin abrir sockets.
  const invocation = new AbortController();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: fetchWithTimeout(
          createSupabaseTimeoutPicker({ auth: PROXY_AUTH_TIMEOUT_MS }),
          { signal: invocation.signal }
        ),
      },
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

  try {
    // getClaims() verifica el JWT localmente (ES256 contra el JWKS cacheado a
    // nivel módulo) y solo va a la red para refrescar si el token venció.
    // Con token vigente no hay red; el deadline cubre el JWKS + el refresh.
    const outcome = await withDeadline(
      (async () =>
        supabase.auth.getClaims(undefined, { jwks: await getProjectJwks() }))(),
      PROXY_DEADLINE_MS
    );
    if (outcome === DEADLINE) {
      invocation.abort();
      // Una sola línea: Observability Events ya es el rubro más caro.
      console.warn(
        `[proxy] Supabase no respondió en ${PROXY_DEADLINE_MS} ms, sigo sin refrescar sesión: ${request.nextUrl.pathname}`
      );
    }
  } catch (err) {
    // getClaims devuelve { error } para todo lo que es AuthError; acá sólo
    // caen errores no-Auth (bug, red rara). Cinturón: nunca colgar ni 500ear.
    invocation.abort();
    console.warn(
      `[proxy] getClaims falló, sigo sin refrescar sesión (${request.nextUrl.pathname}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

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
