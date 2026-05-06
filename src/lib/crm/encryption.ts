"use server";

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Vault-backed secret storage. Server-only.
 *
 * Las funciones de Postgres `apartcba.crm_vault_create_secret` /
 * `crm_vault_update_secret` / `crm_get_secret` están definidas con
 * SECURITY DEFINER y solo accesibles para `service_role`. Esto significa que
 * los plaintexts nunca persisten fuera de Vault: nuestras tablas guardan solo
 * el `secret_id`.
 */

export async function createSecret(name: string, value: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("crm_vault_create_secret", {
    p_name: name,
    p_value: value,
  });
  if (error) throw new Error(`Vault create_secret failed: ${error.message}`);
  if (!data) throw new Error("Vault create_secret returned no id");
  return data as string;
}

export async function updateSecret(secretId: string, value: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("crm_vault_update_secret", {
    p_secret_id: secretId,
    p_value: value,
  });
  if (error) throw new Error(`Vault update_secret failed: ${error.message}`);
}

export async function getSecret(secretId: string | null | undefined): Promise<string | null> {
  if (!secretId) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("crm_get_secret", { p_secret_id: secretId });
  if (error) throw new Error(`Vault get_secret failed: ${error.message}`);
  return (data as string | null) ?? null;
}
