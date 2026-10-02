import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tokens de los links públicos del módulo Alquileres:
 *   - `/inquilino/<token>`: portal del inquilino (su cuenta, recibos, subir
 *     comprobantes de expensas/servicios, avisar un pago).
 *   - `/rendicion/<token>`: rendición de solo lectura para el propietario.
 *
 * Mismo esquema que el link de reserva (`src/lib/marketplace/access-token.ts`):
 * el token se DERIVA con HMAC-SHA256 del id + una versión y un secreto del
 * servidor; en la base vive sólo sha256(token). Cada link tiene su CONTEXTO
 * para que un token de un tipo no sirva en el otro, y la versión permite
 * "regenerar el link" (invalida el anterior) sin guardar nada en claro.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type RentalLinkKind = "inquilino" | "rendicion";

const CONTEXT: Record<RentalLinkKind, string> = {
  inquilino: "apart:alquiler:inquilino:v1:",
  rendicion: "apart:alquiler:rendicion:v1:",
};

function linkSecret(): string {
  const secret = process.env.MARKETPLACE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Falta el secreto para firmar links");
  return secret;
}

/** Token del link (43 caracteres base64url). */
export function deriveRentalToken(
  kind: RentalLinkKind,
  id: string,
  version: number,
  secret: string = linkSecret(),
): string {
  return createHmac("sha256", secret).update(`${CONTEXT[kind]}${id}:${version}`, "utf8").digest("base64url");
}

/** Lo que se guarda en `portal_token_hash` / `public_token_hash`. */
export function hashRentalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Formato válido: evita tocar la base con cualquier cosa que llegue por URL. */
export function isWellFormedRentalToken(token: string | null | undefined): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** Verificación en tiempo constante de que el token corresponde a ese id y versión. */
export function rentalTokenMatches(
  kind: RentalLinkKind,
  token: string,
  id: string,
  version: number,
  secret: string = linkSecret(),
): boolean {
  if (!isWellFormedRentalToken(token)) return false;
  const expected = Buffer.from(deriveRentalToken(kind, id, version, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function tenantPortalPath(contractId: string, version: number): string {
  return `/inquilino/${deriveRentalToken("inquilino", contractId, version)}`;
}

export function statementPublicPath(statementId: string, version: number): string {
  return `/rendicion/${deriveRentalToken("rendicion", statementId, version)}`;
}
