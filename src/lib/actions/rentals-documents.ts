"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { dbFailure, logRentalsError, rentalsContext, type ActionError, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { logRentalEvent } from "@/lib/rentals/server/contract-sync";
import { DOCUMENT_KIND_LABEL } from "@/lib/rentals/labels";
import { ymdInTz } from "@/lib/dates";
import { RECEIPT_MIME_EXT, sniffReceiptMime } from "@/lib/marketplace/reservation-view";
import type { RentalDocument, RentalDocumentKind } from "@/lib/types/database";
import {
  DIRECT_UPLOAD_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  fileExtensionOf,
  scopeRefOf,
  type DocumentScopeRef,
  type DocumentsScope,
  type RentalDocumentView,
} from "@/components/rentals/documents/document-types";

/**
 * Documentos del módulo (contrato firmado, garantía, DNI, mandato…) en el
 * bucket privado `rental-docs`. Hasta 4 MB pasan por Server Action (FormData);
 * más grandes (hasta 15 MB, un contrato escaneado) suben directo con una URL
 * firmada y después se verifican acá: se descarga el objeto, se mira el tipo
 * real por sus primeros bytes y, si no sirve, se borra.
 */

const BUCKET = "rental-docs";
const SIGNED_URL_TTL = 600; // 10 minutos
const SCOPE_TABLE = { contract: "rental_contracts", property: "rental_properties", person: "rental_people" } as const;
const SCOPE_COLUMN = { contract: "contract_id", property: "property_id", person: "person_id" } as const;
const SCOPE_FOLDER = { contract: "contracts", property: "properties", person: "people" } as const;
const ALLOWED_MIME = Object.keys(RECEIPT_MIME_EXT);
const FILE_TYPE_ERROR = "El archivo tiene que ser un PDF o una imagen (JPG, PNG, WEBP o HEIC).";

const scopeSchema = z.object({ kind: z.enum(["contract", "property", "person"]), id: z.string().uuid("Falta a qué pertenece el documento.") });
const kindSchema = z.enum(["contrato", "garantia", "inventario", "acta_entrega", "mandato", "dni", "recibo_sueldo", "poliza", "foto", "otro"]);
const titleSchema = z.string().trim().max(160, "El nombre: hasta 160 caracteres.");

function isUploadedFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function" && (v as Blob).size > 0;
}

function prefixOf(orgId: string, scope: DocumentScopeRef): string {
  return `${orgId}/${SCOPE_FOLDER[scope.kind]}/${scope.id}/`;
}

/** El dueño del documento existe y es de esta org. Devuelve la propiedad (para el historial). */
async function assertScope(ctx: RentalsCtx, scope: DocumentScopeRef): Promise<{ ok: true; propertyId: string | null } | ActionError> {
  const { data, error } = await ctx.admin
    .from(SCOPE_TABLE[scope.kind])
    .select(scope.kind === "contract" ? "id, property_id" : "id")
    .eq("organization_id", ctx.organization.id)
    .eq("id", scope.id)
    .maybeSingle();
  if (error) return dbFailure("assertScope", error, "No se pudo verificar dónde va el documento.");
  if (!data) return { ok: false, error: "No encontramos a qué pertenece el documento." };
  const row = data as unknown as { id: string; property_id?: string };
  return { ok: true, propertyId: scope.kind === "property" ? scope.id : row.property_id ?? null };
}

function revalidateDoc(d: Pick<RentalDocument, "contract_id" | "property_id" | "person_id">): void {
  revalidateRentals({ contractId: d.contract_id, propertyId: d.property_id, personId: d.person_id });
}

