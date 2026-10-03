"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { round2 } from "@/lib/finance/booking-economics";
import { parseAmountInput } from "@/lib/format";
import { RECEIPT_MIME_EXT, sniffReceiptMime } from "@/lib/marketplace/reservation-view";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import { propertyAddress, SERVICE_KIND_META } from "@/lib/rentals/labels";
import { monthOf } from "@/lib/rentals/ymd";
import { dbFailure, logRentalsError, rentalsContext, type ActionResult, type AdminClient } from "@/lib/rentals/server/access";
import { logRentalEvent } from "@/lib/rentals/server/contract-sync";
import { expectedProofKindsIn, proofMonthRange, proofsTrackedFrom } from "@/lib/rentals/server/portal-queries";
import { withContinuationFlags } from "@/lib/rentals/server/continuation";
import { portalPathOf } from "@/lib/rentals/server/contracts";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { sendGuestMail } from "@/lib/email/guest";
import type { RentalContract, RentalProof, RentalServiceKind } from "@/lib/types/database";
import {
  buildProofGrid,
  lastMonths,
  missingKindsOf,
  monthInSentence,
  proofRequestMessage,
} from "@/components/rentals/proofs/proof-helpers";
import { proofRejectedEmail } from "@/components/rentals/proofs/proof-email";
import type {
  ContractProofGridData,
  MissingProofContract,
  PaymentReportItem,
  ProofContractRef,
  ProofItem,
  ProofKey,
  ProofsBoardData,
} from "@/components/rentals/proofs/proof-types";

/**
 * Comprobantes de expensas y servicios (panel): cola de validación, lo que
 * falta en el mes, avisos de pago del portal y la grilla por contrato.
 *
 * Todo pasa por `rentalsContext` (sesión + org + módulo + permiso) y filtra
 * por organization_id: las escrituras van con service role. Los errores para
 * una persona se devuelven como valor (en producción Next.js pisa los throw).
 */

const BUCKET = "rental-docs";
const SIGNED_URL_TTL = 10 * 60;
/** Vercel corta el cuerpo de una Server Action en 4,5 MB (el bucket admite 15). */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

type ContractRow = Pick<
  RentalContract,
  | "id"
  | "organization_id"
  | "number"
  | "status"
  | "property_id"
  | "currency"
  | "portal_enabled"
  | "portal_token_hash"
  | "portal_token_version"
  | "expensas_payer"
  | "expensas_mode"
  | "services"
  | "start_date"
  | "end_date"
  | "billing_starts_on"
  | "terminated_at"
  | "created_at"
> & {
  /** 068f: se lee aparte y tolerante (withContinuationFlags), no en CONTRACT_COLS. */
  continuation_billing?: boolean;
};

const CONTRACT_COLS =
  "id, organization_id, number, status, property_id, currency, portal_enabled, portal_token_hash, portal_token_version, expensas_payer, expensas_mode, services, start_date, end_date, billing_starts_on, terminated_at, created_at";

const PROOF_COLS =
  "id, contract_id, kind, period, status, amount, currency, due_date, file_path, file_mime, file_name, file_size, uploaded_at, uploaded_via, reviewed_at, reviewed_by, rejection_reason, notes";

type ProofRow = Pick<
  RentalProof,
  | "id"
  | "contract_id"
  | "kind"
  | "period"
  | "status"
  | "amount"
  | "currency"
  | "due_date"
  | "file_path"
  | "file_mime"
  | "file_name"
  | "file_size"
  | "uploaded_at"
  | "uploaded_via"
  | "reviewed_at"
  | "reviewed_by"
  | "rejection_reason"
  | "notes"
>;

interface LoadedContract {
  ref: ProofContractRef;
  contract: ContractRow;
}

