import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import type { SecurityEventType } from "@/lib/types/database";

export async function logSecurityEvent(args: {
  userId: string;
  eventType: SecurityEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = h.get("user-agent") ?? null;
    const admin = createAdminClient();
    await admin.from("security_audit_log").insert({
      user_id: args.userId,
      event_type: args.eventType,
      metadata: args.metadata ?? null,
      ip,
      user_agent: userAgent,
    });
  } catch (e) {
    console.warn("Failed to log security event", args.eventType, e);
  }
}
