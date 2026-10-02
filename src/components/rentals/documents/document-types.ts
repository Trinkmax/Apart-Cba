import type { RentalDocument, RentalDocumentKind } from "@/lib/types/database";

/** Tipos y catálogos de Documentos del módulo Alquileres (sin I/O). */

export type DocumentsScope = { contractId: string } | { propertyId: string } | { personId: string };

export type DocumentScopeKind = "contract" | "property" | "person";

export interface DocumentScopeRef {
  kind: DocumentScopeKind;
  id: string;
}

export function scopeRefOf(scope: DocumentsScope): DocumentScopeRef {
  if ("contractId" in scope) return { kind: "contract", id: scope.contractId };
  if ("propertyId" in scope) return { kind: "property", id: scope.propertyId };
  return { kind: "person", id: scope.personId };
}

export interface RentalDocumentView extends RentalDocument {
  uploader_name: string | null;
  /** Día de subida en la zona de la org (YYYY-MM-DD): se muestra igual en servidor y navegador. */
  created_on: string;
}

/** Tope por Server Action (Vercel corta el cuerpo en 4,5 MB). Más grande va por URL firmada. */
export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Tope del bucket `rental-docs` (068: 15 MB). */
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

/** Qué tipos de documento se ofrecen según dónde se suben (en orden de uso). */
export const KINDS_BY_SCOPE: Record<DocumentScopeKind, RentalDocumentKind[]> = {
  contract: ["contrato", "garantia", "acta_entrega", "inventario", "poliza", "foto", "otro"],
  property: ["mandato", "inventario", "foto", "otro"],
  person: ["dni", "recibo_sueldo", "garantia", "otro"],
};

/** Lo que conviene tener sí o sí en cada lugar (se muestra como lista de control). */
export const EXPECTED_KINDS: Record<DocumentScopeKind, RentalDocumentKind[]> = {
  contract: ["contrato", "garantia", "acta_entrega", "inventario"],
  property: ["mandato"],
  person: ["dni"],
};

export const SCOPE_EMPTY_HINT: Record<DocumentScopeKind, string> = {
  contract: "Subí el contrato firmado, la garantía y el acta de entrega: quedan a mano para cualquier reclamo.",
  property: "Guardá el mandato de administración, el inventario y fotos del estado de la propiedad.",
  person: "DNI (frente y dorso), recibos de sueldo o la documentación de la garantía.",
};

export function fileExtensionOf(mime: string | null | undefined): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}
