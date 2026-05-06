/**
 * Channel Provider abstraction. Soporta múltiples canales:
 * Meta Cloud (WhatsApp Business) ahora — IG/Email/SMS futuro.
 */

import type { CrmTemplateButton } from "@/lib/types/database";

export interface OutboundTextMessage {
  type: "text";
  text: string;
  previewUrl?: boolean;
}

export interface OutboundMediaMessage {
  type: "image" | "audio" | "video" | "document" | "sticker";
  /** URL accesible públicamente para Meta (Storage signedUrl OK con TTL >5min) */
  mediaUrl: string;
  caption?: string;
  filename?: string; // documents
}

export interface OutboundLocationMessage {
  type: "location";
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface OutboundButtonsMessage {
  type: "interactive_buttons";
  bodyText: string;
  headerText?: string;
  footerText?: string;
  buttons: { id: string; title: string }[]; // max 3 (WA limit)
}

export interface OutboundListMessage {
  type: "interactive_list";
  bodyText: string;
  buttonText: string;
  headerText?: string;
  footerText?: string;
  sections: {
    title: string;
    rows: { id: string; title: string; description?: string }[];
  }[];
}

export interface OutboundTemplateMessage {
  type: "template";
  templateName: string;
  language: string;
  components: TemplateComponentParam[];
}

export type TemplateComponentParam =
  | { type: "header"; parameters: TemplateParam[] }
  | { type: "body"; parameters: TemplateParam[] }
  | { type: "button"; sub_type: "url" | "quick_reply"; index: number; parameters: TemplateParam[] };

export type TemplateParam =
  | { type: "text"; text: string }
  | { type: "image"; image: { link: string } }
  | { type: "video"; video: { link: string } }
  | { type: "document"; document: { link: string; filename?: string } }
  | { type: "payload"; payload: string };

export type OutboundMessageBody =
  | OutboundTextMessage
  | OutboundMediaMessage
  | OutboundLocationMessage
  | OutboundButtonsMessage
  | OutboundListMessage
  | OutboundTemplateMessage;

export interface OutboundEnvelope {
  toPhone: string; // E.164 sin "+"
  body: OutboundMessageBody;
  replyToWaMessageId?: string;
  context?: Record<string, unknown>;
}

export type SendResult =
  | { ok: true; providerMessageId: string; rawResponse: unknown }
  | { ok: false; errorCode: string; errorMessage: string; isRetryable: boolean; rawResponse: unknown };

// ─── Inbound parsed events ──────────────────────────────────────────────────

export type ParsedMessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "location"
  | "contacts"
  | "sticker"
  | "interactive_button_reply"
  | "interactive_list_reply"
  | "reaction"
  | "story_reply"
  | "story_mention"
  | "share"
  | "postback"
  | "quick_reply"
  | "unsupported";

export interface ParsedInboundMessage {
  waMessageId: string;
  fromPhone: string;
  profileName?: string;
  timestamp: Date;
  type: ParsedMessageType;
  text?: string;
  mediaProviderId?: string;
  mediaMime?: string;
  mediaSha256?: string;
  mediaCaption?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown[];
  interactiveReply?: { id: string; title: string; type: "button" | "list" };
  reaction?: { messageId: string; emoji: string };
  replyToWaMessageId?: string;
  rawPayload: unknown;
}

export interface ParsedStatusUpdate {
  waMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode?: string;
  errorMessage?: string;
  timestamp: Date;
  recipientPhone: string;
}

export interface ParsedTemplateStatusUpdate {
  metaTemplateId: string;
  templateName: string;
  language: string;
  newStatus: string;
  rejectionReason?: string;
}

export type ParsedInboundEvent =
  | { kind: "message"; channelLookupKey: string; message: ParsedInboundMessage }
  | { kind: "status"; channelLookupKey: string; status: ParsedStatusUpdate }
  | { kind: "template_status"; channelLookupKey: string; templateStatus: ParsedTemplateStatusUpdate }
  | { kind: "unsupported"; channelLookupKey: string; raw: unknown };

// ─── Templates ──────────────────────────────────────────────────────────────

export interface TemplateSubmitInput {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  bodyText: string;
  bodyExample?: string[][];
  headerType?: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  headerText?: string;
  headerMediaUrl?: string;
  footer?: string;
  buttons?: CrmTemplateButton[];
}

export interface TemplateSubmitResult {
  metaTemplateId: string;
  status: string;
}

// ─── Channel Provider ───────────────────────────────────────────────────────

export interface ChannelProvider {
  /** Envío único (consumido por outbox). Idempotente en el provider side via wam.id. */
  send(envelope: OutboundEnvelope): Promise<SendResult>;

  /** Marcar como leído en el provider (best-effort). */
  markAsRead(waMessageId: string): Promise<void>;

  /** Webhook verification challenge (Meta GET). Devuelve challenge si OK, null si no. */
  verifyWebhookChallenge(
    mode: string | null,
    token: string | null,
    challenge: string | null,
    expectedToken: string,
  ): string | null;

  /** Verifica firma X-Hub-Signature-256 con app_secret. */
  verifyWebhookSignature(rawBody: string, signature: string | null, appSecret: string): boolean;

  /** Parsea el payload del webhook (POST) en eventos canónicos. */
  parseWebhook(rawBody: unknown): ParsedInboundEvent[];

  /** Descarga URL temporal + meta de un media id. */
  getMediaDownloadUrl(providerMediaId: string): Promise<{ url: string; mime: string; size: number; sha256?: string }>;

  /** Submit template a Meta. */
  submitTemplate(input: TemplateSubmitInput): Promise<TemplateSubmitResult>;

  /** Poll status de un template. */
  getTemplateStatus(metaTemplateId: string): Promise<{ status: string; rejectionReason?: string }>;
}

export interface ChannelProviderContext {
  channelId: string;
  organizationId: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret?: string;
  apiVersion?: string;
}
