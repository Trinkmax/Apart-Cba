"use server";

import { createAdminClient, createAuthAdminClient } from "@/lib/supabase/server";

export async function setupFirstAdmin(input: {
  org_name: string;
  full_name: string;
  email: string;
  password: string;
  existing_org_id: string | null;
}): Promise<{ orgId: string; userId: string }> {
  const admin = createAdminClient();
  const authAdmin = createAuthAdminClient();

  // Verificar que no haya users aún
  const { count } = await admin
    .from("user_profiles")
    .select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    throw new Error("La configuración inicial ya fue completada");
  }

  // Crear o reusar org (idempotente: si ya hay una org sin members, la reusa)
  let orgId = input.existing_org_id;
  if (!orgId) {
    const baseSlug = input.org_name.toLowerCase().replace(/[^a-z0-9]/g, "") || "org";

    // Si ya existe una org con ese slug, reusarla (intento previo fallido)
    const { data: existing } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", baseSlug)
      .maybeSingle();

    if (existing) {
      orgId = existing.id;
    } else {
      const { data: org, error: orgErr } = await admin
        .from("organizations")
        .insert({
          name: input.org_name,
          slug: baseSlug,
          timezone: "America/Argentina/Cordoba",
          default_currency: "ARS",
        })
        .select()
        .single();
      if (orgErr) throw new Error(orgErr.message);
      orgId = org.id;
    }
  }

  // Crear o reusar user en Supabase Auth (puede haber quedado de un intento previo)
  let userId: string;
  const { data: usersList } = await authAdmin.auth.admin.listUsers();
  const existingUser = usersList?.users?.find((u) => u.email === input.email);

  if (existingUser) {
    userId = existingUser.id;
    // Actualizar password por si la cambiaron
    await authAdmin.auth.admin.updateUserById(userId, { password: input.password });
  } else {
    const { data: created, error: authErr } = await authAdmin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    });
    if (authErr) throw new Error(authErr.message);
    if (!created.user) throw new Error("No se pudo crear el usuario");
    userId = created.user.id;
  }

  // Upsert perfil superadmin (idempotente)
  const { error: profileErr } = await admin.from("user_profiles").upsert({
    user_id: userId,
    full_name: input.full_name,
    is_superadmin: true,
    active: true,
  }, { onConflict: "user_id" });
  if (profileErr) throw new Error(profileErr.message);

  // Upsert membership como admin
  const { error: memErr } = await admin.from("organization_members").upsert({
    organization_id: orgId!,
    user_id: userId,
    role: "admin",
    joined_at: new Date().toISOString(),
    active: true,
  }, { onConflict: "organization_id,user_id" });
  if (memErr) throw new Error(memErr.message);

  return { orgId: orgId!, userId };
}
