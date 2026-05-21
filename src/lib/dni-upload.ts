/**
 * Constantes y validación compartidas para la carga de fotos del DNI del
 * equipo. Lo usan el flujo de subida inmediata (`dni-section.tsx`), el server
 * action (`team-dni.ts`) y el picker diferido del diálogo de invitación
 * (`dni-invite-picker.tsx`).
 *
 * Módulo neutral (sin "use server"/"use client"): importable desde cliente y
 * servidor.
 */

export const ALLOWED_DNI_MIME: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const MAX_DNI_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Valida un archivo de DNI por tipo MIME y tamaño.
 * Devuelve un mensaje de error (es-AR) si no es válido, o `null` si está OK.
 */
export function validateDniFile(file: File): string | null {
  if (!ALLOWED_DNI_MIME.includes(file.type)) return "Solo JPG, PNG o WebP";
  if (file.size > MAX_DNI_BYTES) return "Máximo 5 MB";
  return null;
}
