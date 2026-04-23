"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createAuthAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { OrganizationMember, UserRole, UserProfile } from "@/lib/types/database";

const inviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2),
  role: z.enum(["admin", "recepcion", "mantenimiento", "limpieza", "owner_view"]),
  phone: z.string().optional().nullable(),
});

export type InviteInput = z.infer<typeof inviteSchema>;

export async function listTeamMembers(): Promise<(OrganizationMember & { profile: UserProfile | null; email: string | null })[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("organization_members")
    .select("*")
    .eq("organization_id", organization.id)
    .order("active", { ascending: false })
    .order("joined_at");

  if (!members || members.length === 0) return [];
  const userIds = members.map((m) => m.user_id);

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("*")
    .in("user_id", userIds);

  // Get emails from auth.users via admin
  const authAdmin = createAuthAdminClient();
  const emailsByUser = new Map<string, string>();
  for (const m of members) {
    try {
      const { data } = await authAdmin.auth.admin.getUserById(m.user_id);
      if (data?.user?.email) emailsByUser.set(m.user_id, data.user.email);
    } catch {
      // ignore
    }
  }

  return members.map((m) => ({
    ...m,
    profile: profiles?.find((p) => p.user_id === m.user_id) ?? null,
    email: emailsByUser.get(m.user_id) ?? null,
  })) as never;
}

export async function inviteTeamMember(input: InviteInput): Promise<{ userId: string; tempPassword: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin" && !session.profile.is_superadmin) {
    throw new Error("Solo los admins pueden invitar usuarios");
  }
  const validated = inviteSchema.parse(input);
  const authAdmin = createAuthAdminClient();
  const admin = createAdminClient();

  // Check si el user existe en auth.users
  let userId: string;
  let tempPassword = "";

  // Buscar por email
  const { data: existingUsers } = await authAdmin.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === validated.email);

  if (existing) {
    userId = existing.id;
  } else {
    // Crear nuevo
    tempPassword = `Apart${Math.random().toString(36).slice(-8)}!`;
    const { data: created, error } = await authAdmin.auth.admin.createUser({
      email: validated.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: validated.full_name },
    });
    if (error) throw new Error(error.message);
    if (!created.user) throw new Error("No se pudo crear el usuario");
    userId = created.user.id;
  }

  // Asegurar perfil
  await admin
    .from("user_profiles")
    .upsert({
      user_id: userId,
      full_name: validated.full_name,
      phone: validated.phone,
      active: true,
    }, { onConflict: "user_id" });

  // Membership
  const { error: memErr } = await admin
    .from("organization_members")
    .upsert({
      organization_id: organization.id,
      user_id: userId,
      role: validated.role,
      invited_by: session.userId,
      invited_at: new Date().toISOString(),
      active: true,
    }, { onConflict: "organization_id,user_id" });

  if (memErr) throw new Error(memErr.message);

  revalidatePath("/dashboard/configuracion/equipo");
  return { userId, tempPassword };
}

export async function changeMemberRole(userId: string, newRole: UserRole) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin" && !session.profile.is_superadmin) {
    throw new Error("Solo los admins pueden cambiar roles");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_members")
    .update({ role: newRole })
    .eq("organization_id", organization.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/configuracion/equipo");
}

export async function deactivateMember(userId: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin" && !session.profile.is_superadmin) {
    throw new Error("Solo los admins pueden desactivar usuarios");
  }
  if (userId === session.userId) {
    throw new Error("No podés desactivarte a vos mismo");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_members")
    .update({ active: false })
    .eq("organization_id", organization.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/configuracion/equipo");
}
