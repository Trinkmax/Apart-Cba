import type { AnyMessageContent } from "@whiskeysockets/baileys";

/**
 * Mirror of the app's OutboundMessageBody union (src/lib/crm/providers/types.ts).
 * Kept structurally identical so the existing outbox payload flows through
 * unchanged.
 */
export type OutboundBody =
  | { type: "text"; text: string; previewUrl?: boolean }
  | {
      type: "image" | "audio" | "video" | "document" | "sticker";
      mediaUrl: string;
      caption?: string;
      filename?: string;
    }
  | { type: "location"; latitude: number; longitude: number; name?: string; address?: string }
  | {
      type: "interactive_buttons";
      bodyText: string;
      headerText?: string;
      footerText?: string;
      buttons: { id: string; title: string }[];
    }
  | {
      type: "interactive_list";
      bodyText: string;
      buttonText: string;
      headerText?: string;
      footerText?: string;
      sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
    }
  | { type: "template"; templateName: string; language: string; components: unknown[] };

/**
 * Native buttons/lists/templates are unreliable on WhatsApp for unofficial
 * (web) clients in 2026 — they frequently render as a blank message. The robust
 * choice is to flatten them to a well-formatted text message so automations
 * that emit buttons still deliver something the guest can act on.
 */
function flattenInteractive(body: Extract<OutboundBody, { type: "interactive_buttons" | "interactive_list" }>): string {
  const parts: string[] = [];
  if ("headerText" in body && body.headerText) parts.push(`*${body.headerText}*`);
  parts.push(body.bodyText);
  if (body.type === "interactive_buttons") {
    body.buttons.forEach((b, i) => parts.push(`${i + 1}. ${b.title}`));
  } else {
    for (const s of body.sections) {
      if (s.title) parts.push(`*${s.title}*`);
      s.rows.forEach((r, i) =>
        parts.push(`${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ""}`),
      );
    }
  }
  if (body.footerText) parts.push(`_${body.footerText}_`);
  return parts.join("\n");
}

export function toBaileysContent(body: OutboundBody): AnyMessageContent {
  switch (body.type) {
    case "text":
      return { text: body.text };
    case "image":
      return { image: { url: body.mediaUrl }, caption: body.caption };
    case "video":
      return { video: { url: body.mediaUrl }, caption: body.caption };
    case "audio":
      return { audio: { url: body.mediaUrl }, mimetype: "audio/mp4" };
    case "document":
      return {
        document: { url: body.mediaUrl },
        fileName: body.filename ?? "documento",
        caption: body.caption,
        mimetype: "application/octet-stream",
      };
    case "sticker":
      return { sticker: { url: body.mediaUrl } };
    case "location":
      return {
        location: {
          degreesLatitude: body.latitude,
          degreesLongitude: body.longitude,
          name: body.name,
          address: body.address,
        },
      };
    case "interactive_buttons":
    case "interactive_list":
      return { text: flattenInteractive(body) };
    case "template":
      // Baileys = a normal account; there is no Meta template engine. The app
      // pre-renders template text into a plain message before enqueueing for
      // baileys channels, so this is a defensive fallback only.
      return { text: `[plantilla ${body.templateName}]` };
  }
}
