"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { TicketAttachment } from "@/lib/types/database";

const BUCKET = "ticket-photos";
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

async function assertTicketBelongsToOrg(ticketId: string) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Ticket no encontrado");
  return organization.id;
}

export async function listTicketAttachments(
  ticketId: string
): Promise<TicketAttachment[]> {
  await assertTicketBelongsToOrg(ticketId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ticket_attachments")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as TicketAttachment[]) ?? [];
}

export async function uploadTicketPhoto(
  ticketId: string,
  formData: FormData
): Promise<TicketAttachment> {
  const session = await requireSession();
  const orgId = await assertTicketBelongsToOrg(ticketId);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Archivo requerido");
  if (file.size === 0) throw new Error("El archivo está vacío");
  if (file.size > MAX_BYTES)
    throw new Error("La imagen supera el límite de 10MB");
  if (!ALLOWED_MIME.has(file.type))
    throw new Error(`Tipo de archivo no permitido (${file.type || "desconocido"})`);

  const ext = (() => {
    const fromName = file.name.split(".").pop()?.toLowerCase();
    if (fromName && fromName.length <= 5) return fromName;
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    if (file.type === "image/heic" || file.type === "image/heif") return "heic";
    return "jpg";
  })();

  const objectPath = `${orgId}/${ticketId}/${randomUUID()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const admin = createAdminClient();
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(objectPath, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
  if (uploadErr) throw new Error(uploadErr.message);

  const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(objectPath);

  const { data: row, error: insertErr } = await admin
    .from("ticket_attachments")
    .insert({
      ticket_id: ticketId,
      file_url: publicUrl.publicUrl,
      file_name: file.name || null,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: session.userId,
    })
    .select()
    .single();

  if (insertErr) {
    // best-effort cleanup of the orphan object
    await admin.storage.from(BUCKET).remove([objectPath]).catch(() => {});
    throw new Error(insertErr.message);
  }

  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${ticketId}`);
  revalidatePath(`/m/mantenimiento/${ticketId}`);
  revalidatePath("/m/mantenimiento");

  return row as TicketAttachment;
}

export async function deleteTicketAttachment(attachmentId: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: attachment, error: fetchErr } = await admin
    .from("ticket_attachments")
    .select("id, ticket_id, file_url")
    .eq("id", attachmentId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!attachment) throw new Error("Adjunto no encontrado");

  // Confirm the parent ticket belongs to the active org.
  const { data: ticket, error: ticketErr } = await admin
    .from("maintenance_tickets")
    .select("id")
    .eq("id", attachment.ticket_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (ticketErr) throw new Error(ticketErr.message);
  if (!ticket) throw new Error("Ticket no encontrado");

  // Extract storage path from the public URL.
  const marker = `/${BUCKET}/`;
  const idx = attachment.file_url.indexOf(marker);
  if (idx >= 0) {
    const objectPath = attachment.file_url.slice(idx + marker.length);
    await admin.storage.from(BUCKET).remove([objectPath]).catch(() => {});
  }

  const { error: deleteErr } = await admin
    .from("ticket_attachments")
    .delete()
    .eq("id", attachmentId);
  if (deleteErr) throw new Error(deleteErr.message);

  revalidatePath("/dashboard/mantenimiento");
  revalidatePath(`/dashboard/mantenimiento/${attachment.ticket_id}`);
  revalidatePath(`/m/mantenimiento/${attachment.ticket_id}`);
  revalidatePath("/m/mantenimiento");
}
