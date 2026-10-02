"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { round2 } from "@/lib/finance/booking-economics";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { RECEIPT_MIME_EXT, sniffReceiptMime } from "@/lib/marketplace/reservation-view";
import { notifyOrg } from "@/lib/actions/notifications";
import type { RentalReceiptData } from "@/lib/pdf/rental-receipt-pdf";
import { SERVICE_KIND_META, propertyAddress } from "@/lib/rentals/labels";
import { addDays, isYmd, monthOf } from "@/lib/rentals/ymd";
import { logRentalsError, type AdminClient } from "@/lib/rentals/server/access";
import { loadReceiptData } from "@/lib/rentals/server/collections-queries";
import { logRentalEvent } from "@/lib/rentals/server/contract-sync";
import {
  expectedProofKindsIn,
  loadTenantPortal,
  MAX_PENDING_TENANT_REPORTS,
  portalUploadsOpen,
  proofMonthRange,
  resolvePortalToken,
  type PortalContext,
} from "@/lib/rentals/server/portal-queries";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { createAdminClient } from "@/lib/supabase/server";
import type { RentalContract } from "@/lib/types/database";
import { isProofKind, monthInSentence } from "@/components/rentals/proofs/proof-helpers";
import type { TenantPortalView } from "@/components/rentals/portal/portal-types";

/**
 * Portal del inquilino (`/inquilino/<token>`): SIN sesión. Cada acción valida
 * el token (hash → fila, HMAC → confirma contrato y versión) y sólo toca ESE
 * contrato. Las que escriben tienen rate limit (fail-open, como el seguimiento
 * de reservas) y suben archivos por FormData con el tipo verificado por magic
 * bytes; si falla la fila, se borra el archivo subido.
 */

type PortalResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

const BUCKET = "rental-docs";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const NOT_FOUND = "Este link ya no funciona. Pedile uno nuevo a la inmobiliaria.";
const GENERIC = "No pudimos guardarlo. Probá de nuevo en un rato.";
const TOO_MANY = "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
const FILE_TOO_BIG = "El archivo pesa más de 4 MB. Mandá una foto o una captura.";
const BAD_FILE = "Tiene que ser una foto (JPG, PNG o HEIC) o un PDF.";

const formText = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

function isUploadedFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function" && (v as Blob).size > 0;
}

/** IP real del cliente (Vercel la pone en x-forwarded-for). */
async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  } catch {
    return "unknown";
  }
}

/** Rate limit best-effort y FAIL-OPEN (mismo RPC que el login y el seguimiento de reservas). */
async function allowAttempt(bucket: string, max: number, windowSecs: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hit_auth_rate_limit", { p_bucket: bucket, p_max: max, p_window_secs: windowSecs });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

async function resolve(token: string): Promise<PortalContext | null | "error"> {
  try {
    return await resolvePortalToken(token);
  } catch (e) {
    logRentalsError("portal:resolve", e);
    return "error";
  }
}

/** Nombre del inquilino titular y dirección (para el historial y el aviso al equipo). */
async function whoAndWhere(admin: AdminClient, c: RentalContract): Promise<{ tenant: string; address: string }> {
  const [{ data: party }, { data: prop }] = await Promise.all([
    admin
      .from("rental_contract_parties")
      .select("person_id")
      .eq("organization_id", c.organization_id)
      .eq("contract_id", c.id)
      .eq("role", "inquilino")
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(1),
    admin
      .from("rental_properties")
      .select("street, street_number, floor, apartment, tower")
      .eq("organization_id", c.organization_id)
      .eq("id", c.property_id)
      .maybeSingle(),
  ]);
  const personId = (party?.[0] as { person_id: string } | undefined)?.person_id;
  const { data: person } = personId
    ? await admin.from("rental_people").select("full_name").eq("organization_id", c.organization_id).eq("id", personId).maybeSingle()
    : { data: null };
  return {
    tenant: (person as { full_name: string } | null)?.full_name ?? "El inquilino",
    address: prop ? propertyAddress(prop as Parameters<typeof propertyAddress>[0]) : "su propiedad",
  };
}

async function readUpload(file: FormDataEntryValue | null): Promise<{ bytes: Uint8Array; mime: string; name: string } | { error: string }> {
  if (!isUploadedFile(file)) return { error: "Elegí la foto o el PDF del comprobante." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: FILE_TOO_BIG };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffReceiptMime(bytes);
  if (!mime) return { error: BAD_FILE };
  return { bytes, mime, name: (file.name || "").replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 120) };
}

