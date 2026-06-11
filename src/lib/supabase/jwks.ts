import type { JWK } from "@supabase/supabase-js";

/**
 * JWKS del proyecto cacheado a nivel módulo. `getClaims()` verifica el JWT
 * localmente (ES256), pero el cache interno de auth-js vive en la instancia
 * del cliente — que en SSR se recrea en cada request. Sin este cache, cada
 * request pagaría un fetch a /auth/v1/.well-known/jwks.json.
 *
 * Si el `kid` del token no está en este JWKS (rotación de claves), auth-js
 * re-fetchea del endpoint por su cuenta — acá solo optimizamos el caso feliz.
 */
const JWKS_TTL_MS = 10 * 60 * 1000;

let cached: { jwks: { keys: JWK[] }; fetchedAt: number } | null = null;
let inflight: Promise<{ keys: JWK[] } | undefined> | null = null;

export async function getProjectJwks(): Promise<{ keys: JWK[] } | undefined> {
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.jwks;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
        { cache: "no-store" }
      );
      if (!res.ok) return cached?.jwks;
      const jwks = (await res.json()) as { keys: JWK[] };
      if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) return cached?.jwks;
      cached = { jwks, fetchedAt: Date.now() };
      return jwks;
    } catch {
      // Stale-while-error: mejor un JWKS viejo que dejar a getClaims sin keys
      // (igual re-fetchea solo si lo necesita).
      return cached?.jwks;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
