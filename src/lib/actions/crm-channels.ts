"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { createSecret, updateSecret } from "@/lib/crm/encryption";
import type { CrmChannel } from "@/lib/types/database";

export async function listChannels(): Promise<CrmChannel[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_channels")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  return (data ?? []) as CrmChannel[];
}

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  provider: z.enum(["meta_cloud", "meta_instagram"]).default("meta_cloud"),
  displayName: z.string().min(1).max(100),
  // WA fields
  phoneNumber: z.string().optional(),
  phoneNumberId: z.string().optional(),
  wabaId: z.string().optional(),
  // IG fields
  instagramBusinessAccountId: z.string().optional(),
  pageId: z.string().optional(),
  instagramUsername: z.string().optional(),
  // Comunes
  appId: z.string().optional(),
  accessToken: z.string().min(10).optional(),
  appSecret: z.string().min(8).optional(),
  webhookVerifyToken: z.string().min(8).optional(),
}).refine((data) => {
  if (data.provider === "meta_cloud") {
    return !!(data.phoneNumber && data.phoneNumberId && data.wabaId);
  }
  if (data.provider === "meta_instagram") {
    return !!(data.instagramBusinessAccountId);
  }
  return true;
}, { message: "Faltan campos requeridos del proveedor" });

export async function upsertChannel(input: z.infer<typeof upsertSchema>) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const v = upsertSchema.parse(input);
  const admin = createAdminClient();

  let accessTokenSecretId: string | undefined;
  let appSecretSecretId: string | undefined;
  let verifyTokenSecretId: string | undefined;

  if (v.id) {
    // Update existing — rotar secrets si vienen
    const { data: existing } = await admin
      .from("crm_channels")
      .select("access_token_secret_id,app_secret_secret_id,webhook_verify_token_secret_id")
      .eq("id", v.id)
      .eq("organization_id", organization.id)
      .single();
    if (!existing) throw new Error("Channel no encontrado");

    if (v.accessToken) {
      if (existing.access_token_secret_id) {
        await updateSecret(existing.access_token_secret_id, v.accessToken);
        accessTokenSecretId = existing.access_token_secret_id;
      } else {
        accessTokenSecretId = await createSecret(`crm_channel_${v.id}_access_token`, v.accessToken);
      }
    }
    if (v.appSecret) {
      if (existing.app_secret_secret_id) {
        await updateSecret(existing.app_secret_secret_id, v.appSecret);
        appSecretSecretId = existing.app_secret_secret_id;
      } else {
        appSecretSecretId = await createSecret(`crm_channel_${v.id}_app_secret`, v.appSecret);
      }
    }
    if (v.webhookVerifyToken) {
      if (existing.webhook_verify_token_secret_id) {
        await updateSecret(existing.webhook_verify_token_secret_id, v.webhookVerifyToken);
        verifyTokenSecretId = existing.webhook_verify_token_secret_id;
      } else {
        verifyTokenSecretId = await createSecret(`crm_channel_${v.id}_verify_token`, v.webhookVerifyToken);
      }
    }

    const update: Record<string, unknown> = {
      provider: v.provider,
      display_name: v.displayName,
      phone_number: v.phoneNumber ?? null,
      phone_number_id: v.phoneNumberId ?? null,
      waba_id: v.wabaId ?? null,
      instagram_business_account_id: v.instagramBusinessAccountId ?? null,
      page_id: v.pageId ?? null,
      instagram_username: v.instagramUsername ?? null,
      app_id: v.appId,
    };
    if (accessTokenSecretId) update.access_token_secret_id = accessTokenSecretId;
    if (appSecretSecretId) update.app_secret_secret_id = appSecretSecretId;
    if (verifyTokenSecretId) update.webhook_verify_token_secret_id = verifyTokenSecretId;

    await admin.from("crm_channels").update(update).eq("id", v.id);
  } else {
    // Create new
    const { data: created, error } = await admin
      .from("crm_channels")
      .insert({
        organization_id: organization.id,
        provider: v.provider,
        display_name: v.displayName,
        phone_number: v.phoneNumber ?? null,
        phone_number_id: v.phoneNumberId ?? null,
        waba_id: v.wabaId ?? null,
        instagram_business_account_id: v.instagramBusinessAccountId ?? null,
        page_id: v.pageId ?? null,
        instagram_username: v.instagramUsername ?? null,
        app_id: v.appId,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "create_failed");

    if (v.accessToken) {
      const sid = await createSecret(`crm_channel_${created.id}_access_token`, v.accessToken);
      await admin.from("crm_channels").update({ access_token_secret_id: sid }).eq("id", created.id);
    }
    if (v.appSecret) {
      const sid = await createSecret(`crm_channel_${created.id}_app_secret`, v.appSecret);
      await admin.from("crm_channels").update({ app_secret_secret_id: sid }).eq("id", created.id);
    }
    if (v.webhookVerifyToken) {
      const sid = await createSecret(`crm_channel_${created.id}_verify_token`, v.webhookVerifyToken);
      await admin.from("crm_channels").update({ webhook_verify_token_secret_id: sid }).eq("id", created.id);
    }
  }

  revalidatePath("/dashboard/crm/config");
}