function absoluteUrl(path: string): string {
  // El env de Vercel llegó alguna vez con un salto de línea al final.
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

/** Contrato + propiedad + inquilino titular de cada id (4 lecturas, sin N+1). */
async function loadContracts(admin: AdminClient, orgId: string, ids: string[]): Promise<Map<string, LoadedContract>> {
  const out = new Map<string, LoadedContract>();
  const contractIds = unique(ids.filter(Boolean));
  if (!contractIds.length) return out;
  const { data: cData, error } = await admin
    .from("rental_contracts")
    .select(CONTRACT_COLS)
    .eq("organization_id", orgId)
    .in("id", contractIds);
  if (error) {
    logRentalsError("proofs:loadContracts", error);
    return out;
  }
  // Los meses de continuación (art. 1218) también piden comprobantes si se cobran.
  const contracts = await withContinuationFlags(admin, orgId, (cData ?? []) as unknown as ContractRow[]);
  const [{ data: pData }, { data: partyData }] = await Promise.all([
    admin
      .from("rental_properties")
      .select("id, code, street, street_number, floor, apartment, tower")
      .eq("organization_id", orgId)
      .in("id", unique(contracts.map((c) => c.property_id))),
    admin
      .from("rental_contract_parties")
      .select("contract_id, person_id, is_primary, sort_order")
      .eq("organization_id", orgId)
      .eq("role", "inquilino")
      .in("contract_id", contractIds),
  ]);
  type PartyRow = { contract_id: string; person_id: string; is_primary: boolean; sort_order: number };
  const parties = ((partyData ?? []) as PartyRow[]).sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order,
  );
  const titularOf = new Map<string, string>();
  for (const p of parties) if (!titularOf.has(p.contract_id)) titularOf.set(p.contract_id, p.person_id);
  const personIds = unique([...titularOf.values()]);
  const { data: peopleData } = personIds.length
    ? await admin.from("rental_people").select("id, full_name, phone, email").eq("organization_id", orgId).in("id", personIds)
    : { data: [] };
  type PersonRow = { id: string; full_name: string; phone: string | null; email: string | null };
  const people = new Map(((peopleData ?? []) as PersonRow[]).map((p) => [p.id, p]));
  type PropRow = { id: string; code: string; street: string; street_number: string | null; floor: string | null; apartment: string | null; tower: string | null };
  const props = new Map(((pData ?? []) as PropRow[]).map((p) => [p.id, p]));
  for (const c of contracts) {
    const prop = props.get(c.property_id);
    const person = people.get(titularOf.get(c.id) ?? "");
    out.set(c.id, {
      contract: c,
      ref: {
        contractId: c.id,
        contractNumber: c.number,
        contractStatus: c.status,
        propertyId: c.property_id,
        propertyCode: prop?.code ?? "",
        address: prop ? propertyAddress(prop) : "Propiedad",
        tenantName: person?.full_name ?? null,
        tenantWhatsapp: toWhatsappDigits(person?.phone),
        tenantEmail: person?.email ?? null,
        currency: c.currency,
        portalUrl: c.portal_enabled && c.portal_token_hash ? absoluteUrl(portalPathOf(c)) : null,
      },
    });
  }
  return out;
}

async function reviewerNames(admin: AdminClient, ids: (string | null)[]): Promise<Map<string, string>> {
  const userIds = unique(ids.filter((x): x is string => !!x));
  if (!userIds.length) return new Map();
  const { data } = await admin.from("user_profiles").select("user_id, full_name").in("user_id", userIds);
  return new Map(((data ?? []) as { user_id: string; full_name: string }[]).map((u) => [u.user_id, u.full_name]));
}

function toProofItem(row: ProofRow, ref: ProofContractRef, names: Map<string, string>): ProofItem {
  return {
    ...ref,
    id: row.id,
    kind: row.kind,
    period: row.period,
    status: row.status,
    amount: row.amount == null ? null : Number(row.amount),
    proofCurrency: row.currency,
    dueDate: row.due_date,
    hasFile: !!row.file_path,
    fileMime: row.file_mime,
    fileName: row.file_name,
    fileSize: row.file_size,
    uploadedAt: row.uploaded_at,
    uploadedVia: row.uploaded_via,
    reviewedAt: row.reviewed_at,
    reviewerName: row.reviewed_by ? names.get(row.reviewed_by) ?? "Alguien del equipo" : null,
    rejectionReason: row.rejection_reason,
    notes: row.notes,
  };
}

/** Saldo abierto (cargos pendientes o parciales) por contrato. */
async function openBalanceByContract(admin: AdminClient, orgId: string, contractIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!contractIds.length) return out;
  const { data, error } = await admin
    .from("rental_charges")
    .select("contract_id, subtotal, paid_amount")
    .eq("organization_id", orgId)
    .in("contract_id", unique(contractIds))
    .is("voided_at", null)
    .in("status", ["pendiente", "parcial"]);
  if (error) {
    logRentalsError("proofs:openBalance", error);
    return out;
  }
  for (const c of (data ?? []) as { contract_id: string; subtotal: number; paid_amount: number }[]) {
    out.set(c.contract_id, round2((out.get(c.contract_id) ?? 0) + Number(c.subtotal) - Number(c.paid_amount)));
  }
  return out;
}

