import { hoursLabel } from "@/lib/marketplace/web-settings";
import { C, FONT, escapeHtml, renderApartEmail, safeHref } from "../layout";
import {
  calloutHtml,
  detailRowsHtml,
  detailRowsText,
  paragraphHtml,
  type DetailRow,
} from "../blocks";
import { fmtDateTimeAR, fmtStayRange, guestsCountLabel, money, nightsLabel } from "../format";
import type {
  RenderedEmail,
  StaffEmailBase,
  StaffNewRequestEmail,
  StaffPaymentReportedEmail,
  StaffRequestReminderEmail,
} from "./types";

/**
 * Mails al equipo (pedido nuevo, aviso de pago, recordatorio). Misma marca,
 * pero directos: todo lo necesario para responder sin abrir el panel, y el
 * link al panel para actuar.
 */

const STAFF_FOOTER = `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">Aviso automático de la web de apart para el equipo.</p>`;

function link(label: string, url: string): string {
  return `<a href="${safeHref(url)}" target="_blank" rel="noopener" style="color:${C.forest};font-weight:700;text-decoration:underline;text-underline-offset:3px;">${escapeHtml(label)}</a>`;
}

/** Filas comunes: huésped, contacto, unidad, fechas, huéspedes, montos, mensaje. */
function guestAndStayRows(d: StaffEmailBase, opts?: { withMessage?: boolean; senaLabel?: string }): DetailRow[] {
  const g = d.guest;
  const rows: DetailRow[] = [
    { label: "Huésped", value: g.fullName },
    {
      label: "WhatsApp",
      value: g.phone ? `${g.phone}${g.phoneWaUrl ? ` (${g.phoneWaUrl})` : ""}` : null,
      valueHtml: g.phone ? (g.phoneWaUrl ? link(g.phone, g.phoneWaUrl) : escapeHtml(g.phone)) : null,
    },
    { label: "Email", value: g.email, valueHtml: g.email ? link(g.email, `mailto:${g.email}`) : null },
    { label: "Documento", value: g.document },
    { label: "Unidad", value: `${d.stay.unitTitle}${d.stay.hood ? ` (${d.stay.hood})` : ""}` },
    {
      label: "Fechas",
      value: `${fmtStayRange(d.stay.checkIn, d.stay.checkOut)} · ${nightsLabel(d.stay.nights)}`,
    },
    { label: "Huéspedes", value: guestsCountLabel(d.stay.guests) },
    { label: "Total", value: money(d.money.total, d.money.currency) },
    {
      label: opts?.senaLabel ?? "Seña estimada",
      value: d.money.sena != null && d.money.sena > 0 ? money(d.money.sena, d.money.currency) : "Sin seña",
    },
    { label: "Código", value: d.code },
  ];
  if (opts?.withMessage !== false && g.message && g.message.trim()) {
    rows.push({ label: "Mensaje", value: g.message.trim() });
  }
  return rows;
}

