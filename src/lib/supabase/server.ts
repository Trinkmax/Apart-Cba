import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout, pickSupabaseTimeout } from "./fetch-with-timeout";

/**
 * fetch con timeout por request, compartido por los tres factories. Sin esto
 * una degradación de Supabase (incidente 2026-08-29) deja a cada función de
 * Vercel colgada hasta su maxDuration en vez de fallar en segundos. Tiers:
 * auth 8 s, rest/rpc 10 s, storage 15 s (60 s para uploads) — ver
 * fetch-with-timeout.ts. El controller/timer se crea por llamada, así que es
 * seguro capturarlo en el cliente memoizado por React.cache.
 *
 * Al vencer, supabase-js NO lanza: from()/rpc() devuelven `{ error }` con
 * status 0, storage `StorageUnknownError`, auth `AuthRetryableFetchError`
 * (no borra la sesión). Los call sites que ya tratan `error` como fallo no
 * necesitan cambios.
 */
const supabaseFetch = fetchWithTimeout(pickSupabaseTimeout);

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "apartcba" },
      global: { fetch: supabaseFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component context — no-op
          }
        },
      },
    }
  );
}

export const createAdminClient = cache(() =>
  createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: "apartcba" },
      global: { fetch: supabaseFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
);

/**
 * Cliente admin que apunta al schema 'public'/'auth' (para operaciones que
 * cruzan schemas, ej. invitar usuarios via Supabase Auth Admin API).
 */
export function createAuthAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: { fetch: supabaseFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