async function insertDocument(
  ctx: RentalsCtx,
  scope: DocumentScopeRef,
  propertyId: string | null,
  meta: { kind: RentalDocumentKind; title: string; path: string; mime: string; size: number },
): Promise<ActionResult<{ document: RentalDocumentView }>> {
  const { data, error } = await ctx.admin
    .from("rental_documents")
    .insert({
      organization_id: ctx.organization.id,
      [SCOPE_COLUMN[scope.kind]]: scope.id,
      kind: meta.kind,
      title: meta.title,
      file_path: meta.path,
      file_mime: meta.mime,
      file_size: meta.size,
      uploaded_by: ctx.session.userId,
    })
    .select("*")
    .single();
  if (error || !data) {
    await ctx.admin.storage.from(BUCKET).remove([meta.path]).catch(() => undefined);
    return dbFailure("insertDocument", error, "No se pudo guardar el documento. Probá de nuevo.");
  }
  const doc = data as RentalDocument;
  if (scope.kind !== "person") {
    await logRentalEvent(ctx.admin, {
      organizationId: ctx.organization.id,
      contractId: doc.contract_id,
      propertyId: doc.property_id ?? propertyId,
      type: "document_uploaded",
      summary: `Se subió «${doc.title}» (${DOCUMENT_KIND_LABEL[doc.kind]})`,
      payload: { document_id: doc.id, kind: doc.kind },
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
  }
  revalidateDoc(doc);
  return { ok: true, document: { ...doc, uploader_name: ctx.actorName, created_on: ymdInTz(new Date(doc.created_at), ctx.tz) } };
}

function resolveTitle(kind: RentalDocumentKind, raw: string): string {
  return raw.trim() || DOCUMENT_KIND_LABEL[kind];
}

// ─── Subida ─────────────────────────────────────────────────────────────────

/**
 * Subida directa (hasta 4 MB). FormData: `scope_kind` (contract|property|person),
 * `scope_id`, `kind`, `title` (opcional: si falta, el nombre del tipo) y `file`.
 */
export async function uploadRentalDocument(formData: FormData): Promise<ActionResult<{ document: RentalDocumentView }>> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!(formData instanceof FormData)) return { ok: false, error: "No llegó el archivo." };
  const scope = scopeSchema.safeParse({ kind: formData.get("scope_kind"), id: formData.get("scope_id") });
  if (!scope.success) return { ok: false, error: scope.error.issues[0]?.message ?? "Falta a qué pertenece el documento." };
  const kind = kindSchema.safeParse(formData.get("kind"));
  if (!kind.success) return { ok: false, error: "Elegí qué tipo de documento es.", field: "kind" };
  const title = titleSchema.safeParse(typeof formData.get("title") === "string" ? formData.get("title") : "");
  if (!title.success) return { ok: false, error: title.error.issues[0]?.message ?? "Revisá el nombre.", field: "title" };

  const file = formData.get("file");
  if (!isUploadedFile(file)) return { ok: false, error: "Elegí un archivo.", field: "file" };
  if (file.size > DIRECT_UPLOAD_MAX_BYTES) {
    return { ok: false, error: "El archivo pesa más de 4 MB.", field: "file" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffReceiptMime(bytes);
  if (!mime) return { ok: false, error: FILE_TYPE_ERROR, field: "file" };

  const owner = await assertScope(ctx, scope.data);
  if (!owner.ok) return owner;
  const path = `${prefixOf(ctx.organization.id, scope.data)}${randomUUID()}.${RECEIPT_MIME_EXT[mime]}`;
  const { error: upErr } = await ctx.admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) {
    logRentalsError("uploadRentalDocument.storage", upErr);
    return { ok: false, error: "No se pudo subir el archivo. Probá de nuevo." };
  }
  return insertDocument(ctx, scope.data, owner.propertyId, {
    kind: kind.data,
    title: resolveTitle(kind.data, title.data),
    path,
    mime,
    size: bytes.byteLength,
  });
}

/** Paso 1 de la subida grande (4-15 MB): URL firmada para subir directo al bucket. */
export async function prepareRentalDocumentUpload(input: {
  scope: DocumentScopeRef;
  size: number;
  mime: string;
}): Promise<ActionResult<{ path: string; token: string }>> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const scope = scopeSchema.safeParse(input?.scope);
  if (!scope.success) return { ok: false, error: "Falta a qué pertenece el documento." };
  const size = Number(input?.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "Elegí un archivo.", field: "file" };
  if (size > DOCUMENT_MAX_BYTES) return { ok: false, error: "El archivo pesa más de 15 MB. Comprimilo o subilo en partes.", field: "file" };
  // El tipo que dice el navegador sólo elige la extensión; el real se verifica al terminar.
  const mime = ALLOWED_MIME.includes(input?.mime) ? input.mime : "application/pdf";
  const owner = await assertScope(ctx, scope.data);
  if (!owner.ok) return owner;
  const path = `${prefixOf(ctx.organization.id, scope.data)}${randomUUID()}.${fileExtensionOf(mime)}`;
  const { data, error } = await ctx.admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    logRentalsError("prepareRentalDocumentUpload", error);
    return { ok: false, error: "No se pudo preparar la subida. Probá de nuevo." };
  }
  return { ok: true, path: data.path ?? path, token: data.token };
}

