"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createAuthAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { isAdminLevel } from "@/lib/permissions";
import type { OrganizationMember, UserRole, UserProfile } from "@/lib/types/database";

const inviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2),
  role: z.enum(["admin", "recepcion", "mantenimiento", "limpieza", "owner_view"]),
  phone: z.string().optional().nullable(),
});

export type InviteInput = z.infer<typeof inviteSchema>;

// Perfil personal de un miembro del equipo (lo cargan los admins desde /equipo).
const memberProfileSchema = z.object({
  full_name: z.string().min(2, "Nombre muy corto").max(120),
  phone: z.string().max(40).nullish(),
  job_title: z.string().max(80).nullish(),
  dni_number: z.string().max(30).nullish(),
  cuit_cuil: z.string().max(20).nullish(),
  address: z.string().max(200).nullish(),
  birth_date: z.string().nullish(),
  emergency_contact_name: z.string().max(120).nullish(),
  emergency_contact_phone: z.string().max(40).nullish(),
  notes: z.string().max(2000).nullish(),
});

export type MemberProfileInput = z.infer<typeof memberProfileSchema>;

/** "" | "   " | null | undefined → null; caso contrario, el valor trimeado. */
function emptyToNull(v?: string | null): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

export async function listTeamMembers(): Promise<(OrganizationMember & { profile: UserProfile | null; email: string | null })[]> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  // Defensa en profundidad: los perfiles traen PII del staff (DNI, CUIT,
  // domicilio, contacto de emergencia…) → solo admin/recepción o superadmin.
  if (!isAdminLevel(role) && !session.profile.is_superadmin) {
    throw new Error("Solo los administradores pueden ver los perfiles del equipo");
  }
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

  // Get emails from auth.users via admin (1 listUsers paginado en vez de N getUserById)
  const authAdmin = createAuthAdminClient();
  const emailsByUser = new Map<string, string>();
  try {
    const perPage = 1000;
    let page = 1;
    // Seguir pidiendo páginas hasta que una vuelva con menos de perPage usuarios
    for (;;) {
      const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const users = data?.users ?? [];
      for (const u of users) {
        if (u.email) emailsByUser.set(u.id, u.email);
      }
      if (users.length < perPage) break;
      page += 1;
    }
  } catch {
    // ignore
  }

  return members.map((m) => ({
    ...m,
    profile: profiles?.find((p) => p.user_id === m.user_id) ?? null,
    email: emailsByUser.get(m.user_id) ?? null,
  })) as never;
}

/**
 * Versión liviana de {@link listTeamMembers}: sólo user_id + nombre + rol, en
 * una sola query (sin el loop a auth.users por email). Sirve para resolver
 * "abierto por / técnico asignado" y para el selector de asignado en tickets.
 */
export async function listOrgMemberNames(): Promise<
  { user_id: string; full_name: string | null; role: UserRole }[]
> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", organization.id)
    .eq("active", true);
  if (!members || members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in("user_id", userIds);
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, (p.full_name as string | null) ?? null])
  );

  return members.map((m) => ({
    user_id: m.user_id as string,
    full_name: nameById.get(m.user_id as string) ?? null,
    role: m.role as UserRole,
  }));
}

export async function inviteTeamMember(input: InviteInput): Promise<{ userId: string; tempPassword: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role) && !session.profile.is_superadmin) {
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
  if (!isAdminLevel(role) && !session.profile.is_superadmin) {
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

/**
 * Edita el perfil personal de un miembro del equipo. Solo admins de la org (o
 * superadmin) y solo sobre miembros de la propia organización. El nombre se
 * refleja también en el resto de la app (tickets, historial, etc.).
 */
export async function updateMemberProfile(userId: string, input: MemberProfileInput) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role) && !session.profile.is_superadmin) {
    throw new Error("Solo los admins pueden editar perfiles del equipo");
  }

  const admin = createAdminClient();

  // El target tiene que ser miembro de esta organización.
  const { data: membership, error: memErr } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organization.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) throw new Error(memErr.message);
  if (!membership) throw new Error("La persona no pertenece a esta organización");

  const v = memberProfileSchema.parse(input);

  // birth_date: normalizamos "" → null y validamos formato yyyy-mm-dd para no
  // pasarle basura al tipo `date` de Postgres.
  const birth = emptyToNull(v.birth_date);
  const birthDate = birth && /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : null;

  const { error } = await admin
    .from("user_profiles")
    .update({
      full_name: v.full_name.trim(),
      phone: emptyToNull(v.phone),
      job_title: emptyToNull(v.job_title),
      dni_number: emptyToNull(v.dni_number),
      cuit_cuil: emptyToNull(v.cuit_cuil),
      address: emptyToNull(v.address),
      birth_date: birthDate,
      emergency_contact_name: emptyToNull(v.emergency_contact_name),
      emergency_contact_phone: emptyToNull(v.emergency_contact_phone),
      notes: emptyToNull(v.notes),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/configuracion/equipo");
  revalidatePath("/dashboard", "layout");
}

export async function deactivateMember(userId: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role) && !session.profile.is_superadmin) {
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