// ─── Lectura ────────────────────────────────────────────────────────────────

/** Vista del portal. null = link inválido, regenerado o apagado (la página muestra su not-found). */
export async function getTenantPortal(token: string): Promise<TenantPortalView | null> {
  const pc = await resolvePortalToken(token);
  if (!pc) return null;
  return loadTenantPortal(pc, { receiptsAvailable: true });
}

/** Datos del recibo para bajarlo en PDF desde el portal (sólo pagos de ESTE contrato). */
export async function getTenantReceiptData(token: string, paymentId: string): Promise<PortalResult<{ data: RentalReceiptData }>> {
  const pc = await resolve(token);
  if (pc === "error") return { ok: false, error: "No pudimos armar el recibo. Probá de nuevo en un rato." };
  if (!pc) return { ok: false, error: NOT_FOUND };
  if (!z.string().uuid().safeParse(paymentId).success) return { ok: false, error: "No encontramos ese pago." };
  try {
    const data = await loadReceiptData(pc.admin, pc.contract.organization_id, paymentId, pc.today);
    if (!data || data.contract.id !== pc.contract.id || data.receipt.voided) return { ok: false, error: "No encontramos ese pago." };
    // La cuenta de Caja donde entró la plata es un dato interno de la inmobiliaria.
    return { ok: true, data: { ...data, receipt: { ...data.receipt, accountName: null } } };
  } catch (e) {
    logRentalsError("portal:receipt", e);
    return { ok: false, error: "No pudimos armar el recibo. Probá de nuevo en un rato." };
  }
}

// ─── Escrituras ─────────────────────────────────────────────────────────────

/**
 * El inquilino sube el comprobante de un servicio de un mes. Queda "para
 * revisar" y le avisa al equipo. Si ya había uno en revisión o rechazado, lo
 * reemplaza (manda una foto mejor). FormData: token, kind, period (YYYY-MM-01),
 * file (≤ 4 MB), amount (opcional, texto es-AR).
 */