function textBlock(title: string, intro: string, rows: DetailRow[], extra: string[], d: StaffEmailBase, ctaLabel: string): string {
  return [
    title,
    intro,
    detailRowsText(rows),
    ...extra,
    `${ctaLabel}: ${d.panelUrl}`,
    d.statusUrl ? `Lo que ve el huésped: ${d.statusUrl}` : "",
    "Aviso automático de la web de apart.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Equipo · "Nuevo pedido web" (o "Nueva reserva web" si fue inmediata). */
export function renderStaffNewRequestEmail(d: StaffNewRequestEmail): RenderedEmail {
  const range = fmtStayRange(d.stay.checkIn, d.stay.checkOut);
  const who = d.guest.fullName || "Un huésped";
  const title = d.instant ? "Nueva reserva web" : "Nuevo pedido web";
  const expires = d.expiresAt ? ` El pedido vence el ${fmtDateTimeAR(d.expiresAt)}.` : "";
  const intro = d.instant
    ? `${who} reservó ${d.stay.unitTitle} del ${range}. Es una reserva inmediata: ya está confirmada y falta que transfiera la seña.`
    : `${who} pidió ${d.stay.unitTitle} del ${range}. Le prometimos respuesta en menos de ${hoursLabel(d.responseHours)} por WhatsApp y mail.${expires}`;
  const ctaLabel = d.instant ? "Ver la reserva" : "Revisar y confirmar";
  const rows = guestAndStayRows(d);

  const { html } = renderApartEmail({
    preheader: `${who} · ${d.stay.unitTitle} · ${range}`,
    title,
    intro,
    bodyHtml: detailRowsHtml(rows),
    cta: { label: ctaLabel, url: d.panelUrl },
    secondary: d.statusUrl ? { label: "Ver lo que ve el huésped", url: d.statusUrl } : undefined,
    footerHtml: STAFF_FOOTER,
  });

  return {
    subject: `${title}: ${d.stay.unitTitle}, ${range} · ${who}`,
    html,
    text: textBlock(title, intro, rows, [], d, ctaLabel),
  };
}

/** Equipo · aviso de pago de la seña ("Ya transferí"). */
export function renderStaffPaymentReportedEmail(d: StaffPaymentReportedEmail): RenderedEmail {
  const range = fmtStayRange(d.stay.checkIn, d.stay.checkOut);
  const who = d.guest.fullName || "Un huésped";
  const amount = d.reportedAmount != null && d.reportedAmount > 0 ? money(d.reportedAmount, d.money.currency) : null;
  const intro = `${who} avisó que transfirió${amount ? ` ${amount}` : " la seña"} por ${d.stay.unitTitle} del ${range}.`;
  const steps =
    "Verificá que la transferencia haya entrado, registrá el cobro en Caja y después marcá el aviso como registrado: ahí el huésped recibe el mail de reserva asegurada.";

  const rows: DetailRow[] = [
    { label: "Monto informado", value: amount ?? "No lo indicó" },
    { label: "Comprobante", value: d.hasReceipt ? "Adjunto (lo ves en el panel)" : "Sin comprobante" },
    { label: "Nota del huésped", value: d.note?.trim() || null },
    { label: "Registrado en Caja", value: money(d.paid, d.money.currency) },
    ...guestAndStayRows(d, { withMessage: false, senaLabel: "Seña pedida" }),
  ];

  const { html } = renderApartEmail({
    preheader: `${who} avisó que transfirió${amount ? ` ${amount}` : " la seña"} · ${d.stay.unitTitle}`,
    title: "Aviso de pago de la seña",
    intro,
    bodyHtml: [
      calloutHtml({ tone: "coral", title: "Primero registrá el cobro en Caja", bodyHtml: escapeHtml(steps) }),
      detailRowsHtml(rows),
    ].join("\n"),
    cta: { label: "Ver el aviso", url: d.panelUrl },
    secondary: d.statusUrl ? { label: "Ver lo que ve el huésped", url: d.statusUrl } : undefined,
    footerHtml: STAFF_FOOTER,
  });

  return {
    subject: `Aviso de pago: ${who} · ${d.stay.unitTitle}, ${range}`,
    html,
    text: textBlock("Aviso de pago de la seña", intro, rows, [steps], d, "Ver el aviso"),
  };
}

/** Equipo · recordatorio de un pedido que sigue sin respuesta. */
export function renderStaffRequestReminderEmail(d: StaffRequestReminderEmail): RenderedEmail {
  const range = fmtStayRange(d.stay.checkIn, d.stay.checkOut);
  const who = d.guest.fullName || "Un huésped";
  const intro = `${who} pidió ${d.stay.unitTitle} del ${range} el ${fmtDateTimeAR(d.createdAt)} y todavía no tiene respuesta. Le prometimos contestar en menos de ${hoursLabel(d.responseHours)}.`;
  const expiry = d.expiresAt
    ? `El pedido vence el ${fmtDateTimeAR(d.expiresAt)}. Si vence sin respuesta, le avisamos al huésped que no pudimos confirmarle.`
    : "Si vence sin respuesta, le avisamos al huésped que no pudimos confirmarle.";
  const rows = guestAndStayRows(d);

  const { html } = renderApartEmail({
    preheader: `${who} espera respuesta · ${d.stay.unitTitle} · ${range}`,
    title: "Hay un pedido esperando respuesta",
    intro,
    bodyHtml: [paragraphHtml(expiry), detailRowsHtml(rows)].join("\n"),
    cta: { label: "Responder el pedido", url: d.panelUrl },
    secondary: d.statusUrl ? { label: "Ver lo que ve el huésped", url: d.statusUrl } : undefined,
    footerHtml: STAFF_FOOTER,
  });

  return {
    subject: `Pedido sin responder: ${who} · ${d.stay.unitTitle}, ${range}`,
    html,
    text: textBlock("Hay un pedido esperando respuesta", intro, rows, [expiry], d, "Responder el pedido"),
  };
}
