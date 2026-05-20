import { gatewayFetch, verifyGatewaySignature } from "../baileys-gateway";
import type {
  ChannelProvider,
  OutboundEnvelope,
  SendResult,
  ParsedInboundEvent,
  ParsedInboundMessage,
  ParsedMessageType,
  ParsedStatusUpdate,
  TemplateSubmitInput,
  TemplateSubmitResult,
} from "./types";

export interface BaileysProviderContext {
  channelId: string;
  organizationId: string;
}

/**
 * Baileys provider: a normal WhatsApp account driven through the Railway
 * gateway. Implements the SAME ChannelProvider contract as MetaCloudProvider,
 * so the outbox / workflows / broadcasts pipeline routes through it unchanged.
 *
 * Key difference vs Meta: there is no 24 h customer-care window and no Meta
 * template approval — it's an ordinary account. Inbound media is pre-uploaded
 * to Storage by the gateway, so getMediaDownloadUrl is never used.
 */
export class BaileysProvider implements ChannelProvider {
  constructor(private readonly ctx: BaileysProviderContext) {}

  async send(envelope: OutboundEnvelope): Promise<SendResult> {
    try {
      const res = await gatewayFetch<
        | { ok: true; providerMessageId: string }
        | { ok: false; error: string; retryable: boolean }
      >(`/sessions/${this.ctx.channelId}/send`, {
        method: "POST",
        body: {
          organizationId: this.ctx.organizationId,
          toPhone: envelope.toPhone,
          body: envelope.body,
        },
      });

      if (res.ok) {
        return { ok: true, providerMessageId: res.providerMessageId, rawResponse: res };
      }
      return {
        ok: false,
        errorCode: "baileys_send_failed",
        errorMessage: res.error,
        isRetryable: res.retryable,
        rawResponse: res,
      };
    } catch (err) {
      // Network/gateway-down → retryable so the outbox backoff picks it up.
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        errorCode: "gateway_unreachable",
        errorMessage: message,
        isRetryable: true,
        rawResponse: null,
      };
    }
  }

  async markAsRead(waMessageId: string): Promise<void> {
    // Best-effort; the gateway needs remoteJid which we don't have here. The
    // inbound webhook path marks read with full context. No-op otherwise.
    void waMessageId;
  }

  verifyWebhookChallenge(): string | null {
    return null; // Baileys has no Meta-style GET challenge.
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    return verifyGatewaySignature(rawBody, signature);
  }

  parseWebhook(rawBody: unknown): ParsedInboundEvent[] {
    const body = rawBody as {
      channelId?: string;
      events?: Array<Record<string, unknown>>;
    } | null;
    const key = body?.channelId ?? this.ctx.channelId;
    const out: ParsedInboundEvent[] = [];

    for (const ev of body?.events ?? []) {
      if (ev.kind === "message") {
        const m = ev.message as Record<string, unknown>;
        const msg: ParsedInboundMessage = {
          waMessageId: String(m.waMessageId ?? ""),
          fromPhone: String(m.fromPhone ?? ""),
          profileName: (m.profileName as string) ?? undefined,
          timestamp: new Date(String(m.timestamp ?? new Date().toISOString())),
          type: (m.type as ParsedMessageType) ?? "unsupported",
          text: (m.text as string) ?? undefined,
          mediaCaption: (m.text as string) ?? undefined,
          location: m.location as ParsedInboundMessage["location"],
          reaction: m.reaction as ParsedInboundMessage["reaction"],
          replyToWaMessageId: (m.replyToWaMessageId as string) ?? undefined,
          rawPayload: m,
        };
        if (m.mediaStoragePath) {
          msg.prefetchedMedia = {
            storagePath: String(m.mediaStoragePath),
            mime: String(m.mediaMime ?? "application/octet-stream"),
            sizeBytes: m.mediaSizeBytes ? Number(m.mediaSizeBytes) : undefined,
            durationMs: m.mediaDurationMs ? Number(m.mediaDurationMs) : undefined,
            filename: (m.mediaFilename as string) ?? undefined,
          };
        }
        out.push({ kind: "message", channelLookupKey: key, message: msg });
      } else if (ev.kind === "status") {
        const s = ev.status as Record<string, unknown>;
        const status: ParsedStatusUpdate = {
          waMessageId: String(s.waMessageId ?? ""),
          status: (s.status as ParsedStatusUpdate["status"]) ?? "sent",
          timestamp: new Date(String(s.timestamp ?? new Date().toISOString())),
          recipientPhone: String(s.recipientPhone ?? ""),
        };
        out.push({ kind: "status", channelLookupKey: key, status });
      }
      // 'connection' events are handled by the webhook route, not here.
    }
    return out;
  }

  async getMediaDownloadUrl(): Promise<{ url: string; mime: string; size: number }> {
    // Never called for Baileys: the gateway uploads inbound media to Storage
    // and sends the storage path directly.
    throw new Error("getMediaDownloadUrl no aplica para Baileys (media pre-subida)");
  }

  async submitTemplate(input: TemplateSubmitInput): Promise<TemplateSubmitResult> {
    // Baileys = cuenta normal: no hay motor de plantillas de Meta. Se aprueba
    // localmente para que la UI de plantillas no se rompa; el envío real
    // renderiza el texto plano.
    return { metaTemplateId: `baileys_local_${input.name}`, status: "approved" };
  }

  async getTemplateStatus(): Promise<{ status: string; rejectionReason?: string }> {
    return { status: "approved" };
  }
}