type ReportRow = {
  id: string;
  contract_id: string;
  amount: number | null;
  currency: string | null;
  paid_on: string | null;
  receipt_path: string | null;
  receipt_mime: string | null;
  note: string | null;
  status: PaymentReportItem["status"];
  payment_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const REPORT_COLS = "id, contract_id, amount, currency, paid_on, receipt_path, receipt_mime, note, status, payment_id, reviewed_by, reviewed_at, created_at";

function toReportItem(row: ReportRow, ref: ProofContractRef, names: Map<string, string>, debt: number | null): PaymentReportItem {
  return {
    ...ref,
    id: row.id,
    amount: row.amount == null ? null : Number(row.amount),
    reportCurrency: row.currency,
    paidOn: row.paid_on,
    note: row.note,
    hasFile: !!row.receipt_path,
    fileMime: row.receipt_mime,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewerName: row.reviewed_by ? names.get(row.reviewed_by) ?? "Alguien del equipo" : null,
    paymentId: row.payment_id,
    debt,
  };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

/**
 * Todo lo que necesita la pantalla Comprobantes en una ida: cola para revisar,
 * revisados recientes, lo que falta en `month` (YYYY-MM-01, default el mes de
 * hoy), avisos de pago y el KPI "Expensas al día".
 */
export async function getProofsBoard(month?: string | null): Promise<ActionResult<{ data: ProofsBoardData }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  const m = month && /^\d{4}-\d{2}-01$/.test(month) ? month : monthOf(ctx.today);

  const [reviewRes, reviewedRes, monthRes, activeRes, reportsRes, resolvedRes] = await Promise.all([
    ctx.admin.from("rental_proofs").select(PROOF_COLS).eq("organization_id", orgId).eq("status", "en_revision")
      .order("uploaded_at", { ascending: false, nullsFirst: false }).limit(300),
    ctx.admin.from("rental_proofs").select(PROOF_COLS).eq("organization_id", orgId)
      .in("status", ["validado", "rechazado", "no_corresponde"]).gte("reviewed_at", daysAgoIso(60))
      .order("reviewed_at", { ascending: false }).limit(120),
    ctx.admin.from("rental_proofs").select("id, contract_id, kind, status, rejection_reason").eq("organization_id", orgId).eq("period", m),
    ctx.admin.from("rental_contracts").select(CONTRACT_COLS).eq("organization_id", orgId).eq("status", "vigente"),
    ctx.admin.from("rental_payment_reports").select(REPORT_COLS).eq("organization_id", orgId).eq("status", "pendiente")
      .order("created_at", { ascending: false }).limit(200),
    ctx.admin.from("rental_payment_reports").select(REPORT_COLS).eq("organization_id", orgId).neq("status", "pendiente")
      .gte("reviewed_at", daysAgoIso(30)).order("reviewed_at", { ascending: false }).limit(30),
  ]);
  const firstError = [reviewRes, reviewedRes, monthRes, activeRes, reportsRes, resolvedRes].find((x) => x.error)?.error;
  if (firstError) return dbFailure("getProofsBoard", firstError, "No se pudieron leer los comprobantes.");

  const review = (reviewRes.data ?? []) as unknown as ProofRow[];
  const reviewed = (reviewedRes.data ?? []) as unknown as ProofRow[];
  const monthProofs = (monthRes.data ?? []) as { id: string; contract_id: string; kind: string; status: RentalProof["status"]; rejection_reason: string | null }[];
  const active = await withContinuationFlags(ctx.admin, orgId, (activeRes.data ?? []) as unknown as ContractRow[]);
  const reports = [...((reportsRes.data ?? []) as ReportRow[]), ...((resolvedRes.data ?? []) as ReportRow[])];

  // Qué falta este mes: lo que pide cada contrato vigente menos lo que ya está.
  const proofsByContract = new Map<string, typeof monthProofs>();
  for (const p of monthProofs) proofsByContract.set(p.contract_id, [...(proofsByContract.get(p.contract_id) ?? []), p]);
  let expensasRequired = 0;
  let expensasValidated = 0;
  let expensasInReview = 0;
  const missingRaw: { contractId: string; kinds: ReturnType<typeof missingKindsOf> }[] = [];
  for (const c of active) {
    const expected = m >= proofsTrackedFrom(c) ? expectedProofKindsIn(c, m) : [];
    const rows = proofsByContract.get(c.id) ?? [];
    if (expected.includes("expensas")) {
      expensasRequired++;
      const ex = rows.find((p) => p.kind === "expensas");
      if (ex?.status === "validado" || ex?.status === "no_corresponde") expensasValidated++;
      else if (ex?.status === "en_revision") expensasInReview++;
    }
    const kinds = missingKindsOf(expected, rows);
    if (kinds.length) missingRaw.push({ contractId: c.id, kinds });
  }

  const contractIds = [
    ...review.map((p) => p.contract_id),
    ...reviewed.map((p) => p.contract_id),
    ...missingRaw.map((x) => x.contractId),
    ...reports.map((x) => x.contract_id),
  ];
  const [loaded, names, balances] = await Promise.all([
    loadContracts(ctx.admin, orgId, contractIds),
    reviewerNames(ctx.admin, [...reviewed.map((p) => p.reviewed_by), ...reports.map((x) => x.reviewed_by)]),
    openBalanceByContract(ctx.admin, orgId, reports.filter((x) => x.status === "pendiente").map((x) => x.contract_id)),
  ]);
  const items = (rows: ProofRow[]) =>
    rows.flatMap((row) => {
      const l = loaded.get(row.contract_id);
      return l ? [toProofItem(row, l.ref, names)] : [];
    });

  const missing: MissingProofContract[] = missingRaw.flatMap(({ contractId, kinds }) => {
    const l = loaded.get(contractId);
    if (!l) return [];
    const whatsappText = proofRequestMessage({
      tenantName: l.ref.tenantName,
      orgName: ctx.organization.name,
      kinds: kinds.map((k) => k.kind),
      month: m,
      address: l.ref.address,
      portalUrl: l.ref.portalUrl,
    });
    return [{ ...l.ref, month: m, kinds, whatsappText }];
  });
  missing.sort((a, b) => (a.tenantName ?? a.address).localeCompare(b.tenantName ?? b.address, "es"));

  return {
    ok: true,
    data: {
      month: m,
      today: ctx.today,
      orgName: ctx.organization.name,
      review: items(review),
      reviewed: items(reviewed),
      missing,
      reports: reports.flatMap((row) => {
        const l = loaded.get(row.contract_id);
        return l ? [toReportItem(row, l.ref, names, row.status === "pendiente" ? balances.get(row.contract_id) ?? 0 : null)] : [];
      }),
      kpi: {
        month: m,
        expensasRequired,
        expensasValidated,
        expensasInReview,
        missingCount: missing.reduce((s, x) => s + x.kinds.length, 0),
        contractsWithMissing: missing.length,
      },
    },
  };
}

const queueSchema = z.object({
  status: z.enum(["pendiente", "en_revision", "validado", "rechazado", "no_corresponde"]).default("en_revision"),
  month: z.string().regex(/^\d{4}-\d{2}-01$/).nullable().optional(),
  kind: z.enum(["expensas", "luz", "gas", "agua", "municipal", "inmobiliario", "internet", "seguro", "otro"]).nullable().optional(),
});

/** Comprobantes por estado (y opcionalmente mes / tipo), los más recientes primero. */
export async function listProofQueue(input: {
  status?: RentalProof["status"];
  month?: string | null;
  kind?: RentalServiceKind | null;
} = {}): Promise<ActionResult<{ items: ProofItem[] }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = queueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Filtro inválido." };
  const { status, month, kind } = parsed.data;
  let q = ctx.admin.from("rental_proofs").select(PROOF_COLS).eq("organization_id", ctx.organization.id).eq("status", status);
  if (month) q = q.eq("period", month);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q
    .order(status === "en_revision" ? "uploaded_at" : "updated_at", { ascending: false, nullsFirst: false })
    .limit(300);
  if (error) return dbFailure("listProofQueue", error, "No se pudieron leer los comprobantes.");
  const rows = (data ?? []) as unknown as ProofRow[];
  const [loaded, names] = await Promise.all([
    loadContracts(ctx.admin, ctx.organization.id, rows.map((p) => p.contract_id)),
    reviewerNames(ctx.admin, rows.map((p) => p.reviewed_by)),
  ]);
  return {
    ok: true,
    items: rows.flatMap((row) => {
      const l = loaded.get(row.contract_id);
      return l ? [toProofItem(row, l.ref, names)] : [];
    }),
  };
}

