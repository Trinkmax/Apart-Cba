import "server-only";
import { formatDate, formatMoney } from "@/lib/format";
import { formatReceiptNumber } from "@/lib/rentals/labels";
import type { RentalReceiptData } from "@/lib/pdf/rental-receipt-pdf";
import type { ReminderData } from "@/lib/rentals/server/collections-queries";
import {
  RECEIPT_LEGEND,
  buildReceiptWhatsappText,
  buildReminderWhatsappText,
  firstNameOf,
  reminderTotal,
} from "@/components/rentals/collections/messages";

/**
 * Mails de Cobranzas al inquilino: el recibo (con el PDF adjunto) y el aviso
 * de pago. HTML con estilos inline y el color de marca de la org; todo texto
 * dinámico va escapado. El envío lo hace la action con `sendGuestMail`
 * (remitente de la org).
 */

const DEFAULT_BRAND = "#0F766E";

function esc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandOf(hex: string | null | undefined): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim() : DEFAULT_BRAND;
}

function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function layout(opts: { brand: string; orgName: string; logoUrl: string | null; title: string; body: string; footer: string }): string {
  const logo = safeUrl(opts.logoUrl);
  const head = logo
    ? `<img src="${esc(logo)}" alt="${esc(opts.orgName)}" height="40" style="display:block;max-height:40px;border:0">`
    : `<span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:.2px">${esc(opts.orgName)}</span>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:${opts.brand};padding:20px 24px">${head}</td></tr>
<tr><td style="padding:24px">${opts.body}</td></tr>
<tr><td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b">${opts.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function contactFooter(org: { name: string; contact_email?: string | null; contact_phone?: string | null }): string {
  const parts = [esc(org.name), org.contact_phone ? esc(org.contact_phone) : null, org.contact_email ? esc(org.contact_email) : null].filter(Boolean);
  return `${parts.join(" · ")}<br>Si tenés alguna duda, respondé este mail.`;
}

function row(label: string, value: string, strong = false): string {
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#475569">${label}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;${strong ? "font-weight:700;color:#0f172a" : "color:#0f172a"};white-space:nowrap">${value}</td></tr>`;
}

function cta(href: string, label: string, brand: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px"><tr><td style="border-radius:10px;background:${brand}"><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${esc(label)}</a></td></tr></table>`;
}

const money = (n: number, currency: string) => esc(formatMoney(n, currency).replace(/\s/g, " "));

export function renderReceiptEmail(data: RentalReceiptData, opts: { portalUrl?: string | null } = {}): { subject: string; html: string; text: string } {
  const { receipt: r, org } = data;
  const brand = brandOf(org.primary_color);
  const number = formatReceiptNumber(r.number);
  const name = firstNameOf(data.tenant.name, data.tenant.isCompany);
  const subject = `Recibo N° ${number} · Alquiler ${data.contract.address}`;
  const lines = data.lines.map((l) => row(esc(l.description), money(l.amount, r.currency))).join("");
  const credit = data.creditLeft > 0.004 ? row("A cuenta (saldo a favor)", money(data.creditLeft, r.currency)) : "";
  const pending =
    data.pending.total > 0.004
      ? `<div style="margin-top:18px;padding:12px 14px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;font-size:13px;color:#92400e"><strong>Queda pendiente al ${esc(formatDate(data.pending.asOf))}: ${money(data.pending.total, r.currency)}</strong><br>${data.pending.items
          .slice(0, 6)
          .map((i) => `${esc(i.label)} · vence ${esc(formatDate(i.dueDate))}: ${money(i.outstanding, r.currency)}`)
          .join("<br>")}</div>`
      : `<div style="margin-top:18px;padding:12px 14px;border-radius:10px;background:#ecfdf5;border:1px solid #a7f3d0;font-size:13px;color:#047857"><strong>Con este pago quedás al día.</strong></div>`;
  const portal = safeUrl(opts.portalUrl);
  const body = `<p style="margin:0 0 6px;font-size:16px">Hola${name ? ` ${esc(name)}` : ""},</p>
<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#334155">Te enviamos el recibo de tu pago del alquiler de <strong>${esc(data.contract.address)}</strong>. Lo tenés adjunto en PDF.</p>
<div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b">Recibo N° ${esc(number)} · ${esc(formatDate(r.paidAt))}</div>
<div style="font-size:28px;font-weight:700;margin:4px 0 14px;color:#0f172a">${money(r.amount, r.currency)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines}${credit}${row("Medio de pago", esc(r.methodLabel))}</table>
${pending}
${portal ? cta(portal, "Ver mi cuenta y mis recibos", brand) : ""}
<p style="margin:18px 0 0;font-size:11px;line-height:1.5;color:#94a3b8">${esc(RECEIPT_LEGEND)}</p>`;
  const html = layout({ brand, orgName: org.name, logoUrl: org.logo_url, title: subject, body, footer: contactFooter(org) });
  const text = buildReceiptWhatsappText({
    tenantName: data.tenant.name,
    isCompany: data.tenant.isCompany,
    orgName: org.name,
    address: data.contract.address,
    amount: r.amount,
    currency: r.currency,
    receiptNumber: number,
    pendingTotal: data.pending.total,
    creditLeft: data.creditLeft,
    portalUrl: portal,
  });
  return { subject, html, text };
}