const UPLOADED_NAME = /^[0-9a-f-]{36}\.(pdf|jpg|png|webp|heic|heif)$/;

/** Paso 2 de la subida grande: verifica el archivo subido (tipo real y tamaño) y lo registra. */
export async function finishRentalDocumentUpload(input: {
  scope: DocumentScopeRef;
  kind: RentalDocumentKind;
  title: string;
  path: string;
}): Promise<ActionResult<{ document: RentalDocumentView }>> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const scope = scopeSchema.safeParse(input?.scope);
  if (!scope.success) return { ok: false, error: "Falta a qué pertenece el documento." };
  const kind = kindSchema.safeParse(input?.kind);
  if (!kind.success) return { ok: false, error: "Elegí qué tipo de documento es.", field: "kind" };
  const title = titleSchema.safeParse(input?.title ?? "");
  if (!title.success) return { ok: false, error: title.error.issues[0]?.message ?? "Revisá el nombre.", field: "title" };
  const prefix = prefixOf(ctx.organization.id, scope.data);
  const path = String(input?.path ?? "");
  if (!path.startsWith(prefix) || !UPLOADED_NAME.test(path.slice(prefix.length))) {
    return { ok: false, error: "No encontramos el archivo subido. Probá de nuevo." };
  }
  const owner = await assertScope(ctx, scope.data);
  if (!owner.ok) return owner;

  const { data: blob, error } = await ctx.admin.storage.from(BUCKET).download(path);
  if (error || !blob) {
    logRentalsError("finishRentalDocumentUpload.download", error);
    return { ok: false, error: "No encontramos el archivo subido. Probá de nuevo." };
  }
  const head = new Uint8Array(await blob.slice(0, 2048).arrayBuffer());
  const mime = sniffReceiptMime(head);
  if (!mime || blob.size > DOCUMENT_MAX_BYTES) {
    await ctx.admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return { ok: false, error: mime ? "El archivo pesa más de 15 MB." : FILE_TYPE_ERROR, field: "file" };
  }
  return insertDocument(ctx, scope.data, owner.propertyId, {
    kind: kind.data,
    title: resolveTitle(kind.data, title.data),
    path,
    mime,
    size: blob.size,
  });
}

// ─── Lectura, link, edición y baja ──────────────────────────────────────────

/** Acepta `{ kind, id }` o la forma de DocumentsSection (`{ contractId }` / `{ propertyId }` / `{ personId }`). */
export async function listRentalDocuments(
  scopeInput: DocumentScopeRef | DocumentsScope,
): Promise<ActionResult<{ documents: RentalDocumentView[] }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const scope = scopeSchema.safeParse(scopeInput && "kind" in scopeInput ? scopeInput : scopeInput ? scopeRefOf(scopeInput) : null);
  if (!scope.success) return { ok: false, error: "Falta a qué pertenecen los documentos." };
  const { data, error } = await ctx.admin
    .from("rental_documents")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .eq(SCOPE_COLUMN[scope.data.kind], scope.data.id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return dbFailure("listRentalDocuments", error, "No se pudieron cargar los documentos.");
  const docs = (data ?? []) as RentalDocument[];
  const uploaderIds = Array.from(new Set(docs.map((d) => d.uploaded_by).filter((v): v is string => Boolean(v))));
  const names = new Map<string, string>();
  if (uploaderIds.length) {
    // user_profiles no tiene `id`: la clave es user_id (= auth.users.id, lo que guarda uploaded_by).
    const { data: profiles, error: pErr } = await ctx.admin.from("user_profiles").select("user_id, full_name").in("user_id", uploaderIds);
    if (pErr) logRentalsError("listRentalDocuments.profiles", pErr);
    for (const p of (profiles ?? []) as { user_id: string; full_name: string | null }[]) if (p.full_name) names.set(p.user_id, p.full_name);
  }
  return {
    ok: true,
    documents: docs.map((d) => ({
      ...d,
      uploader_name: d.uploaded_by ? names.get(d.uploaded_by) ?? null : null,
      created_on: ymdInTz(new Date(d.created_at), ctx.tz),
    })),
  };
}