/** Avisos de pago del portal por estado (pendiente por defecto). */
export async function listPaymentReports(
  status: PaymentReportItem["status"] = "pendiente",
): Promise<ActionResult<{ items: PaymentReportItem[] }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!["pendiente", "registrado", "descartado"].includes(status)) return { ok: false, error: "Estado inválido." };
  const { data, error } = await ctx.admin
    .from("rental_payment_reports")
    .select(REPORT_COLS)
    .eq("organization_id", ctx.organization.id)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return dbFailure("listPaymentReports", error, "No se pudieron leer los avisos de pago.");
  const rows = (data ?? []) as ReportRow[];
  const ids = rows.map((x) => x.contract_id);
  const [loaded, names, balances] = await Promise.all([
    loadContracts(ctx.admin, ctx.organization.id, ids),
    reviewerNames(ctx.admin, rows.map((x) => x.reviewed_by)),
    status === "pendiente" ? openBalanceByContract(ctx.admin, ctx.organization.id, ids) : Promise.resolve(new Map<string, number>()),
  ]);
  return {
    ok: true,
    items: rows.flatMap((row) => {
      const l = loaded.get(row.contract_id);
      return l ? [toReportItem(row, l.ref, names, status === "pendiente" ? balances.get(row.contract_id) ?? 0 : null)] : [];
    }),
  };
}

