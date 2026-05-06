"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getSecret } from "../encryption";
import { MetaCloudProvider } from "./meta-cloud";
import { InstagramProvider } from "./instagram";
import type { ChannelProvider, ChannelProviderContext } from "./types";

/**
 * Resuelve el ChannelProvider correcto a partir de un canal existente.
 * Carga las credenciales desde Vault (server-only).
 */
export async function getProviderForChannel(channelId: string): Promise<ChannelProvider> {
  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("crm_channels")
    .select("*")
    .eq("id", channelId)
    .single();

  if (error || !channel) {
    throw new Error(`Channel ${channelId} not found`);
  }

  const accessToken = await getSecret(channel.access_token_secret_id);
  const appSecret = await getSecret(channel.app_secret_secret_id);

  if (!accessToken) {
    throw new Error(`Channel ${channelId} has no access token. Configure Meta credentials first.`);
  }

  const ctx: ChannelProviderContext = {
    channelId: channel.id,
    organizationId: channel.organization_id,
    phoneNumberId: channel.phone_number_id ?? "",
    wabaId: channel.waba_id ?? "",
    accessToken,
    appSecret: appSecret ?? undefined,
  };

  switch (channel.provider) {
    case "meta_cloud":
      return new MetaCloudProvider(ctx);
    case "meta_instagram":
      return new InstagramProvider({
        ...ctx,
        pageId: channel.page_id ?? undefined,
        igAccountId: channel.instagram_business_account_id ?? undefined,
      });
    default:
      throw new Error(`Unsupported provider: ${channel.provider}`);
  }
}

interface ResolvedChannel {
  id: string;
  organization_id: string;
  provider: string;
  app_secret_secret_id: string | null;
  webhook_verify_token_secret_id: string | null;
  page_id: string | null;
  instagram_business_account_id: string | null;
}

/**
 * Lookup canal por phone_number_id (para webhook routing WhatsApp).
 */
export async function getProviderForPhoneNumberId(
  phoneNumberId: string,
): Promise<{ provider: ChannelProvider; channel: ResolvedChannel } | null> {
  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("crm_channels")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .eq("provider", "meta_cloud")
    .maybeSingle();

  if (error || !channel) return null;
  return await buildProvider(channel);
}

/**
 * Lookup canal por Instagram business account id o page id (para webhook routing IG).
 */
export async function getProviderForInstagramId(
  igAccountIdOrPageId: string,
): Promise<{ provider: ChannelProvider; channel: ResolvedChannel } | null> {
  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("crm_channels")
    .select("*")
    .eq("provider", "meta_instagram")
    .or(`instagram_business_account_id.eq.${igAccountIdOrPageId},page_id.eq.${igAccountIdOrPageId}`)
    .maybeSingle();

  if (error || !channel) return null;
  return await buildProvider(channel);
}

async function buildProvider(channel: {
  id: string;
  organization_id: string;
  provider: string;
  phone_number_id: string | null;
  waba_id: string | null;
  page_id: string | null;
  instagram_business_account_id: string | null;
  access_token_secret_id: string | null;
  app_secret_secret_id: string | null;
  webhook_verify_token_secret_id: string | null;
}): Promise<{ provider: ChannelProvider; channel: ResolvedChannel } | null> {
  const accessToken = await getSecret(channel.access_token_secret_id);
  const appSecret = await getSecret(channel.app_secret_secret_id);
  if (!accessToken) return null;

  const ctx: ChannelProviderContext = {
    channelId: channel.id,
    organizationId: channel.organization_id,
    phoneNumberId: channel.phone_number_id ?? "",
    wabaId: channel.waba_id ?? "",
    accessToken,
    appSecret: appSecret ?? undefined,
  };

  let provider: ChannelProvider;
  switch (channel.provider) {
    case "meta_cloud":
      provider = new MetaCloudProvider(ctx);
      break;
    case "meta_instagram":
      provider = new InstagramProvider({
        ...ctx,
        pageId: channel.page_id ?? undefined,
        igAccountId: channel.instagram_business_account_id ?? undefined,
      });
      break;
    default:
      return null;
  }

  return {
    provider,
    channel: {
      id: channel.id,
      organization_id: channel.organization_id,
      provider: channel.provider,
      app_secret_secret_id: channel.app_secret_secret_id,
      webhook_verify_token_secret_id: channel.webhook_verify_token_secret_id,
      page_id: channel.page_id,
      instagram_business_account_id: channel.instagram_business_account_id,
    },
  };
}
