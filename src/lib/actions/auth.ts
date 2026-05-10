"use server";

import { cache } from "react";
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

const sessionLoader = cache(async (): Promise<SessionContext | null> => {
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
});

export async function getSession(): Promise<SessionContext | null> {
  return sessionLoader();
}

export async function requireSession(): Promise<SessionContext> {
  const session = await sessionLoader();
  if (!session) redirect("/login");
  return session;
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // Verificar que el user tenga perfil en Apart Cba
  const session = await getSession();
  if (!session) {
    await supabase.auth.signOut();
    return { error: "Esta cuenta no está habilitada para Apart Cba." };
  }

  revalidatePath("/", "layout");
  return {};
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
