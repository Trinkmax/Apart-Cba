import { htmlToText } from "@/lib/inbound/parse-utils";

/**
 * Confirmación de reenvío de Gmail.
 *
 * Gmail no reenvía NADA a una dirección nueva hasta que esa dirección acepta:
 * le manda un mail (forwarding-noreply@google.com) con un código de 9 dígitos
 * y un enlace. Acá esa dirección es ota-<token>@…, que no es una casilla que
 * lea una persona: el mail cae en nuestro webhook. Si no lo mostramos en
 * Canales, nadie puede terminar la configuración.
 *
 * Y ese mail NO prueba que el reenvío funcione: llega antes de que Gmail
 * reenvíe nada. Contarlo como "primer email" marcaba Funcionando a casillas que
 * nunca reenviaron (Habitana desde el 07/09/2026, Viaggiato el 09/11/2026:
 * ningún mail de Airbnb ni de Booking en ninguna de las dos).
 */

/** `payload.ignored` del channel_event que guarda la confirmación. */
export const GMAIL_FORWARDING_LABEL = "reenvio_gmail";

export interface GmailForwardingConfirmation {
  /** Lo que Gmail pide en Configuración → Reenvío → «Verificar». */
  code: string | null;
  /** Enlace de Gmail que confirma con un clic. Sólo hosts de Google (ver safeGmailConfirmUrl). */
  confirmUrl: string | null;
  /** La cuenta que pidió reenviar sus mails. */
  requester: string | null;
}

/** Un pedido de confirmación tal como quedó guardado, con la hora en que llegó. */
export interface ForwardingRequest extends GmailForwardingConfirmation {
  receivedAt: string;
}

// El dominio tiene que terminar ahí: "…@google.com.otro.com" no es Google.
const FORWARDING_SENDER = /forwarding-noreply@google\.com(?:>|\s|$)/i;
const GOOGLE_SENDER = /@(?:[a-z0-9-]+\.)*google\.com(?:>|\s|$)/i;
const FORWARDING_SUBJECT =
  /forwarding confirmation|confirmaci[oó]n de reenv[ií]o|confirma[cç][aã]o de encaminhamento|confirmation de transfert|conferma (?:di )?inoltro/i;

export function isGmailForwardingConfirmation(from: string, subject: string): boolean {
  if (FORWARDING_SENDER.test(from)) return true;
  return GOOGLE_SENDER.test(from) && FORWARDING_SUBJECT.test(subject);
}

// "Código de confirmación: 123456789" — y, más abajo, "enviar el código de
// confirmación 123456789 a …". Cualquiera de los dos sirve: es el mismo número.
const CODE_LABEL =
  /(?:c[oó]digo de confirmaci[oó]n|confirmation code|c[oó]digo de confirma[cç][aã]o|code de confirmation|codice di conferma|best[äa]tigungscode)\s*:?\s*(\d{6,12})\b/i;
