import { formatPhoneAR, whatsappLink } from "@/lib/marketplace/display";

/**
 * Contacto del sitio listo para el header, el menú mobile y el footer.
 *
 * El layout de la web lo arma en el server a partir de `getSiteContact()`
 * (sin leer cookies, así la web sigue siendo estática) y lo pasa como prop a
 * los componentes cliente: por eso son todos valores planos y serializables.
 * Puro y testeado.
 */
export interface ShellContact {
  /** Link de WhatsApp con un saludo precargado, o null si no hay número. */
  whatsappUrl: string | null;
  /** Número para mostrar ("+54 9 351 563-9985"). */
  whatsappLabel: string | null;
  email: string | null;
  emailUrl: string | null;
  /** Usuario de Instagram sin "@" ("apartcba"). */
  instagramHandle: string | null;
  instagramUrl: string | null;
  /** Horas en las que prometemos responder un pedido. */
  responseHours: number;
}

/** Mensaje precargado del botón general de WhatsApp (sin emojis). */
export const SITE_WHATSAPP_MESSAGE = "Hola, les escribo desde la web de apart.";

const DEFAULT_RESPONSE_HOURS = 24;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INSTAGRAM_RE = /^[a-z0-9._]{1,30}$/i;

/** "@apartcba", "instagram.com/apartcba/", "https://www.instagram.com/apartcba" → "apartcba". */
export function cleanInstagramHandle(raw: string | null | undefined): string | null {
  const value = (raw ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?instagram\.com\//i, "")
    .replace(/^@+/, "")
    .replace(/[/?#].*$/, "");
  return INSTAGRAM_RE.test(value) ? value : null;
}

export function buildShellContact(
  input:
    | {
        whatsappNumber?: string | null;
        publicEmail?: string | null;
        instagramHandle?: string | null;
        responseHours?: number | null;
      }
    | null
    | undefined,
): ShellContact {
  const whatsappUrl = whatsappLink(input?.whatsappNumber, SITE_WHATSAPP_MESSAGE);
  const email = (input?.publicEmail ?? "").trim();
  const validEmail = EMAIL_RE.test(email) ? email : null;
  const handle = cleanInstagramHandle(input?.instagramHandle);
  const hours = Number(input?.responseHours);
  return {
    whatsappUrl,
    whatsappLabel: whatsappUrl ? formatPhoneAR(input?.whatsappNumber) : null,
    email: validEmail,
    emailUrl: validEmail ? `mailto:${validEmail}` : null,
    instagramHandle: handle,
    instagramUrl: handle ? `https://www.instagram.com/${handle}/` : null,
    responseHours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_RESPONSE_HOURS,
  };
}

/** Contacto vacío (se usa si la lectura del server falla: la web no se cae). */
export const EMPTY_SHELL_CONTACT: ShellContact = buildShellContact(null);

export function hasAnyContact(c: ShellContact): boolean {
  return Boolean(c.whatsappUrl || c.emailUrl || c.instagramUrl);
}
