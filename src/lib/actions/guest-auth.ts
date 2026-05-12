"use server";

import { cache } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createClient,
  createAdminClient,
  createAuthAdminClient,
} from "@/lib/supabase/server";
import type { GuestProfile } from "@/lib/types/database";

export type GuestSession = {
  userId: string;
  email: string;
  profile: GuestProfile;
};

const signUpSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  full_name: z.string().min(2, "Nombre demasiado corto").max(120),
  phone: z
    .string()
    .trim()
    .min(6, "Teléfono inválido")
    .max(30)
    .optional()
    .or(z.literal("")),
  marketing_consent: z.boolean().default(false),
});

const signInSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Contraseña requerida"),
});

const updateProfileSchema = z.object({
  full_name: z.string().min(2).max(120),
  phone: z.string().max(30).optional().nullable(),
  document_type: z.string().max(20).optional().nullable(),
  document_number: z.string().max(40).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  birth_date: z.string().optional().nullable(),
  marketing_consent: z.boolean().optional(),
});

const guestSessionLoader = cache(async (): Promise<GuestSession | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("guest_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return null;
  return {
    userId: user.id,
    email: user.email,
    profile: profile as GuestProfile,
  };
});

export async function getGuestSession(): Promise<GuestSession | null> {
  return guestSessionLoader();
}

export async function requireGuestSession(): Promise<GuestSession> {
  const session = await guestSessionLoader();
  if (!session) redirect("/ingresar");
  return session;
}

export async function signUpGuest(input: z.infer<typeof signUpSchema>): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const supabase = await createClient();
  const phone = parsed.data.phone?.trim() || null;

  // 1) Crear usuario en auth.users (Supabase Auth)
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.full_name,
        is_marketplace_guest: true,
      },
    },
  });
  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return { ok: false, error: "Ya hay una cuenta con ese email. Probá ingresar." };
    }
    return { ok: false, error: error.message };
  }
  if (!data.user) {
    return { ok: false, error: "No se pudo crear la cuenta. Probá de nuevo." };
  }

  // 2) Crear guest_profile (con service role para bypass de RLS)
  const admin = createAdminClient();
  const { error: profileErr } = await admin
    .from("guest_profiles")
    .insert({
      user_id: data.user.id,
      full_name: parsed.data.full_name,
      phone,
      marketing_consent: parsed.data.marketing_consent ?? false,
    });

  if (profileErr) {
    // Best-effort cleanup: borrar auth user creado
    try {
      const authAdmin = createAuthAdminClient();
      await authAdmin.auth.admin.deleteUser(data.user.id);
    } catch {
      // ignore
    }
    return { ok: false, error: `Error creando el perfil: ${profileErr.message}` };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signInGuest(
  input: z.infer<typeof signInSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, error: "Email o contraseña incorrectos" };
  }
  if (!data.user) {
    return { ok: false, error: "No se pudo iniciar sesión" };
  }

  // Si el usuario ya existe en auth pero no tiene guest_profile, lo creamos
  // al vuelo (caso: staff PMS que también quiere usar el marketplace).
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("guest_profiles")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!existing) {
    const fullName =
      (data.user.user_metadata?.full_name as string | undefined) ??
      data.user.email?.split("@")[0] ??
      "Huésped";
    await admin.from("guest_profiles").insert({
      user_id: data.user.id,
      full_name: fullName,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signOutGuest(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function updateGuestProfile(
  input: z.infer<typeof updateProfileSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireGuestSession();
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("guest_profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      document_type: parsed.data.document_type || null,
      document_number: parsed.data.document_number || null,
      country: parsed.data.country || null,
      city: parsed.data.city || null,
      birth_date: parsed.data.birth_date || null,
      marketing_consent: parsed.data.marketing_consent,
    })
    .eq("user_id", session.userId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/mi-cuenta");
  revalidatePath("/mi-cuenta/perfil");
  return { ok: true };
}

export async function requestGuestPasswordReset(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email) return { ok: false, error: "Email requerido" };
  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/reset-password`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
