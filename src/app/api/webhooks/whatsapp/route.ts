import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getProviderForPhoneNumberId, getProviderForInstagramId } from "@/lib/crm/providers/factory";
import { getSecret } from "@/lib/crm/encryption";
import {
  processInboundMessage,
  processStatusUpdate,
  processTemplateStatus,
} from "@/lib/crm/inbound";
import type { CrmContactExternalKind } from "@/lib/types/database";

export const runtime = "nodejs"; // crypto.createHmac requiere node runtime
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook único de Meta WhatsApp Business API.
 * Routing multi-tenant: cada evento trae phone_number_id → resuelve org.
 *
 * GET: verify challenge (suscripción inicial Meta).
 * POST: eventos (messages, statuses, template_status).
 *
 * El procesamiento inbound vive en @/lib/crm/inbound (compartido con el
 * webhook de Baileys) para que las automatizaciones se disparen idénticas.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  // Sin canal específico, usamos el verify token global del .env como fallback.
  const expectedToken = process.env.META_WEBHOOK_DEFAULT_TOKEN;
  if (mode === "subscribe" && token && expectedToken && token === expectedToken) {
    return new Response(challenge ?? "", { status: 200 });
  }

  // Si tenemos múltiples canales con tokens distintos, hacer lookup en DB
  // por todos los webhook_verify_token_secret_id y comparar uno a uno.
  if (mode === "subscribe" && token) {
    const admin = createAdminClient();
    const { data: channels } = await admin
      .from("crm_channels")
      .select("id,webhook_verify_token_secret_id")
      .not("webhook_verify_token_secret_id", "is", null);
    for (const ch of channels ?? []) {
      const stored = await getSecret(ch.webhook_verify_token_secret_id);
      if (stored && stored === token) {
        return new Response(challenge ?? "", { status: 200 });
      }
    }
  }

  return NextResponse.json({ error: "verify_failed" }, { status: 403 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const objectType = (parsedBody as { object?: string } | null)?.object;

  // Routing según object: 'whatsapp_business_account' o 'instagram'
  let lookup: Awaited<ReturnType<typeof getProviderForPhoneNumberId>> | null = null;
  let externalKind: CrmContactExternalKind = "phone";

  if (objectType === "whatsapp_business_account") {
    const phoneNumberId = extractPhoneNumberId(parsedBody);
    if (!phoneNumberId) return NextResponse.json({ ok: true, ignored: "no_phone_number_id" });
    lookup = await getProviderForPhoneNumberId(phoneNumberId);
    externalKind = "phone";
  } else if (objectType === "instagram") {
    const entryId = extractEntryId(parsedBody);
    if (!entryId) return NextResponse.json({ ok: true, ignored: "no_entry_id" });
    lookup = await getProviderForInstagramId(entryId);
    externalKind = "igsid";
  } else {
    return NextResponse.json({ ok: true, ignored: `unsupported_object_${objectType ?? "null"}` });
  }

  if (!lookup) {
    return NextResponse.json({ ok: true, ignored: "channel_not_registered" });
  }

  const { provider, channel } = lookup;

  const appSecret = await getSecret(channel.app_secret_secret_id);
  if (appSecret) {
    const valid = provider.verifyWebhookSignature(rawBody, signature, appSecret);
    if (!valid) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  const events = provider.parseWebhook(parsedBody);
  const admin = createAdminClient();

  for (const ev of events) {
    if (ev.kind === "message") {
      await processInboundMessage(admin, channel.organization_id, channel.id, ev.message, externalKind);
    } else if (ev.kind === "status") {
      await processStatusUpdate(admin, channel.id, ev.status);
    } else if (ev.kind === "template_status") {
      await processTemplateStatus(admin, channel.id, ev.templateStatus);
    }
  }

  return NextResponse.json({ ok: true, events_processed: events.length, channel_provider: channel.provider });
}

function extractEntryId(body: unknown): string | null {
  const b = body as { entry?: { id?: string }[] } | null;
  return b?.entry?.[0]?.id ?? null;
}

function extractPhoneNumberId(body: unknown): string | null {
  const b = body as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[] } | null;
  return b?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
}
