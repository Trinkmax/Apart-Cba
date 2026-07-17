import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  handleResendInbound,
  verifySvixSignature,
  type ResendWebhookPayload,
} from "@/lib/channels/email-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Webhook canónico de inbound email para Canales de venta.
 * (El endpoint legacy /api/inbound/resend delega acá y sigue funcionando.)
 *
 *   - firma Svix verificada sobre el body crudo + ventana anti-replay de 5 min
 *   - dedupe por provider message ID
 *   - evento durable ANTES de responder; sin raw bodies persistidos
 *   - fail-closed en producción si falta el secret
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  const body = await req.text();

  if (webhookSecret) {
    const valid = verifySvixSignature(
      {
        svixId: req.headers.get("svix-id"),
        svixTimestamp: req.headers.get("svix-timestamp"),
        svixSignature: req.headers.get("svix-signature"),
      },
      body,
      webhookSecret,
    );
    if (!valid) {
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[webhooks/channel-email] RESEND_INBOUND_WEBHOOK_SECRET no configurada");
    return NextResponse.json({ ok: false, error: "webhook_secret_missing" }, { status: 500 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await handleResendInbound(admin, payload);
  return NextResponse.json({ ok: result.ok, status: result.status }, { status: result.httpStatus });
}
