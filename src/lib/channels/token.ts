import crypto from "crypto";

/**
 * Tokens del calendario saliente. En la tabla solo vive el hash SHA-256 (hex);
 * el plaintext se guarda en Vault para poder volver a mostrar la URL en la UI.
 */

export function generateExportToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Comparación en tiempo constante contra el hash guardado. */
export function tokenMatchesHash(token: string, storedHashHex: string | null): boolean {
  if (!storedHashHex || !token) return false;
  const a = Buffer.from(sha256Hex(token), "hex");
  let b: Buffer;
  try {
    b = Buffer.from(storedHashHex, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