/** Grilla meses × tipos de un contrato: los últimos 6 meses y el actual. */
export async function getContractProofGrid(contractId: string): Promise<ActionResult<{ data: ContractProofGridData }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!z.string().uuid().safeParse(contractId).success) return { ok: false, error: "No encontramos el contrato." };
  const loaded = await loadContracts(ctx.admin, ctx.organization.id, [contractId]);
  const l = loaded.get(contractId);
  if (!l) return { ok: false, error: "No encontramos el contrato." };
  const months = lastMonths(ctx.today, 6);
  const { data, error } = await ctx.admin
    .from("rental_proofs")
    .select(PROOF_COLS)
    .eq("organization_id", ctx.organization.id)
    .eq("contract_id", contractId)
    .gte("period", months[0])
    .lte("period", months[months.length - 1]);
  if (error) return dbFailure("getContractProofGrid", error, "No se pudieron leer los comprobantes del contrato.");
  const rows = (data ?? []) as unknown as ProofRow[];
  const names = await reviewerNames(ctx.admin, rows.map((p) => p.reviewed_by));
  const range = proofMonthRange(l.contract);
  const expectedByMonth: Record<string, string[]> = {};
  const inRangeByMonth: Record<string, boolean> = {};
  for (const m of months) {
    inRangeByMonth[m] = !!range && m >= range.from && m <= range.to;
    expectedByMonth[m] = m >= proofsTrackedFrom(l.contract) ? expectedProofKindsIn(l.contract, m) : [];
  }
  const proofs = rows.map((row) => toProofItem(row, l.ref, names));
  const gridRows = buildProofGrid({ months, expectedByMonth, inRangeByMonth, proofs });
  const expensasRow = gridRows.find((row) => row.kind === "expensas");
  const expensasExpected = expensasRow?.cells.filter((c) => c.expected || c.proof).length ?? 0;
  const expensasOk = expensasRow?.cells.filter((c) => c.state === "validado" || c.state === "no_corresponde").length ?? 0;
  return {
    ok: true,
    data: {
      contract: l.ref,
      today: ctx.today,
      orgName: ctx.organization.name,
      months,
      rows: gridRows,
      expensasOk,
      expensasExpected,
      pendingReview: proofs.filter((p) => p.status === "en_revision").length,
    },
  };
}

// ─── Revisar ────────────────────────────────────────────────────────────────

function proofLabel(kind: string, period: string): string {
  const label = SERVICE_KIND_META[kind as RentalServiceKind]?.label ?? "comprobante";
  return `${label.toLowerCase()} de ${monthInSentence(monthOf(period))}`;
}

async function loadProof(admin: AdminClient, orgId: string, id: string): Promise<ProofRow | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await admin.from("rental_proofs").select(PROOF_COLS).eq("id", id).eq("organization_id", orgId).maybeSingle();
  return (data as unknown as ProofRow | null) ?? null;
}

const reviewSchema = z.object({
  decision: z.enum(["validado", "rechazado"]),
  reason: z.string().trim().max(500, "El motivo puede tener hasta 500 caracteres.").optional().nullable(),
  amount: z.number().min(0, "El importe no puede ser negativo.").max(1_000_000_000).nullable().optional(),
  notifyTenant: z.boolean().optional(),
});

