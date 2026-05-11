"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { logSecurityEvent } from "@/lib/security/audit";
import { sendSystemMail } from "@/lib/email/system";

// ════════════════════════════════════════════════════════════════════════
// Cambio de contraseña
// ════════════════════════════════════════════════════════════════════════

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Ingresá tu contraseña actual"),
  newPassword: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Za-z]/, "Debe incluir al menos una letra")
    .regex(/[0-9]/, "Debe incluir al menos un número"),
});

export type ChangePasswordInput = z.infer<typeof passwordSchema>;

export async function changePassword(
  input: ChangePasswordInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // Re-auth con la contraseña actual
  const sb = await createClient();
  const { data: userData } = await sb.auth.getUser();
  const email = userData.user?.email;
  if (!email) return { ok: false, error: "No se pudo obtener el email del usuario" };

  const { error: signInError } = await sb.auth.signInWithPassword({
    email,
    password: parsed.data.currentPassword,
  });
  if (signInError) return { ok: false, error: "Contraseña actual incorrecta" };

  // Actualizar password
  const { error: updateError } = await sb.auth.updateUser({
    password: parsed.data.newPassword,
  });
  if (updateError) return { ok: false, error: updateError.message };

  // Audit log + mail (best-effort)
  await logSecurityEvent({
    userId: session.userId,
    eventType: "password_changed",
  });
  const mailResult = await sendSystemMail({
    to: email,
    template: {
      name: "password-changed",
      vars: { occurredAt: new Date().toLocaleString("es-AR") },
    },
  });
  if (!mailResult.ok) {
    await logSecurityEvent({
      userId: session.userId,
      eventType: "password_changed",
      metadata: { notification_failed: true, error: mailResult.error },
    });
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════
// Cambio de email — request / confirm / cancel
// ════════════════════════════════════════════════════════════════════════

const emailChangeSchema = z.object({
  newEmail: z.string().email("Email inválido").max(200, "Email demasiado largo"),
  currentPassword: z.string().min(1, "Ingresá tu contraseña actual"),
});

export type RequestEmailChangeInput = z.infer<typeof emailChangeSchema>;

export async function requestEmailChange(
  input: RequestEmailChangeInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = emailChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const sb = await createClient();
  const { data: userData } = await sb.auth.getUser();
  const oldEmail = userData.user?.email;
  if (!oldEmail) return { ok: false, error: "No se pudo obtener el email del usuario" };

  const newEmail = parsed.data.newEmail.toLowerCase();
  if (newEmail === oldEmail.toLowerCase()) {
    return { ok: false, error: "El nuevo email es igual al actual" };
  }

  // Re-auth con la contraseña actual
  const { error: signInError } = await sb.auth.signInWithPassword({
    email: oldEmail,
    password: parsed.data.currentPassword,
  });
  if (signInError) return { ok: false, error: "Contraseña incorrecta" };

  const admin = createAdminClient();

  // Marcar requests previas como cancelled
  await admin
    .from("email_change_requests")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("user_id", session.userId)
    .is("confirmed_at", null)
    .is("cancelled_at", null);

  // Generar tokens (64 chars hex) + hashes
  const confirmToken = randomBytes(32).toString("hex");
  const cancelToken = randomBytes(32).toString("hex");
  const confirmTokenHash = await bcrypt.hash(confirmToken, 10);
  const cancelTokenHash = await bcrypt.hash(cancelToken, 10);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const { data: inserted, error: insertError } = await admin
    .from("email_change_requests")
    .insert({
      user_id: session.userId,
      old_email: oldEmail,
      new_email: newEmail,
      confirm_token_hash: confirmTokenHash,
      cancel_token_hash: cancelTokenHash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? "No se pudo crear la solicitud" };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const confirmUrl = `${baseUrl}/confirm-email-change?token=${confirmToken}`;
  const cancelUrl = `${baseUrl}/cancel-email-change?token=${cancelToken}`;

  // Mail al nuevo email (confirmar)
  await sendSystemMail({
    to: newEmail,
    template: {
      name: "email-change-confirm",
      vars: { confirmUrl, expiresAt: expiresAt.toLocaleString("es-AR") },
    },
  });

  // Mail al viejo email (notificar + opción de cancelar)
  const notifyResult = await sendSystemMail({
    to: oldEmail,
    template: {
      name: "email-change-notify-old",
      vars: { newEmail, cancelUrl },
    },
  });
  if (notifyResult.ok) {
    await admin
      .from("email_change_requests")
      .update({ notified_old_at: new Date().toISOString() })
      .eq("id", inserted.id);
  }

  await logSecurityEvent({
    userId: session.userId,
    eventType: "email_change_requested",
    metadata: { from: oldEmail, to: newEmail },
  });

  return { ok: true };
}

export async function confirmEmailChange(
  token: string
): Promise<{ ok: true; newEmail: string } | { ok: false; error: string }> {
  if (typeof token !== "string" || token.length !== 64) {
    return { ok: false, error: "Token inválido" };
  }

  const admin = createAdminClient();
  const { data: requests } = await admin
    .from("email_change_requests")
    .select("id, user_id, old_email, new_email, confirm_token_hash")
    .is("confirmed_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (!requests || requests.length === 0) {
    return { ok: false, error: "Token inválido o expirado" };
  }

  let matched: (typeof requests)[number] | null = null;
  for (const req of requests) {
    if (await bcrypt.compare(token, req.confirm_token_hash)) {
      matched = req;
      break;
    }
  }

  if (!matched) {
    return { ok: false, error: "Token inválido o expirado" };
  }

  const { error: updateAuthError } = await admin.auth.admin.updateUserById(matched.user_id, {
    email: matched.new_email,
  });
  if (updateAuthError) {
    return { ok: false, error: updateAuthError.message };
  }

  await admin
    .from("email_change_requests")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", matched.id);

  await logSecurityEvent({
    userId: matched.user_id,
    eventType: "email_change_confirmed",
    metadata: { from: matched.old_email, to: matched.new_email },
  });

  return { ok: true, newEmail: matched.new_email };
}

export async function cancelEmailChange(
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof token !== "string" || token.length !== 64) {
    return { ok: false, error: "Token inválido" };
  }

  const admin = createAdminClient();
  const { data: requests } = await admin
    .from("email_change_requests")
    .select("id, user_id, old_email, new_email, cancel_token_hash")
    .is("confirmed_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (!requests || requests.length === 0) {
    return { ok: false, error: "Token inválido o ya procesado" };
  }

  let matched: (typeof requests)[number] | null = null;
  for (const req of requests) {
    if (await bcrypt.compare(token, req.cancel_token_hash)) {
      matched = req;
      break;
    }
  }

  if (!matched) {
    return { ok: false, error: "Token inválido o ya procesado" };
  }

  await admin
    .from("email_change_requests")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", matched.id);

  await logSecurityEvent({
    userId: matched.user_id,
    eventType: "email_change_cancelled",
    metadata: { attempted_email: matched.new_email },
  });

  await sendSystemMail({
    to: matched.old_email,
    template: {
      name: "email-change-cancel-confirm",
      vars: {},
    },
  });

  return { ok: true };
}
