"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserProfile, OrganizationMember, Organization } from "@/lib/types/database";

export type SessionContext = {
  userId: string;
  email: string | null;
  profile: UserProfile;
  memberships: (OrganizationMember & { organization: Organization })[];
};

/**
 * Devuelve la sesión actual del usuario logueado, o null.
 * Hace una sola query JOIN para evitar N+1.
 */
export async function getSession(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    admin.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    admin
      .from("organization_members")
      .select("*, organization:organizations(*)")
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

  if (!profile) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: profile as UserProfile,
    memberships: (memberships ?? []) as never,
  };
}

/**
 * Helper: enforced. Redirige a /login si no hay sesión.
 */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
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
    return { error: "Esta cuenta no está habilitada para Apart Cba." };
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