/** Mail al inquilino con el motivo del rechazo y su link (best-effort: nunca rompe la revisión). */
async function mailRejection(ctx: { admin: AdminClient; organization: { id: string; name: string; primary_color: string | null } }, proof: ProofRow, reason: string): Promise<boolean> {
  try {
    const l = (await loadContracts(ctx.admin, ctx.organization.id, [proof.contract_id])).get(proof.contract_id);
    if (!l?.ref.tenantEmail) return false;
    const mail = proofRejectedEmail({
      orgName: ctx.organization.name,
      brandColor: ctx.organization.primary_color,
      tenantName: l.ref.tenantName,
      kind: proof.kind,
      period: proof.period,
      address: l.ref.address,
      reason,
      portalUrl: l.ref.portalUrl,
    });
    const res = await sendGuestMail({ organizationId: ctx.organization.id, to: l.ref.tenantEmail, ...mail });
    if (!res.ok) logRentalsError("reviewProof:mail", res.error);
    return res.ok;
  } catch (e) {
    logRentalsError("reviewProof:mail", e);
    return false;
  }
}

/**
 * Validar o rechazar un comprobante. El rechazo exige motivo: el inquilino lo
 * lee en su link (y por mail si `notifyTenant` y tiene mail cargado).
 */
export async function reviewProof(
  id: string,
  input: { decision: "validado" | "rechazado"; reason?: string | null; amount?: number | null; notifyTenant?: boolean },
): Promise<ActionResult<{ status: RentalProof["status"]; emailed: boolean }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  const { decision, amount } = parsed.data;
  const reason = parsed.data.reason?.trim() || null;
  if (decision === "rechazado" && !reason) {
    return { ok: false, error: "Contá por qué lo rechazás: el inquilino lo ve en su link.", field: "reason" };
  }
  const proof = await loadProof(ctx.admin, ctx.organization.id, id);
  if (!proof) return { ok: false, error: "No encontramos el comprobante." };

  const patch: Record<string, unknown> = {
    status: decision,
    reviewed_at: new Date().toISOString(),
    reviewed_by: ctx.session.userId,
    rejection_reason: decision === "rechazado" ? reason : null,
  };
  if (amount !== undefined) patch.amount = amount == null ? null : round2(amount);
  const { error } = await ctx.admin.from("rental_proofs").update(patch).eq("id", proof.id).eq("organization_id", ctx.organization.id);
  if (error) return dbFailure("reviewProof", error, "No se pudo guardar la revisión.");

  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: proof.contract_id,
    type: decision === "validado" ? "proof_validated" : "proof_rejected",
    summary:
      decision === "validado"
        ? `Validó el comprobante de ${proofLabel(proof.kind, proof.period)}`
        : `Rechazó el comprobante de ${proofLabel(proof.kind, proof.period)}: ${reason}`,
    payload: { proofId: proof.id, kind: proof.kind, period: proof.period, amount: patch.amount ?? proof.amount, reason },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  const emailed = decision === "rechazado" && parsed.data.notifyTenant && reason ? await mailRejection(ctx, proof, reason) : false;
  revalidateRentals({ contractId: proof.contract_id });
  return { ok: true, status: decision, emailed };
}

/** Deshacer una revisión: vuelve a "para revisar" (o a "falta" si no tiene archivo). */
export async function reopenProof(id: string): Promise<ActionResult<{ status: RentalProof["status"] }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const proof = await loadProof(ctx.admin, ctx.organization.id, id);
  if (!proof) return { ok: false, error: "No encontramos el comprobante." };
  const status: RentalProof["status"] = proof.file_path ? "en_revision" : "pendiente";
  const { error } = await ctx.admin
    .from("rental_proofs")
    .update({ status, reviewed_at: null, reviewed_by: null, rejection_reason: null })
    .eq("id", proof.id)
    .eq("organization_id", ctx.organization.id);
  if (error) return dbFailure("reopenProof", error, "No se pudo deshacer.");
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: proof.contract_id,
    type: "proof_reopened",
    summary: `Volvió a abrir el comprobante de ${proofLabel(proof.kind, proof.period)}`,
    payload: { proofId: proof.id, previous: proof.status },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId: proof.contract_id });
  return { ok: true, status };
}

const keySchema = z.object({
  contractId: z.string().uuid("Contrato inválido."),
  kind: z.enum(["expensas", "luz", "gas", "agua", "municipal", "inmobiliario", "internet", "seguro", "otro"]),
  period: z.string().regex(/^\d{4}-\d{2}-01$/, "Mes inválido."),
});

/**
 * "No corresponde" (ese mes no hubo factura, la paga el propietario…). Acepta
 * el id de la fila o la clave contrato + tipo + mes cuando el cron todavía no
 * creó la fila.
 */
