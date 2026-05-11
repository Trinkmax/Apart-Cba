import "server-only";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";

let resendClient: Resend | null = null;
function getResend(): Resend {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no configurada");
  resendClient = new Resend(key);
  return resendClient;
}

/**
 * Envía un mail al huésped (confirmación de reserva, recibos, etc).
 *
 * Lookup del dominio de la org:
 * - Si `email_domain_verified_at` IS NOT NULL → from = "{sender_name} <{local_part}@{domain}>"
 * - Si NO verificado → from = "{org.name} <APART_CBA_FALLBACK_FROM>"
 *
 * Best-effort: si Resend falla, devuelve { ok: false, error } sin throw.
 */
export async function sendGuestMail(args: {
  organizationId: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}): Promise<{ ok: true; id: string; from_used: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("name, email_domain, email_sender_name, email_sender_local_part, email_domain_verified_at")
    .eq("id", args.organizationId)
    .maybeSingle();

  if (orgErr || !org) {
    return { ok: false, error: orgErr?.message ?? "Org no encontrada" };
  }

  let from: string;
  if (
    org.email_domain_verified_at &&
    org.email_domain &&
    org.email_sender_local_part
  ) {
    const senderName = org.email_sender_name ?? org.name;
    from = `${senderName} <${org.email_sender_local_part}@${org.email_domain}>`;
  } else {
    const fallbackFrom = process.env.APART_CBA_FALLBACK_FROM;
    if (!fallbackFrom) return { ok: false, error: "APART_CBA_FALLBACK_FROM no configurada" };
    from = `${org.name} <${fallbackFrom}>`;
  }

  try {
    const result = await getResend().emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {}),
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    });
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true, id: result.data?.id ?? "", from_used: from };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
