"use server";

import { randomBytes } from "node:crypto";
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

/**
 * Fila de la pantalla de Equipo. `last_sign_in_at` sale de auth.users (no de
 * `joined_at`, que se setea al insertar la membresía): es el único dato que
 * distingue "invitado que nunca entró" de alguien que ya está usando el sistema.
 */
export type TeamMemberRow = OrganizationMember & {
  profile: UserProfile | null;
  email: string | null;
  last_sign_in_at: string | null;
};

type AuthUserLite = { id: string; email: string | null; last_sign_in_at: string | null };

/**
 * Todos los usuarios de auth.users, paginados. GoTrue no expone búsqueda por
 * email en el SDK, así que la única forma confiable de resolver "¿este mail ya
 * existe?" es recorrer las páginas — con el default (50 por página) una cuenta
 * vieja quedaba fuera del listado y `createUser` explotaba con "already registered".
 */
async function listAllAuthUsers(): Promise<AuthUserLite[]> {
  const authAdmin = createAuthAdminClient();
  const out: AuthUserLite[] = [];
  const perPage = 1000;
  let page = 1;
  try {
    // Seguir pidiendo páginas hasta que una vuelva con menos de perPage usuarios
    for (;;) {
      const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const users = data?.users ?? [];
      for (const u of users) {
        out.push({
          id: u.id,
          email: u.email ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
        });
      }
      if (users.length < perPage) break;
      page += 1;
    }
  } catch {
    // ignore
  }
  return out;
}

/**
 * Gate para las acciones que manejan credenciales o expulsan gente.
 *
 * `isAdminLevel()` incluye a recepción (ver permissions.ts), y eso acá es una
 * escalada: recepción podría regenerar la contraseña de la dueña, entrar con
 * ella y quedarse con la organización. Invitar y editar perfiles sí siguen
 * abiertos a recepción; tocar la credencial de otro, no.
 */
function assertOwnsCredentials(
  role: string,
  isSuperadmin: boolean,
  accion: string
): void {
  if (role !== "admin" && !isSuperadmin) {
    throw new Error(`Solo un administrador puede ${accion}`);
  }
}

/** Formato único de contraseña temporal: legible por teléfono y pegable en WhatsApp. */
function generateTempPassword(): string {
  // `Math.random()` no es un CSPRNG y esta clave es el ÚNICO mecanismo de acceso
  // y de recuperación del staff (no hay reset por mail): tiene que ser
  // impredecible. Alfabeto sin 0/O/1/l/I porque la clave se dicta por teléfono.
  const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  return `Apart${body}!`;
}

