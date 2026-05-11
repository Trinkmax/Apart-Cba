import "server-only";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

const CODE_COUNT = 8;

/**
 * Genera CODE_COUNT codes en formato XXXX-XXXX-XXXX-XXXX, los hashea con
 * bcrypt e inserta en user_2fa_recovery_codes. Devuelve los codes plain
 * — única vez que existen. Antes de generar, marca codes activos previos
 * como used_at = now() (los invalida).
 */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const admin = createAdminClient();

  await admin
    .from("user_2fa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("used_at", null);

  const codes: string[] = [];
  const inserts: Array<{ user_id: string; code_hash: string }> = [];
  for (let i = 0; i < CODE_COUNT; i++) {
    const code = formatCode(randomBytes(8).toString("hex").toUpperCase().slice(0, 16));
    codes.push(code);
    inserts.push({ user_id: userId, code_hash: await bcrypt.hash(code, 10) });
  }
  const { error } = await admin.from("user_2fa_recovery_codes").insert(inserts);
  if (error) throw new Error(error.message);
  return codes;
}

function formatCode(raw: string): string {
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}

/**
 * Valida un recovery code contra los activos del user. Si match, marca
 * used_at = now() y devuelve true. Sino false.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const normalized = code.replace(/\s/g, "").toUpperCase();
  if (normalized.length !== 19) return false;
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("user_2fa_recovery_codes")
    .select("id, code_hash")
    .eq("user_id", userId)
    .is("used_at", null);
  for (const row of rows ?? []) {
    if (await bcrypt.compare(normalized, row.code_hash)) {
      await admin
        .from("user_2fa_recovery_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", row.id);
      return true;
    }
  }
  return false;
}
