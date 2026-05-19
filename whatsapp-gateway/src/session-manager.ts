import { WaSession } from "./session";
import { supabase } from "./supabase";
import { logger } from "./logger";
import type { OutboundBody } from "./outbound";

/** Multi-tenant: one WaSession per rentOS baileys channel (one per org). */
class SessionManager {
  private sessions = new Map<string, WaSession>();

  get(channelId: string): WaSession | undefined {
    return this.sessions.get(channelId);
  }

  private getOrCreate(channelId: string, organizationId: string): WaSession {
    let s = this.sessions.get(channelId);
    if (!s) {
      s = new WaSession(channelId, organizationId);
      this.sessions.set(channelId, s);
    }
    return s;
  }

  async connect(channelId: string, organizationId: string, pairingPhone?: string): Promise<WaSession> {
    const s = this.getOrCreate(channelId, organizationId);
    await s.connect(pairingPhone);
    return s;
  }

  async send(
    channelId: string,
    organizationId: string,
    toPhone: string,
    body: OutboundBody,
  ): Promise<{ ok: true; providerMessageId: string } | { ok: false; error: string; retryable: boolean }> {
    let s = this.sessions.get(channelId);
    if (!s) {
      // In-memory map lost (redeploy) but creds are durable → lazily revive.
      s = this.getOrCreate(channelId, organizationId);
      s.connect().catch((err) => logger.error({ err: String(err) }, "lazy connect failed"));
      return { ok: false, error: "session_reviving", retryable: true };
    }
    return s.send(toPhone, body);
  }

  async logout(channelId: string): Promise<void> {
    const s = this.sessions.get(channelId);
    if (s) await s.logout();
  }

  /**
   * On boot, re-establish every session that was meant to be online. Auth
   * state is durable in Postgres so this resumes WITHOUT a new QR scan.
   */
  async recoverAll(): Promise<void> {
    const { data, error } = await supabase
      .from("crm_baileys_sessions")
      .select("channel_id, organization_id, status")
      .not("status", "in", '("disconnected","logged_out","banned")');
    if (error) {
      logger.error({ err: error.message }, "recoverAll query failed");
      return;
    }
    logger.info({ count: data?.length ?? 0 }, "recovering baileys sessions");
    for (const row of data ?? []) {
      const s = this.getOrCreate(row.channel_id, row.organization_id);
      s.connect().catch((err) =>
        logger.error({ err: String(err), channelId: row.channel_id }, "recover connect failed"),
      );
    }
  }

  shutdownAll(): void {
    for (const s of this.sessions.values()) s.shutdown();
  }
}

export const sessionManager = new SessionManager();
