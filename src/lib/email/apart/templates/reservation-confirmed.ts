import { renderApartEmail } from "../layout";
import {
  TEXT_SIGNATURE,
  brandLineHtml,
  calloutHtml,
  codeLineHtml,
  contactFooterHtml,
  contactText,
  eyebrowHtml,
  moneyTableHtml,
  moneyText,
  paragraphHtml,
  richParagraphHtml,
  stayCardHtml,
  stayText,
  stepsHtml,
  stepsText,
  strong,
  transferBlockHtml,
  transferText,
  type MoneyRow,
  type StepItem,
} from "../blocks";
import { ctaButtonHtml, escapeHtml, safeHref } from "../layout";
import { fmtDateTimeAR, fmtStayRange, money } from "../format";
import type { RenderedEmail, ReservationConfirmedEmail } from "./types";

/**
 * Huésped · reserva confirmada. Con seña: monto, vencimiento y datos para
 * transferir (o "te los pasamos por WhatsApp" si el equipo no los cargó).
 * Sin seña: la reserva ya queda asegurada.
 */
export function renderReservationConfirmedEmail(d: ReservationConfirmedEmail): RenderedEmail {
  const range = fmtStayRange(d.stay.checkIn, d.stay.checkOut);
  const hasSena = d.money.sena != null && d.money.sena > 0;
  const senaLabel = hasSena ? money(d.money.sena, d.money.currency) : "";
  const due = hasSena && d.senaDueAt ? fmtDateTimeAR(d.senaDueAt) : null;
  const dueText = due ? `antes del ${due}` : "lo antes posible";
  const hola = d.guestFirstName ? `Hola, ${d.guestFirstName}.` : "Hola.";
  const paid = d.paid != null && Number.isFinite(d.paid) && d.paid > 0 ? d.paid : 0;

  let title: string;
  let intro: string;
  let subject: string;
  if (hasSena) {
    title = d.instant ? "¡Reservado! Falta la seña" : "¡Confirmado! Falta la seña";
    intro = d.instant
      ? `${hola} Tu reserva en ${d.stay.unitTitle} del ${range} quedó confirmada. Para asegurarla, transferí la seña de ${senaLabel} ${dueText}. El resto lo pagás al llegar.`
      : `${hola} ¡Tenemos lugar para vos! Confirmamos tu pedido en ${d.stay.unitTitle} del ${range}. Para asegurar tus fechas, transferí la seña de ${senaLabel} ${dueText}. El resto lo pagás al llegar.`;
    subject = `Confirmado: ${d.stay.unitTitle}, ${range}. Falta la seña`;
  } else if (paid > 0) {
    title = "Todo listo. Dale, pasá.";
    const rest = d.money.resto > 0 ? " El resto lo pagás al llegar." : "";
    intro = `${hola} Tu reserva en ${d.stay.unitTitle} del ${range} está confirmada y asegurada: ya registramos tu pago de ${money(paid, d.money.currency)}.${rest} Uno o dos días antes te escribimos para coordinar la entrega de llaves.`;
    subject = `Reserva confirmada: ${d.stay.unitTitle}, ${range}`;
  } else {
    title = "Todo listo. Dale, pasá.";
    intro = `${hola} Tu reserva en ${d.stay.unitTitle} del ${range} está confirmada. No hace falta seña: pagás la estadía al llegar. Uno o dos días antes te escribimos para coordinar la entrega de llaves.`;
    subject = `Reserva confirmada: ${d.stay.unitTitle}, ${range}`;
  }

  const rows: MoneyRow[] = [{ label: "Total de la estadía", value: money(d.money.total, d.money.currency), strong: true }];
  if (!hasSena && paid > 0) {
    rows.push({ label: "Ya pagaste", value: money(paid, d.money.currency) });
  }
  if (hasSena) {
    rows.push({
      label: "Seña a transferir",
      value: senaLabel,
      note: due ? `Vence el ${due}` : null,
      highlight: true,
    });
  }
  rows.push({
    label: "Al llegar",
    value: money(d.money.resto, d.money.currency),
    note: "En efectivo o por transferencia, el día de la entrega de llaves.",
  });

  const parts: string[] = [stayCardHtml(d.stay), moneyTableHtml(rows)];
  const textParts: string[] = [title, intro, stayText(d.stay), moneyText(rows)];

  if (hasSena) {
    parts.push(eyebrowHtml("Datos para transferir"));
    if (d.transfer) {
      parts.push(
        richParagraphHtml(`Transferí ${strong(senaLabel)} ${escapeHtml(dueText)} a esta cuenta:`),
        transferBlockHtml(d.transfer),
        // La acción que sigue, al lado de los datos: el huésped vuelve a este
        // mail después de transferir.
        `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td align="left" style="padding:20px 0 0;">${ctaButtonHtml({ label: "Avisar que transferí", url: d.statusUrl, tone: "coral" })}</td></tr></table>`,
      );
      textParts.push(`Datos para transferir (${senaLabel}, ${dueText}):\n${transferText(d.transfer)}`);
    } else {
      const wa = d.contact.whatsappUrl
        ? ` <a href="${safeHref(d.contact.whatsappUrl)}" target="_blank" rel="noopener" style="color:#145447;font-weight:700;">Escribinos por WhatsApp</a> si no te llegan en un rato.`
        : "";
      parts.push(
        calloutHtml({
          tone: "leaf",
          title: "Te pasamos los datos por WhatsApp",
          bodyHtml: `En breve te escribimos con el alias o CBU para transferir ${strong(senaLabel)}.${wa}`,
        }),
      );
      textParts.push(`Datos para transferir: te los pasamos por WhatsApp en breve (seña de ${senaLabel}, ${dueText}).`);
    }

    const steps: StepItem[] = [
      { title: "Transferí la seña", body: `${senaLabel} ${dueText}.` },
      { title: "Avisanos", body: "Entrá a tu reserva y tocá “Avisar que transferí”. Podés adjuntar el comprobante." },
      { title: "Tu reserva queda asegurada", body: "Cuando veamos la transferencia acreditada, te lo confirmamos por mail." },
      { title: "El resto, al llegar", body: "Pagás el saldo el día que te entregamos las llaves, en efectivo o por transferencia." },
    ];
    parts.push(eyebrowHtml("Qué sigue"), stepsHtml(steps));
    textParts.push(`Qué sigue:\n${stepsText(steps)}`);
  }

  if (d.cancellation) {
    parts.push(paragraphHtml(`${d.cancellation.title}. ${d.cancellation.body}`, { muted: true, small: true }));
    textParts.push(`${d.cancellation.title}. ${d.cancellation.body}`);
  }

  parts.push(codeLineHtml(d.code), brandLineHtml(hasSena ? "Llegar debe sentirse simple." : "Sentite como en casa."));
  textParts.push(`Código de tu reserva: ${d.code}`, `Ver mi reserva: ${d.statusUrl}`, contactText(d.contact), TEXT_SIGNATURE);

  const { html } = renderApartEmail({
    preheader: hasSena
      ? `Transferí la seña de ${senaLabel} ${dueText} y tus fechas quedan aseguradas.`
      : `Tu reserva en ${d.stay.unitTitle} está confirmada. Te esperamos.`,
    title,
    intro,
    bodyHtml: parts.join("\n"),
    cta: { label: "Ver mi reserva", url: d.statusUrl },
    footerHtml: contactFooterHtml(d.contact),
  });

  return { subject, html, text: textParts.filter(Boolean).join("\n\n") };
}