export async function markProofNotApplicable(target: string | ProofKey, note?: string | null): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  const cleanNote = note?.trim().slice(0, 500) || null;
  const reviewed = { status: "no_corresponde", reviewed_at: new Date().toISOString(), reviewed_by: ctx.session.userId, rejection_reason: null };
  let contractId: string;
  let kind: string;
  let period: string;
  if (typeof target === "string") {
    const proof = await loadProof(ctx.admin, orgId, target);
    if (!proof) return { ok: false, error: "No encontramos el comprobante." };
    const { error } = await ctx.admin
      .from("rental_proofs")
      .update({ ...reviewed, ...(cleanNote ? { notes: cleanNote } : {}) })
      .eq("id", proof.id)
      .eq("organization_id", orgId);
    if (error) return dbFailure("markProofNotApplicable", error, "No se pudo marcar.");
    ({ contract_id: contractId, kind, period } = proof);
  } else {
    const parsed = keySchema.safeParse(target);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
    ({ contractId, kind, period } = parsed.data);
    const { data: c } = await ctx.admin.from("rental_contracts").select("id").eq("id", contractId).eq("organization_id", orgId).maybeSingle();
    if (!c) return { ok: false, error: "No encontramos el contrato." };
    const { error } = await ctx.admin
      .from("rental_proofs")
      .upsert(
        { organization_id: orgId, contract_id: contractId, kind, period, ...reviewed, notes: cleanNote },
        { onConflict: "contract_id,kind,period" },
      );
    if (error) return dbFailure("markProofNotApplicable:upsert", error, "No se pudo marcar.");
  }
  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    contractId,
    type: "proof_not_applicable",
    summary: `Marcó que no corresponde el comprobante de ${proofLabel(kind, period)}${cleanNote ? `: ${cleanNote}` : ""}`,
    payload: { kind, period, note: cleanNote },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId });
  return { ok: true };
}

// ─── Archivos ───────────────────────────────────────────────────────────────

const formText = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

function isUploadedFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function" && (v as Blob).size > 0;
}

function safeFileName(name: string | null | undefined, ext: string): string {
  const base = (name ?? "").replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 120);
  return base || `comprobante.${ext}`;
}

/**
 * "Subir yo": alguien del equipo carga el comprobante que le mandaron por otro
 * lado (WhatsApp, mail, en mano). Si marca "Ya lo revisé" queda validado.
 *
 * FormData: contractId, kind, period (YYYY-MM-01), file (≤ 4 MB, imagen o PDF),
 * amount (texto es-AR, opcional), validate ("1"), note (opcional).
 */
export async function uploadProofFromStaff(formData: FormData): Promise<ActionResult<{ proofId: string; status: RentalProof["status"] }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  const parsed = keySchema.safeParse({
    contractId: formText(formData.get("contractId")),
    kind: formText(formData.get("kind")),
    period: formText(formData.get("period")),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  const { contractId, kind, period } = parsed.data;
  if (period > monthOf(ctx.today)) return { ok: false, error: "No se pueden cargar comprobantes de meses que todavía no empezaron.", field: "period" };

  const amountText = formText(formData.get("amount")).trim();
  const amount = amountText ? parseAmountInput(amountText) : null;
  if (amountText && (amount == null || amount < 0)) return { ok: false, error: "Revisá el importe.", field: "amount" };
  const validate = formText(formData.get("validate")) === "1";
  const note = formText(formData.get("note")).trim().slice(0, 500) || null;

  const file = formData.get("file");
  if (!isUploadedFile(file)) return { ok: false, error: "Elegí el archivo del comprobante.", field: "file" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "El archivo pesa más de 4 MB. Probá con una foto o un PDF más liviano.", field: "file" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffReceiptMime(bytes);
  if (!mime) return { ok: false, error: "Tiene que ser una imagen (JPG, PNG, WEBP o HEIC) o un PDF.", field: "file" };

  const { data: c } = await ctx.admin.from("rental_contracts").select("id, currency").eq("id", contractId).eq("organization_id", orgId).maybeSingle();
  if (!c) return { ok: false, error: "No encontramos el contrato." };
  const { data: existing } = await ctx.admin
    .from("rental_proofs")
    .select("id, file_path")
    .eq("organization_id", orgId)
    .eq("contract_id", contractId)
    .eq("kind", kind)
    .eq("period", period)
    .maybeSingle();

  const ext = RECEIPT_MIME_EXT[mime] ?? "bin";
  const path = `${orgId}/proofs/${contractId}/${randomUUID()}.${ext}`;
  const { error: upErr } = await ctx.admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) {
    logRentalsError("uploadProofFromStaff:storage", upErr);
    return { ok: false, error: "No se pudo subir el archivo. Probá de nuevo." };
  }
  const now = new Date().toISOString();
  const status: RentalProof["status"] = validate ? "validado" : "en_revision";
  const { data: saved, error } = await ctx.admin
    .from("rental_proofs")
    .upsert(
      {
        organization_id: orgId,
        contract_id: contractId,
        kind,
        period,
        status,
        amount: amount == null ? null : round2(amount),
        currency: c.currency,
        file_path: path,
        file_mime: mime,
        file_name: safeFileName(file.name, ext),
        file_size: bytes.byteLength,
        uploaded_at: now,
        uploaded_via: "staff",
        uploaded_by: ctx.session.userId,
        reviewed_at: validate ? now : null,
        reviewed_by: validate ? ctx.session.userId : null,
        rejection_reason: null,
        ...(note ? { notes: note } : {}),
      },
      { onConflict: "contract_id,kind,period" },
    )
    .select("id")
    .single();
  if (error || !saved) {
    await ctx.admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return dbFailure("uploadProofFromStaff", error, "No se pudo guardar el comprobante.");
  }
  const oldPath = (existing as { file_path: string | null } | null)?.file_path;
  if (oldPath && oldPath !== path) await ctx.admin.storage.from(BUCKET).remove([oldPath]).catch(() => undefined);

  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    contractId,
    type: "proof_uploaded",
    summary: `Cargó el comprobante de ${proofLabel(kind, period)}${validate ? " y lo validó" : ""}`,
    payload: { proofId: saved.id, kind, period, amount, via: "staff" },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId });
  return { ok: true, proofId: saved.id as string, status };
}

