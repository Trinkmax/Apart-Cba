import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Resuelve qué canal usa una organización para enviar — esto ES la "selección
 * de proveedor por organización":
 *
 *  1. Si hay conversación → su channel_id (se respeta el canal por donde
 *     entró la charla; con Baileys conectado, las conversaciones ya viven en
 *     el canal baileys, así que las respuestas/automatizaciones salen por ahí).
 *  2. Envío proactivo sin conversación (workflows scheduled / pms_event) →
 *     canal activo de la org, **prefiriendo el canal Baileys conectado**, luego
 *     cualquier canal 'active', luego el más reciente.
 *
 * Antes de esto, `ctx.channelId` nunca se poblaba en el executor de workflows,
 * por lo que los nodos send_* fallaban siempre. Resolverlo acá hace que las
 * automatizaciones efectivamente envíen — y que lo hagan por WhatsApp/Baileys
 * cuando es el canal de la org.
 */
export async function resolveOrgChannelId(
  admin: Admin,
  organizationId: string,
  conversationId?: string | null,
): Promise<string | null> {
  if (conversationId) {
    const { data } = await admin
      .from("crm_conversations")
      .select("channel_id")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data?.channel_id) return data.channel_id as string;
  }

  // Prioridad: canal Baileys conectado (la org "eligió" WhatsApp por Baileys).
  const { data: baileysChannels } = await admin
    .from("crm_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", "baileys");
  const baileysIds = (baileysChannels ?? []).map((c) => c.id as string);
  if (baileysIds.length > 0) {
    const { data: connected } = await admin
      .from("crm_baileys_sessions")
      .select("channel_id")
      .in("channel_id", baileysIds)
      .eq("status", "connected")
      .limit(1)
      .maybeSingle();
    if (connected?.channel_id) return connected.channel_id as string;
  }

  const { data: active } = await admin
    .from("crm_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (active?.id) return active.id as string;

  const { data: latest } = await admin
    .from("crm_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (latest?.id as string) ?? null;
}
