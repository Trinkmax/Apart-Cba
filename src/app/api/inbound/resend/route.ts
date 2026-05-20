import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { airbnbParser } from "@/lib/inbound/parsers/airbnb";
import { bookingParser } from "@/lib/inbound/parsers/booking";
import { handleInboundEvent } from "@/lib/inbound/handler";
import type { ResendInboundEmail, InboundEmailParser } from "@/lib/inbound/types";

export const dynamic = "force-dynamic";

const PARSERS: InboundEmailParser[] = [airbnbParser, bookingParser];

/**
 * Resend inbound webhook — receives forwarded OTA emails.
 * Always returns 200 to prevent Resend retries; errors are logged internally.
 */
export async function POST(req: Request) {
  const admin = createAdminClient();

  // Verify Svix signature
  const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (webhookSecret) {
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    // Anti-replay: timestamp within 5 min
    const ts = parseInt(svixTimestamp);
    if (Math.abs(Date.now() / 1000 - ts) > 300) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    const body = await req.text();
    const toSign = `${svixId}.${svixTimestamp}.${body}`;
    const secretBytes = Buffer.from(webhookSecret.replace("whsec_", ""), "base64");
    const expectedSig = crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");
    const sigParts = svixSignature.split(" ");
    const verified = sigParts.some((s) => {
      const val = s.replace(/^v\d,/, "");
      return val === expectedSig;
    });
    if (!verified) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    // Parse pre-read body
    return handleEmail(admin, JSON.parse(body));
  }

  // No secret configured — accept all (dev mode)
  const body = await req.json();
  return handleEmail(admin, body);
}

async function handleEmail(
  admin: ReturnType<typeof createAdminClient>,
  payload: Record<string, unknown>
): Promise<NextResponse> {
  const email: ResendInboundEmail = {
    from: String(payload.from ?? ""),
    to: String(payload.to ?? ""),
    subject: String(payload.subject ?? ""),
    html: String(payload.html ?? ""),
    text: String(payload.text ?? ""),
    headers: (payload.headers as Record<string, string>) ?? {},
  };

  // Extract token from to address: ota-<token>@<domain>
  const tokenMatch = email.to.match(/ota-([a-f0-9]+)@/i);
  if (!tokenMatch) {
    return NextResponse.json({ ok: true, status: "ignored" });
  }
  const token = tokenMatch[1];

  // Lookup org by token
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("inbound_email_token", token)
    .maybeSingle();
  if (!org) {
    return NextResponse.json({ ok: true, status: "unknown_org" });
  }
  const orgId = org.id;

  // Dedup by resend message id
  const resendMsgId = email.headers["message-id"] ?? null;
  if (resendMsgId) {
    const { data: dup } = await admin
      .from("inbound_email_log")
      .select("id")
      .eq("resend_message_id", resendMsgId)
      .maybeSingle();
    if (dup) {
      return NextResponse.json({ ok: true, status: "duplicate" });
    }
  }

  // Try parsers
  let parserUsed: string | null = null;
  let parsed: ReturnType<InboundEmailParser["parse"]> = null;
  for (const parser of PARSERS) {
    if (parser.canParse(email.from, email.subject)) {
      parsed = parser.parse(email);
      if (parsed) {
        parserUsed = parser.name;
        break;
      }
    }
  }

  const rawSize = (email.html?.length ?? 0) + (email.text?.length ?? 0);

  if (!parsed) {
    // Log as unmatched
    await admin.from("inbound_email_log").insert({
      organization_id: orgId,
      resend_message_id: resendMsgId,
      from_address: email.from,
      to_address: email.to,
      subject: email.subject,
      status: "unmatched",
      raw_size_bytes: rawSize,
    });
    return NextResponse.json({ ok: true, status: "unmatched" });
  }

  // Handle the event
  const result = await handleInboundEvent(admin, orgId, parsed);

  const logStatus =
    result.action === "created" || result.action === "cancelled"
      ? "parsed"
      : result.action === "duplicate"
        ? "duplicate"
        : "error";

  await admin.from("inbound_email_log").insert({
    organization_id: orgId,
    resend_message_id: resendMsgId,
    from_address: email.from,
    to_address: email.to,
    subject: email.subject,
    parser_used: parserUsed,
    event_type: parsed.type,
    status: logStatus,
    booking_id: result.bookingId ?? null,
    error_message: result.error ?? null,
    raw_size_bytes: rawSize,
  });

  return NextResponse.json({ ok: true, status: logStatus, action: result.action });
}
