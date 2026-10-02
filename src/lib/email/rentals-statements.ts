import "server-only";
import { formatDate, formatMoney } from "@/lib/format";
import type { StatementDocModel } from "@/components/rentals/statements/statement-model";

/**
 * Mail de la rendición al propietario: resumen de lo cobrado y lo descontado,
 * neto bien grande, link al documento (y el PDF adjunto). HTML de tablas con
 * estilos inline y el color de marca de la org; todo texto dinámico escapado.
 */

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandOf(hex: string | null | undefined): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#0F766E";
}

function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

export function renderStatementEmail(args: {
  model: StatementDocModel;
  orgName: string;
  brandColor: string | null;
  publicUrl: string;
  contactEmail: string | null;
  contactPhone: string | null;
  hasAttachment: boolean;
}): { subject: string; html: string; text: string } {
  const { model: m, orgName } = args;
  const brand = brandOf(args.brandColor);
  const c = m.currency;
  const net = m.totals.net;
  // Una rendición cerrada con saldo a cuenta (neto <= 0) está 'pagada' pero no se transfirió nada.
  const paid = m.status === "pagada" && net > 0;
  const netLabel = net < 0 ? "Saldo a tu cargo" : paid ? "Neto transferido" : net > 0 ? "Neto a transferirte" : "Neto";
  const subject = `Rendición N° ${m.number} · ${m.periodLabel} · ${net < 0 ? `saldo a tu cargo ${formatMoney(Math.abs(net), c)}` : formatMoney(net, c)}`;
  const intro = `Te mandamos la rendición N° ${m.number} con lo cobrado hasta el ${formatDate(m.cutoffDate)}.`;
  const paidLine =
    paid && m.paidAt
      ? `Ya te transferimos el neto el ${formatDate(m.paidAt)}.`
      : net < 0
        ? "Este período los gastos superaron lo cobrado: ese saldo se descuenta de tu próxima rendición."
        : null;

  const rows: { label: string; value: string; strong?: boolean; negative?: boolean }[] = [
    { label: `Cobrado (${m.collectedCount} ${m.collectedCount === 1 ? "cobro" : "cobros"})`, value: formatMoney(m.totals.collected, c) },
  ];
  if (m.totals.fees) rows.push({ label: "Honorarios de administración", value: `- ${formatMoney(m.totals.fees, c)}`, negative: true });
  if (m.totals.vat) rows.push({ label: "IVA sobre honorarios", value: `- ${formatMoney(m.totals.vat, c)}`, negative: true });
  if (m.totals.expenses) rows.push({ label: "Gastos a tu cargo", value: `- ${formatMoney(m.totals.expenses, c)}`, negative: true });
  if (m.totals.other) {
    rows.push({
      label: m.totals.other < 0 ? "Otros descuentos" : "Otros conceptos",
      value: m.totals.other < 0 ? `- ${formatMoney(-m.totals.other, c)}` : formatMoney(m.totals.other, c),
      negative: m.totals.other < 0,
    });
  }

  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td style="padding:8px 0;color:#475569;font-size:14px;">${esc(r.label)}</td><td style="padding:8px 0;text-align:right;font-size:14px;color:${r.negative ? "#be123c" : "#0f172a"};white-space:nowrap;">${esc(r.value)}</td></tr>`,
    )
    .join("");
  const groupsHtml = m.groups
    .map(
      (g) =>
        `<tr><td style="padding:6px 0;font-size:13px;color:#334155;">${esc(g.label)}${g.sharePct ? ` <span style="color:#94a3b8;">(tu parte ${esc(g.sharePct.toLocaleString("es-AR"))} %)</span>` : ""}</td><td style="padding:6px 0;text-align:right;font-size:13px;color:#334155;white-space:nowrap;">${esc(formatMoney(g.subtotal.net, c))}</td></tr>`,
    )
    .join("");
  const contact = [args.contactEmail, args.contactPhone].filter(Boolean).join(" · ");
  const href = safeHref(args.publicUrl);

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<span style="display:none!important;opacity:0;color:transparent;max-height:0;overflow:hidden;">${esc(`${netLabel}: ${formatMoney(Math.abs(net), c)}`)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:${brand};padding:22px 28px;color:#ffffff;">
<div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">${esc(orgName)}</div>
<div style="font-size:20px;font-weight:700;margin-top:6px;">Rendición N° ${esc(m.number)}</div>
<div style="font-size:14px;opacity:0.9;margin-top:2px;">${esc(m.periodLabel)} · cobros hasta el ${esc(formatDate(m.cutoffDate))}</div>
</td></tr>
<tr><td style="padding:24px 28px 8px;">
<p style="margin:0 0 10px;font-size:15px;">Hola ${esc(firstName(m.owner.full_name))},</p>
<p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#334155;">${esc(intro)}</p>
${paidLine ? `<p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:${paid ? "#047857" : "#334155"};">${esc(paidLine)}</p>` : ""}
</td></tr>
<tr><td style="padding:8px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;">${rowsHtml}
<tr><td style="padding:14px 0 4px;border-top:2px solid ${brand};font-size:15px;font-weight:700;color:${brand};">${esc(netLabel)}</td><td style="padding:14px 0 4px;border-top:2px solid ${brand};text-align:right;font-size:22px;font-weight:700;color:${brand};white-space:nowrap;">${esc(formatMoney(Math.abs(net), c))}</td></tr>
</table></td></tr>
${m.groups.length > 1 ? `<tr><td style="padding:12px 28px 0;"><div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Por propiedad</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${groupsHtml}</table></td></tr>` : ""}
<tr><td align="center" style="padding:24px 28px 8px;">
<a href="${esc(href)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px;">Ver la rendición completa</a>
<div style="font-size:12px;color:#64748b;margin-top:10px;">${args.hasAttachment ? "También te la adjuntamos en PDF." : "Desde el link podés bajar el PDF."}</div>
</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;">
${esc(orgName)}${contact ? ` · ${esc(contact)}` : ""}<br>Si algo no te cierra, respondé este mail y lo revisamos.
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Hola ${firstName(m.owner.full_name)},`,
    "",
    intro,
    ...(paidLine ? [paidLine] : []),
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    `${netLabel}: ${formatMoney(Math.abs(net), c)}`,
    "",
    `Ver la rendición completa: ${args.publicUrl}`,
    "",
    `${orgName}${contact ? ` · ${contact}` : ""}`,
  ].join("\n");

  return { subject, html, text };
}
