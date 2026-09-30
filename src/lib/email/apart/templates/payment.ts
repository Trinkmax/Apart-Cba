import { renderApartEmail } from "../layout";
import {
  TEXT_SIGNATURE,
  brandLineHtml,
  calloutHtml,
  codeLineHtml,
  contactFooterHtml,
  contactText,
  moneyTableHtml,
  moneyText,
  stayCardHtml,
  stayText,
  type MoneyRow,
} from "../blocks";
import { fmtStayRange, money } from "../format";
import type { DepositRegisteredEmail, PaymentReportedGuestEmail, RenderedEmail } from "./types";

/** Huésped · acuse del aviso "Ya transferí". Todavía NO es un cobro. */
export function renderPaymentReportedGuestEmail(d: PaymentReportedGuestEmail): RenderedEmail {
  const hola = d.guestFirstName ? `Hola, ${d.guestFirstName}.` : "Hola.";
  const amount = d.reportedAmount != null && d.reportedAmount > 0 ? money(d.reportedAmount, d.money.currency) : null;
  const intro = `${hola} Gracias por avisarnos${amount ? ` que transferiste ${amount}` : ""}. Estamos verificando la transferencia y te escribimos apenas la veamos acreditada.`;

  const rows: MoneyRow[] = [];
  if (d.money.sena != null && d.money.sena > 0) {
    rows.push({ label: "Seña", value: money(d.money.sena, d.money.currency), strong: true });
  }
  if (amount) {
    rows.push({ label: "Lo que nos avisaste", value: amount, note: d.hasReceipt ? "Con comprobante adjunto." : null, highlight: true });
  }
  rows.push({
    label: "Al llegar",
    value: money(d.money.resto, d.money.currency),
    note: "En efectivo o por transferencia, el día de la entrega de llaves.",
  });

  const pending =
    "Tu reserva queda asegurada cuando veamos la transferencia acreditada. Si pasa un día y no tenés novedades, escribinos.";

  const { html } = renderApartEmail({
    preheader: "Estamos verificando tu transferencia. Te avisamos apenas la veamos acreditada.",
    title: "Recibimos tu aviso de pago",
    intro,
    bodyHtml: [
      stayCardHtml(d.stay),
      moneyTableHtml(rows),
      calloutHtml({ tone: "leaf", title: "¿Y ahora?", bodyHtml: pending }),
      codeLineHtml(d.code),
    ].join("\n"),
    cta: { label: "Ver mi reserva", url: d.statusUrl },
    footerHtml: contactFooterHtml(d.contact),
  });

  const text = [
    "Recibimos tu aviso de pago.",
    intro,
    stayText(d.stay),
    moneyText(rows),
    pending,
    `Código de tu reserva: ${d.code}`,
    `Ver mi reserva: ${d.statusUrl}`,
    contactText(d.contact),
    TEXT_SIGNATURE,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject: `Recibimos tu aviso de pago: ${d.stay.unitTitle}`, html, text };
}

/** Huésped · "Reserva asegurada": el equipo registró la seña en Caja. */
export function renderDepositRegisteredEmail(d: DepositRegisteredEmail): RenderedEmail {
  const range = fmtStayRange(d.stay.checkIn, d.stay.checkOut);
  const hola = d.guestFirstName ? `Hola, ${d.guestFirstName}.` : "Hola.";
  const paid = money(d.paid, d.money.currency);
  const intro = `${hola} Recibimos tu pago de ${paid} y tu reserva en ${d.stay.unitTitle} del ${range} está asegurada. Uno o dos días antes de tu llegada te escribimos para coordinar la entrega de llaves.`;

  const rows: MoneyRow[] = [
    { label: "Total de la estadía", value: money(d.money.total, d.money.currency), strong: true },
    { label: "Ya pagaste", value: paid },
    {
      label: "Al llegar",
      value: money(d.money.resto, d.money.currency),
      note: "En efectivo o por transferencia, el día de la entrega de llaves.",
      highlight: d.money.resto > 0,
    },
  ];

  const { html } = renderApartEmail({
    preheader: `Tu reserva en ${d.stay.unitTitle} está asegurada. Te esperamos.`,
    title: "Todo listo. Dale, pasá.",
    intro,
    bodyHtml: [
      stayCardHtml(d.stay),
      moneyTableHtml(rows),
      codeLineHtml(d.code),
      brandLineHtml("Este lugar es tuyo por unos días."),
    ].join("\n"),
    cta: { label: "Ver mi reserva", url: d.statusUrl },
    footerHtml: contactFooterHtml(d.contact),
  });

  const text = [
    "Todo listo. Dale, pasá.",
    intro,
    stayText(d.stay),
    moneyText(rows),
    `Código de tu reserva: ${d.code}`,
    `Ver mi reserva: ${d.statusUrl}`,
    contactText(d.contact),
    TEXT_SIGNATURE,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject: `Tu reserva está asegurada: ${d.stay.unitTitle}, ${range}`, html, text };
}
