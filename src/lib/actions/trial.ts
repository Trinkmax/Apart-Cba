"use server";

import { headers, cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createClient,
  createAdminClient,
  createAuthAdminClient,
} from "@/lib/supabase/server";
import { seedDemoData, purgeDemoData } from "@/lib/demo/seed";
import { requireSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";

/**
 * Alta self-serve desde la landing de rentOS.
 *
 * Es el único camino público a la creación de una organización: `/setup` está
 * quemado (exige cero user_profiles) y `createOrganizationWithAdmin` arranca con
 * `requireSuperadmin()`. Por eso esta acción reimplementa la secuencia en vez de
 * reusar aquellas.
 *
 * Dos decisiones que no son obvias y conviene no revertir:
 *
 *  - Se usa `auth.admin.createUser({ email_confirm: true })` y NO `signUp()`. Si
 *    el proyecto tuviera activada la confirmación por email, `signUp` dejaría al
 *    visitante sin sesión hasta que abra el mail, y la promesa de la landing
 *    ("entrás en menos de un minuto") se cae. La API admin saltea ese setting.
 *  - El login posterior se hace con `signInWithPassword` inline en vez de reusar
 *    `signIn()` de auth.ts: ese helper llama a `getSession()`, que está memoizado
 *    por request con React.cache, y devolvería el null cacheado de antes de que
 *    existiera el perfil.
 */

const ORG_COOKIE = "apartcba_org";

const startTrialSchema = z.object({
  full_name: z.string().trim().min(2, "Poné tu nombre y apellido").max(120),
  org_name: z.string().trim().min(2, "Poné el nombre de tu operación").max(80),
  email: z.string().trim().toLowerCase().email("Revisá el email"),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres"),
});

export type StartTrialInput = z.infer<typeof startTrialSchema>;
export type StartTrialResult =
  | { ok: true; orgName: string }
  | { ok: false; error: string; field?: keyof StartTrialInput };

/** IP real del cliente (Vercel la inyecta en x-forwarded-for). */
async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown"
    );
  } catch {
    return "unknown";
  }
}

/** Rate limit best-effort, FAIL-OPEN: un bug del limiter no puede frenar un alta. */
async function allowAttempt(bucket: string, max: number, windowSecs: number) {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hit_auth_rate_limit", {
      p_bucket: bucket,
      p_max: max,
      p_window_secs: windowSecs,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "operacion"
  );
}

/**
 * Inserta la organización reintentando ante colisión de slug. El generador de
 * superadmin.ts tira error en ese caso, que con alta pública es cuestión de días:
 * dos "Departamentos Córdoba" colisionan sin que nadie haya hecho nada mal.
 */
async function insertOrganization(
  admin: ReturnType<typeof createAdminClient>,
  name: string
): Promise<{ id: string } | { error: string }> {
  const base = slugify(name);

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await admin
      .from("organizations")
      .insert({
        name,
        slug,
        timezone: "America/Argentina/Cordoba",
        default_currency: "ARS",
        default_commission_pct: 20,
        is_trial: true,
        demo_data_seeded_at: new Date().toISOString(),
        trial_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      })
      .select("id")
      .single();

    if (!error && data) return { id: data.id as string };
    // 23505 = unique_violation sobre organizations_slug_key.
    if (error && error.code !== "23505") return { error: error.message };
  }

  return { error: "No pudimos generar un identificador para tu operación." };
}

export async function startTrial(input: StartTrialInput): Promise<StartTrialResult> {
  const parsed = startTrialSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Revisá los datos",
      field: issue?.path[0] as keyof StartTrialInput | undefined,
    };
  }
  const { full_name, org_name, email, password } = parsed.data;

  const ip = await clientIp();
  if (!(await allowAttempt(`trial:${ip}`, 5, 3600))) {
    return {
      ok: false,
      error: "Demasiadas cuentas desde esta conexión. Probá de nuevo en un rato.",
    };
  }

  const authAdmin = createAuthAdminClient();
  const admin = createAdminClient();

  // 1. Usuario de auth ─────────────────────────────────────────────────────
  const { data: created, error: createErr } = await authAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (createErr || !created?.user) {
    const msg = (createErr?.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return {
        ok: false,
        field: "email",
        error: "Ya hay una cuenta con ese email. Entrá desde /login.",
      };
    }
    return { ok: false, error: "No pudimos crear la cuenta. Probá de nuevo." };
  }

  const userId = created.user.id;
  let orgId: string | null = null;

  try {
    // 2. Organización ──────────────────────────────────────────────────────
    const org = await insertOrganization(admin, org_name);
    if ("error" in org) throw new Error(org.error);
    orgId = org.id;

    // 3. Perfil + membresía ────────────────────────────────────────────────
    // Sin la fila de user_profiles, getSession() devuelve null y el usuario
    // queda deslogueado de hecho aunque la sesión de Supabase exista.
    const { error: profileErr } = await admin
      .from("user_profiles")
      .insert({ user_id: userId, full_name, active: true });
    if (profileErr) throw new Error(`user_profiles: ${profileErr.message}`);

    const { error: memberErr } = await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: userId,
      role: "admin",
      active: true,
    });
    if (memberErr) throw new Error(`organization_members: ${memberErr.message}`);

    // 4. Datos de ejemplo ──────────────────────────────────────────────────
    await seedDemoData(admin, orgId, userId);
  } catch (err) {
    // Rollback: borrar la org arrastra todo lo sembrado (las FK a organizations
    // son ON DELETE CASCADE), y después se borra el usuario de auth.
    if (orgId) {
      await admin.from("organizations").delete().eq("id", orgId).then(
        () => undefined,
        () => undefined
      );
    }
    try {
      await authAdmin.auth.admin.deleteUser(userId);
    } catch {
      // best-effort
    }
    console.error("[startTrial]", err);
    return { ok: false, error: "No pudimos preparar tu panel. Probá de nuevo en un minuto." };
  }

  // 5. Login ────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    // La cuenta quedó creada y sembrada: mandarlo a /login es mejor que perderla.
    return {
      ok: false,
      error: "Tu cuenta quedó creada, pero no pudimos iniciar sesión. Entrá desde /login.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, orgId!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  revalidatePath("/", "layout");
  return { ok: true, orgName: org_name };
}

/**
 * Borra los datos de ejemplo de la cuenta de prueba propia. Es cómo una cuenta
 * de prueba se convierte en cuenta real: sin migrar nada y sin volver a
 * registrarse. Sólo un admin de la propia org puede ejecutarla, y sólo mientras
 * la org siga marcada como sembrada.
 */
export async function purgeTrialDemoData(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();

  if (role !== "admin") {
    return { ok: false, error: "Sólo un administrador puede vaciar los datos de ejemplo." };
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, is_trial, demo_data_seeded_at")
    .eq("id", organization.id)
    .single();

  if (!org?.is_trial || !org.demo_data_seeded_at) {
    return { ok: false, error: "Esta cuenta no tiene datos de ejemplo para vaciar." };
  }

  try {
    await purgeDemoData(admin, organization.id);
  } catch (err) {
    console.error("[purgeTrialDemoData]", err);
    return { ok: false, error: "No pudimos vaciar los datos. Probá de nuevo." };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
