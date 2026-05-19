import {
  downloadMediaMessage,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { supabase } from "./supabase";
import { baileysLogger, logger } from "./logger";

const BUCKET = "crm-media";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

function extFor(mime: string): string {
  const base = mime.split(";")[0]?.trim() ?? mime;
  return EXT[base] ?? base.split("/")[1] ?? "bin";
}

interface MediaNode {
  mimetype?: string | null;
  seconds?: number | null;
  fileName?: string | null;
  fileLength?: number | Long | null;
}
type Long = { toNumber: () => number };

function pickMediaNode(msg: WAMessage): { node: MediaNode; kind: string } | null {
  const m = msg.message;
  if (!m) return null;
  if (m.imageMessage) return { node: m.imageMessage, kind: "image" };
  if (m.videoMessage) return { node: m.videoMessage, kind: "video" };
  if (m.audioMessage) return { node: m.audioMessage, kind: "audio" };
  if (m.documentMessage) return { node: m.documentMessage, kind: "document" };
  if (m.documentWithCaptionMessage?.message?.documentMessage)
    return { node: m.documentWithCaptionMessage.message.documentMessage, kind: "document" };
  if (m.stickerMessage) return { node: m.stickerMessage, kind: "sticker" };
  return null;
}

export interface StoredMedia {
  storagePath: string;
  mime: string;
  sizeBytes: number;
  durationMs?: number;
  filename?: string;
}

/**
 * Download an inbound media message via Baileys and persist it to the same
 * Supabase Storage bucket the Meta pipeline uses (`crm-media`), so the inbox /
 * message-bubble render path is identical regardless of provider.
 */
export async function downloadAndStore(
  sock: WASocket,
  msg: WAMessage,
  organizationId: string,
  channelId: string,
  waMessageId: string,
): Promise<StoredMedia | null> {
  const picked = pickMediaNode(msg);
  if (!picked) return null;
  const { node } = picked;

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: baileysLogger, reuploadRequest: sock.updateMediaMessage },
    )) as Buffer;

    const mime = (node.mimetype ?? "application/octet-stream").split(";")[0]!.trim();
    const ext = extFor(mime);
    const safeId = waMessageId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const storagePath = `${organizationId}/${channelId}/${safeId}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: mime, upsert: true });
    if (error) {
      logger.error({ err: error.message, storagePath }, "media upload failed");
      return null;
    }

    const lenRaw = node.fileLength;
    const sizeBytes =
      typeof lenRaw === "number"
        ? lenRaw
        : lenRaw && typeof lenRaw.toNumber === "function"
          ? lenRaw.toNumber()
          : buffer.length;

    return {
      storagePath,
      mime,
      sizeBytes,
      durationMs: node.seconds ? node.seconds * 1000 : undefined,
      filename: node.fileName ?? undefined,
    };
  } catch (err) {
    logger.error({ err: String(err), waMessageId }, "media download failed");
    return null;
  }
}
