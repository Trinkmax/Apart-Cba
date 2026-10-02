import { firstName, kindInSentence, monthInSentence } from "./proof-helpers";
import type { RentalServiceKind } from "@/lib/types/database";

/**
 * Mail al inquilino cuando se rechaza un comprobante: qué fue, el motivo y el
 * link para subirlo de nuevo. HTML con estilos en línea y el color de la org;
 * todo texto dinámico va escapado. Puro (test en __tests__/).
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeColor(hex: string | null | undefined): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim() : "#0F766E";
}

export function proofRejectedEmail(input: {
  orgName: string;
  brandColor: string | null;
  tenantName: string | null;
  kind: RentalServiceKind;
  period: string;
  address: string;
  reason: string;
  portalUrl: string | null;
}): { subject: string; html: string; text: string } {
  const brand = safeColor(input.brandColor);
  const name = firstName(input.tenantName);
  const what = `${kindInSentence(input.kind)} de ${monthInSentence(input.period)}`;
  const subject = `Tenés que volver a subir el comprobante de ${what}`;
  const greeting = name ? `Hola ${name},` : "Hola,";
  const cta = input.portalUrl
    ? `<p style="margin:20px 0 8px"><a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:${brand};color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Subirlo de nuevo</a></p>
       <p style="margin:0;color:#6b7280;font-size:13px">Una foto clara o un PDF alcanza.</p>`
    : `<p style="margin:16px 0 0">Respondé este mail con el comprobante (una foto clara o un PDF).</p>`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f7;padding:24px 12px">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:15px;line-height:1.5">
    <div style="height:4px;background:${brand}"></div>
    <div style="padding:24px">
      <p style="margin:0 0 12px">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 12px">Revisamos el comprobante de <strong>${escapeHtml(what)}</strong> de ${escapeHtml(input.address)} y no lo pudimos validar:</p>
      <p style="margin:0;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:12px 14px;color:#9f1239">${escapeHtml(input.reason)}</p>
      ${cta}
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px">${escapeHtml(input.orgName)}</p>
    </div>
  </div>
</body></html>`;
  const text = [
    greeting,
    "",
    `Revisamos el comprobante de ${what} de ${input.address} y no lo pudimos validar: ${input.reason}`,
    "",
    input.portalUrl ? `Subilo de nuevo desde tu link: ${input.portalUrl}` : "Respondé este mail con el comprobante (una foto clara o un PDF).",
    "",
    input.orgName,
  ].join("\n");
  return { subject, html, text };
}
