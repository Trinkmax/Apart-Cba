import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

const KEY = Buffer.from(config.stateEncKeyHex, "hex");

/**
 * AES-256-GCM. Output: base64( iv(12) | tag(16) | ciphertext ).
 * Used to encrypt the Baileys keystore at rest in crm_baileys_auth_state so a
 * DB dump never leaks a live WhatsApp session.
 */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** HMAC-SHA256 signature for the outbound webhook to the Next.js app. */
export function signBody(rawBody: string): string {
  return "sha256=" + createHmac("sha256", config.gatewaySecret).update(rawBody).digest("hex");
}

/** Constant-time bearer check for inbound HTTP from the Next.js app. */
export function bearerOk(authHeader: string | undefined): boolean {
  if (!authHeader) return false;
  const expected = `Bearer ${config.gatewaySecret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
