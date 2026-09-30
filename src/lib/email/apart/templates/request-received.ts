import { hoursLabel } from "@/lib/marketplace/web-settings";
import { renderApartEmail } from "../layout";
import {
  TEXT_SIGNATURE,
  brandLineHtml,
  codeLineHtml,
  contactFooterHtml,
  contactText,
  eyebrowHtml,
  moneyTableHtml,
  moneyText,
  stayCardHtml,
  stayText,
  stepsHtml,
  stepsText,
  type MoneyRow,
  type StepItem,
} from "../blocks";
import { fmtStayRange, money } from "../format";
import type { RenderedEmail, RequestReceivedEmail } from "./types";

/** Huésped · "Recibimos tu pedido" (pedido con confirmación, todavía sin pago). */
export function renderRequestReceivedEmail(d: RequestReceivedEmail): RenderedEmail {
  const hours = hoursLabel(d.responseHours);
  const range = fmtStayRange(d.stay.checkIn, d.stay.checkOut);
  const hasSena = d.money.sena != null && d.money.sena > 0;
  const hola = d.guestFirstName ? `Hola, ${d.guestFirstName}.` : "Hola.";

  const intro = `${hola} Gracias por elegirnos. Estamos revisando la disponibilidad de ${d.stay.unitTitle} y te respondemos en menos de ${hours} por WhatsApp y por mail. Todavía no pagás nada.`;

  const rows: MoneyRow[] = [{ label: "Total de la estadía", value: money(d.money.total, d.money.currency), strong: true }];
  if (hasSena) {
    rows.push({
      label: d.senaRuleLabel ? `Seña (${d.senaRuleLabel})` : "Seña",
      value: money(d.money.sena, d.money.currency),
      note: "La transferís recién cuando te confirmamos.",
      highlight: true,
    });
  }
  rows.push({
    label: "Al llegar",
    value: money(d.money.resto, d.money.currency),
    note: "En efectivo o por transferencia, el día de la entrega de llaves.",
  });

  const steps: StepItem[] = [
    { title: "Pedís tus fechas", body: "Listo. Todavía no pagás nada.", done: true },
    { title: "Te confirmamos", body: `Te respondemos en menos de ${hours} por WhatsApp y mail.` },
  ];
  if (hasSena) {
    steps.push({
      title: `Señás${d.senaRuleLabel ? ` ${d.senaRuleLabel}` : ""}`,
      body: "Transferís la seña para asegurar tus fechas. Te pasamos los datos al confirmar.",
    });
  }
  steps.push({
    title: "El resto, al llegar",
    body: "Pagás el saldo el día que te entregamos las llaves, en efectivo o por transferencia.",
  });

  const bodyHtml = [
    stayCardHtml(d.stay),
    moneyTableHtml(rows),
    eyebrowHtml("Qué sigue"),
    stepsHtml(steps),
    codeLineHtml(d.code),
    brandLineHtml("Tu lugar en Córdoba, por el tiempo que necesites."),
  ].join("\n");

  const { html } = renderApartEmail({
    preheader: `Todavía no pagás nada. Te respondemos en menos de ${hours} por WhatsApp y mail.`,
    title: "Recibimos tu pedido",
    intro,
    bodyHtml,
    cta: { label: "Ver mi reserva", url: d.statusUrl },
    footerHtml: contactFooterHtml(d.contact),
  });

  const text = [
    "Recibimos tu pedido.",
    intro,
    stayText(d.stay),
    moneyText(rows),
    `Qué sigue:\n${stepsText(steps)}`,
    `Código de tu reserva: ${d.code}`,
    `Ver mi reserva: ${d.statusUrl}`,
    contactText(d.contact),
    TEXT_SIGNATURE,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    subject: `Recibimos tu pedido: ${d.stay.unitTitle}, ${range}`,
    html,
    text,
  };
}