export async function setChannelStatus(id: string, status: "active" | "disabled") {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin
    .from("crm_channels")
    .update({ status })
    .eq("id", id)
    .eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/config");
}

export async function deleteChannel(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const admin = createAdminClient();
  await admin.from("crm_channels").delete().eq("id", id).eq("organization_id", organization.id);
  revalidatePath("/dashboard/crm/config");
}

/**
 * Health check: valida que las credenciales del canal funcionen contra Meta API.
 * Hace GET a /{phone_number_id} y verifica que devuelva 200.
 */
export async function testChannelHealth(id: string): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("crm_channels")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (error || !channel) throw new Error("Canal no encontrado");

  const { getSecret } = await import("@/lib/crm/encryption");
  const accessToken = await getSecret(channel.access_token_secret_id);
  if (!accessToken) {
    await admin
      .from("crm_channels")
      .update({ status: "error", last_error: "Access token no configurado", last_health_check_at: new Date().toISOString() })
      .eq("id", id);
    return { ok: false, message: "Access token no configurado" };
  }

  const apiVersion = process.env.META_GRAPH_API_VERSION || "v22.0";
  // Endpoint distinto según provider
  const url = channel.provider === "meta_instagram"
    ? `https://graph.facebook.com/${apiVersion}/${channel.instagram_business_account_id}?fields=username,name,profile_picture_url,followers_count`
    : `https://graph.facebook.com/${apiVersion}/${channel.phone_number_id}?fields=display_phone_number,verified_name,quality_rating,platform_type`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => null)) as
      | { display_phone_number?: string; verified_name?: string; quality_rating?: string; error?: { message?: string; code?: number } }
      | null;

    if (!res.ok) {
      const errMsg = data?.error?.message ?? `HTTP ${res.status}`;
      await admin
        .from("crm_channels")
        .update({ status: "error", last_error: errMsg, last_health_check_at: new Date().toISOString() })
        .eq("id", id);
      revalidatePath("/dashboard/crm/config");
      return { ok: false, message: errMsg };
    }

    await admin
      .from("crm_channels")
      .update({ status: "active", last_error: null, last_health_check_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath("/dashboard/crm/config");
    const success = channel.provider === "meta_instagram"
      ? `IG @${(data as { username?: string })?.username ?? "?"} · ${(data as { followers_count?: number })?.followers_count ?? "?"} followers`
      : `WA ${(data as { display_phone_number?: string })?.display_phone_number ?? "?"} · ${(data as { verified_name?: string })?.verified_name ?? "?"} · quality: ${(data as { quality_rating?: string })?.quality_rating ?? "?"}`;
    return {
      ok: true,
      message: `Conectado · ${success}`,
      details: data ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("crm_channels")
      .update({ status: "error", last_error: message, last_health_check_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath("/dashboard/crm/config");
    return { ok: false, message };
  }
}

/**
 * Verifica si Meta efectivamente está enviando webhooks a este canal — distinto
 * de testChannelHealth, que solo prueba que el access token funcione.
 *
 * Para WA: llama a Graph API /{waba_id}/subscribed_apps y reporta si nuestra app
 * (identificada por app_id si está cargado) figura en la lista de subscribed.
 *
 * Para IG: llama a /{page_id}/subscribed_apps. La cuenta IG Business hereda los
 * webhooks de su Page de Facebook — si la Page no está suscripta, ningún DM
 * llega. Además devolvemos qué fields están subscribed para que el admin pueda
 * confirmar que "messages" está activo.
 *
 * Causas típicas de "no me llegan mensajes":
 *   1. La Page no está suscripta a nuestra app → fix: hacer POST /{page_id}/subscribed_apps
 *   2. La app está suscripta pero sin el field "messages" → fix: agregar field
 *   3. El access token no tiene permiso pages_messaging / instagram_manage_messages
 *   4. La Callback URL en Meta App Dashboard apunta a otro dominio (placeholder)
 */
export async function verifyChannelSubscription(
  id: string,
): Promise<{
  ok: boolean;
  message: string;
  details?: {
    subscribed: boolean;
    fields: string[];
    expected_fields: string[];
    target: string;
    hint?: string;
  };
}> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("crm_channels")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (error || !channel) throw new Error("Canal no encontrado");

  const { getSecret } = await import("@/lib/crm/encryption");
  const accessToken = await getSecret(channel.access_token_secret_id);
  if (!accessToken) {
    return { ok: false, message: "Access token no configurado" };
  }

  const apiVersion = process.env.META_GRAPH_API_VERSION || "v22.0";
  // Para IG el lookup es por page_id (la Page de FB que tiene linkeada la cuenta).
  // Para WA es por waba_id.
  const target = channel.provider === "meta_instagram" ? channel.page_id : channel.waba_id;
  if (!target) {
    return {
      ok: false,
      message:
        channel.provider === "meta_instagram"
          ? "Falta Page ID en el canal — no se puede chequear suscripción IG"
          : "Falta WABA ID en el canal — no se puede chequear suscripción WA",
    };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${target}/subscribed_apps`;
  let payload: { data?: { id?: string; name?: string; subscribed_fields?: string[] }[]; error?: { message?: string; code?: number; type?: string } };
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    payload = await res.json();
    if (!res.ok) {
      const errMsg = payload?.error?.message ?? `HTTP ${res.status}`;
      return {
        ok: false,
        message: `Meta API: ${errMsg}`,
        details: {
          subscribed: false,
          fields: [],
          expected_fields:
            channel.provider === "meta_instagram"
              ? ["messages", "messaging_postbacks", "messaging_seen"]
              : ["messages"],
          target,
          hint:
            payload?.error?.code === 100 || payload?.error?.code === 190
              ? "El token no tiene permisos suficientes — regenerá uno con instagram_manage_messages + pages_messaging."
              : undefined,
        },
      };
    }
  } catch (err) {
    return {
      ok: false,
      message: `Fallo de red al consultar Meta: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const apps = payload.data ?? [];
  // Si app_id del canal está cargado, lo usamos para identificar nuestra app.
  // Si no, tomamos cualquier app que aparezca como "suscripta".
  const ourApp = channel.app_id
    ? apps.find((a) => a.id === channel.app_id)
    : apps[0];
  const expectedFields =
    channel.provider === "meta_instagram"
      ? ["messages", "messaging_postbacks"]
      : ["messages"];
  const fields = ourApp?.subscribed_fields ?? [];
  const missing = expectedFields.filter((f) => !fields.includes(f));

  if (!ourApp) {
    return {
      ok: false,
      message: `La Page/WABA no tiene ninguna app suscripta — Meta no está enviando webhooks acá.`,
      details: {
        subscribed: false,
        fields: [],
        expected_fields: expectedFields,
        target,
        hint:
          channel.provider === "meta_instagram"
            ? `En Meta Dev → tu App → Instagram → Webhooks: agregá la Page (${target}) como suscripta a "messages".`
            : `En Meta Dev → tu App → WhatsApp → Configuration: suscribí la WABA (${target}) al campo "messages".`,
      },
    };
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message: `App suscripta pero faltan campos: ${missing.join(", ")}`,
      details: {
        subscribed: true,
        fields,
        expected_fields: expectedFields,
        target,
        hint: `Activá los fields faltantes en Meta Dev → tu App → Webhooks → ${
          channel.provider === "meta_instagram" ? "Instagram" : "WhatsApp Business"
        }.`,
      },
    };
  }

  return {
    ok: true,
    message: `Suscripción OK · ${fields.length} fields activos`,
    details: {
      subscribed: true,
      fields,
      expected_fields: expectedFields,
      target,
    },
  };
}

/**
 * Suscribe la Page (IG) o la WABA (WhatsApp) a nuestra app vía Graph API.
 * Es el equivalente a hacer `POST /{page_id}/subscribed_apps` desde Graph API
 * Explorer pero automatizado — usa el token ya guardado en el canal.
 *
 * Sin este paso, aunque la app esté correctamente configurada en Meta App
 * Dashboard, Meta no entrega webhooks a nuestro endpoint para esta Page/WABA
 * específicamente — la suscripción a nivel app y la suscripción a nivel
 * Page/WABA son dos cosas distintas.
 */
export async function subscribeChannelPage(
  id: string,
): Promise<{ ok: boolean; message: string; details?: { fields: string[]; target: string; hint?: string } }> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");

  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("crm_channels")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();
  if (error || !channel) throw new Error("Canal no encontrado");

  const { getSecret } = await import("@/lib/crm/encryption");
  const accessToken = await getSecret(channel.access_token_secret_id);
  if (!accessToken) {
    return { ok: false, message: "Access token no configurado" };
  }

  const apiVersion = process.env.META_GRAPH_API_VERSION || "v22.0";

  // Para WhatsApp: una sola suscripción a nivel WABA.
  // Para Instagram: DOS suscripciones (Page + IG account) — Meta requiere ambas
  // para que los DMs lleguen al webhook. Sin la IG-level, Meta procesa el evento
  // pero no lo entrega a nuestra URL aunque la app esté correctamente configurada.
  type SubResult = { target: string; ok: boolean; fields: string[]; error?: string; code?: number };
  const results: SubResult[] = [];

  async function subscribe(target: string, fields: string): Promise<SubResult> {
    const url = `https://graph.facebook.com/${apiVersion}/${target}/subscribed_apps?subscribed_fields=${fields}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: { message?: string; code?: number; type?: string } }
        | null;
      if (!res.ok || !data?.success) {
        return {
          target,
          ok: false,
          fields: fields.split(","),
          error: data?.error?.message ?? `HTTP ${res.status}`,
          code: data?.error?.code,
        };
      }
      return { target, ok: true, fields: fields.split(",") };
    } catch (err) {
      return {
        target,
        ok: false,
        fields: fields.split(","),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (channel.provider === "meta_instagram") {
    if (!channel.page_id) {
      return { ok: false, message: "Falta Page ID en el canal" };
    }
    // Page-level: para que la Page entregue eventos a nuestra app
    results.push(await subscribe(channel.page_id, "messages,messaging_postbacks"));
    // IG-level: para que la cuenta IG entregue eventos al app subscriber
    if (channel.instagram_business_account_id) {
      results.push(await subscribe(channel.instagram_business_account_id, "messages"));
    }
  } else {
    if (!channel.waba_id) {
      return { ok: false, message: "Falta WABA ID en el canal" };
    }
    results.push(await subscribe(channel.waba_id, "messages"));
  }

  const failed = results.filter((r) => !r.ok);
  const succeeded = results.filter((r) => r.ok);

  if (failed.length > 0 && succeeded.length === 0) {
    const first = failed[0];
    return {
      ok: false,
      message: `Meta API: ${first.error}`,
      details: {
        fields: first.fields,
        target: first.target,
        hint:
          first.code === 100
            ? "El token no tiene permisos suficientes — necesita pages_manage_metadata + instagram_manage_messages."
            : first.code === 190
              ? "Token inválido o vencido — regeneralo desde Business Suite (System User → Caducidad: Nunca)."
              : "Confirmá en Meta Business Suite que la Page/IG están en un Business Manager al que pertenece la app.",
      },
    };
  }

  // Mezcla todos los fields suscritos (deduplicados) para registrar en DB.
  const allFields = Array.from(new Set(succeeded.flatMap((r) => r.fields)));
  await admin
    .from("crm_channels")
    .update({
      webhook_subscribed_fields: allFields,
      last_health_check_at: new Date().toISOString(),
      last_error: failed.length > 0 ? `Parcial: falló ${failed.map((f) => f.target).join(", ")}` : null,
    })
    .eq("id", id);
  revalidatePath("/dashboard/configuracion/mensajeria");

  if (failed.length > 0) {
    return {
      ok: true,
      message: `Suscripción parcial · ${succeeded.length}/${results.length} OK`,
      details: {
        fields: allFields,
        target: succeeded.map((s) => s.target).join(" + "),
        hint: `Falló: ${failed.map((f) => `${f.target} (${f.error})`).join("; ")}`,
      },
    };
  }

  return {
    ok: true,
    message:
      channel.provider === "meta_instagram"
        ? `Page + IG suscriptos · ${allFields.join(", ")}`
        : `WABA suscripta · ${allFields.join(", ")}`,
    details: {
      fields: allFields,
      target: succeeded.map((s) => s.target).join(" + "),
    },
  };
}
