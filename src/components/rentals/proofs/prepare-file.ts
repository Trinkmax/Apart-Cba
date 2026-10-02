"use client";

import { compressImage } from "@/lib/marketplace/image-compress";

/**
 * Prepara un comprobante para subir desde el navegador (panel y portal): las
 * fotos pesadas y las HEIC de iPhone pasan a JPEG (así el equipo las ve en
 * cualquier navegador y no chocan con el tope de 4 MB de las Server Actions).
 * Si la compresión falla se sube el original: nunca bloquea la subida.
 */

export const MAX_PROOF_BYTES = 4 * 1024 * 1024;
const COMPRESS_FROM_BYTES = 1.5 * 1024 * 1024;
const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const PROOF_ACCEPT = "image/*,application/pdf,.heic,.heif,.pdf";

export interface PreparedProofFile {
  file: File;
  kind: "image" | "pdf" | "heic";
  /** URL local para la miniatura (revocala al descartar). */
  previewUrl: string | null;
}

function kindOf(file: File): "image" | "heic" | "pdf" | null {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/.test(name)) return "heic";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp)$/.test(name)) return "image";
  return null;
}

export async function prepareProofFile(file: File): Promise<PreparedProofFile | { error: string }> {
  const kind = kindOf(file);
  if (!kind) return { error: "Subí una foto (JPG, PNG o HEIC) o un PDF." };
  let upload = file;
  if (kind !== "pdf" && (kind === "heic" || file.size > COMPRESS_FROM_BYTES)) {
    const compressed = await compressImage(file);
    if (compressed && compressed.blob.size < file.size * 1.1) {
      const base = file.name.replace(/\.[^.]+$/, "") || "comprobante";
      upload = new File([compressed.blob], `${base}.jpg`, { type: "image/jpeg" });
    }
  }
  if (upload.size > MAX_PROOF_BYTES) return { error: "El archivo pesa más de 4 MB. Mandá una foto o una captura." };
  const finalKind = kind === "heic" && upload.type === "image/jpeg" ? "image" : kind;
  return { file: upload, kind: finalKind, previewUrl: PREVIEWABLE.has(upload.type) ? URL.createObjectURL(upload) : null };
}
