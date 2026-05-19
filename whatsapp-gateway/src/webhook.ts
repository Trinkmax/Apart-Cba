import { config } from "./config";
import { signBody } from "./crypto";
import { logger } from "./logger";

/** Canonical events delivered to the rentOS app webhook (/api/webhooks/baileys). */
export interface InboundMessageEvent {
  kind: "message";
  message: {
    waMessageId: string;
    fromPhone: string;
    profileName?: string;
    timestamp: string; // ISO
    type:
      | "text"
      | "image"
      | "audio"
      | "video"
      | "document"
      | "sticker"
      | "location"
      | "contacts"
      | "reaction"
      | "unsupported";
    text?: string;
    mediaStoragePath?: string;
    mediaMime?: string;
    mediaSizeBytes?: number;
    mediaDurationMs?: number;
    mediaFilename?: string;
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    reaction?: { messageId: string; emoji: string };
    replyToWaMessageId?: string;
  };
}

export interface StatusEvent {
  kind: "status";
  status: {
    waMessageId: string;
    status: "sent" | "delivered" | "read" | "failed";
    timestamp: string;
    recipientPhone: string;
  };
}

export interface ConnectionEvent {
  kind: "connection";
  connection: {
    status:
      | "connecting"
      | "qr"
      | "pairing"
      | "connected"
      | "logged_out"
      | "conflict"
      | "error"
      | "banned"
      | "disconnected";
    phone?: string;
    deviceName?: string;
    qr?: string; // PNG data URL
    qrExpiresAt?: string;
    pairingCode?: string;
    lastError?: string;
  };
}

export type GatewayEvent = InboundMessageEvent | StatusEvent | ConnectionEvent;

/**
 * Deliver events to the rentOS app, HMAC-signed. Small bounded retry — if the
 * app is briefly down we don't want to drop an inbound message. The app side
 * is idempotent (wa_message_id unique), so retries are safe.
 */
export async function emitToApp(
  organizationId: string,
  channelId: string,
  events: GatewayEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const raw = JSON.stringify({ organizationId, channelId, events });
  const signature = signBody(raw);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(config.appWebhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-baileys-signature": signature,
        },
        body: raw,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return;
      logger.warn({ status: res.status, attempt }, "app webhook non-2xx");
    } catch (err) {
      logger.warn({ err: String(err), attempt }, "app webhook delivery failed");
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  logger.error({ channelId, count: events.length }, "app webhook gave up after retries");
}
