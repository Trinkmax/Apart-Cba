/**
 * Normalización de números de teléfono a formato E.164 (sin "+", solo dígitos).
 *
 * Meta WhatsApp Business API espera números en E.164 sin "+" (e.g. "5493515551234").
 * Argentina: prefijo país 54 + área (e.g. 9 + 351 para Córdoba móvil) + número.
 */

const DEFAULT_COUNTRY_PREFIX = "54"; // Argentina

export function normalizePhone(input: string | null | undefined, defaultCountry = DEFAULT_COUNTRY_PREFIX): string {
  if (!input) return "";
  let digits = String(input).replace(/[^\d]/g, "");
  if (!digits) return "";

  // Si arranca con 00, sacarlo (formato internacional viejo).
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Si arranca con el prefijo país, ya es internacional.
  if (digits.startsWith(defaultCountry)) return digits;

  // Si arranca con 0 (área nacional), sacarlo y prefixar país.
  if (digits.startsWith("0")) digits = digits.slice(1);

  // Si arranca con 15 (móvil legacy AR), reemplazar por 9 (formato móvil internacional).
  if (defaultCountry === "54" && digits.startsWith("15")) {
    digits = "9" + digits.slice(2);
  }

  return defaultCountry + digits;
}

export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = String(phone).replace(/[^\d]/g, "");
  if (!digits) return "—";

  // +54 9 351 555-1234
  if (digits.startsWith("549") && digits.length >= 12) {
    const area = digits.slice(3, 6);
    const part1 = digits.slice(6, 9);
    const part2 = digits.slice(9);
    return `+54 9 ${area} ${part1}-${part2}`;
  }

  if (digits.startsWith("54") && digits.length >= 11) {
    const area = digits.slice(2, 5);
    const rest = digits.slice(5);
    return `+54 ${area} ${rest}`;
  }

  return "+" + digits;
}

export function isValidE164(phone: string): boolean {
  return /^\d{10,15}$/.test(phone);
}
