import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ChannelProvider,
  ChannelProviderContext,
  OutboundEnvelope,
  ParsedInboundEvent,
  ParsedInboundMessage,
  ParsedMessageType,
  SendResult,
  TemplateSubmitInput,
  TemplateSubmitResult,
} from "./types";

const DEFAULT_API_VERSION = "v22.0";

/**
 * Provider para Instagram Direct Messaging via Meta Messenger Platform.
 *
 * Diferencias vs WhatsApp Cloud:
 *   • Send endpoint: /me/messages (Page Token) en lugar de /{phone_id}/messages
 *   • Webhook object = "instagram", events en entry[].messaging[]
 *   • Sin templates aprobados (Instagram usa "tags" para re-engagement fuera 24h)
 *   • Identificador del usuario = IGSID (Instagram-scoped User ID), no phone
 *   • Tipos de mensaje extra: story_reply, story_mention, share, postback
 */
export class InstagramProvider implements ChannelProvider {
  private readonly baseUrl: string;
  private readonly pageId?: string;
  private readonly igAccountId?: string;

  constructor(private readonly ctx: ChannelProviderContext & {
    pageId?: string;
    igAccountId?: string;
  }) {
    const v = ctx.apiVersion || process.env.META_GRAPH_API_VERSION || DEFAULT_API_VERSION;
    this.baseUrl = `https://graph.facebook.com/${v}`;
    this.pageId = ctx.pageId;
    this.igAccountId = ctx.igAccountId;
  }

  // ─── send ────────────────────────────────────────────────────────────────
  async send(envelope: OutboundEnvelope): Promise<SendResult> {
    // Instagram Messenger send endpoint usa /me/messages con Page access token
    const url = `${this.baseUrl}/me/messages?access_token=${encodeURIComponent(this.ctx.accessToken)}`;
    const payload = this.buildSendPayload(envelope);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return {
        ok: false,
        errorCode: "network",
        errorMessage: err instanceof Error ? err.message : "Network error",
        isRetryable: true,
        rawResponse: null,
      };
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      raw = null;
    }

    if (!res.ok) {
      const errBody = raw as { error?: { code?: number; message?: string; error_subcode?: number } } | null;
      const err = errBody?.error;
      return {
        ok: false,
        errorCode: err?.code != null ? String(err.code) : String(res.status),
        errorMessage: err?.message ?? `HTTP ${res.status}`,
        isRetryable: this.isRetryable(res.status, err?.code),
        rawResponse: raw,
      };
    }

