/**
 * "¿Quisiste decir …@gmail.com?" — detecta errores de tipeo comunes en el
 * dominio de un email (gmai.com, gmial.com, hotmial.com, outlok.com,
 * gmail.con, gmail.com.ar…). Es sólo una sugerencia: nunca bloquea el envío.
 * Puro y testeado.
 */

/** Proveedores populares en Argentina: contra estos se mide la cercanía. */
const POPULAR_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "hotmail.com.ar",
  "outlook.com",
  "outlook.com.ar",
  "yahoo.com",
  "yahoo.com.ar",
  "icloud.com",
  "live.com",
  "live.com.ar",
] as const;

/** Dominios reales que se parecen a uno popular y NO hay que corregir. */
const LEGIT_DOMAINS = new Set([
  "mail.com",
  "email.com",
  "ymail.com",
  "gmx.com",
  "gmx.net",
  "me.com",
  "mac.com",
  "msn.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "hotmail.es",
  "outlook.es",
  "yahoo.es",
  "live.com.mx",
  "hotmail.com.br",
  "yahoo.com.br",
]);

/** Errores frecuentes que la distancia sola no resuelve bien. */
const EXPLICIT_FIXES: Record<string, string> = {
  "gmail.com.ar": "gmail.com",
  "gmail.ar": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.cm": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.comar": "gmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.om": "hotmail.com",
  "hotmail.cm": "hotmail.com",
  "hotmail.comar": "hotmail.com.ar",
  "hotmail.ar": "hotmail.com.ar",
  "outlook.co": "outlook.com",
  "yahoo.co": "yahoo.com",
  "yahoo.comar": "yahoo.com.ar",
  "icloud.co": "icloud.com",
};

/** Proveedor sin dominio de primer nivel ("juan@gmail"). */
const BARE_PROVIDERS: Record<string, string> = {
  gmail: "gmail.com",
  hotmail: "hotmail.com",
  outlook: "outlook.com",
  yahoo: "yahoo.com",
  icloud: "icloud.com",
};

/** Distancia de edición con transposiciones adyacentes (OSA). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

function isKnown(domain: string): boolean {
  return (POPULAR_DOMAINS as readonly string[]).includes(domain) || LEGIT_DOMAINS.has(domain);
}

function fixDomain(domain: string, depth = 0): string | null {
  if (isKnown(domain)) return null;
  if (EXPLICIT_FIXES[domain]) return EXPLICIT_FIXES[domain];
  if (BARE_PROVIDERS[domain]) return BARE_PROVIDERS[domain];

  // Terminaciones mal tipeadas en cualquier dominio: ".con", ".cmo", ".com.ra".
  const tld = domain
    .replace(/\.(con|cmo|comm|cpm|xom|vom|coom)$/, ".com")
    .replace(/\.com\.(ra|rg|arr)$/, ".com.ar");
  if (tld !== domain) {
    return depth === 0 ? (fixDomain(tld, 1) ?? tld) : tld;
  }

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of POPULAR_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  const limit = domain.length >= 9 ? 2 : 1;
  return best && bestDistance > 0 && bestDistance <= limit ? best : null;
}

/**
 * Devuelve el email corregido si el dominio parece un error de tipeo, o null.
 * Conserva la parte local tal cual la escribió la persona.
 */
export function suggestEmailFix(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  const local = value.slice(0, at);
  if (/\s/.test(local)) return null;
  const domain = value
    .slice(at + 1)
    .toLowerCase()
    .replace(/\.+$/, "");
  if (!domain || /[^a-z0-9.-]/.test(domain)) return null;
  const fixed = fixDomain(domain);
  return fixed && fixed !== domain ? `${local}@${fixed}` : null;
}
