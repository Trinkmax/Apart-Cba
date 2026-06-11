"use server";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getProjectJwks } from "@/lib/supabase/jwks";
import type {
  Notification,
  UserProfile,
  OrganizationMember,
  Organization,
} from "@/lib/types/database";

export type SessionContext = {
  userId: string;
  email: string | null;
  profile: UserProfile;
  memberships: (OrganizationMember & { organization: Organization })[];
};

/**
 * Contexto completo de sesión: lo que el shell del dashboard necesita para
 * pintar sin queries adicionales. `currentOrgId` ya viene resuelto por la DB
 * (cookie válida → esa org; si no → primera membresía activa por joined_at).
 */
export type FullSessionContext = SessionContext & {
  currentOrgId: string | null;
  notifications: Notification[];
  unreadCount: number;
};

// Mantener en sync con ORG_COOKIE de org.ts.
const ORG_COOKIE = "apartcba_org";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionContextRpc = {
  profile: UserProfile | null;
  memberships: (OrganizationMember & { organization: Organization })[] | null;
  current_org_id: string | null;
  notifications: Notification[] | null;
  unread_count: number | null;
};

/**
 * Devuelve la sesión actual del usuario logueado, o null.
 * - getClaims() valida el JWT localmente (firma ES256 contra el JWKS cacheado
 *   a nivel módulo): cero round trips a GoTrue salvo refresh de token vencido
 *   (que normalmente ya hizo el proxy). El gate de autorización real sigue
 *   siendo la membresía activa, consultada en cada request.
 * - Un único RPC (get_session_context) trae profile + membresías + org activa
 *   + notificaciones en un solo round trip (antes: 5 llamadas en 3 olas).
 * Cacheado por request via React.cache para deduplicar llamadas.
 */
const sessionContextLoader = cache(async (): Promise<FullSessionContext | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims(undefined, {
    jwks: await getProjectJwks(),
  });
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const cookieStore = await cookies();
  const rawOrgId = cookieStore.get(ORG_COOKIE)?.value;
  const cookieOrgId = rawOrgId && UUID_RE.test(rawOrgId) ? rawOrgId : null;

  const admin = createAdminClient();
  const { data: ctx, error } = await admin.rpc("get_session_context", {
    p_user_id: claims.sub,
    p_org_id: cookieOrgId,
  });
  if (error) {
    // Falla transitoria de DB: tratar como deslogueado (igual que antes,
    // cuando un profile inalcanzable devolvía sesión null).
    console.error("get_session_context falló:", error.message);
    return null;
  }

  const parsed = ctx as SessionContextRpc | null;
  if (!parsed?.profile) return null;

  return {
    userId: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    profile: parsed.profile,
    memberships: parsed.memberships ?? [],
    currentOrgId: parsed.current_org_id,
    notifications: parsed.notifications ?? [],
    unreadCount: parsed.unread_count ?? 0,
  };
});

export async function getSession(): Promise<SessionContext | null> {
  return sessionContextLoader();
}

/**
 * Contexto completo (incluye org activa resuelta + notificaciones) para el
 * shell del dashboard. Mismo costo que getSession(): es el mismo loader.
 */
export async function getSessionContext(): Promise<FullSessionContext | null> {
  return sessionContextLoader();
}

/**
 * Helper enforced: redirige a /login si no hay sesión.
 */
export async function requireSession(): Promise<SessionContext> {
  const session = await sessionContextLoader();
  if (!session) redirect("/login");
  return session;
}

export async function signIn(
  email: string,
  password: string
): Promise<{ error?: string; requiresMfa?: { factorId: string } }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  const session = await getSession();
  if (!session) {
    await supabase.auth.signOut();
    return { error: "Esta cuenta no está habilitada para rentOS." };
  }

  // Spec 2: si el user tiene factor TOTP verificado, desviar a /login/2fa
  // antes de revalidar / redirigir al dashboard.
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const totpFactor = factorsData?.totp?.[0];
  if (totpFactor && totpFactor.status === "verified") {
    return { requiresMfa: { factorId: totpFactor.id } };
  }

  revalidatePath("/", "layout");
  return {};
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
