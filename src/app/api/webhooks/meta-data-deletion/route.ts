import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { getSecret } from "@/lib/crm/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint exigido por Meta Platform Policy: cuando un usuario revoca el acceso
 * a una app desde su configuración de Facebook/Instagram (Configuración →
 * Privacidad → Apps y sitios web → quitar acceso), Meta envía un POST acá con
 * un `signed_request` (JWT-like firmado con HMAC-SHA256 usando el app_secret).
 *
 * El handler:
 *   1. Lee el signed_request del body form-encoded.
 *   2. Decodifica el payload (base64url) y verifica la firma con el app_secret
 *      del canal correcto (lookup por app_id contenido en el payload).
 *   3. Marca los datos asociados a ese user_id (IGSID o ASID Facebook) para
 *      eliminación — anonimiza el contacto en crm_contacts y registra un
 *      evento en crm_events para auditoría.
 *   4. Responde con { url, confirmation_code } según exige Meta. El usuario
 *      puede consultar el status visitando esa URL.
 *
 * Configuración en Meta App Dashboard → Settings → Basic → User Data Deletion:
 *   "Data Deletion Request URL" → https://<dominio>/api/webhooks/meta-data-deletion
 */
export async function POST(req: Request) {
  try {
    return await handleDeletion(req);
  } catch (err) {
    console.error("[meta-data-deletion] unhandled", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

async function handleDeletion(req: Request) {
  const formData = await req.formData();
  const signedRequest = formData.get("signed_request");
  if (typeof signedRequest !== "string" || !signedRequest.includes(".")) {
    return NextResponse.json({ error: "invalid_signed_request" }, { status: 400 });
  }

  const [encodedSig, encodedPayload] = signedRequest.split(".");
  let payload: { user_id?: string; algorithm?: string; issued_at?: number; app_id?: string };
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  if (payload.algorithm !== "HMAC-SHA256") {
    return NextResponse.json({ error: "unsupported_algorithm" }, { status: 400 });
  }
  if (!payload.user_id) {
    return NextResponse.json({ error: "missing_user_id" }, { status: 400 });
  }

  // Lookup del canal por app_id si vino, si no probamos todos los canales con
  // app_secret cargado y verificamos la firma. El primero que valide es el
  // dueño de esta request.
  const admin = createAdminClient();
  let query = admin
    .from("crm_channels")
    .select("id, organization_id, app_id, app_secret_secret_id")
    .not("app_secret_secret_id", "is", null);
  if (payload.app_id) query = query.eq("app_id", payload.app_id);
  const { data: channels } = await query;

  let matchedChannel: { id: string; organization_id: string } | null = null;
  const expectedSig = base64UrlDecode(encodedSig);
  for (const ch of channels ?? []) {
    const appSecret = await getSecret(ch.app_secret_secret_id);
    if (!appSecret) continue;
    const computed = crypto
      .createHmac("sha256", appSecret)
      .update(encodedPayload)
      .digest();
    if (crypto.timingSafeEqual(computed, expectedSig)) {
      matchedChannel = { id: ch.id, organization_id: ch.organization_id };
      break;
    }
  }

  if (!matchedChannel) {
    return NextResponse.json({ error: "signature_mismatch" }, { status: 401 });
  }

  // Confirmation code único — Meta lo guarda y lo usa el usuario para chequear
  // el estado en la URL devuelta.
  const confirmationCode = `del_${crypto.randomBytes(8).toString("hex")}`;

  // Anonimizar contactos asociados a este user_id (IGSID o ASID).
  // No hard-delete por consistencia referencial con conversaciones/eventos;
  // anonimizamos identificadores personales y dejamos un evento de auditoría.
  await admin
    .from("crm_contacts")
    .update({
      name: null,
      phone: null,
      profile_pic_url: null,
      external_id: `deleted_${confirmationCode}`,
    })
    .eq("organization_id", matchedChannel.organization_id)
    .eq("external_id", payload.user_id);

  await admin.from("crm_events").insert({
    organization_id: matchedChannel.organization_id,
    event_type: "user.data_deletion_requested",
    payload: {
      meta_user_id: payload.user_id,
      meta_app_id: payload.app_id ?? null,
      confirmation_code: confirmationCode,
      issued_at: payload.issued_at,
      channel_id: matchedChannel.id,
    },
  });

  console.log(
    `[meta-data-deletion] anonymized user_id=${payload.user_id} channel=${matchedChannel.id} code=${confirmationCode}`,
  );

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (req.headers.get("x-forwarded-host")
      ? `https://${req.headers.get("x-forwarded-host")}`
      : new URL(req.url).origin);

  return NextResponse.json({
    url: `${baseUrl}/legal/eliminacion-de-datos?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + padding, "base64");
}
