import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

/**
 * Service-role client pinned to the `apartcba` schema (same convention as the
 * Next.js app's createAdminClient). Used for: durable Baileys keystore,
 * session-status writes, and inbound-media upload to Storage.
 */
export const supabase: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    db: { schema: "apartcba" },
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
