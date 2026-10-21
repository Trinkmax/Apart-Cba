/**
 * Datos de cada depto para los mensajes al huésped (migración 076): el link
 * de Google Maps y el instructivo propio del depto.
 */

export const GUEST_INSTRUCTIONS_MAX = 5000;

export type MapsUrlResult = { ok: true; url: string | null } | { ok: false; error: string };

/**
 * Normaliza el link que pega la persona. Vacío = sin link. Sin "https://"
 * (lo que copia el celular a veces: "maps.app.goo.gl/…") se lo agrega; lo
 * que no es una dirección web se rechaza con un motivo en castellano.
 */
export function normalizeMapsUrl(raw: string | null | undefined): MapsUrlResult {
  const value = (raw ?? "").trim();
  if (!value) return { ok: true, url: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: "Ese link no es válido. Copialo desde Google Maps con «Compartir»." };
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".") || /\s/.test(value)) {
    return { ok: false, error: "Ese link no es válido. Copialo desde Google Maps con «Compartir»." };
  }
  if (withScheme.length > 2000) {
    return { ok: false, error: "El link es demasiado largo." };
  }
  return { ok: true, url: withScheme };
}
