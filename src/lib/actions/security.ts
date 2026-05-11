"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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
