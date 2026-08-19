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

  // dedupe por provider message ID. Excepción deliberada: un evento que quedó
  // en needs_review (email no parseado) SÍ se reprocesa — permite que un
  // "Replay" desde Resend re-parse emails viejos después de mejorar los
  // parsers/el clasificador. El evento viejo se elimina y su incidencia se
  // resuelve automáticamente.
  const { data: dup } = await admin
    .from("channel_events")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("dedupe_key", `email:${emailId}`)
    .maybeSingle();
  if (dup && dup.status === "needs_review") {
    await admin.from("channel_events").delete().eq("id", dup.id);
    await admin
      .from("channel_issues")
      .update({
        status: "resolved",
        resolution: "Reprocesado automáticamente con el parser/clasificador actualizado.",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("dedupe_key", `email_unparsed:${emailId}`)
      .eq("status", "open");
  } else if (dup && dup.status !== "error") {
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
    // Ruido conocido (reseñas, avisos de seguridad, consultas, facturación…):
    // evento durable para auditoría pero SIN incidencia — el panel de Canales
    // es para cosas accionables, no para el inbox completo de las OTAs.
    const noise = classifyIgnorable(email.from, email.subject ?? "");
    if (noise) {
      const { error: evErr } = await admin.from("channel_events").insert({
        organization_id: orgId,
        transport: "email",
        event_type: "email_unparsed",
        dedupe_key: `email:${emailId}`,
        content_hash: normalized.contentHash,
        payload: {
          subject: (email.subject || "").slice(0, 150),
          from_domain: email.from.split("@").pop()?.slice(0, 60) ?? null,
          ignored: noise,
        },
        status: "processed",
      });
      if (evErr && evErr.code !== "23505") {
        console.error("[channels/email] event insert falló", evErr.message);
      }
      return { ok: true, status: `ignored_${noise}`, httpStatus: 200 };
    }

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

/**
 * Emails de OTA que NO son eventos de reserva y no deben abrir incidencias.
 * Sólo corre cuando el parseo falló — un email que sí parsea como reserva o
 * cancelación jamás pasa por acá. Devuelve la razón (para auditoría) o null.
 */
function classifyIgnorable(from: string, subject: string): string | null {
  // Confirmaciones de reenvío de Gmail y avisos de Google
  if (/@google\.com$|@google\.com>/i.test(from.trim()) || /forwarding-noreply@/i.test(from)) {
    return "reenvio_gmail";
  }
  const s = subject;
  if (/rese[ñn]a|review/i.test(s)) return "resena";
  if (/sign.?in|inicio de sesi[oó]n|new device|nuevo dispositivo/i.test(s)) return "seguridad";
  if (/c[oó]digo de verificaci[oó]n|verification code|c[oó]digo de acceso/i.test(s)) return "seguridad";
  if (/consulta sobre/i.test(s)) return "consulta";
  if (/recordatorio.*solicitud|solicitud de reservaci[oó]n|reservation request/i.test(s)) {
    return "solicitud_pendiente";
  }
  if (/pregunta sobre tu alojamiento|nueva pregunta|new question/i.test(s)) return "pregunta";
  if (/pagos pendientes|saldes los pagos|factura|invoice|comisi[oó]n|payout|extracto/i.test(s)) {
    return "facturacion";
  }
  if (/te envi[oó] un mensaje|nuevo mensaje|new message|hemos recibido este mensaje/i.test(s)) {
    return "mensaje";
  }
  // OJO: el aviso "¡Nueva reserva!" de Booking NO se descarta acá.
  // Se descartaba porque no trae la estadía completa (falta el check-out) y la
  // reserva igual entra por iCal — pero su subject lleva el número de reserva
  // junto a la fecha de llegada, y ese es el ÚNICO punto donde la identidad del
  // email se cruza con la del iCal. Tirándolo, la reserva proyectada quedaba
  // para siempre sin número y la cancelación por email —que llega con número y
  // sin fechas— no encontraba nada que cancelar. Hoy el parser lo convierte en
  // un evento `reference`; si algún día dejara de parsear, cae abajo como
  // "email no reconocido", que es visible, en vez de desaparecer en silencio.

  // Marketing/engagement genérico de Airbnb
  if (/est[áa]n esperando tu|completa tu|aumenta tus reservas|consejos para/i.test(s)) {
    return "marketing";
  }
  return null;
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
