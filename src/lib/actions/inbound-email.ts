"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";

export interface InboundEmailConfig {
  token: string;
  address: string;
}

export async function getInboundEmailConfig(): Promise<InboundEmailConfig> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("inbound_email_token")
    .eq("id", organization.id)
    .single();
  if (error) throw new Error(error.message);

  const domain = process.env.INBOUND_EMAIL_DOMAIN ?? "ota.example.com";
  return {
    token: data.inbound_email_token,
    address: `ota-${data.inbound_email_token}@${domain}`,
  };
}

export async function rotateInboundToken(): Promise<InboundEmailConfig> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error } = await admin
    .from("organizations")
    .update({ inbound_email_token: token })
    .eq("id", organization.id);
  if (error) throw new Error(error.message);

  const domain = process.env.INBOUND_EMAIL_DOMAIN ?? "ota.example.com";
  revalidatePath("/dashboard/configuracion/inbound-email");
  return {
    token,
    address: `ota-${token}@${domain}`,
  };
}

export interface InboundEmailLogEntry {
  id: string;
  from_address: string;
  to_address: string;
  subject: string | null;
  received_at: string;
  parser_used: string | null;
  event_type: string | null;
  status: string;
  booking_id: string | null;
  error_message: string | null;
}

export async function listInboundEmails(limit = 50): Promise<InboundEmailLogEntry[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inbound_email_log")
    .select("id, from_address, to_address, subject, received_at, parser_used, event_type, status, booking_id, error_message")
    .eq("organization_id", organization.id)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as InboundEmailLogEntry[];
}
