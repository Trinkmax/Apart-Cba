"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createAuthAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import type { Organization, UserRole } from "@/lib/types/database";

async function requireSuperadmin() {
  const session = await requireSession();
  if (!session.profile.is_superadmin) {
    throw new Error("Solo el superadmin puede ejecutar esta acción");
  }
  return session;
}

const orgSchema = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones").optional(),
  legal_name: z.string().optional().nullable(),
  tax_id: z.string().optional().nullable(),
  timezone: z.string().default("America/Argentina/Cordoba"),
  default_currency: z.string().default("ARS"),
  default_commission_pct: z.coerce.number().min(0).max(100).default(20),
  primary_color: z.string().default("#0F766E"),
});

export type OrganizationInput = z.infer<typeof orgSchema>;

const adminSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional().nullable(),
});

export type FirstAdminInput = z.infer<typeof adminSchema>;

export async function listAllOrganizations() {
  await requireSuperadmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  // Conteo de members por org
  const ids = (data ?? []).map((o) => o.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: members } = await admin
      .from("organization_members")
      .select("organization_id")
      .in("organization_id", ids)
      .eq("active", true);
    (members ?? []).forEach((m) => {
      counts.set(m.organization_id, (counts.get(m.organization_id) ?? 0) + 1);
    });
  }

  return (data as Organization[]).map((o) => ({
    ...o,
    member_count: counts.get(o.id) ?? 0,
  }));
}

export async function createOrganizationWithAdmin(input: {
  org: OrganizationInput;
  admin: FirstAdminInput;
}): Promise<{ orgId: string; userId: string; tempPassword?: string }> {
  await requireSuperadmin();
  const orgValidated = orgSchema.parse(input.org);
  const adminValidated = adminSchema.parse(input.admin);

  const admin = createAdminClient();
  const authAdmin = createAuthAdminClient();

  const slug =
    orgValidated.slug ??
    orgValidated.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);

  // Verificar slug único
  const { data: dupSlug } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (dupSlug) throw new Error(`Ya existe una organización con slug "${slug}"`);

  // Crear org
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ ...orgValidated, slug })
    .select()
    .single();
  if (orgErr) throw new Error(orgErr.message);

  // Crear o reusar user
  let userId: string;
  const { data: usersList } = await authAdmin.auth.admin.listUsers();
  const existingUser = usersList?.users?.find((u) => u.email === adminValidated.email);

  if (existingUser) {
    userId = existingUser.id;
    await authAdmin.auth.admin.updateUserById(userId, { password: adminValidated.password });
  } else {
    const { data: created, error: authErr } = await authAdmin.auth.admin.createUser({
      email: adminValidated.email,
      password: adminValidated.password,
      email_confirm: true,
      user_metadata: { full_name: adminValidated.full_name },
    });
    if (authErr) throw new Error(authErr.message);
    userId = created.user!.id;
  }

  // Upsert profile (no superadmin — solo de la org)
  await admin.from("user_profiles").upsert(
    {
      user_id: userId,
      full_name: adminValidated.full_name,
      phone: adminValidated.phone,
      active: true,
    },
    { onConflict: "user_id" }
  );

  // Membership como admin
  const { error: memErr } = await admin.from("organization_members").upsert(
    {
      organization_id: org.id,
      user_id: userId,
      role: "admin" as UserRole,
      joined_at: new Date().toISOString(),
      active: true,
    },
    { onConflict: "organization_id,user_id" }
  );
  if (memErr) throw new Error(memErr.message);

  revalidatePath("/superadmin");
  revalidatePath("/superadmin/orgs");
  return { orgId: org.id, userId, tempPassword: adminValidated.password };
}

export async function deactivateOrganization(orgId: string) {
  await requireSuperadmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ active: false })
    .eq("id", orgId);
  if (error) throw new Error(error.message);
  revalidatePath("/superadmin");
}
