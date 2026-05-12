import "server-only";
import { Resend } from "resend";
import {
  passwordChangedTemplate,
  emailChangeConfirmTemplate,
  emailChangeNotifyOldTemplate,
  emailChangeCancelConfirmTemplate,
  twoFactorEnabledTemplate,
  twoFactorDisabledTemplate,
} from "./templates/system";
import { plainTextToHtml } from "./render";

type SystemTemplate =
  | { name: "password-changed"; vars: { occurredAt: string } }
  | { name: "email-change-confirm"; vars: { confirmUrl: string; expiresAt: string } }
  | { name: "email-change-notify-old"; vars: { newEmail: string; cancelUrl: string } }
  | { name: "email-change-cancel-confirm"; vars: Record<string, never> }
  | { name: "2fa-enabled"; vars: { occurredAt: string } }
  | { name: "2fa-disabled"; vars: { occurredAt: string } };

const TEMPLATE_MAP = {
  "password-changed": passwordChangedTemplate,
  "email-change-confirm": emailChangeConfirmTemplate,
  "email-change-notify-old": emailChangeNotifyOldTemplate,
  "email-change-cancel-confirm": emailChangeCancelConfirmTemplate,
  "2fa-enabled": twoFactorEnabledTemplate,
  "2fa-disabled": twoFactorDisabledTemplate,
} as const;

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no configurada");
  resendClient = new Resend(key);
  return resendClient;
}

/**
 * Envía un mail "del sistema" (auth flows: password change, email change,
 * 2FA enable/disable). Siempre desde el dominio configurado en
 * SYSTEM_EMAIL_FROM, no desde el dominio de ninguna org.
 *
 * Best-effort: si Resend falla, NO throw — devuelve `{ ok: false, error }`.
 * El caller decide si mostrar warning o ignorar.
 */
export async function sendSystemMail(args: {
  to: string;
  template: SystemTemplate;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const from = process.env.SYSTEM_EMAIL_FROM;
  const fromName = process.env.SYSTEM_EMAIL_FROM_NAME ?? "rentOS Seguridad";
  if (!from) return { ok: false, error: "SYSTEM_EMAIL_FROM no configurada" };

  const tpl = TEMPLATE_MAP[args.template.name];
  if (!tpl) return { ok: false, error: `Template desconocido: ${args.template.name}` };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = tpl.text(args.template.vars as any);
  const subject = typeof tpl.subject === "string" ? tpl.subject : tpl.subject;
  const html = plainTextToHtml(text);

  try {
    const result = await getResend().emails.send({
      from: `${fromName} <${from}>`,
      to: args.to,
      subject,
      text,
      html,
    });
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true, id: result.data?.id ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