// La versión en inglés lo pone en el asunto: "(#123456789) Gmail Forwarding Confirmation…".
const CODE_IN_SUBJECT = /\(\s*(?:#|n\.?\s*[º°o]\.?)\s*(\d{6,12})\s*\)/i;
const NINE_DIGITS = /(?<![\w.])(\d{9})(?!\w)/;

const CONFIRM_URL = /https:\/\/[a-z0-9.-]+\.google\.com\/mail\/(?:u\/\d+\/)?vf-[^\s"'<>]+/gi;
const CONFIRM_HOSTS = new Set(["mail-settings.google.com", "mail.google.com", "isolated.mail.google.com"]);

const REQUESTER_SUBJECT =
  /(?:recibir correo de|receive mail from|receber e-?mails? de|recevoir (?:des )?(?:e-?mails|messages) de|ricevere (?:la )?posta da)\s+([^\s<>()"',;]+@[^\s<>()"',;]+)/i;
const REQUESTER_BODY =
  /([^\s<>()"',;:]+@[^\s<>()"',;:]+)\s+(?:ha solicitado|has requested|solicitou|a demandé|ha richiesto)/i;

/**
 * Devuelve null si el mail no es una confirmación de reenvío de Gmail. Si lo
 * es pero no se pudo leer algún dato, ese dato viene en null: igual es una
 * confirmación (no cuenta como mail reenviado y Canales lo muestra).
 */
export function parseGmailForwardingConfirmation(email: {
  from: string;
  subject: string;
  text?: string | null;
  html?: string | null;
}): GmailForwardingConfirmation | null {
  const subject = email.subject ?? "";
  if (!isGmailForwardingConfirmation(email.from ?? "", subject)) return null;

  const html = email.html ?? "";
  const text = [email.text ?? "", htmlToText(html)].join("\n");
  return {
    code: extractCode(subject, text),
    confirmUrl: extractConfirmUrl(text, html),
    requester: requesterFromSubject(subject) ?? matchEmail(text, REQUESTER_BODY),
  };
}

function extractCode(subject: string, text: string): string | null {
  const labeled = text.match(CODE_LABEL);
  if (labeled) return labeled[1];
  const inSubject = subject.match(CODE_IN_SUBJECT);
  if (inSubject) return inSubject[1];
  // Último recurso, sin las URLs: el enlace trae tramos de dígitos.
  const bare = text.replace(/https?:\/\/\S+/gi, " ").match(NINE_DIGITS);
  return bare ? bare[1] : null;
}

function extractConfirmUrl(text: string, html: string): string | null {
  for (const source of [text, html.replace(/&amp;/gi, "&")]) {
    for (const m of source.matchAll(CONFIRM_URL)) {
      const safe = safeGmailConfirmUrl(m[0].replace(/[).,;]+$/, ""));
      if (safe) return safe;
    }
  }
  return null;
}

/**
 * El enlace termina en un href que alguien va a tocar, y el remitente de un
 * mail se puede falsificar: sólo pasa un enlace de confirmación de Gmail
 * (https, host de Gmail, ruta /mail/vf-…). El de cancelar (uf-) no pasa.
 */
export function safeGmailConfirmUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!CONFIRM_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (!/^\/mail\/(?:u\/\d+\/)?vf-/.test(url.pathname)) return null;
  return url.toString();
}

function requesterFromSubject(subject: string): string | null {
  return matchEmail(subject, REQUESTER_SUBJECT);
}

function matchEmail(source: string, re: RegExp): string | null {
  const m = source.match(re);
  if (!m) return null;
  const addr = m[1].replace(/[.:]+$/, "").toLowerCase();
  return addr.length <= 254 ? addr : null;
}

/**
 * Lee lo que guardó el webhook en channel_events.payload. Revalida todo —lo
 * que termina en un href tiene que ser de Google aunque la fila la haya escrito
 * otra versión del código— y saca la cuenta del asunto en las filas viejas, que
 * se guardaron sin el detalle.
 */
export function forwardingRequestFromEvent(
  row: { created_at: string; payload: unknown } | null,
): ForwardingRequest | null {
  if (!row) return null;
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  if (payload.ignored !== GMAIL_FORWARDING_LABEL) return null;
  const data = (payload.gmail_forwarding ?? {}) as Record<string, unknown>;
  const code = typeof data.code === "string" && /^\d{6,12}$/.test(data.code) ? data.code : null;
  const storedRequester =
    typeof data.requester === "string" && /^[^\s@]+@[^\s@]+$/.test(data.requester)
      ? data.requester.slice(0, 254)
      : null;
  return {
    receivedAt: row.created_at,
    code,
    confirmUrl: safeGmailConfirmUrl(typeof data.confirm_url === "string" ? data.confirm_url : null),
    requester:
      storedRequester ?? (typeof payload.subject === "string" ? requesterFromSubject(payload.subject) : null),
  };
}

export type EmailChannelView =
  /** No llegó nada todavía. */
  | { state: "waiting" }
  /** Gmail pidió confirmar y todavía no llegó ningún mail reenviado. */
  | { state: "confirm"; request: ForwardingRequest }
  /** Ya llegan mails. `newRequest`: otra cuenta pidió confirmar después. */
  | { state: "working"; newRequest: ForwardingRequest | null };

/** Cuánto se sigue mostrando un pedido nuevo de Gmail cuando el canal ya funciona. */
const NEW_REQUEST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * `verifiedAt` es el primer mail reenviado de verdad: la confirmación de Gmail
 * no lo marca. Un pedido que llega después de ese primer mail es otra cuenta
 * (o la misma, reconfigurada) y se muestra aparte, sin tapar el Funcionando.
 */
export function emailChannelView(input: {
  verifiedAt: string | null;
  request: ForwardingRequest | null;
  now: Date;
}): EmailChannelView {
  const { verifiedAt, request, now } = input;
  if (!verifiedAt) return request ? { state: "confirm", request } : { state: "waiting" };
  if (!request) return { state: "working", newRequest: null };
  const received = Date.parse(request.receivedAt);
  const isNew =
    received > Date.parse(verifiedAt) && now.getTime() - received <= NEW_REQUEST_WINDOW_MS;
  return { state: "working", newRequest: isNew ? request : null };
}
