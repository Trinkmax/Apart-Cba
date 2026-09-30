import "server-only";

import { sendGuestMail } from "@/lib/email/guest";

/**
 * Envía un mail de marca de apart por Resend (remitente según el dominio de la
 * organización, ver sendGuestMail). Best-effort: nunca lanza; devuelve si salió
 * y deja el motivo en el log cuando no.
 */
export async function sendApartEmail(p: {
  organizationId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
}): Promise<boolean> {
  const to = (p.to ?? "").trim();
  if (!to || !to.includes("@")) {
    console.warn("[apart-email] sin destinatario válido:", p.subject);
    return false;
  }
  try {
    const res = await sendGuestMail({
      organizationId: p.organizationId,
      to,
      subject: p.subject,
      html: p.html,
      text: p.text,
      ...(p.replyTo && p.replyTo.trim() ? { replyTo: p.replyTo.trim() } : {}),
    });
    if (!res.ok) {
      console.warn("[apart-email] no salió:", p.subject, "→", res.error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[apart-email] error enviando:", p.subject, e);
    return false;
  }
}