export async function uploadTenantProof(formData: FormData): Promise<PortalResult> {
  if (!(formData instanceof FormData)) return { ok: false, error: GENERIC };
  const ip = await clientIp();
  if (ip !== "unknown" && !(await allowAttempt(`rental-proof:ip:${ip}`, 20, 60 * 60))) return { ok: false, error: TOO_MANY };
  const pc = await resolve(formText(formData.get("token")));
  if (pc === "error") return { ok: false, error: GENERIC };
  if (!pc) return { ok: false, error: NOT_FOUND };
  const { admin, contract: c, today } = pc;
  const orgId = c.organization_id;
  if (!portalUploadsOpen(c, today)) {
    return { ok: false, error: "Tu contrato ya terminó. Si te falta mandar algo, escribile a la inmobiliaria." };
  }
  if (!(await allowAttempt(`rental-proof:contract:${c.id}`, 40, 24 * 60 * 60))) return { ok: false, error: TOO_MANY };

  const kind = formText(formData.get("kind"));
  if (!isProofKind(kind)) return { ok: false, error: "Elegí qué comprobante es.", field: "kind" };
  const period = formText(formData.get("period"));
  const range = proofMonthRange(c);
  if (!/^\d{4}-\d{2}-01$/.test(period) || !range || period < range.from || period > range.to || period > monthOf(today)) {
    return { ok: false, error: "Ese mes no corresponde a tu contrato.", field: "period" };
  }
  if (period < monthOf(addDays(today, -400))) return { ok: false, error: "Ese mes es muy viejo. Escribile a la inmobiliaria.", field: "period" };
  const amountText = formText(formData.get("amount")).trim();
  const amount = amountText ? parseAmountInput(amountText) : null;
  if (amountText && (amount == null || amount < 0 || amount > 1_000_000_000)) return { ok: false, error: "Revisá el importe.", field: "amount" };

  const { data: existingData, error: exErr } = await admin
    .from("rental_proofs")
    .select("id, status, file_path")
    .eq("organization_id", orgId)
    .eq("contract_id", c.id)
    .eq("kind", kind)
    .eq("period", period)
    .maybeSingle();
  if (exErr) return { ok: false, error: GENERIC };
  const existing = existingData as { id: string; status: string; file_path: string | null } | null;
  if (existing?.status === "validado") return { ok: false, error: "Ese comprobante ya está validado. ¡Gracias!" };
  if (existing?.status === "no_corresponde") return { ok: false, error: "Ese comprobante no hace falta ese mes." };
  if (!existing && !expectedProofKindsIn(c, period).includes(kind)) {
    return { ok: false, error: "Ese comprobante no se pide ese mes. Si querés mandarlo igual, escribile a la inmobiliaria." };
  }

  const file = await readUpload(formData.get("file"));
  if ("error" in file) return { ok: false, error: file.error, field: "file" };
  const ext = RECEIPT_MIME_EXT[file.mime] ?? "bin";
  const path = `${orgId}/proofs/${c.id}/${randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file.bytes, { contentType: file.mime, upsert: false });
  if (upErr) {
    logRentalsError("portal:uploadProof:storage", upErr);
    return { ok: false, error: "No pudimos subir el archivo. Probá de nuevo o mandalo por WhatsApp." };
  }
  const { data: saved, error } = await admin
    .from("rental_proofs")
    .upsert(
      {
        organization_id: orgId,
        contract_id: c.id,
        kind,
        period,
        status: "en_revision",
        amount: amount == null ? null : round2(amount),
        currency: c.currency,
        file_path: path,
        file_mime: file.mime,
        file_name: file.name || `comprobante.${ext}`,
        file_size: file.bytes.byteLength,
        uploaded_at: new Date().toISOString(),
        uploaded_via: "portal",
        uploaded_by: null,
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null,
      },
      { onConflict: "contract_id,kind,period" },
    )
    .select("id")
    .single();
  if (error || !saved) {
    logRentalsError("portal:uploadProof", error);
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return { ok: false, error: GENERIC };
  }
  if (existing?.file_path && existing.file_path !== path) await admin.storage.from(BUCKET).remove([existing.file_path]).catch(() => undefined);

  const label = `${SERVICE_KIND_META[kind].label.toLowerCase()} de ${monthInSentence(period)}`;
  try {
    const { tenant, address } = await whoAndWhere(admin, c);
    await logRentalEvent(admin, {
      organizationId: orgId,
      contractId: c.id,
      type: "proof_uploaded",
      summary: `Subió el comprobante de ${label} desde su link`,
      payload: { proofId: saved.id, kind, period, amount, via: "portal" },
      actorName: `${tenant} (inquilino)`,
    });
    await notifyOrg(orgId, {
      type: "rental_proof",
      severity: "info",
      title: "Comprobante para revisar",
      body: `${tenant} subió ${label} · ${address}`,
      ref_type: "rental_proof",
      ref_id: saved.id as string,
      action_url: "/dashboard/alquileres/comprobantes",
      dedup_key: `rental_proof:${saved.id}:${Math.floor(Date.now() / 3_600_000)}`,
    });
  } catch (e) {
    logRentalsError("portal:uploadProof:notify", e);
  }
  revalidateRentals({ contractId: c.id });
  return { ok: true };
}

/**
 * "Ya pagué": el inquilino avisa una transferencia (monto, fecha y, si quiere,
 * el comprobante). NO es un cobro: queda un aviso pendiente que el equipo
 * verifica y registra con su recibo. FormData: token, amount (texto es-AR),
 * paidOn (YYYY-MM-DD), note (opcional), receipt (opcional, ≤ 4 MB).
 */
export async function reportTenantPayment(formData: FormData): Promise<PortalResult> {
  if (!(formData instanceof FormData)) return { ok: false, error: GENERIC };
  const ip = await clientIp();
  if (ip !== "unknown" && !(await allowAttempt(`rental-report:ip:${ip}`, 10, 60 * 60))) return { ok: false, error: TOO_MANY };
  const pc = await resolve(formText(formData.get("token")));
  if (pc === "error") return { ok: false, error: GENERIC };
  if (!pc) return { ok: false, error: NOT_FOUND };
  const { admin, contract: c, today } = pc;
  const orgId = c.organization_id;
  if (!portalUploadsOpen(c, today)) {
    return { ok: false, error: "Tu contrato ya terminó. Para avisar un pago, escribile a la inmobiliaria." };
  }

  const amount = parseAmountInput(formText(formData.get("amount")));
  if (amount == null || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    return { ok: false, error: "Indicá el monto que pagaste.", field: "amount" };
  }
  const paidOn = formText(formData.get("paidOn"));
  if (!isYmd(paidOn) || paidOn > today || paidOn < addDays(today, -120)) {
    return { ok: false, error: "Revisá la fecha del pago.", field: "paidOn" };
  }
  const note = formText(formData.get("note")).trim();
  if (note.length > 1000) return { ok: false, error: "La nota puede tener hasta 1000 caracteres.", field: "note" };

  const { count, error: cntErr } = await admin
    .from("rental_payment_reports")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("contract_id", c.id)
    .eq("status", "pendiente");
  if (cntErr) return { ok: false, error: GENERIC };
  if ((count ?? 0) >= MAX_PENDING_TENANT_REPORTS) {
    return { ok: false, error: `Ya tenemos ${MAX_PENDING_TENANT_REPORTS} avisos tuyos sin revisar. Esperá a que los veamos o escribinos.` };
  }

  let receiptPath: string | null = null;
  let receiptMime: string | null = null;
  const receipt = formData.get("receipt");
  if (isUploadedFile(receipt)) {
    const file = await readUpload(receipt);
    if ("error" in file) return { ok: false, error: file.error, field: "receipt" };
    const path = `${orgId}/payment-reports/${c.id}/${randomUUID()}.${RECEIPT_MIME_EXT[file.mime] ?? "bin"}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file.bytes, { contentType: file.mime, upsert: false });
    if (upErr) {
      logRentalsError("portal:report:storage", upErr);
      return { ok: false, error: "No pudimos subir el comprobante. Probá de nuevo o mandalo por WhatsApp." };
    }
    receiptPath = path;
    receiptMime = file.mime;
  }

  const { data: report, error } = await admin
    .from("rental_payment_reports")
    .insert({
      organization_id: orgId,
      contract_id: c.id,
      amount: round2(amount),
      currency: c.currency,
      paid_on: paidOn,
      receipt_path: receiptPath,
      receipt_mime: receiptMime,
      note: note || null,
      status: "pendiente",
    })
    .select("id")
    .single();
  if (error || !report) {
    logRentalsError("portal:report", error);
    if (receiptPath) await admin.storage.from(BUCKET).remove([receiptPath]).catch(() => undefined);
    return { ok: false, error: GENERIC };
  }

  try {
    const { tenant, address } = await whoAndWhere(admin, c);
    const when = paidOn.split("-").reverse().join("/");
    await logRentalEvent(admin, {
      organizationId: orgId,
      contractId: c.id,
      type: "payment_reported",
      summary: `Avisó un pago de ${formatMoney(round2(amount), c.currency)} del ${when} desde su link`,
      payload: { reportId: report.id, amount: round2(amount), paidOn, withReceipt: !!receiptPath },
      actorName: `${tenant} (inquilino)`,
    });
    await notifyOrg(orgId, {
      type: "rental_payment_report",
      severity: "info",
      title: `Aviso de pago de ${tenant}`,
      body: `Informó ${formatMoney(round2(amount), c.currency)} pagados el ${when} · ${address}`,
      ref_type: "rental_payment_report",
      ref_id: report.id as string,
      action_url: "/dashboard/alquileres/comprobantes?tab=avisos",
      dedup_key: `rental_payment_report:${report.id}`,
    });
  } catch (e) {
    logRentalsError("portal:report:notify", e);
  }
  revalidateRentals({ contractId: c.id });
  return { ok: true };
}
