import {
  adjustmentBasisText,
  adjustmentSentence,
  firstNameOf,
  formatVariation,
  longDate,
  plainMoney,
  type NoticeInput,
} from "@/components/rentals/adjustments/adjustment-text";
import { formatContractNumber } from "@/lib/rentals/labels";

/**
 * Mail al inquilino avisando el alquiler nuevo después de un ajuste. Puro
 * (sin red ni base): la action lo arma y lo manda con `sendGuestMail`, que usa
 * el remitente de la organización. HTML con tablas y estilos en línea (los
 * clientes de mail no leen CSS externo), con el color de marca de la org.
 */

export interface AdjustmentEmailInput {
  orgName: string;
  brandColor: string | null;
  logoUrl: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  tenantName: string | null;
  address: string;
  contractNumber: number;
  notice: NoticeInput;
  /** Fecha del ajuste siguiente, si el contrato tiene otro. */
  nextAdjustmentDate?: string | null;
}

const DEFAULT_BRAND = "#0F766E";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function brandOf(c: string | null): string {
  return c && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : DEFAULT_BRAND;
}

function safeUrl(u: string | null): string | null {
  return u && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

export function buildAdjustmentEmail(input: AdjustmentEmailInput): { subject: string; html: string; text: string } {
  const n = input.notice;
  const brand = brandOf(input.brandColor);
  const name = firstNameOf(input.tenantName);
  const subject = `Tu alquiler se actualiza desde el ${longDate(n.effectiveDate)}`;
  const sentence = adjustmentSentence(n);
  const basis = adjustmentBasisText(n);
  const contact = [input.contactPhone ? `WhatsApp o teléfono: ${input.contactPhone}` : null, input.contactEmail ? `Mail: ${input.contactEmail}` : null]
    .filter((x): x is string => !!x);
  const next = input.nextAdjustmentDate ? `El próximo ajuste está previsto para el ${longDate(input.nextAdjustmentDate)}.` : null;
  const ref = `${formatContractNumber(input.contractNumber)} · ${input.address}`;

  const text = [
    `Hola${name ? ` ${name}` : ""}:`,
    "",
    sentence,
    "",
    `Alquiler anterior: ${plainMoney(n.oldAmount, n.currency)}`,
    `Alquiler nuevo: ${plainMoney(n.newAmount, n.currency)}`,
    n.variationPct != null ? `Variación: ${formatVariation(n.variationPct)} (${basis})` : `Motivo: ${basis}`,
    ...(next ? ["", next] : []),
    "",
    contact.length ? `Cualquier duda, escribinos. ${contact.join(" · ")}` : "Cualquier duda, escribinos.",
    "",
    `${input.orgName} · ${ref}`,
  ].join("\n");

  const logo = safeUrl(input.logoUrl);
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">${escapeHtml(label)}</td>` +
    `<td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-size:${strong ? "18px" : "14px"};font-weight:${strong ? 700 : 500};color:#111827;">${escapeHtml(value)}</td></tr>`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(sentence)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="background:${brand};padding:20px 24px;color:#ffffff;">
${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(input.orgName)}" height="32" style="display:block;height:32px;max-width:180px;margin-bottom:10px;border:0;">` : ""}
<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">${escapeHtml(input.orgName)}</div>
<div style="font-size:22px;font-weight:700;margin-top:4px;">Tu alquiler se actualiza</div>
</td></tr>
<tr><td style="padding:24px;">
<p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hola${name ? ` ${escapeHtml(name)}` : ""}:</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55;">${escapeHtml(sentence)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Alquiler anterior", plainMoney(n.oldAmount, n.currency))}
${row("Desde el " + longDate(n.effectiveDate), plainMoney(n.newAmount, n.currency), true)}
${n.variationPct != null ? row("Variación", `${formatVariation(n.variationPct)} · ${basis}`) : row("Motivo", basis)}
</table>
${next ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#6b7280;">${escapeHtml(next)}</p>` : ""}
<p style="margin:18px 0 0;font-size:14px;line-height:1.55;">Cualquier duda, escribinos.${contact.length ? `<br><span style="color:#6b7280;font-size:13px;">${contact.map(escapeHtml).join(" · ")}</span>` : ""}</p>
</td></tr>
<tr><td style="padding:14px 24px;background:#fafafa;border-top:1px solid #f0f0f0;font-size:12px;color:#9ca3af;">${escapeHtml(input.orgName)} · ${escapeHtml(ref)}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text };
}