function downloadName(title: string, mime: string | null): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "documento";
  return `${base}.${fileExtensionOf(mime)}`;
}

/** Link firmado por 10 minutos (para ver o, con `download`, para bajar con su nombre). */
export async function getRentalDocumentUrl(id: string, opts: { download?: boolean } = {}): Promise<ActionResult<{ url: string }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos el documento." };
  const { data, error } = await ctx.admin
    .from("rental_documents")
    .select("file_path, title, file_mime")
    .eq("organization_id", ctx.organization.id)
    .eq("id", id)
    .maybeSingle();
  if (error) return dbFailure("getRentalDocumentUrl", error, "No se pudo abrir el documento.");
  if (!data) return { ok: false, error: "No encontramos el documento." };
  const doc = data as Pick<RentalDocument, "file_path" | "title" | "file_mime">;
  const { data: signed, error: sErr } = await ctx.admin.storage
    .from(BUCKET)
    .createSignedUrl(doc.file_path, SIGNED_URL_TTL, opts.download ? { download: downloadName(doc.title, doc.file_mime) } : undefined);
  if (sErr || !signed?.signedUrl) {
    logRentalsError("getRentalDocumentUrl.sign", sErr);
    return { ok: false, error: "No se pudo abrir el archivo. Probá de nuevo." };
  }
  return { ok: true, url: signed.signedUrl };
}

export async function updateRentalDocument(id: string, input: { title: string; kind: RentalDocumentKind }): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos el documento." };
  const kind = kindSchema.safeParse(input?.kind);
  if (!kind.success) return { ok: false, error: "Elegí qué tipo de documento es.", field: "kind" };
  const title = titleSchema.safeParse(input?.title ?? "");
  if (!title.success) return { ok: false, error: title.error.issues[0]?.message ?? "Revisá el nombre.", field: "title" };
  const { data, error } = await ctx.admin
    .from("rental_documents")
    .update({ kind: kind.data, title: resolveTitle(kind.data, title.data) })
    .eq("organization_id", ctx.organization.id)
    .eq("id", id)
    .select("contract_id, property_id, person_id")
    .maybeSingle();
  if (error) return dbFailure("updateRentalDocument", error, "No se pudieron guardar los cambios.");
  if (!data) return { ok: false, error: "No encontramos el documento." };
  revalidateDoc(data as Pick<RentalDocument, "contract_id" | "property_id" | "person_id">);
  return { ok: true };
}

export async function deleteRentalDocument(id: string): Promise<ActionResult> {
  const r = await rentalsContext("delete");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos el documento." };
  const { data, error } = await ctx.admin
    .from("rental_documents")
    .delete()
    .eq("organization_id", ctx.organization.id)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return dbFailure("deleteRentalDocument", error, "No se pudo borrar el documento.");
  if (!data) return { ok: false, error: "No encontramos el documento." };
  const doc = data as RentalDocument;
  const { error: rmErr } = await ctx.admin.storage.from(BUCKET).remove([doc.file_path]);
  if (rmErr) logRentalsError("deleteRentalDocument.storage", rmErr);
  if (doc.contract_id || doc.property_id) {
    await logRentalEvent(ctx.admin, {
      organizationId: ctx.organization.id,
      contractId: doc.contract_id,
      propertyId: doc.property_id,
      type: "document_deleted",
      summary: `Se borró «${doc.title}» (${DOCUMENT_KIND_LABEL[doc.kind]})`,
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
  }
  revalidateDoc(doc);
  return { ok: true };
}
