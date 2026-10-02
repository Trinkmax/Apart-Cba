"use client";

import { prepareImageForUpload } from "@/lib/image-compress";
import { createClient } from "@/lib/supabase/client";
import {
  finishRentalDocumentUpload,
  prepareRentalDocumentUpload,
  uploadRentalDocument,
} from "@/lib/actions/rentals-documents";
import type { RentalDocumentKind } from "@/lib/types/database";
import {
  DIRECT_UPLOAD_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  type DocumentScopeRef,
  type RentalDocumentView,
} from "./document-types";

/** Lo que acepta el selector de archivos (Safari manda HEIC con tipo vacío: va también por extensión). */
export const DOCUMENT_ACCEPT = "image/*,application/pdf,.pdf,.heic,.heif";

function guessMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

export function isImageFile(file: File): boolean {
  return guessMime(file).startsWith("image/");
}

/**
 * Sube un documento: achica las fotos en el navegador, manda hasta 4 MB por
 * Server Action y lo más pesado (un contrato escaneado, hasta 15 MB) directo
 * al bucket con URL firmada; el servidor verifica el archivo en los dos casos.
 */
export async function uploadDocumentFile(
  scope: DocumentScopeRef,
  kind: RentalDocumentKind,
  title: string,
  original: File,
): Promise<{ ok: true; document: RentalDocumentView } | { ok: false; error: string }> {
  let file = original;
  if (isImageFile(file)) file = await prepareImageForUpload(file);
  if (file.size > DOCUMENT_MAX_BYTES) {
    return { ok: false, error: `«${original.name}» pesa más de 15 MB. Comprimilo o sacale una foto con menos resolución.` };
  }
  if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
    const fd = new FormData();
    fd.set("scope_kind", scope.kind);
    fd.set("scope_id", scope.id);
    fd.set("kind", kind);
    fd.set("title", title);
    fd.set("file", file);
    const res = await uploadRentalDocument(fd);
    return res.ok ? { ok: true, document: res.document } : { ok: false, error: res.error };
  }
  const mime = guessMime(file);
  const prep = await prepareRentalDocumentUpload({ scope, size: file.size, mime });
  if (!prep.ok) return { ok: false, error: prep.error };
  const supabase = createClient();
  const up = await supabase.storage.from("rental-docs").uploadToSignedUrl(prep.path, prep.token, file, { contentType: mime });
  if (up.error) {
    return { ok: false, error: "No se pudo subir el archivo. Revisá la conexión y probá de nuevo." };
  }
  const done = await finishRentalDocumentUpload({ scope, kind, title, path: prep.path });
  return done.ok ? { ok: true, document: done.document } : { ok: false, error: done.error };
}
