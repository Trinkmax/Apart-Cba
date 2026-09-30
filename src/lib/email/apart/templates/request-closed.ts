import { renderApartEmail } from "../layout";
import {
  TEXT_SIGNATURE,
  calloutHtml,
  codeLineHtml,
  contactFooterHtml,
  contactText,
  paragraphHtml,
  stayCardHtml,
  stayText,
} from "../blocks";
import { escapeMultiline } from "../layout";
import { fmtStayRange } from "../format";
import type { RenderedEmail, RequestExpiredEmail, RequestRejectedEmail } from "./types";

/**
 * Pedidos que no llegaron a reserva: rechazado (no disponible) y vencido sin
 * respuesta. En los dos: no se cobró nada, y el camino para seguir es buscar
 * otras fechas o escribirnos. El link de seguimiento va igual.
 */

/** Huésped · "No pudimos confirmar tu pedido". */
export function renderRequestRejectedEmail(d: RequestRejectedEmail): RenderedEmail {
  const range = fmtStayRange(d.stay.checkIn, d.stay.checkOut);
  const hola = d.guestFirstName ? `Hola, ${d.guestFirstName}.` : "Hola.";
  const intro = `${hola} Lo sentimos: no pudimos confirmar tu pedido en ${d.stay.unitTitle} del ${range}. No se te cobró nada.`;
  const reason = (d.reason ?? "").trim();
  const next =
    "Probá con otras fechas o con otro de nuestros departamentos. Si preferís, escribinos y te ayudamos a encontrar lugar.";

  const parts = [stayCardHtml(d.stay)];
  if (reason) {
    parts.push(calloutHtml({ tone: "cream", title: "Motivo", bodyHtml: escapeMultiline(reason) }));
  }
  parts.push(paragraphHtml(next), codeLineHtml(d.code, "Código de tu pedido"));

  const { html } = renderApartEmail({
    preheader: "Esas fechas no están disponibles. Te ayudamos a encontrar otras.",
    title: "No pudimos confirmar tu pedido",
    intro,
    bodyHtml: parts.join("\n"),
    cta: { label: "Buscar otras fechas", url: d.searchUrl },
    secondary: { label: "Ver mi pedido", url: d.statusUrl },
    footerHtml: contactFooterHtml(d.contact),
  });

  const text = [
    "No pudimos confirmar tu pedido.",
    intro,
    stayText(d.stay),
    reason ? `Motivo: ${reason}` : "",
    next,
    `Buscar otras fechas: ${d.searchUrl}`,
    `Ver mi pedido (${d.code}): ${d.statusUrl}`,
    contactText(d.contact),
    TEXT_SIGNATURE,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject: `No pudimos confirmar tu pedido en ${d.stay.unitTitle}`, html, text };
}

/** Huésped · "Tu pedido venció sin respuesta". */
export function renderRequestExpiredEmail(d: RequestExpiredEmail): RenderedEmail {
  const range = fmtStayRange(d.stay.checkIn, d.stay.checkOut);
  const hola = d.guestFirstName ? `Hola, ${d.guestFirstName}.` : "Hola.";
  const intro = `${hola} Perdón: no llegamos a confirmarte a tiempo tu pedido en ${d.stay.unitTitle} del ${range}, así que venció. No se te cobró nada.`;
  const next = d.contact.whatsappUrl
    ? "Si todavía te interesa, escribinos por WhatsApp y lo resolvemos, o probá con otras fechas."
    : "Si todavía te interesa, escribinos y lo resolvemos, o probá con otras fechas.";

  const parts = [stayCardHtml(d.stay), paragraphHtml(next), codeLineHtml(d.code, "Código de tu pedido")];

  const { html } = renderApartEmail({
    preheader: "No llegamos a confirmarte a tiempo. Escribinos y lo resolvemos.",
    title: "Tu pedido venció sin respuesta",
    intro,
    bodyHtml: parts.join("\n"),
    cta: d.contact.whatsappUrl
      ? { label: "Escribinos por WhatsApp", url: d.contact.whatsappUrl }
      : { label: "Buscar otras fechas", url: d.searchUrl },
    secondary: { label: "Ver mi pedido", url: d.statusUrl },
    footerHtml: contactFooterHtml(d.contact),
  });

  const text = [
    "Tu pedido venció sin respuesta.",
    intro,
    stayText(d.stay),
    next,
    `Buscar otras fechas: ${d.searchUrl}`,
    `Ver mi pedido (${d.code}): ${d.statusUrl}`,
    contactText(d.contact),
    TEXT_SIGNATURE,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject: `Tu pedido para ${d.stay.unitTitle} venció`, html, text };
}