    const okBody = raw as { message_id?: string; recipient_id?: string } | null;
    if (!okBody?.message_id) {
      return {
        ok: false,
        errorCode: "no_message_id",
        errorMessage: "Instagram response missing message_id",
        isRetryable: false,
        rawResponse: raw,
      };
    }
    return { ok: true, providerMessageId: okBody.message_id, rawResponse: raw };
  }

  async markAsRead(_waMessageId: string): Promise<void> {
    // Instagram no tiene endpoint para marcar leído explícitamente; mark_seen está
    // disponible via sender_action pero requiere recipient_id. Sin contexto, no-op.
    return;
  }

  // ─── webhook verification ────────────────────────────────────────────────
  verifyWebhookChallenge(
    mode: string | null,
    token: string | null,
    challenge: string | null,
    expectedToken: string,
  ): string | null {
    if (mode === "subscribe" && token && expectedToken && token === expectedToken && challenge) {
      return challenge;
    }
    return null;
  }

  verifyWebhookSignature(rawBody: string, signature: string | null, appSecret: string): boolean {
    if (!signature || !appSecret) return false;
    const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    const provided = signature.replace(/^sha256=/, "");
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  }

  // ─── parseWebhook ────────────────────────────────────────────────────────
  parseWebhook(rawBody: unknown): ParsedInboundEvent[] {
    const events: ParsedInboundEvent[] = [];
    const body = rawBody as { object?: string; entry?: IGEntry[] } | null;
    if (!body || body.object !== "instagram") return events;

    for (const entry of body.entry ?? []) {
      const channelLookupKey = entry.id; // page id o ig business account id
      for (const m of entry.messaging ?? []) {
        if (m.message) {
          const parsed = this.parseInboundMessage(m);
          if (parsed) events.push({ kind: "message", channelLookupKey, message: parsed });
        } else if (m.postback) {
          events.push({
            kind: "message",
            channelLookupKey,
            message: {
              waMessageId: `postback-${m.timestamp}-${m.sender.id}`,
              fromPhone: m.sender.id, // IGSID
              timestamp: new Date(m.timestamp),
              type: "postback" as ParsedMessageType,
              text: m.postback.title,
              interactiveReply: { id: m.postback.payload, title: m.postback.title, type: "button" },
              rawPayload: m,
            },
          });
        } else if (m.read) {
          events.push({
            kind: "status",
            channelLookupKey,
            status: {
              waMessageId: `ig-read-${m.timestamp}`,
              status: "read",
              timestamp: new Date(m.timestamp),
              recipientPhone: m.sender.id,
            },
          });
        } else if (m.delivery) {
          // Delivery receipt — Instagram envía mids en delivery.mids[]
          for (const mid of m.delivery.mids ?? []) {
            events.push({
              kind: "status",
              channelLookupKey,
              status: {
                waMessageId: mid,
                status: "delivered",
                timestamp: new Date(m.timestamp),
                recipientPhone: m.sender.id,
              },
            });
          }
        }
      }
    }
    return events;
  }

  private parseInboundMessage(m: IGMessagingEntry): ParsedInboundMessage | null {
    const msg = m.message!;
    if (msg.is_echo) return null; // Echoes from page itself

    let type: ParsedMessageType = "text";
    let text: string | undefined;
    let mediaProviderId: string | undefined;
    let mediaMime: string | undefined;
    let mediaCaption: string | undefined;

    if (msg.text) {
      type = "text";
      text = msg.text;
    }

    if (msg.attachments && msg.attachments.length > 0) {
      const att = msg.attachments[0];
      switch (att.type) {
        case "image": type = "image"; break;
        case "audio": type = "audio"; break;
        case "video": type = "video"; break;
        case "file": type = "document"; break;
        case "story_mention": type = "story_mention"; break;
        case "share": type = "share"; break;
        case "ig_reel": type = "video"; break;
        default: type = "unsupported";
      }
      mediaProviderId = att.payload?.url ?? undefined;
      mediaCaption = msg.text;
    }

    if (msg.reply_to?.story?.id) {
      type = "story_reply";
    }

    if (msg.quick_reply) {
      type = "quick_reply";
      text = msg.text;
    }

    return {
      waMessageId: msg.mid,
      fromPhone: m.sender.id, // IGSID
      timestamp: new Date(m.timestamp),
      type,
      text,
      mediaProviderId,
      mediaMime,
      mediaCaption,
      replyToWaMessageId: msg.reply_to?.mid,
      rawPayload: m,
    };
  }

  // ─── media ───────────────────────────────────────────────────────────────
  async getMediaDownloadUrl(providerMediaId: string) {
    // Instagram envía URLs públicas firmadas en attachments[].payload.url
    // No requiere otra llamada — el `providerMediaId` ES la URL en nuestro caso.
    if (providerMediaId.startsWith("http")) {
      const head = await fetch(providerMediaId, { method: "HEAD" });
      const mime = head.headers.get("content-type") ?? "application/octet-stream";
      const size = parseInt(head.headers.get("content-length") ?? "0", 10);
      return { url: providerMediaId, mime, size };
    }
    // Fallback: tratar como Meta media id (poco común en IG)
    const url = `${this.baseUrl}/${providerMediaId}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.ctx.accessToken}` } });
    if (!res.ok) throw new Error(`IG media meta fetch failed: ${res.status}`);
    const meta = (await res.json()) as { url: string; mime_type: string; file_size?: number };
    return { url: meta.url, mime: meta.mime_type, size: meta.file_size ?? 0 };
  }

  // ─── templates (no aplica a Instagram) ───────────────────────────────────
  async submitTemplate(_input: TemplateSubmitInput): Promise<TemplateSubmitResult> {
    throw new Error("Instagram no soporta templates — usá mensajes libres dentro 24h o human_agent tag");
  }

  async getTemplateStatus(_metaTemplateId: string) {
    return { status: "not_supported", rejectionReason: "Instagram doesn't use templates" };
  }

  // ─── helpers ─────────────────────────────────────────────────────────────
  private buildSendPayload(envelope: OutboundEnvelope): Record<string, unknown> {
    const { toPhone, body } = envelope; // toPhone es IGSID en este provider
    const base: Record<string, unknown> = {
      recipient: { id: toPhone },
      messaging_type: "RESPONSE",
    };

    switch (body.type) {
      case "text":
        return { ...base, message: { text: body.text } };
      case "image":
      case "audio":
      case "video":
      case "document":
      case "sticker": {
        const igType = body.type === "document" ? "file" : body.type === "sticker" ? "image" : body.type;
        return {
          ...base,
          message: {
            attachment: {
              type: igType,
              payload: { url: body.mediaUrl, is_reusable: true },
            },
          },
        };
      }
      case "interactive_buttons":
        return {
          ...base,
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: body.bodyText,
                buttons: body.buttons.map((b) => ({
                  type: "postback",
                  title: b.title.slice(0, 20),
                  payload: b.id,
                })),
              },
            },
          },
        };
      case "interactive_list":
        // Instagram no soporta listas estilo WA → fallback a botones de la primera sección
        const firstRows = body.sections[0]?.rows ?? [];
        return {
          ...base,
          message: {
            text: body.bodyText,
            quick_replies: firstRows.slice(0, 13).map((r) => ({
              content_type: "text",
              title: r.title.slice(0, 20),
              payload: r.id,
            })),
          },
        };
      case "location":
        return {
          ...base,
          message: { text: `📍 ${body.name ?? "Ubicación"}: https://maps.google.com/?q=${body.latitude},${body.longitude}` },
        };
      case "template":
        // No aplica IG — fallback a texto plano del body si hay alguno en components
        return {
          ...base,
          message: { text: "[Template message — no soportado en Instagram. Usá mensaje libre.]" },
        };
    }
  }

  private isRetryable(httpStatus: number, errorCode?: number): boolean {
    if (httpStatus >= 500) return true;
    if (httpStatus === 429) return true;
    // Códigos IG/Messenger documentados:
    //   #200 — Permission denied (no retry)
    //   #10  — Application does not have permission (no retry)
    //   #100 — Invalid parameter (no retry)
    //   #2018278 — Recipient unavailable (no retry)
    //   #2018108 — Message outside 24h window (no retry — usar tag)
    if (errorCode === 200 || errorCode === 10 || errorCode === 100) return false;
    if (errorCode === 2018278 || errorCode === 2018108) return false;
    return false;
  }
}

// ─── Tipos Meta Instagram (Messenger Platform format) ──────────────────────

interface IGEntry {
  id: string;            // page id o ig business account id
  time: number;
  messaging?: IGMessagingEntry[];
}

interface IGMessagingEntry {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload: string };
    reply_to?: { mid?: string; story?: { id: string; url?: string } };
    attachments?: { type: string; payload?: { url?: string; sticker_id?: string } }[];
  };
  postback?: {
    mid?: string;
    title: string;
    payload: string;
  };
  read?: { mid: string };
  delivery?: { mids?: string[]; watermark?: number };
  reaction?: { reaction?: string; emoji?: string; mid?: string; action?: string };
}
