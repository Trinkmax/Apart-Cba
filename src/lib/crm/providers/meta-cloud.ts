import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ChannelProvider,
  ChannelProviderContext,
  OutboundEnvelope,
  ParsedInboundEvent,
  ParsedInboundMessage,
  ParsedStatusUpdate,
  ParsedMessageType,
  SendResult,
  TemplateSubmitInput,
  TemplateSubmitResult,
} from "./types";

const DEFAULT_API_VERSION = "v22.0";

export class MetaCloudProvider implements ChannelProvider {
  private readonly baseUrl: string;
  constructor(private readonly ctx: ChannelProviderContext) {
    const v = ctx.apiVersion || process.env.META_GRAPH_API_VERSION || DEFAULT_API_VERSION;
    this.baseUrl = `https://graph.facebook.com/${v}`;
  }

  // ─── send ────────────────────────────────────────────────────────────────
  async send(envelope: OutboundEnvelope): Promise<SendResult> {
    const url = `${this.baseUrl}/${this.ctx.phoneNumberId}/messages`;
    const payload = this.buildSendPayload(envelope);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.ctx.accessToken}`,
        },
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
      const errBody = raw as MetaErrorEnvelope | null;
      const err = errBody?.error;
      const code = err?.code != null ? String(err.code) : String(res.status);
      const message = err?.message ?? `HTTP ${res.status}`;
      return {
        ok: false,
        errorCode: code,
        errorMessage: message,
        isRetryable: this.isRetryable(res.status, err?.code),
        rawResponse: raw,
      };
    }

    const okBody = raw as MetaSendOk | null;
    const wamid = okBody?.messages?.[0]?.id;
    if (!wamid) {
      return {
        ok: false,
        errorCode: "no_wamid",
        errorMessage: "Meta response missing wam.id",
        isRetryable: false,
        rawResponse: raw,
      };
    }

    return { ok: true, providerMessageId: wamid, rawResponse: raw };
  }

  async markAsRead(waMessageId: string): Promise<void> {
    const url = `${this.baseUrl}/${this.ctx.phoneNumberId}/messages`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.ctx.accessToken}`,
      },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: waMessageId }),
    }).catch(() => undefined); // best-effort
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
    const body = rawBody as MetaWebhookBody | null;
    if (!body || body.object !== "whatsapp_business_account") return events;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const field = change.field;
        const value = change.value as Record<string, unknown>;

        if (field === "messages") {
          const phoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id;
          if (!phoneNumberId) continue;
          const channelLookupKey = phoneNumberId;

          const contacts = (value.contacts as MetaContact[]) ?? [];
          const messages = (value.messages as MetaInboundMessage[]) ?? [];
          const statuses = (value.statuses as MetaStatusEntry[]) ?? [];

          for (const msg of messages) {
            const profileName = contacts.find((c) => c.wa_id === msg.from)?.profile?.name;
            const parsed = this.parseInboundMessage(msg, profileName);
            if (parsed) events.push({ kind: "message", channelLookupKey, message: parsed });
          }

          for (const status of statuses) {
            events.push({
              kind: "status",
              channelLookupKey,
              status: {
                waMessageId: status.id,
                status: status.status as ParsedStatusUpdate["status"],
                errorCode: status.errors?.[0]?.code != null ? String(status.errors[0].code) : undefined,
                errorMessage: status.errors?.[0]?.message,
                timestamp: new Date(parseInt(status.timestamp, 10) * 1000),
                recipientPhone: status.recipient_id,
              },
            });
          }
        } else if (field === "message_template_status_update") {
          const ts = value as unknown as MetaTemplateStatusUpdate;
          events.push({
            kind: "template_status",
            channelLookupKey: this.ctx.phoneNumberId, // template events son a nivel WABA
            templateStatus: {
              metaTemplateId: ts.message_template_id,
              templateName: ts.message_template_name,
              language: ts.message_template_language,
              newStatus: ts.event,
              rejectionReason: ts.reason,
            },
          });
        } else {
          events.push({ kind: "unsupported", channelLookupKey: this.ctx.phoneNumberId, raw: change });
        }
      }
    }
    return events;
  }

  // ─── media download ──────────────────────────────────────────────────────
  async getMediaDownloadUrl(providerMediaId: string) {
    const metaUrl = `${this.baseUrl}/${providerMediaId}`;
    const res = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${this.ctx.accessToken}` },
    });
    if (!res.ok) throw new Error(`Meta media meta fetch failed: ${res.status}`);
    const meta = (await res.json()) as { url: string; mime_type: string; sha256?: string; file_size?: number };
    return { url: meta.url, mime: meta.mime_type, size: meta.file_size ?? 0, sha256: meta.sha256 };
  }

  // ─── templates ───────────────────────────────────────────────────────────
  async submitTemplate(input: TemplateSubmitInput): Promise<TemplateSubmitResult> {
    const url = `${this.baseUrl}/${this.ctx.wabaId}/message_templates`;
    const components: unknown[] = [];

    if (input.headerType && input.headerType !== "NONE") {
      const header: Record<string, unknown> = { type: "HEADER", format: input.headerType };
      if (input.headerType === "TEXT" && input.headerText) header.text = input.headerText;
      if (["IMAGE", "VIDEO", "DOCUMENT"].includes(input.headerType) && input.headerMediaUrl) {
        header.example = { header_handle: [input.headerMediaUrl] };
      }
      components.push(header);
    }

    const body: Record<string, unknown> = { type: "BODY", text: input.bodyText };
    if (input.bodyExample) body.example = { body_text: input.bodyExample };
    components.push(body);

    if (input.footer) components.push({ type: "FOOTER", text: input.footer });
    if (input.buttons && input.buttons.length > 0) {
      components.push({
        type: "BUTTONS",
        buttons: input.buttons.map((b) => {
          if (b.type === "URL") return { type: "URL", text: b.text, url: b.url };
          if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number };
          return { type: "QUICK_REPLY", text: b.text };
        }),
      });
    }

    const payload = {
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.ctx.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const raw = (await res.json().catch(() => null)) as
      | { id?: string; status?: string; error?: { message?: string } }
      | null;

    if (!res.ok || !raw?.id) {
      throw new Error(raw?.error?.message ?? `Template submit failed (HTTP ${res.status})`);
    }
    return { metaTemplateId: raw.id, status: raw.status ?? "PENDING" };
  }

  async getTemplateStatus(metaTemplateId: string) {
    const url = `${this.baseUrl}/${metaTemplateId}?fields=status,rejected_reason`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.ctx.accessToken}` },
    });
    if (!res.ok) throw new Error(`Meta template status failed: ${res.status}`);
    const data = (await res.json()) as { status: string; rejected_reason?: string };
    return { status: data.status, rejectionReason: data.rejected_reason };
  }

  // ─── helpers ─────────────────────────────────────────────────────────────
  private buildSendPayload(envelope: OutboundEnvelope): Record<string, unknown> {
    const { toPhone, body, replyToWaMessageId } = envelope;
    const base: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toPhone,
    };
    if (replyToWaMessageId) {
      base.context = { message_id: replyToWaMessageId };
    }

    switch (body.type) {
      case "text":
        return { ...base, type: "text", text: { body: body.text, preview_url: body.previewUrl ?? false } };

      case "image":
      case "audio":
      case "video":
      case "sticker":
      case "document": {
        const media: Record<string, unknown> = { link: body.mediaUrl };
        if (body.type === "image" || body.type === "video" || body.type === "document") {
          if (body.caption) media.caption = body.caption;
        }
        if (body.type === "document" && body.filename) media.filename = body.filename;
        return { ...base, type: body.type, [body.type]: media };
      }

      case "location":
        return {
          ...base,
          type: "location",
          location: {
            latitude: body.latitude,
            longitude: body.longitude,
            name: body.name,
            address: body.address,
          },
        };

      case "interactive_buttons":
        return {
          ...base,
          type: "interactive",
          interactive: {
            type: "button",
            ...(body.headerText ? { header: { type: "text", text: body.headerText } } : {}),
            body: { text: body.bodyText },
            ...(body.footerText ? { footer: { text: body.footerText } } : {}),
            action: {
              buttons: body.buttons.map((b) => ({
                type: "reply",
                reply: { id: b.id, title: b.title.slice(0, 20) },
              })),
            },
          },
        };

      case "interactive_list":
        return {
          ...base,
          type: "interactive",
          interactive: {
            type: "list",
            ...(body.headerText ? { header: { type: "text", text: body.headerText } } : {}),
            body: { text: body.bodyText },
            ...(body.footerText ? { footer: { text: body.footerText } } : {}),
            action: {
              button: body.buttonText.slice(0, 20),
              sections: body.sections.map((s) => ({
                title: s.title,
                rows: s.rows.map((r) => ({
                  id: r.id,
                  title: r.title.slice(0, 24),
                  ...(r.description ? { description: r.description.slice(0, 72) } : {}),
                })),
              })),
            },
          },
        };

      case "template":
        return {
          ...base,
          type: "template",
          template: {
            name: body.templateName,
            language: { code: body.language },
            components: body.components,
          },
        };
    }
  }

  private parseInboundMessage(msg: MetaInboundMessage, profileName?: string): ParsedInboundMessage | null {
    const baseType = (msg.type ?? "unsupported") as string;
    let type: ParsedMessageType;
    let text: string | undefined;
    let mediaProviderId: string | undefined;
    let mediaMime: string | undefined;
    let mediaSha256: string | undefined;
    let mediaCaption: string | undefined;
    let interactiveReply: ParsedInboundMessage["interactiveReply"];
    let location: ParsedInboundMessage["location"];
    let reaction: ParsedInboundMessage["reaction"];
    const replyToWaMessageId: string | undefined = msg.context?.id;

    switch (baseType) {
      case "text":
        type = "text";
        text = msg.text?.body;
        break;
      case "image":
      case "audio":
      case "video":
      case "document":
      case "sticker":
        type = baseType as ParsedMessageType;
        const media = msg[baseType] as MetaInboundMedia | undefined;
        mediaProviderId = media?.id;
        mediaMime = media?.mime_type;
        mediaSha256 = media?.sha256;
        mediaCaption = media?.caption;
        break;
      case "location":
        type = "location";
        location = {
          latitude: msg.location!.latitude,
          longitude: msg.location!.longitude,
          name: msg.location!.name,
          address: msg.location!.address,
        };
        break;
      case "interactive": {
        const inter = msg.interactive!;
        if (inter.type === "button_reply") {
          type = "interactive_button_reply";
          interactiveReply = { id: inter.button_reply!.id, title: inter.button_reply!.title, type: "button" };
        } else if (inter.type === "list_reply") {
          type = "interactive_list_reply";
          interactiveReply = { id: inter.list_reply!.id, title: inter.list_reply!.title, type: "list" };
        } else {
          type = "unsupported";
        }
        break;
      }
      case "reaction":
        type = "reaction";
        reaction = { messageId: msg.reaction!.message_id, emoji: msg.reaction!.emoji };
        break;
      case "contacts":
        type = "contacts";
        break;
      default:
        type = "unsupported";
    }

    return {
      waMessageId: msg.id,
      fromPhone: msg.from,
      profileName,
      timestamp: new Date(parseInt(msg.timestamp, 10) * 1000),
      type,
      text,
      mediaProviderId,
      mediaMime,
      mediaSha256,
      mediaCaption,
      interactiveReply,
      location,
      reaction,
      replyToWaMessageId,
      rawPayload: msg,
    };
  }

  private isRetryable(httpStatus: number, errorCode?: number): boolean {
    if (httpStatus >= 500) return true;
    if (httpStatus === 429) return true;
    // Meta error codes documentados (parcial):
    //   131000 — generic, retryable
    //   131005 — access denied (no retry)
    //   131008 — required parameter missing (no retry)
    //   131056 — pair rate limit reached (retry)
    if (errorCode === 131000 || errorCode === 131056) return true;
    return false;
  }
}

// ─── Tipos Meta ────────────────────────────────────────────────────────────

interface MetaErrorEnvelope {
  error?: { code?: number; message?: string; type?: string; error_data?: unknown; fbtrace_id?: string };
}

interface MetaSendOk {
  messaging_product: string;
  contacts?: { input: string; wa_id: string }[];
  messages?: { id: string; message_status?: string }[];
}

interface MetaWebhookBody {
  object: string;
  entry?: { id: string; changes?: { field: string; value: unknown }[] }[];
}

interface MetaContact {
  profile?: { name?: string };
  wa_id: string;
}

interface MetaInboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: MetaInboundMedia;
  audio?: MetaInboundMedia;
  video?: MetaInboundMedia;
  document?: MetaInboundMedia;
  sticker?: MetaInboundMedia;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  interactive?: {
    type: "button_reply" | "list_reply" | string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  reaction?: { message_id: string; emoji: string };
  context?: { id?: string };
}

interface MetaInboundMedia {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
}

interface MetaStatusEntry {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; message: string }[];
}

interface MetaTemplateStatusUpdate {
  message_template_id: string;
  message_template_name: string;
  message_template_language: string;
  event: string;
  reason?: string;
}