async function signedUrl(admin: AdminClient, path: string): Promise<string | null> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) {
    logRentalsError("proofs:signedUrl", error);
    return null;
  }
  return data.signedUrl;
}

/** URL firmada (10 min) para ver el archivo de un comprobante. */
export async function getProofFileUrl(id: string): Promise<ActionResult<{ url: string; mime: string | null; name: string | null }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const proof = await loadProof(ctx.admin, ctx.organization.id, id);
  if (!proof?.file_path) return { ok: false, error: "Este comprobante no tiene archivo." };
  const url = await signedUrl(ctx.admin, proof.file_path);
  if (!url) return { ok: false, error: "No se pudo abrir el archivo. Probá de nuevo." };
  return { ok: true, url, mime: proof.file_mime, name: proof.file_name };
}

/** URL firmada (10 min) del comprobante adjunto a un aviso de pago. */
export async function getPaymentReportFileUrl(id: string): Promise<ActionResult<{ url: string; mime: string | null }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos el aviso." };
  const { data } = await ctx.admin
    .from("rental_payment_reports")
    .select("receipt_path, receipt_mime")
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const row = data as { receipt_path: string | null; receipt_mime: string | null } | null;
  if (!row?.receipt_path) return { ok: false, error: "Este aviso no trae comprobante." };
  const url = await signedUrl(ctx.admin, row.receipt_path);
  if (!url) return { ok: false, error: "No se pudo abrir el archivo. Probá de nuevo." };
  return { ok: true, url, mime: row.receipt_mime };
}

/** Descartar un aviso de pago (no entró la plata, está repetido…). El motivo queda en el historial. */
export async function discardPaymentReport(id: string, reason: string): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const why = (reason ?? "").trim();
  if (why.length < 3) return { ok: false, error: "Contá brevemente por qué lo descartás.", field: "reason" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos el aviso." };
  const { data, error } = await ctx.admin
    .from("rental_payment_reports")
    .update({ status: "descartado", reviewed_by: ctx.session.userId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "pendiente")
    .select("id, contract_id, amount, currency, paid_on")
    .maybeSingle();
  if (error) return dbFailure("discardPaymentReport", error, "No se pudo descartar el aviso.");
  if (!data) return { ok: false, error: "Ese aviso ya no está pendiente (alguien lo resolvió)." };
  const row = data as { id: string; contract_id: string; amount: number | null; currency: string | null; paid_on: string | null };
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: row.contract_id,
    type: "payment_report_discarded",
    summary: `Descartó un aviso de pago${row.paid_on ? ` del ${row.paid_on.split("-").reverse().join("/")}` : ""}: ${why.slice(0, 300)}`,
    payload: { reportId: row.id, amount: row.amount, currency: row.currency, reason: why.slice(0, 500) },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId: row.contract_id });
  return { ok: true };
}
