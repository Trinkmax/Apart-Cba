import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { supabase } from "./supabase";
import { encrypt, decrypt } from "./crypto";
import { logger } from "./logger";

const TABLE = "crm_baileys_auth_state";

/**
 * Baileys auth state persisted to Postgres (crm_baileys_auth_state), encrypted
 * at rest with AES-256-GCM. This is what makes a Railway redeploy / crash
 * non-destructive: the WhatsApp session survives because creds + signal keys
 * are durable. Losing this table (or the enc key) = every org re-scans QR.
 *
 * Mirrors the official `useMultiFileAuthState` contract, swapping the fs for
 * encrypted DB rows keyed by (channel_id, key).
 */

async function readBlob(channelId: string, key: string): Promise<unknown | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("channel_id", channelId)
    .eq("key", key)
    .maybeSingle();
  if (error) {
    logger.error({ err: error.message, key }, "auth-state read failed");
    return null;
  }
  if (!data?.data) return null;
  try {
    return JSON.parse(decrypt(data.data as string), BufferJSON.reviver);
  } catch (err) {
    logger.error({ err: String(err), key }, "auth-state decrypt/parse failed");
    return null;
  }
}

async function writeBlob(
  channelId: string,
  organizationId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const payload = encrypt(JSON.stringify(value, BufferJSON.replacer));
  const { error } = await supabase.from(TABLE).upsert(
    {
      channel_id: channelId,
      organization_id: organizationId,
      key,
      data: payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel_id,key" },
  );
  if (error) logger.error({ err: error.message, key }, "auth-state write failed");
}

async function deleteBlob(channelId: string, key: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("channel_id", channelId).eq("key", key);
  if (error) logger.error({ err: error.message, key }, "auth-state delete failed");
}

export interface SupabaseAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearState: () => Promise<void>;
}

export async function useSupabaseAuthState(
  channelId: string,
  organizationId: string,
): Promise<SupabaseAuthState> {
  const storedCreds = (await readBlob(channelId, "creds")) as AuthenticationCreds | null;
  const creds: AuthenticationCreds = storedCreds ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readBlob(channelId, `${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as Record<string, unknown>,
                );
              }
              if (value) result[id] = value as SignalDataTypeMap[typeof type];
            }),
          );
          return result;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const type in data) {
            const typed = data[type as keyof typeof data];
            if (!typed) continue;
            for (const id in typed) {
              const value = typed[id];
              const key = `${type}-${id}`;
              tasks.push(
                value
                  ? writeBlob(channelId, organizationId, key, value)
                  : deleteBlob(channelId, key),
              );
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeBlob(channelId, organizationId, "creds", creds);
    },
    clearState: async () => {
      const { error } = await supabase.from(TABLE).delete().eq("channel_id", channelId);
      if (error) logger.error({ err: error.message }, "auth-state clear failed");
    },
  };
}
