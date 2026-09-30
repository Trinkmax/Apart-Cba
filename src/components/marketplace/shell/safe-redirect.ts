/**
 * Destino "de vuelta" después de ingresar (`?redirect=` / `?next=`), validado
 * para que sólo pueda ser una ruta interna de la web: evita open redirects
 * ("//otro.com", "/\\otro.com", caracteres de control que el navegador
 * descarta) y loops hacia las propias pantallas de ingreso. Puro y testeado.
 */
export const DEFAULT_AFTER_LOGIN = "/mi-cuenta";

const MAX_LENGTH = 512;

export function safeRedirectPath(value: string | null | undefined, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (!v || v.length > MAX_LENGTH) return fallback;
  if (!v.startsWith("/") || v.startsWith("//")) return fallback;
  // Barras invertidas y caracteres de control (tab, salto de línea…): algunos
  // navegadores los normalizan a "//" y el destino termina siendo externo.
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return fallback;
  const path = v.split(/[?#]/)[0];
  if (/^\/(ingresar|registrarse|auth)(\/|$)/.test(path)) return fallback;
  return v;
}
