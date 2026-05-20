import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { useSupabaseAuthState, type SupabaseAuthState } from "./auth-state";
import { downloadAndStore } from "./media";
import { toBaileysContent, type OutboundBody } from "./outbound";
import { emitToApp, type GatewayEvent } from "./webhook";
import { supabase } from "./supabase";
import { baileysLogger, logger } from "./logger";
import { config } from "./config";

type SessionStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "pairing"
  | "connected"
  | "logged_out"
  | "conflict"
  | "error"
  | "banned";

const SUFFIX = "@s.whatsapp.net";

function phoneToJid(phone: string): string {
  return `${phone.replace(/[^0-9]/g, "")}${SUFFIX}`;
}
function jidToPhone(jid: string): string {
  return jidNormalizedUser(jid).split("@")[0]!.replace(/[^0-9]/g, "");
}
const rand = (max: number) => Math.floor(Math.random() * max);

/**
 * One persistent WhatsApp Web connection for one rentOS channel (one org).
 * Owns the socket, the reconnection policy, the humanized send queue, and is
 * the single writer of crm_baileys_sessions (→ Supabase Realtime → connect UI).
 */
export class WaSession {
  private sock: WASocket | null = null;
  private auth: SupabaseAuthState | null = null;
  status: SessionStatus = "disconnected";
  private phone: string | null = null;
  private pendingPairingPhone: string | null = null;
  private manualClose = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastSentAt = 0;
  private sendChain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly channelId: string,
    readonly organizationId: string,
  ) {}

  /** Open (or re-open) the socket. `pairingPhone` switches QR → pairing-code flow. */
  async connect(pairingPhone?: string): Promise<void> {
    if (this.sock) return; // already up / connecting
    this.manualClose = false;
    this.pendingPairingPhone = pairingPhone ?? null;
    await this.setStatus("connecting");

    this.auth = await useSupabaseAuthState(this.channelId, this.organizationId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: this.auth.state.creds,
        keys: makeCacheableSignalKeyStore(this.auth.state.keys, baileysLogger),
      },
      logger: baileysLogger,
      browser: Browsers.ubuntu("Chrome"),
      markOnlineOnConnect: false, // don't hijack the phone's "online" / notifications
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      retryRequestDelayMs: 1000,
    });
    this.sock = sock;

    sock.ev.on("creds.update", () => void this.auth?.saveCreds());
    sock.ev.on("connection.update", (u) => void this.onConnectionUpdate(u));
    sock.ev.on("messages.upsert", (u) => void this.onMessagesUpsert(u));
    sock.ev.on("messages.update", (u) => void this.onMessagesUpdate(u));

    // Pairing-code flow (alternative to QR): request once, after the socket
    // starts but before registration completes.
    if (pairingPhone && !sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(pairingPhone.replace(/[^0-9]/g, ""));
          await this.setStatus("pairing", { pairingCode: code });
          logger.info({ channelId: this.channelId }, "pairing code issued");
        } catch (err) {
          logger.error({ err: String(err) }, "requestPairingCode failed");
          await this.setStatus("error", { lastError: "No se pudo generar el código de vinculación" });
        }
      }, 3000);
    }
  }

  private async onConnectionUpdate(u: {
    connection?: string;
    lastDisconnect?: { error?: unknown };
    qr?: string;
  }): Promise<void> {
    const { connection, lastDisconnect, qr } = u;

    if (qr && !this.pendingPairingPhone) {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      await this.setStatus("qr", {
        qr: dataUrl,
        qrExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    }

    if (connection === "open") {
      this.reconnectAttempts = 0;
      this.pendingPairingPhone = null;
      const me = this.sock?.user?.id ? jidToPhone(this.sock.user.id) : null;
      this.phone = me;
      await this.setStatus("connected", {
        phone: me ?? undefined,
        deviceName: this.sock?.user?.name ?? undefined,
      });
      logger.info({ channelId: this.channelId, phone: me }, "whatsapp connected");
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      this.sock = null;

      if (this.manualClose) {
        await this.setStatus("disconnected");
        return;
      }
      if (code === DisconnectReason.loggedOut) {
        await this.auth?.clearState();
        await this.setStatus("logged_out", {
          lastError: "El teléfono cerró la sesión. Volvé a vincular.",
        });
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        await this.setStatus("conflict", {
          lastError: "Se abrió WhatsApp Web en otro lugar con este número.",
        });
        return;
      }
      if (code === DisconnectReason.badSession) {
        await this.auth?.clearState();
        await this.setStatus("error", { lastError: "Sesión corrupta. Volvé a vincular." });
        return;
      }
      if (code === 403) {
        await this.setStatus("banned", {
          lastError: "WhatsApp bloqueó este número.",
        });
        return;
      }
      // Transient (restartRequired / connectionLost / timedOut / 5xx) → backoff
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manualClose) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(
      config.reconnectMaxMs,
      Math.round(1000 * 2 ** this.reconnectAttempts) + rand(2000),
    );
    void this.setStatus("connecting", {
      lastError: `Reconectando (intento ${this.reconnectAttempts})…`,
    });
    logger.warn({ channelId: this.channelId, delay }, "scheduling reconnect");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(this.pendingPairingPhone ?? undefined).catch((err) =>
        logger.error({ err: String(err) }, "reconnect failed"),
      );
    }, delay);
  }

  // ─── Inbound ─────────────────────────────────────────────────────────────
  private async onMessagesUpsert(u: { messages: WAMessage[]; type: string }): Promise<void> {
    if (u.type !== "notify") return;
    for (const msg of u.messages) {
      try {
        await this.handleInbound(msg);
      } catch (err) {
        logger.error({ err: String(err) }, "handleInbound failed");
      }
    }
  }

  private async handleInbound(msg: WAMessage): Promise<void> {
    const jid = msg.key.remoteJid ?? "";
    if (msg.key.fromMe) return; // outbound echo
    if (!jid || jid === "status@broadcast") return;
    if (jid.endsWith("@g.us") || jid.endsWith("@newsletter")) return; // 1:1 only
    const m = msg.message;
    if (!m) return;

    const waMessageId = msg.key.id ?? "";
    if (!waMessageId) return;
    const fromPhone = jidToPhone(jid);
    const timestamp = new Date(
      (typeof msg.messageTimestamp === "number"
        ? msg.messageTimestamp
        : Number(msg.messageTimestamp ?? Date.now() / 1000)) * 1000,
    ).toISOString();
    const ctx =
      m.extendedTextMessage?.contextInfo ??
      m.imageMessage?.contextInfo ??
      m.videoMessage?.contextInfo;
    const replyToWaMessageId = ctx?.stanzaId ?? undefined;

    const ev: GatewayEvent = {
      kind: "message",
      message: {
        waMessageId,
        fromPhone,
        profileName: msg.pushName ?? undefined,
        timestamp,
        type: "unsupported",
        replyToWaMessageId,
      },
    };
    const out = ev.message;

    if (m.conversation || m.extendedTextMessage?.text) {
      out.type = "text";
      out.text = m.conversation ?? m.extendedTextMessage?.text ?? "";
    } else if (m.locationMessage) {
      out.type = "location";
      out.location = {
        latitude: m.locationMessage.degreesLatitude ?? 0,
        longitude: m.locationMessage.degreesLongitude ?? 0,
        name: m.locationMessage.name ?? undefined,
        address: m.locationMessage.address ?? undefined,
      };
    } else if (m.reactionMessage) {
      out.type = "reaction";
      out.reaction = {
        messageId: m.reactionMessage.key?.id ?? "",
        emoji: m.reactionMessage.text ?? "",
      };
    } else if (
      m.imageMessage ||
      m.videoMessage ||
      m.audioMessage ||
      m.documentMessage ||
      m.documentWithCaptionMessage ||
      m.stickerMessage
    ) {
      out.type = m.imageMessage
        ? "image"
        : m.videoMessage
          ? "video"
          : m.audioMessage
            ? "audio"
            : m.stickerMessage
              ? "sticker"
              : "document";
      out.text =
        m.imageMessage?.caption ??
        m.videoMessage?.caption ??
        m.documentMessage?.caption ??
        undefined;
      const stored = this.sock
        ? await downloadAndStore(this.sock, msg, this.organizationId, this.channelId, waMessageId)
        : null;
      if (stored) {
        out.mediaStoragePath = stored.storagePath;
        out.mediaMime = stored.mime;
        out.mediaSizeBytes = stored.sizeBytes;
        out.mediaDurationMs = stored.durationMs;
        out.mediaFilename = stored.filename;
      }
    } else {
      out.type = "unsupported";
    }

    await emitToApp(this.organizationId, this.channelId, [ev]);
  }

  // ─── Delivery / read receipts ────────────────────────────────────────────
  private async onMessagesUpdate(
    updates: { key: WAMessage["key"]; update: Partial<WAMessage> }[],
  ): Promise<void> {
    const events: GatewayEvent[] = [];
    for (const { key, update } of updates) {
      if (!key.fromMe || !key.id) continue;
      if (update.status == null) continue;
      const s = Number(update.status);
      // proto WebMessageInfo.Status: 0 ERROR 1 PENDING 2 SERVER_ACK 3 DELIVERY_ACK 4 READ 5 PLAYED
      const mapped: "read" | "delivered" | "sent" | "failed" | null =
        s >= 4 ? "read" : s === 3 ? "delivered" : s === 2 ? "sent" : s === 0 ? "failed" : null;
      if (!mapped) continue;
      events.push({
        kind: "status",
        status: {
          waMessageId: key.id,
          status: mapped,
          timestamp: new Date().toISOString(),
          recipientPhone: key.remoteJid ? jidToPhone(key.remoteJid) : "",
        },
      });
    }
    if (events.length) await emitToApp(this.organizationId, this.channelId, events);
  }

  // ─── Outbound (humanized, serialized per session) ────────────────────────
  async send(
    toPhone: string,
    body: OutboundBody,
  ): Promise<{ ok: true; providerMessageId: string } | { ok: false; error: string; retryable: boolean }> {
    if (!this.sock || this.status !== "connected") {
      return { ok: false, error: `whatsapp_not_connected (${this.status})`, retryable: true };
    }
    const run = this.sendChain.then(() => this.doSend(toPhone, body));
    // keep the chain alive regardless of individual failures
    this.sendChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doSend(
    toPhone: string,
    body: OutboundBody,
  ): Promise<{ ok: true; providerMessageId: string } | { ok: false; error: string; retryable: boolean }> {
    const sock = this.sock;
    if (!sock) return { ok: false, error: "socket_gone", retryable: true };
    const jid = phoneToJid(toPhone);

    try {
      // Anti-ban pacing: min gap since last send + jitter + a short "typing".
      const sinceLast = Date.now() - this.lastSentAt;
      const gap = Math.max(0, config.sendMinGapMs - sinceLast);
      const jitter = rand(config.sendJitterMs);
      await sleep(gap + jitter);

      try {
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate("composing", jid);
        await sleep(600 + rand(900));
        await sock.sendPresenceUpdate("paused", jid);
      } catch {
        /* presence is best-effort */
      }

      const content = toBaileysContent(body);
      const sent = await sock.sendMessage(jid, content);
      this.lastSentAt = Date.now();
      const id = sent?.key?.id;
      if (!id) return { ok: false, error: "no_message_id", retryable: true };
      return { ok: true, providerMessageId: id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Connection-ish errors are retryable; payload errors are not.
      const retryable = /timed?\s*out|connection|closed|socket|rate|overloaded/i.test(message);
      logger.error({ err: message, toPhone }, "send failed");
      return { ok: false, error: message, retryable };
    }
  }

  async logout(): Promise<void> {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.sock?.logout();
    } catch {
      /* ignore */
    }
    try {
      this.sock?.end(undefined);
    } catch {
      /* ignore */
    }
    this.sock = null;
    await this.auth?.clearState();
    await this.setStatus("disconnected");
  }

  /** Best-effort read receipt back to the contact. */
  async markRead(remoteJid: string, messageId: string, participant?: string): Promise<void> {
    try {
      await this.sock?.readMessages([
        { remoteJid, id: messageId, fromMe: false, participant },
      ]);
    } catch (err) {
      logger.debug({ err: String(err) }, "markRead failed (non-fatal)");
    }
  }

  /** Graceful socket close on SIGTERM (Railway redeploy) WITHOUT clearing state. */
  shutdown(): void {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.sock?.end(undefined);
    } catch {
      /* ignore */
    }
  }

  // ─── Status: single source of truth for the connect UI ───────────────────
  private async setStatus(
    status: SessionStatus,
    extra: {
      phone?: string;
      deviceName?: string;
      qr?: string;
      qrExpiresAt?: string;
      pairingCode?: string;
      lastError?: string;
    } = {},
  ): Promise<void> {
    this.status = status;
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      channel_id: this.channelId,
      organization_id: this.organizationId,
      status,
      last_seen_at: now,
      updated_at: now,
      // transient fields are cleared unless explicitly set for this transition
      qr: extra.qr ?? null,
      qr_expires_at: extra.qrExpiresAt ?? null,
      pairing_code: extra.pairingCode ?? null,
      last_error: extra.lastError ?? null,
    };
    if (extra.phone) row.phone = extra.phone;
    if (extra.deviceName) row.device_name = extra.deviceName;
    if (status === "connected") {
      row.connected_at = now;
      row.last_error = null;
    }
    if (status === "disconnected" || status === "logged_out") row.disconnected_at = now;

    const { error } = await supabase
      .from("crm_baileys_sessions")
      .upsert(row, { onConflict: "channel_id" });
    if (error) logger.error({ err: error.message }, "session status upsert failed");

    await emitToApp(this.organizationId, this.channelId, [
      {
        kind: "connection",
        connection: {
          status,
          phone: extra.phone ?? this.phone ?? undefined,
          deviceName: extra.deviceName,
          qr: extra.qr,
          qrExpiresAt: extra.qrExpiresAt,
          pairingCode: extra.pairingCode,
          lastError: extra.lastError,
        },
      },
    ]);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
