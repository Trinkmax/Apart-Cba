import express, { type Request, type Response, type NextFunction } from "express";
import { bearerOk } from "./crypto";
import { sessionManager } from "./session-manager";
import { supabase } from "./supabase";
import { logger } from "./logger";
import type { OutboundBody } from "./outbound";

export function buildServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Railway healthcheck — unauthenticated, cheap.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // Everything else requires the shared bearer secret.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!bearerOk(req.header("authorization"))) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  app.post("/sessions/:channelId/connect", async (req, res) => {
    const { channelId } = req.params;
    const organizationId = String(req.body?.organizationId ?? "");
    const pairingPhone = req.body?.pairingPhone ? String(req.body.pairingPhone) : undefined;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId required" });
      return;
    }
    try {
      const s = await sessionManager.connect(channelId, organizationId, pairingPhone);
      res.json({ ok: true, status: s.status });
    } catch (err) {
      logger.error({ err: String(err), channelId }, "connect endpoint failed");
      res.status(500).json({ error: "connect_failed", detail: String(err) });
    }
  });

  app.get("/sessions/:channelId/status", async (req, res) => {
    const { channelId } = req.params;
    const { data } = await supabase
      .from("crm_baileys_sessions")
      .select("status, phone, device_name, qr, qr_expires_at, pairing_code, last_error, connected_at")
      .eq("channel_id", channelId)
      .maybeSingle();
    const live = sessionManager.get(channelId)?.status;
    res.json({ ok: true, live: live ?? "disconnected", session: data ?? null });
  });

  app.post("/sessions/:channelId/logout", async (req, res) => {
    await sessionManager.logout(req.params.channelId);
    res.json({ ok: true });
  });

  app.post("/sessions/:channelId/send", async (req, res) => {
    const { channelId } = req.params;
    const organizationId = String(req.body?.organizationId ?? "");
    const toPhone = String(req.body?.toPhone ?? "");
    const body = req.body?.body as OutboundBody | undefined;
    if (!organizationId || !toPhone || !body) {
      res.status(400).json({ error: "organizationId, toPhone, body required" });
      return;
    }
    const result = await sessionManager.send(channelId, organizationId, toPhone, body);
    res.json(result);
  });

  app.post("/sessions/:channelId/read", async (req, res) => {
    const s = sessionManager.get(req.params.channelId);
    const messageId = String(req.body?.messageId ?? "");
    const remoteJid = String(req.body?.remoteJid ?? "");
    if (s && messageId && remoteJid) {
      await s.markRead(remoteJid, messageId, req.body?.participant);
    }
    res.json({ ok: true });
  });

  return app;
}
