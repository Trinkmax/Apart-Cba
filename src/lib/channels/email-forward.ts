import { htmlToText } from "@/lib/inbound/parse-utils";
import type { ResendInboundEmail } from "@/lib/inbound/types";

/**
 * Un mail de la OTA reenviado A MANO desde la casilla de la organización
 * ("Fwd: Reserva confirmada: Kevin… llega el 12 nov.").
 *
 * Llega con el remitente de la org (gmail.com) y el asunto con prefijo, así que
 * ningún parser lo reconocía y terminaba como incidencia, justo cuando la
 * persona lo había mandado para que se cargara (Viaggiato, 12/11/2026: tres
 * confirmaciones reenviadas a mano, tres "Email de OTA no reconocido").
 *
 * Si el asunto trae prefijo de reenvío y el cuerpo trae el encabezado del
 * mensaje original con un remitente de Airbnb o Booking, se devuelve el mail
 * "desenvuelto": ese remitente y el asunto sin prefijo. El cuerpo queda igual
 * (el parser lo lee completo, con el encabezado incluido). Si no se puede
 * afirmar que es un reenvío de una OTA, el mail vuelve tal cual.
 */
export function unwrapForwardedEmail(email: ResendInboundEmail): ResendInboundEmail {
  const subject = email.subject ?? "";
  if (!FORWARD_PREFIX.test(subject)) return email;
  const body = htmlToText(email.html) || email.text || "";
  const sender = body.match(OTA_SENDER_LINE)?.[1];
  if (!sender) return email;
  return {
    ...email,
    from: sender.toLowerCase(),
    subject: subject.replace(FORWARD_PREFIX, "").trim(),
  };
}

// "Fwd:", "Fw:", "RV:" (Outlook en español), "Reenviado:", "TR:" — repetidos si
// el mail se reenvió más de una vez.
const FORWARD_PREFIX = /^\s*(?:(?:fwd?|rv|tr|reenviado)\s*:\s*)+/i;

// La línea "De:"/"From:" del encabezado del reenvío (Gmail en español o en
// inglés, Outlook): "De: Airbnb <automated@airbnb.com>".
const OTA_SENDER_LINE =
  /(?:^|\n)[\s>*]*(?:de|from)\s*:\s*[^\n]*?([\w.+-]+@(?:[\w-]+\.)*(?:airbnb\.[a-z.]+|booking\.com))/i;
