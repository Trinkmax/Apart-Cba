import type { RentalDocType } from "@/lib/types/database";

/**
 * Lógica pura de Personas (inquilinos y garantes): documentos, CUIT, búsqueda
 * y cuánto cubren los ingresos. Sin I/O: la usan formularios y actions.
 */

export function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

/** Lo que se guarda: DNI/CUIT/CUIL sólo cifras; pasaporte u otro, en mayúsculas sin espacios de más. */
export function normalizeDocNumber(type: RentalDocType | null | undefined, raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (type === "DNI" || type === "CUIT" || type === "CUIL") {
    const d = digitsOnly(t);
    return d || null;
  }
  return t.toUpperCase().replace(/\s+/g, " ").slice(0, 30);
}

/** "30.123.456" (DNI) o "20-30123456-7" (CUIT/CUIL). */
export function formatDocNumber(type: RentalDocType | null | undefined, value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  const d = digitsOnly(v);
  if ((type === "CUIT" || type === "CUIL") && d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  if (type === "DNI" && d.length >= 6 && d.length <= 9) return Number(d).toLocaleString("es-AR");
  return v;
}

/** "DNI 30.123.456" / "CUIT 20-30123456-7" / "" */
export function docLabel(type: RentalDocType | null | undefined, value: string | null | undefined): string {
  const f = formatDocNumber(type, value);
  if (!f) return "";
  return type && type !== "OTRO" ? `${type === "PASAPORTE" ? "Pasaporte" : type} ${f}` : f;
}

/** Dígito verificador de CUIT/CUIL (módulo 11). Acepta con o sin guiones. */
export function isValidCuit(raw: string | null | undefined): boolean {
  const d = digitsOnly(raw);
  if (d.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((s, w, i) => s + w * Number(d[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(d[10]);
}

/** Aviso suave (no bloquea) si un CUIT/CUIL tipeado no cierra. */
export function cuitWarning(raw: string | null | undefined): string | null {
  const d = digitsOnly(raw);
  if (!d) return null;
  if (d.length !== 11) return "El CUIT/CUIL tiene 11 cifras (por ejemplo, 20-30123456-7).";
  if (!isValidCuit(d)) return "Revisá el CUIT/CUIL: el último número no coincide con los anteriores.";
  return null;
}

/**
 * Limpia un término de búsqueda para el filtro `or()` de PostgREST: saca los
 * caracteres que rompen la sintaxis (coma, paréntesis, comodines) y lo acota.
 */
export function sanitizeSearchTerm(q: string | null | undefined): string {
  return (q ?? "")
    .replace(/[,()%*\\:"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Cuántas veces cubren los ingresos al alquiler (1 decimal), o null si falta un dato. */
export function incomeCoverage(income: number | null | undefined, rent: number | null | undefined): number | null {
  if (!income || !rent || income <= 0 || rent <= 0) return null;
  return Math.round((income / rent) * 10) / 10;
}

/** Lo habitual en las inmobiliarias: ingresos de al menos 3 veces el alquiler. */
export const INCOME_COVERAGE_TARGET = 3;

export function coverageTone(ratio: number | null): "ok" | "warn" | "low" | null {
  if (ratio == null) return null;
  if (ratio >= INCOME_COVERAGE_TARGET) return "ok";
  if (ratio >= 2) return "warn";
  return "low";
}

/** Sin tildes ni diéresis y en minúsculas ("Núñez" → "nunez"). */
export function foldText(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const ACCENT_CLASSES: Record<string, string> = {
  a: "aáàäâ",
  e: "eéèëê",
  i: "iíìïî",
  o: "oóòöô",
  u: "uúùüû",
  n: "nñ",
  c: "cç",
};

/**
 * Expresión regular (POSIX, para el `imatch` de PostgREST) que encuentra una
 * palabra con o sin tildes: "munoz" → m[uú…][nñ…][oó…]z. Sólo letras y
 * números: cualquier otro carácter se descarta (nada de metacaracteres).
 */
export function accentInsensitiveRegex(word: string): string {
  return Array.from(foldText(word).replace(/[^a-z0-9]/g, ""))
    .map((ch) => {
      const cls = ACCENT_CLASSES[ch];
      return cls ? `[${cls}${cls.toUpperCase()}]` : ch;
    })
    .join("");
}
