import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Thin client for the always-on Baileys gateway (Railway). The gateway holds
 * the persistent WhatsApp Web socket — Vercel cannot. Shared by the provider,
 * the server actions and the inbound webhook so auth stays in one place.
 */

export function gatewayConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_GATEWAY_URL && process.env.WHATSAPP_GATEWAY_SECRET);
}

function base(): string {
  const url = process.env.WHATSAPP_GATEWAY_URL;
  if (!url) throw new Error("WHATSAPP_GATEWAY_URL no configurada");
  return url.replace(/\/+$/, "");
}

function secret(): string {
  const s = process.env.WHATSAPP_GATEWAY_SECRET;
  if (!s) throw new Error("WHATSAPP_GATEWAY_SECRET no configurada");
  return s;
}

export async function gatewayFetch<T = unknown>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number } = { method: "GET" },
): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret()}`,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    throw new Error(
      `Gateway ${path} → HTTP ${res.status}: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

/** Verify the HMAC-SHA256 signature the gateway puts on its webhook calls. */
export function verifyGatewaySignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret()).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