export async function listTeamMembers(): Promise<TeamMemberRow[]> {
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

  // Email + último ingreso desde auth.users (1 listUsers paginado en vez de N getUserById)
  const authByUser = new Map<string, AuthUserLite>();
  for (const u of await listAllAuthUsers()) authByUser.set(u.id, u);

  return members.map((m) => ({
    ...m,
    profile: profiles?.find((p) => p.user_id === m.user_id) ?? null,
    email: authByUser.get(m.user_id)?.email ?? null,
    last_sign_in_at: authByUser.get(m.user_id)?.last_sign_in_at ?? null,
  })) as TeamMemberRow[];
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

export type InviteResult = {
  userId: string;
  /** Contraseña a entregar. null = la persona ya tiene la suya y no se la pisamos. */
  tempPassword: string | null;
  /** true si el email ya existía en auth.users y esa cuenta ya ingresó alguna vez. */
  alreadyHadAccess: boolean;
};

export async function inviteTeamMember(input: InviteInput): Promise<InviteResult> {
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
  let tempPassword: string | null = null;
  let alreadyHadAccess = false;

  // Buscar por email
  const existing = (await listAllAuthUsers()).find((u) => u.email === validated.email);

  if (existing) {
    userId = existing.id;
    if (existing.last_sign_in_at) {
      // La persona ya usa esa cuenta: pisarle la clave la dejaría afuera sin
      // enterarse. Se lo decimos a quien invita en vez de devolver nada.
      alreadyHadAccess = true;
    } else {
      // Cuenta fantasma: existe pero nunca ingresó (típicamente una invitación
      // anterior cuya contraseña se perdió). Regeneramos y la devolvemos —
      // es exactamente lo que buscaba quien vuelve a invitar.
      //
      // Pero `auth.users` es de TODO el proyecto Supabase: lo comparten las
      // otras organizaciones, los huéspedes del marketplace (`guest_profiles`)
      // y TextOS, que vive en el schema `public`. Regenerar a ciegas por
      // coincidencia de email deja que cualquier admin se apodere de una cuenta
      // ajena tipeando su mail. Sólo tocamos la clave si esa cuenta no es de
      // nadie más.
      const [{ data: otherMemberships }, { data: guestProfile }] = await Promise.all([
        admin
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", userId)
          .neq("organization_id", organization.id)
          .limit(1),
        admin
          .from("guest_profiles")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      if ((otherMemberships?.length ?? 0) > 0 || guestProfile) {
        alreadyHadAccess = true;
      } else {
        tempPassword = generateTempPassword();
        const { error } = await authAdmin.auth.admin.updateUserById(userId, {
          password: tempPassword,
        });
        if (error) throw new Error(error.message);
      }
    }
  } else {
    // Crear nuevo
    tempPassword = generateTempPassword();
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
  return { userId, tempPassword, alreadyHadAccess };
}

/**
 * Regenera la contraseña de un miembro y la devuelve para entregarla a mano
 * (por WhatsApp). Es el único camino de recuperación que existe: no hay
 * "olvidé mi contraseña" para el staff, y el admin de la org es quien resuelve.
 */
export async function resetMemberAccess(
  userId: string
): Promise<{ email: string; fullName: string; tempPassword: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  assertOwnsCredentials(role, session.profile.is_superadmin, "regenerar contraseñas");
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

  const authAdmin = createAuthAdminClient();
  const { data: target, error: getErr } = await authAdmin.auth.admin.getUserById(userId);
  if (getErr) throw new Error(getErr.message);
  const email = target?.user?.email;
  if (!email) throw new Error("Esa cuenta no tiene un email para ingresar");

  const tempPassword = generateTempPassword();
  const { error } = await authAdmin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (error) throw new Error(error.message);

  const { data: profile } = await admin
    .from("user_profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle();

  revalidatePath("/dashboard/configuracion/equipo");
  return {
    email,
    fullName: (profile?.full_name as string | null) ?? email,
    tempPassword,
  };
}

/**
 * Saca a alguien del equipo de verdad: borra la fila de `organization_members`
 * (desactivar dejaba la fila listada y confundía). No toca auth.users ni
 * user_profiles — la misma persona puede seguir en otra organización.
 *
 * Antes de borrar desasigna todo lo que le apunte DENTRO de esta org, para que
 * el trabajo no quede escondido detrás de alguien que ya no entra.
 */
export async function removeMember(userId: string): Promise<{ unassigned: number }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  assertOwnsCredentials(role, session.profile.is_superadmin, "quitar personas del equipo");
  if (userId === session.userId) {
    throw new Error("No podés quitarte a vos mismo del equipo");
  }
  const admin = createAdminClient();

  const { data: target, error: memErr } = await admin
    .from("organization_members")
    .select("role, active")
    .eq("organization_id", organization.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) throw new Error(memErr.message);
  if (!target) throw new Error("La persona no pertenece a esta organización");

  // Sin admin activo la organización queda sin nadie que pueda invitar,
  // cambiar roles ni regenerar contraseñas: nadie podría volver a entrar.
  if (target.role === "admin" && target.active) {
    const { count } = await admin
      .from("organization_members")
      .select("user_id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("role", "admin")
      .eq("active", true);
    if ((count ?? 0) <= 1) {
      throw new Error(
        "Es la única administradora activa. Nombrá a otra persona como administradora antes de quitarla."
      );
    }
  }

  // Tablas con `assigned_to` en el schema (el stack `messaging_*` queda afuera
  // a propósito: es legacy, el CRM vivo es `crm_*`).
  // Sólo se desasigna lo que sigue abierto. `cleaning_tasks` no tiene
  // `completed_by` ni los tickets `resolved_by`: en lo ya cerrado, `assigned_to`
  // ES el registro de quién lo hizo, y borrarlo reescribe el historial.
  const ASSIGNABLE_TABLES = [
    { table: "maintenance_tickets", open: ["abierto", "en_progreso", "esperando_repuesto"] },
    { table: "cleaning_tasks", open: ["pendiente", "en_progreso"] },
    { table: "concierge_requests", open: ["pendiente", "en_progreso"] },
    { table: "crm_conversations", open: null },
  ] as const;

  let unassigned = 0;
  for (const { table, open } of ASSIGNABLE_TABLES) {
    let q = admin
      .from(table)
      .update({ assigned_to: null })
      .eq("organization_id", organization.id)
      .eq("assigned_to", userId);
    if (open) q = q.in("status", open as unknown as string[]);
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.message);
    unassigned += data?.length ?? 0;
  }

  const { error } = await admin
    .from("organization_members")
    .delete()
    .eq("organization_id", organization.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/configuracion/equipo");
  revalidatePath("/dashboard/mantenimiento");
  revalidatePath("/dashboard/limpieza");
  revalidatePath("/dashboard/conserjeria");
  revalidatePath("/dashboard/crm");
  revalidatePath("/m", "layout");
  return { unassigned };
}

/** Vuelve a habilitar a alguien que había sido desactivado. */
export async function reactivateMember(userId: string) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role) && !session.profile.is_superadmin) {
    throw new Error("Solo los admins pueden reactivar usuarios");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_members")
    .update({ active: true })
    .eq("organization_id", organization.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/configuracion/equipo");
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
