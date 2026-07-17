import crypto from "crypto";
import { Resend } from "resend";
import { normalizeInboundEmail } from "./email-adapter";
import { ingestEvent, openIssue } from "./ingest";
import type { ResendInboundEmail } from "@/lib/inbound/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

/**
 * Procesamiento compartido del webhook inbound de Resend. Lo usan:
 *   - POST /api/webhooks/channel-email/resend  (canónico)
 *   - POST /api/inbound/resend                 (adaptador legacy, misma lógica)
 *
 * Flujo: verificar firma (en la route) → dedupe por provider message ID →
 * persistir evento durable → responder rápido. El raw body NO se guarda:
 * queda provider id + hash + payload normalizado + extracto redactado.
 */

export interface ResendWebhookPayload {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
  };
}

/** Verificación Svix (firma del webhook de Resend) con ventana anti-replay. */
export function verifySvixSignature(
  headers: { svixId: string | null; svixTimestamp: string | null; svixSignature: string | null },
  body: string,
  secret: string,
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const ts = parseInt(svixTimestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const toSign = `${svixId}.${svixTimestamp}.${body}`;
  const secretBytes = Buffer.from(secret.replace("whsec_", ""), "base64");
  const expected = crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");
  return svixSignature
    .split(" ")
    .some((part) => safeEqual(part.replace(/^v\d+,/, ""), expected));
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export interface EmailWebhookResult {
  ok: boolean;
  status: string;
  httpStatus: number;
}

export async function handleResendInbound(
  admin: AdminClient,
  payload: ResendWebhookPayload,
): Promise<EmailWebhookResult> {
  if (payload.type !== "email.received") {
    return { ok: true, status: "ignored_event", httpStatus: 200 };
  }

  const data = payload.data ?? {};
  const emailId = data.email_id;
  const toList = Array.isArray(data.to) ? data.to : [];
  if (!emailId) return { ok: true, status: "missing_email_id", httpStatus: 200 };

  // token de la org: dirección ota-<token>@<dominio>
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
  if (!token) return { ok: true, status: "ignored", httpStatus: 200 };

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("inbound_email_token", token)
    .maybeSingle();
  if (!org) {
    console.warn("[channels/email] email para token desconocido");
    return { ok: true, status: "unknown_org", httpStatus: 200 };
  }
  const orgId = org.id as string;

  // dedupe duro por provider message ID (los reintentos del webhook son no-op)
  const { data: dup } = await admin
    .from("channel_events")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("dedupe_key", `email:${emailId}`)
    .maybeSingle();
  if (dup && dup.status !== "error") {
    return { ok: true, status: "duplicate", httpStatus: 200 };
  }

  // El webhook no trae el cuerpo → Received Emails API (en memoria, no persiste)
  const fetched = await fetchReceivedEmail(emailId);
  if (!fetched) {
    // fallo transitorio → 5xx para que Resend reintente
    return { ok: false, status: "body_fetch_failed", httpStatus: 502 };
  }

  const email: ResendInboundEmail = {
    from: fetched.from ?? data.from ?? "",
    to: toAddress,
    subject: fetched.subject ?? data.subject ?? "",
    html: fetched.html ?? "",
    text: fetched.text ?? "",
  };

  // marca de actividad del canal de email de la org (verifica el reenvío)
  await admin
    .from("channel_settings")
    .upsert(
      {
        organization_id: orgId,
        last_email_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );
  await admin
    .from("channel_settings")
    .update({ email_verified_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .is("email_verified_at", null);

  const normalized = normalizeInboundEmail({
    organizationId: orgId,
    providerMessageId: emailId,
    email,
  });

  if (!normalized.event) {
    // email no interpretable: evento durable + incidencia con extracto redactado
    const { error: evErr } = await admin.from("channel_events").insert({
      organization_id: orgId,
      transport: "email",
      event_type: "email_unparsed",
      dedupe_key: `email:${emailId}`,
      content_hash: normalized.contentHash,
      payload: {
        subject: (email.subject || "").slice(0, 150),
        from_domain: email.from.split("@").pop()?.slice(0, 60) ?? null,
      },
      status: "needs_review",
    });
    if (evErr && evErr.code !== "23505") {
      console.error("[channels/email] event insert falló", evErr.message);
      return { ok: false, status: "event_insert_failed", httpStatus: 500 };
    }
    await openIssue(admin, {
      organizationId: orgId,
      issueType: "parse_error",
      severity: "warning",
      title: "Email de OTA no reconocido",
      detail: `Llegó un email ("${(email.subject || "sin asunto").slice(0, 120)}") que no se pudo interpretar como reserva o cancelación. Si es una reserva, cargala manualmente y avisanos el formato.`,
      dedupeKey: `email_unparsed:${emailId}`,
    });
    return { ok: true, status: "unmatched", httpStatus: 200 };
  }

  const result = await ingestEvent(admin, normalized.event);
  return {
    ok: result.outcome !== "error",
    status: result.outcome,
    httpStatus: result.outcome === "error" ? 500 : 200,
  };
}

interface ReceivedEmail {
  from?: string;
  subject?: string;
  html?: string | null;
  text?: string | null;
}

async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[channels/email] RESEND_API_KEY no configurada");
    return null;
  }
  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.receiving.get(emailId);
    if (error || !data) {
      console.error("[channels/email] receiving.get falló", error);
      return null;
    }
    return { from: data.from, subject: data.subject, html: data.html, text: data.text };
  } catch (err) {
    console.error("[channels/email] receiving.get excepción", err);
    return null;
  }
}
