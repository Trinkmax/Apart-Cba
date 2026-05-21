import { NextResponse } from "next/server";
import crypto from "crypto";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { airbnbParser } from "@/lib/inbound/parsers/airbnb";
import { bookingParser } from "@/lib/inbound/parsers/booking";
import { handleInboundEvent } from "@/lib/inbound/handler";
import type { ResendInboundEmail, InboundEmailParser } from "@/lib/inbound/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PARSERS: InboundEmailParser[] = [airbnbParser, bookingParser];
const MAX_RAW_BODY = 200_000;

interface ResendWebhookPayload {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
  };
}

/**
 * Webhook de inbound email de Resend — recibe los mails de confirmación de OTAs
 * que el staff reenvía a ota-<token>@<dominio>.
 *
 * El evento `email.received` de Resend trae SOLO metadata (sin cuerpo): hay que
 * pedir el HTML/texto aparte con la Received Emails API. Ver:
 * https://resend.com/docs/dashboard/receiving/introduction
 */
export async function POST(req: Request) {
  const admin = createAdminClient();
  const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  const body = await req.text();

  // ─── Verificación de firma (Svix) ─────────────────────────────────────────
  if (webhookSecret) {
    if (!verifySvix(req, body, webhookSecret)) {
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Fail-closed: en producción NO aceptamos webhooks sin firmar.
    console.error("[inbound/resend] RESEND_INBOUND_WEBHOOK_SECRET no configurada");
    return NextResponse.json({ ok: false, error: "webhook_secret_missing" }, { status: 500 });
  }
  // En dev sin secret: se acepta sin verificar.

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  return handleWebhook(admin, payload);
}

function verifySvix(req: Request, body: string, secret: string): boolean {
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Anti-replay: timestamp dentro de 5 min.
  const ts = parseInt(svixTimestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const toSign = `${svixId}.${svixTimestamp}.${body}`;
  const secretBytes = Buffer.from(secret.replace("whsec_", ""), "base64");
  const expected = crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");
  return svixSignature.split(" ").some((part) => safeEqual(part.replace(/^v\d,/, ""), expected));
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function handleWebhook(
  admin: ReturnType<typeof createAdminClient>,
  payload: ResendWebhookPayload,
): Promise<NextResponse> {
  // Resend manda varios tipos de evento al endpoint; solo procesamos el inbound.
  if (payload.type !== "email.received") {
    return NextResponse.json({ ok: true, status: "ignored_event" });
  }

  const data = payload.data ?? {};
  const emailId = data.email_id;
  const toList = Array.isArray(data.to) ? data.to : [];
  if (!emailId) {
    return NextResponse.json({ ok: true, status: "missing_email_id" });
  }

  // Token de org desde la dirección ota-<token>@<dominio>.
  let token: string | null = null;
  let toAddress = "";
  for (const addr of toList) {
    const m = addr.match(/ota-([a-f0-9]{8,})@/i);
    if (m) {
      token = m[1];
      toAddress = addr;
      break;
    }
  }
  if (!token) {
    return NextResponse.json({ ok: true, status: "ignored" });
  }

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("inbound_email_token", token)
    .maybeSingle();
  if (!org) {
    console.warn("[inbound/resend] email recibido para un token desconocido");
    return NextResponse.json({ ok: true, status: "unknown_org" });
  }
  const orgId = org.id;

  // Dedup por el id del email en Resend.
  const { data: dup } = await admin
    .from("inbound_email_log")
    .select("id")
    .eq("resend_message_id", emailId)
    .maybeSingle();
  if (dup) {
    return NextResponse.json({ ok: true, status: "duplicate" });
  }

  // El webhook no trae el cuerpo: lo pedimos a la Received Emails API.
  const fetched = await fetchReceivedEmail(emailId);
  if (!fetched) {
    // Fallo probablemente transitorio — 5xx para que Resend reintente.
    return NextResponse.json({ ok: false, error: "body_fetch_failed" }, { status: 502 });
  }

  const email: ResendInboundEmail = {
    from: fetched.from ?? data.from ?? "",
    to: toAddress,
    subject: fetched.subject ?? data.subject ?? "",
    html: fetched.html ?? "",
    text: fetched.text ?? "",
  };
  const rawBody = (email.html || email.text || "").slice(0, MAX_RAW_BODY);

  // Parsers (Airbnb / Booking).
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

  if (!parsed) {
    await admin.from("inbound_email_log").insert({
      organization_id: orgId,
      resend_message_id: emailId,
      from_address: email.from,
      to_address: email.to,
      subject: email.subject,
      status: "unmatched",
      raw_size_bytes: rawBody.length,
      raw_body: rawBody,
    });
    // Un email que no se pudo interpretar no debe pasar desapercibido.
    const { error: notifErr } = await admin.from("notifications").insert({
      organization_id: orgId,
      type: "channel_feed_error",
      severity: "warning",
      title: "Email de OTA no reconocido",
      body: `Llegó un email ("${email.subject || "sin asunto"}") que no se pudo interpretar como reserva. Revisalo en Email Parser.`,
      target_role: "admin",
      action_url: "/dashboard/configuracion/inbound-email",
      dedup_key: `inbound_unmatched:${emailId}`,
    });
    if (notifErr && notifErr.code !== "23505") {
      console.error("[inbound/resend:notify]", notifErr);
    }
    return NextResponse.json({ ok: true, status: "unmatched" });
  }

  const result = await handleInboundEvent(admin, orgId, parsed);
  const logStatus =
    result.action === "created" || result.action === "cancelled"
      ? "parsed"
      : result.action === "duplicate"
        ? "duplicate"
        : "error";

  await admin.from("inbound_email_log").insert({
    organization_id: orgId,
    resend_message_id: emailId,
    from_address: email.from,
    to_address: email.to,
    subject: email.subject,
    parser_used: parserUsed,
    event_type: parsed.type,
    status: logStatus,
    booking_id: result.bookingId ?? null,
    error_message: result.error ?? null,
    raw_size_bytes: rawBody.length,
    raw_body: rawBody,
  });

  return NextResponse.json({ ok: true, status: logStatus, action: result.action });
}

interface ReceivedEmail {
  from?: string;
  subject?: string;
  html?: string | null;
  text?: string | null;
}

/**
 * Trae el cuerpo del email recibido vía la Received Emails API de Resend.
 * Devuelve null ante cualquier fallo (el caller responde 5xx para reintentar).
 */
async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[inbound/resend] RESEND_API_KEY no configurada — no se puede leer el email");
    return null;
  }
  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.receiving.get(emailId);
    if (error || !data) {
      console.error("[inbound/resend] receiving.get falló", error);
      return null;
    }
    return { from: data.from, subject: data.subject, html: data.html, text: data.text };
  } catch (err) {
    console.error("[inbound/resend] receiving.get excepción", err);
    return null;
  }
}