export function renderReminderEmail(data: ReminderData): { subject: string; html: string; text: string } {
  const brand = brandOf(data.org.primary_color);
  const tenantName = data.tenant?.name ?? "";
  const name = firstNameOf(tenantName, data.tenant?.isCompany);
  const open = data.lines.filter((l) => l.outstanding > 0.004);
  const overdue = open.some((l) => l.dueDate < data.today);
  const subject = overdue ? `Tenés un saldo vencido · Alquiler ${data.address}` : `Recordatorio de pago · Alquiler ${data.address}`;
  const rows = open
    .map((l) => {
      const late = l.dueDate < data.today;
      const when = `${late ? "Venció" : "Vence"} el ${esc(formatDate(l.dueDate))}`;
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a">${esc(l.label)}<div style="font-size:12px;color:${late ? "#be123c" : "#64748b"}">${when}</div></td><td align="right" style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:600;white-space:nowrap">${money(l.outstanding, data.currency)}</td></tr>`;
    })
    .join("");
  const total = open.length > 1 ? row("<strong>Total</strong>", money(reminderTotal(open), data.currency), true) : "";
  const lateNote = data.hasLateFees
    ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#64748b">${
        overdue
          ? "Al pagar se suman los intereses por mora que fija el contrato, calculados al día del pago."
          : "Después del vencimiento se suman intereses por mora, como dice el contrato."
      }</p>`
    : "";
  const instructions = data.paymentInstructions?.trim();
  const how = instructions
    ? `<div style="margin-top:18px;padding:14px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:6px">Cómo pagar</div><div style="font-size:14px;line-height:1.6;color:#0f172a;white-space:pre-wrap">${esc(instructions)}</div></div>`
    : "";
  const portal = safeUrl(data.portalUrl);
  const body = `<p style="margin:0 0 6px;font-size:16px">Hola${name ? ` ${esc(name)}` : ""},</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155">${
    overdue ? "Te escribimos por el alquiler de" : "Te recordamos lo que vence del alquiler de"
  } <strong>${esc(data.address)}</strong>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${total}</table>
${lateNote}${how}
${portal ? cta(portal, "Avisar el pago y subir el comprobante", brand) : `<p style="margin:18px 0 0;font-size:14px;color:#334155">Cuando pagues, respondé este mail con el comprobante.</p>`}`;
  const html = layout({ brand, orgName: data.org.name, logoUrl: data.org.logo_url, title: subject, body, footer: contactFooter(data.org) });
  const text = buildReminderWhatsappText({
    tenantName,
    isCompany: data.tenant?.isCompany,
    orgName: data.org.name,
    address: data.address,
    currency: data.currency,
    today: data.today,
    lines: open,
    hasLateFees: data.hasLateFees,
    paymentInstructions: data.paymentInstructions,
    portalUrl: portal,
  });
  return { subject, html, text };
}
