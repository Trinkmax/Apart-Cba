import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token del link de seguimiento de una reserva de la web (`/reserva/<token>`).
 *
 * El huésped puede pedir sin crear cuenta: el link que le mandamos por mail (y
 * que ve al terminar el pedido) es su llave. El token se DERIVA del id de la
 * solicitud con un HMAC-SHA256 y un secreto del servidor, así:
 *   - no se adivina sin el secreto;
 *   - se puede volver a armar para cada email (confirmación, vencimiento…) sin
 *     guardar el token en claro;
 *   - en la base vive sólo `access_token_hash` = sha256(token), indexado, para
 *     encontrar la solicitud a partir del link.
 *
 * Secreto: MARKETPLACE_LINK_SECRET si existe; si no, la service role key de
 * Supabase (existe en todo entorno donde corre el server y nunca sale de él).
 * Rotarlo invalida los links viejos.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const CONTEXT = "apart:reserva:v1:";

function linkSecret(): string {
  const secret = process.env.MARKETPLACE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Falta el secreto para firmar links de reserva");
  return secret;
}

/** Token del link de una solicitud (43 caracteres base64url). */
export function deriveAccessToken(requestId: string, secret: string = linkSecret()): string {
  return createHmac("sha256", secret).update(`${CONTEXT}${requestId}`, "utf8").digest("base64url");
}

/** Lo que se guarda en `booking_requests.access_token_hash`. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Formato válido (evita tocar la base con cualquier cosa que llegue por URL). */
export function isWellFormedAccessToken(token: string | null | undefined): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** Verificación en tiempo constante de que un token corresponde a la solicitud. */
export function tokenMatchesRequest(token: string, requestId: string, secret: string = linkSecret()): boolean {
  if (!isWellFormedAccessToken(token)) return false;
  const expected = Buffer.from(deriveAccessToken(requestId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Path del link de seguimiento de una solicitud. */
export function reservationPath(requestId: string): string {
  return `/reserva/${deriveAccessToken(requestId)}`;
}
