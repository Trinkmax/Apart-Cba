"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { gatewayConfigured, gatewayFetch } from "@/lib/crm/baileys-gateway";
import type { CrmBaileysSession, CrmChannel } from "@/lib/types/database";

type Admin = ReturnType<typeof createAdminClient>;

async function adminGuard() {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") throw new Error("Sin permisos");
  return { organization };
}

/** One baileys channel per org. Create lazily + seed a disconnected session. */
async function ensureBaileysChannel(admin: Admin, organizationId: string): Promise<string> {
  const { data: existing } = await admin
    .from("crm_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", "baileys")
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await admin
    .from("crm_channels")
    .insert({
      organization_id: organizationId,
      provider: "baileys",
      display_name: "WhatsApp",
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "No se pudo crear el canal");

  await admin.from("crm_baileys_sessions").upsert(
    {
      organization_id: organizationId,
      channel_id: created.id,
      status: "disconnected",
    },
    { onConflict: "channel_id" },
  );
  return created.id as string;
}

export interface BaileysState {
  configured: boolean;
  channel: Pick<CrmChannel, "id" | "display_name" | "status" | "phone_number"> | null;
  session: CrmBaileysSession | null;
}

/** Initial state for the connect UI (it also subscribes to Realtime). */
export async function getBaileysState(): Promise<BaileysState> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: channel } = await admin
    .from("crm_channels")
    .select("id, display_name, status, phone_number")
    .eq("organization_id", organization.id)
    .eq("provider", "baileys")
    .maybeSingle();

  let session: CrmBaileysSession | null = null;
  if (channel?.id) {
    const { data } = await admin
      .from("crm_baileys_sessions")
      .select("*")
      .eq("channel_id", channel.id)
      .maybeSingle();
    session = (data as CrmBaileysSession) ?? null;
  }

  return {
    configured: gatewayConfigured(),
    channel: (channel as BaileysState["channel"]) ?? null,
    session,
  };
}

/** Open the socket → returns a QR (Realtime pushes it to the UI). */
export async function connectBaileys(): Promise<{ channelId: string }> {
  const { organization } = await adminGuard();
  if (!gatewayConfigured()) {
    throw new Error("Falta configurar WHATSAPP_GATEWAY_URL / WHATSAPP_GATEWAY_SECRET");
  }
  const admin = createAdminClient();
  const channelId = await ensureBaileysChannel(admin, organization.id);

  await gatewayFetch(`/sessions/${channelId}/connect`, {
    method: "POST",
    body: { organizationId: organization.id },
  });

  revalidatePath("/dashboard/configuracion/mensajeria");
  return { channelId };
}

const pairingSchema = z.object({
  phoneNumber: z
    .string()
    .min(8)
    .max(20)
    .transform((s) => s.replace(/[^0-9]/g, "")),
});

/** Alternative to QR: link by entering an 8-char code on the phone. */
export async function requestBaileysPairingCode(
  input: z.infer<typeof pairingSchema>,
): Promise<{ channelId: string }> {
  const { organization } = await adminGuard();
  if (!gatewayConfigured()) {
    throw new Error("Falta configurar WHATSAPP_GATEWAY_URL / WHATSAPP_GATEWAY_SECRET");
  }
  const { phoneNumber } = pairingSchema.parse(input);
  const admin = createAdminClient();
  const channelId = await ensureBaileysChannel(admin, organization.id);

  await gatewayFetch(`/sessions/${channelId}/connect`, {
    method: "POST",
    body: { organizationId: organization.id, pairingPhone: phoneNumber },
  });

  revalidatePath("/dashboard/configuracion/mensajeria");
  return { channelId };
}

/** Unlink: logs out on the phone and wipes the durable session. */
export async function disconnectBaileys(): Promise<void> {
  const { organization } = await adminGuard();
  const admin = createAdminClient();

  const { data: channel } = await admin
    .from("crm_channels")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("provider", "baileys")
    .maybeSingle();
  if (!channel?.id) return;

  if (gatewayConfigured()) {
    try {
      await gatewayFetch(`/sessions/${channel.id}/logout`, {
        method: "POST",
        body: {},
      });
    } catch {
      // El gateway puede estar caído; igual marcamos desconectado localmente.
    }
  }

  await admin.from("crm_channels").update({ status: "disabled" }).eq("id", channel.id);
  await admin
    .from("crm_baileys_sessions")
    .upsert(
      {
        organization_id: organization.id,
        channel_id: channel.id,
        status: "disconnected",
        qr: null,
        pairing_code: null,
        disconnected_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );

  revalidatePath("/dashboard/configuracion/mensajeria");
}
