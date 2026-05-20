/** Centralized env loading + validation. Fails fast on boot if misconfigured. */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

function optionalInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: optionalInt("PORT", 8080),
  gatewaySecret: required("GATEWAY_SECRET"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  appWebhookUrl: required("APP_WEBHOOK_URL"),
  /** 32-byte hex key for AES-256-GCM of the Baileys keystore. */
  stateEncKeyHex: required("BAILEYS_STATE_ENC_KEY"),
  sendMinGapMs: optionalInt("SEND_MIN_GAP_MS", 1200),
  sendJitterMs: optionalInt("SEND_JITTER_MS", 1500),
  reconnectMaxMs: optionalInt("RECONNECT_MAX_MS", 120_000),
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;

if (Buffer.from(config.stateEncKeyHex, "hex").length !== 32) {
  throw new Error("BAILEYS_STATE_ENC_KEY must be 32 bytes (64 hex chars)");
}
