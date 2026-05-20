import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyGatewaySignature } from "@/lib/crm/baileys-gateway";
import { BaileysProvider } from "@/lib/crm/providers/baileys";
import { processInboundMessage, processStatusUpdate } from "@/lib/crm/inbound";
import type { CrmChannelStatus } from "@/lib/types/database";

export const runtime = "nodejs"; // crypto.timingSafeEqual / HMAC
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Inbound webhook del gateway Baileys (Railway → app). HMAC-firmado con el
 * shared secret. Reusa EXACTAMENTE el mismo pipeline inbound que Meta
 * (@/lib/crm/inbound) → contacto/conversación/mensaje + dispatchEvent
 * "message.received" → workflows. Las automatizaciones se disparan igual que
 * con la API oficial.
 *
 * Eventos:
 *  • message / status  → pipeline compartido (idéntico a Meta).
 *  • connection        → mapea a crm_channels.status (la sesión/QR la escribe
 *                        el gateway directo en crm_baileys_sessions → Realtime).
 */

interface ConnectionEvent {
  kind: "connection";
  connection: {
    status: string;
    phone?: string;
    lastError?: string;
  };
}

function mapChannelStatus(connStatus: string): CrmChannelStatus {
  switch (connStatus) {
    case "connected":
      return "active";
    case "disconnected":
    case "logged_out":
      return "disabled";
    case "error":
    case "conflict":
    case "banned":
      return "error";
    default:
      return "pending"; // connecting | qr | pairing
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-baileys-signature");

  if (!verifyGatewaySignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: { organizationId?: string; channelId?: string; events?: unknown[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const organizationId = body.organizationId;
  const channelId = body.channelId;
  if (!organizationId || !channelId) {
    return NextResponse.json({ error: "missing_ids" }, { status: 400 });
  }

  const admin = createAdminClient();

  // El canal debe existir, pertenecer a esa org y ser baileys.
  const { data: channel } = await admin
    .from("crm_channels")
    .select("id,organization_id,provider")
    .eq("id", channelId)
    .eq("organization_id", organizationId)
    .eq("provider", "baileys")
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ ok: true, ignored: "channel_not_registered" });
  }

  // Connection events → crm_channels.status (idempotente).
  const events = (body.events ?? []) as Array<Record<string, unknown>>;
  for (const ev of events) {
    if (ev.kind === "connection") {
      const conn = (ev as unknown as ConnectionEvent).connection;
      const update: Record<string, unknown> = {
        status: mapChannelStatus(conn.status),
        last_error: conn.lastError ?? null,
        last_health_check_at: new Date().toISOString(),
      };
      if (conn.phone) update.phone_number = conn.phone;
      await admin.from("crm_channels").update(update).eq("id", channel.id);
    }
  }

  // message / status → pipeline compartido (mismo que Meta).
  const provider = new BaileysProvider({
    channelId: channel.id,
    organizationId: channel.organization_id,
  });
  const parsed = provider.parseWebhook(body);

  for (const e of parsed) {
    if (e.kind === "message") {
      await processInboundMessage(admin, channel.organization_id, channel.id, e.message, "phone");
    } else if (e.kind === "status") {
      await processStatusUpdate(admin, channel.id, e.status);
    }
  }

  return NextResponse.json({
    ok: true,
    events_processed: parsed.length,
    channel_provider: "baileys",
  });
}
