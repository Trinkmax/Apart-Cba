import "server-only";
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz } from "@/lib/dates";
import { round2 } from "@/lib/finance/booking-economics";
import { formatMoney } from "@/lib/format";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import { INDEX_META } from "@/lib/rentals/indices";
import {
  CONTRACT_STATE_META,
  contractDisplayState,
  formatContractNumber,
  formatReceiptNumber,
  PAYMENT_METHOD_LABEL,
  propertyAddress,
} from "@/lib/rentals/labels";
import { hashRentalToken, isWellFormedRentalToken, rentalTokenMatches } from "@/lib/rentals/link-token";
import { addDays, monthOf } from "@/lib/rentals/ymd";
import { createAdminClient } from "@/lib/supabase/server";
import type { RentalContract, RentalLateFeeType, RentalPaymentMethod, RentalProof } from "@/lib/types/database";
import { isProofKind, lastMonths, sortKinds } from "@/components/rentals/proofs/proof-helpers";
import {
  adjustmentExplanation,
  adjustmentSummary,
  formatPctAr,
  INDEX_PLAIN,
} from "@/components/rentals/portal/portal-helpers";
import type {
  TenantPortalCharge,
  TenantPortalProof,
  TenantPortalProofMonth,
  TenantPortalView,
} from "@/components/rentals/portal/portal-types";
import type { AdminClient } from "./access";
import { expectedProofKinds } from "./contract-sync";
import { getRentalSettings } from "./contracts";
import { computePaymentPreview } from "./payments";

/**
 * Lecturas del portal del inquilino (`/inquilino/<token>`) y reglas que
 * comparten el portal y la pantalla Comprobantes del panel.
 *
 * El token se valida en dos pasos (como el link de reserva): el hash encuentra
 * la fila y el HMAC confirma que corresponde a ese contrato y versión. Todo lo
 * que sale de acá hacia la página pública está listado en TenantPortalView.
 */

const DEFAULT_BRAND = "#0F766E";
/** Avisos de pago sin revisar que puede tener un inquilino a la vez. */
export const MAX_PENDING_TENANT_REPORTS = 5;
/** Días después del fin en que el portal todavía deja subir cosas (última expensa, último pago). */
const UPLOADS_GRACE_DAYS = 90;

type RangeContract = Pick<RentalContract, "status" | "start_date" | "end_date" | "billing_starts_on" | "terminated_at">;

/** Meses que el contrato cobra (y en los que pide comprobantes): [from, to] en YYYY-MM-01. */
export function proofMonthRange(c: RangeContract): { from: string; to: string } | null {
  if (c.status === "borrador") return null;
  const end = c.terminated_at && c.terminated_at < c.end_date ? c.terminated_at : c.end_date;
  return { from: monthOf(c.billing_starts_on ?? c.start_date), to: monthOf(end) };
}

/** Tipos de comprobante que el contrato pide en un mes (vacío fuera del período). */
export function expectedProofKindsIn(
  c: RangeContract & Pick<RentalContract, "expensas_payer" | "expensas_mode" | "services">,
  month: string,
): string[] {
  const range = proofMonthRange(c);
  const m = monthOf(month);
  if (!range || m < range.from || m > range.to) return [];
  return expectedProofKinds(c as RentalContract, m).filter(isProofKind);
}

/**
 * Desde qué mes se controlan los comprobantes: el del alta del contrato en el
 * sistema. Los meses anteriores (contratos que ya venían corriendo) no se
 * reclaman como "faltan": nadie los pidió.
 */
export function proofsTrackedFrom(c: Pick<RentalContract, "created_at">): string {
  return monthOf((c.created_at ?? "").slice(0, 10) || "1970-01-01");
}

/** El portal deja subir comprobantes y avisar pagos mientras rige y hasta 90 días después. */
export function portalUploadsOpen(c: RangeContract, today: string): boolean {
  if (c.status === "vigente") return true;
  if (c.status === "borrador") return false;
  const end = c.terminated_at ?? c.end_date;
  return addDays(end, UPLOADS_GRACE_DAYS) >= today;
}

export interface PortalOrg {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  timezone: string | null;
}

export interface PortalContext {
  admin: AdminClient;
  contract: RentalContract;
  org: PortalOrg;
  today: string;
}

/** Token del link → contrato (con el portal encendido) + org. null = link inválido o apagado. */
export async function resolvePortalToken(token: string | null | undefined): Promise<PortalContext | null> {
  if (!isWellFormedRentalToken(token)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_contracts")
    .select("*")
    .eq("portal_token_hash", hashRentalToken(token))
    .maybeSingle();
  if (error) throw new Error("No se pudo leer el contrato.");
  const contract = data as RentalContract | null;
  if (!contract || !contract.portal_enabled || contract.status === "borrador") return null;
  if (!rentalTokenMatches("inquilino", token, contract.id, contract.portal_token_version || 1)) return null;
  const { data: orgData } = await admin
    .from("organizations")
    .select("id, name, logo_url, primary_color, contact_phone, contact_email, timezone, rentals_enabled, active")
    .eq("id", contract.organization_id)
    .maybeSingle();
  const org = orgData as (PortalOrg & { rentals_enabled: boolean; active: boolean }) | null;
  if (!org || !org.rentals_enabled || org.active === false) return null;
  return { admin, contract, org, today: todayYmdInTz(org.timezone || DEFAULT_ORG_TIMEZONE) };
}

function lateFeeRate(type: RentalLateFeeType, value: number, currency: string): string {
  const pct = `${Number(value).toLocaleString("es-AR")} %`;
  if (type === "diario_pct") return `al ${pct} diario`;
  if (type === "mensual_pct") return `al ${pct} mensual`;
  if (type === "fijo_diario") return `a ${formatMoney(value, currency)} por día`;
  return "";
}

function brandOf(color: string | null): string {
  return color && /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : DEFAULT_BRAND;
}

function firstNameOf(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

type ProofLite = Pick<RentalProof, "id" | "kind" | "period" | "status" | "amount" | "rejection_reason" | "uploaded_at">;

/** Arma la vista completa del portal. Lanza sólo si la base no responde (lo ataja error.tsx). */
export async function loadTenantPortal(pc: PortalContext, opts: { receiptsAvailable: boolean }): Promise<TenantPortalView> {
  const { admin, contract: c, org, today } = pc;
  const orgId = c.organization_id;
  const months = lastMonths(today, 6);
  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const [propRes, partyRes, settings, previewRes, payRes, proofRes, adjRes, repRes, evRes] = await Promise.all([
    admin.from("rental_properties").select("street, street_number, floor, apartment, tower, city").eq("organization_id", orgId).eq("id", c.property_id).maybeSingle(),
    admin.from("rental_contract_parties").select("person_id, is_primary, sort_order").eq("organization_id", orgId).eq("contract_id", c.id).eq("role", "inquilino")
      .order("is_primary", { ascending: false }).order("sort_order", { ascending: true }).limit(1),
    getRentalSettings(admin, orgId),
    computePaymentPreview(admin, orgId, { contractId: c.id, amount: 0, paidAt: today }),
    admin.from("rental_payments").select("id, paid_at, amount, currency, method, receipt_number, unallocated_amount").eq("organization_id", orgId).eq("contract_id", c.id)
      .is("voided_at", null).order("paid_at", { ascending: false }).limit(24),
    admin.from("rental_proofs").select("id, kind, period, status, amount, rejection_reason, uploaded_at").eq("organization_id", orgId).eq("contract_id", c.id)
      .gte("period", months[0]).lte("period", months[months.length - 1]),
    admin.from("rental_adjustments").select("sequence, effective_date, status, method, index_code, from_key, to_key, variation_pct, base_amount, computed_amount, applied_amount")
      .eq("organization_id", orgId).eq("contract_id", c.id).order("sequence", { ascending: true }),
    admin.from("rental_payment_reports").select("id, created_at, amount, paid_on, status").eq("organization_id", orgId).eq("contract_id", c.id)
      .gte("created_at", since60).order("created_at", { ascending: false }).limit(10),
    admin.from("rental_events").select("payload").eq("organization_id", orgId).eq("contract_id", c.id).eq("event_type", "payment_report_discarded").gte("created_at", since60),
  ]);
  if (propRes.error || payRes.error || proofRes.error || adjRes.error || repRes.error) throw new Error("No se pudo leer la cuenta del inquilino.");

  const personId = (partyRes.data?.[0] as { person_id: string } | undefined)?.person_id;
  const { data: person } = personId
    ? await admin.from("rental_people").select("full_name").eq("organization_id", orgId).eq("id", personId).maybeSingle()
    : { data: null };

  // Deuda: la vista previa del cobro al día de hoy (punitorios incluidos).
  // Sin la cuenta no mostramos nada: un "estás al día" falso es peor que un error.
  if (!previewRes.ok) throw new Error("No se pudo calcular la deuda del inquilino.");
  const preview = previewRes.preview;
  const feeByCharge = new Map(preview.lateFees.map((f) => [f.chargeId, f]));
  const charges: TenantPortalCharge[] = preview.charges
    .filter((ch) => ch.outstanding > 0)
    .map((ch) => {
      const fee = feeByCharge.get(ch.id);
      return {
        id: ch.id,
        label: ch.label,
        dueDate: ch.dueDate,
        total: ch.subtotal,
        paid: ch.paid,
        outstanding: ch.outstanding,
        state: ch.dueDate < today ? "vencido" : ch.paid > 0 ? "parcial" : "pendiente",
        items: ch.items.map((i) => ({ kind: i.kind, description: i.description, outstanding: i.outstanding })),
        lateFee: fee
          ? { daysLate: fee.daysLate, amount: fee.amount, explanation: `${fee.daysLate} ${fee.daysLate === 1 ? "día" : "días"} de atraso ${lateFeeRate(c.late_fee_type, Number(c.late_fee_value), c.currency)}`.trim() }
          : null,
      };
    });

  // Comprobantes: el mes actual (lo que se pide + lo que haya) y los 6 anteriores.
  const uploadsOpen = portalUploadsOpen(c, today);
  const proofs = (proofRes.data ?? []) as ProofLite[];
  const trackedFrom = proofsTrackedFrom(c);
  const proofMonth = (month: string): TenantPortalProof[] => {
    const rows = proofs.filter((p) => monthOf(p.period) === month);
    const expected = month >= trackedFrom ? expectedProofKindsIn(c, month) : [];
    const kinds = sortKinds([...expected, ...rows.map((p) => p.kind)]).filter(isProofKind);
    return kinds.map((kind) => {
      const row = rows.find((p) => p.kind === kind);
      const status = row?.status ?? "pendiente";
      return {
        id: row?.id ?? null,
        kind,
        period: month,
        status,
        amount: row?.amount == null ? null : Number(row.amount),
        rejectionReason: status === "rechazado" ? row?.rejection_reason ?? null : null,
        uploadedAt: row?.uploaded_at ?? null,
        canUpload: uploadsOpen && (status === "pendiente" || status === "rechazado" || status === "en_revision"),
      };
    });
  };
  const currentMonth = monthOf(today);
  const history: TenantPortalProofMonth[] = months
    .filter((m) => m !== currentMonth)
    .reverse()
    .map((m) => ({ month: m, proofs: proofMonth(m) }))
    .filter((x) => x.proofs.length > 0);

  // Ajustes aplicados (con el porqué) y el próximo.
  type AdjRow = { sequence: number; effective_date: string; status: string; method: RentalContract["adjustment_method"]; index_code: RentalContract["index_code"]; from_key: string | null; to_key: string | null; variation_pct: number | null; base_amount: number | null; computed_amount: number | null; applied_amount: number | null };
  const adjRows = (adjRes.data ?? []) as AdjRow[];
  const adjustments = adjRows
    .filter((a) => a.status === "aplicado" && a.applied_amount != null && a.effective_date <= today)
    .reverse()
    .map((a) => ({
      effectiveDate: a.effective_date,
      from: a.base_amount == null ? null : Number(a.base_amount),
      to: Number(a.applied_amount),
      variationPct: a.variation_pct == null ? null : Number(a.variation_pct),
      explanation: adjustmentExplanation({ method: a.method, indexCode: a.index_code, variationPct: a.variation_pct == null ? null : Number(a.variation_pct), fromKey: a.from_key, toKey: a.to_key }),
    }));
  const next = adjRows.find((a) => a.effective_date > today && a.status !== "omitido");
  const nextAmount = next ? next.applied_amount ?? (next.status === "calculado" ? next.computed_amount : null) : null;
  const nextIndex = next?.index_code ? INDEX_META[next.index_code] : null;
  const nextAdjustment = next
    ? {
        date: next.effective_date,
        amount: nextAmount == null ? null : Number(nextAmount),
        explanation:
          nextAmount != null
            ? `Pasa de ${formatMoney(c.current_rent, c.currency)} a ${formatMoney(Number(nextAmount), c.currency)}${next.variation_pct != null ? ` (${Number(next.variation_pct) > 0 ? "+" : ""}${formatPctAr(Number(next.variation_pct))})` : ""}.`
            : nextIndex
              ? `El monto nuevo se sabe cuando ${nextIndex.publisher} publique el ${nextIndex.label} que falta. Te avisamos antes de que rija.`
              : "Te avisamos el monto nuevo antes de que rija.",
      }
    : null;

  // Avisos de pago recientes (y el motivo si se descartó).
  const reasons = new Map<string, string>();
  for (const e of (evRes.data ?? []) as { payload: { reportId?: string; reason?: string } | null }[]) {
    if (e.payload?.reportId && e.payload.reason) reasons.set(e.payload.reportId, e.payload.reason);
  }
  type RepRow = { id: string; created_at: string; amount: number | null; paid_on: string | null; status: TenantPortalView["reports"][number]["status"] };
  const reports = ((repRes.data ?? []) as RepRow[]).map((x) => ({
    id: x.id,
    createdAt: x.created_at,
    amount: x.amount == null ? null : Number(x.amount),
    paidOn: x.paid_on,
    status: x.status,
    reason: x.status === "descartado" ? reasons.get(x.id) ?? null : null,
  }));
  const pendingReports = reports.filter((x) => x.status === "pendiente").length;

  type PayRow = { id: string; paid_at: string; amount: number; currency: string; method: RentalPaymentMethod; receipt_number: number | null; unallocated_amount: number };
  const payRows = (payRes.data ?? []) as PayRow[];
  const prop = propRes.data as { street: string; street_number: string | null; floor: string | null; apartment: string | null; tower: string | null; city: string } | null;
  const state = contractDisplayState(c, today);

  return {
    org: {
      name: org.name,
      logoUrl: org.logo_url,
      brandColor: brandOf(org.primary_color),
      phone: org.contact_phone,
      whatsapp: toWhatsappDigits(org.contact_phone),
      email: org.contact_email,
      paymentInstructions: settings.payment_instructions,
    },
    today,
    tenantFirstName: firstNameOf((person as { full_name: string } | null)?.full_name),
    contract: {
      number: formatContractNumber(c.number),
      address: prop ? propertyAddress(prop) : "",
      city: prop?.city ?? "",
      status: state,
      statusLabel: CONTRACT_STATE_META[state].label,
      startDate: c.start_date,
      endDate: c.end_date,
      currency: c.currency,
      currentRent: Number(c.current_rent),
      adjustmentSummary: adjustmentSummary({ method: c.adjustment_method, indexCode: c.index_code, every: c.adjustment_every_months, fixedPct: c.fixed_pct == null ? null : Number(c.fixed_pct) }),
      indexExplanation: c.adjustment_method === "indice" && c.index_code ? INDEX_PLAIN[c.index_code] : null,
      paysOwnerDirectly: c.collector === "propietario",
    },
    debt: {
      total: round2(charges.reduce((s, ch) => s + ch.outstanding, 0)),
      overdue: round2(charges.filter((ch) => ch.state === "vencido").reduce((s, ch) => s + ch.outstanding, 0)),
      charges,
    },
    credit: round2(payRows.reduce((s, p) => s + Number(p.unallocated_amount || 0), 0)),
    payments: payRows.slice(0, 12).map((p) => ({
      id: p.id,
      paidAt: p.paid_at,
      amount: Number(p.amount),
      currency: p.currency,
      methodLabel: PAYMENT_METHOD_LABEL[p.method] ?? "Pago",
      receiptNumber: p.receipt_number ? formatReceiptNumber(p.receipt_number) : null,
    })),
    receiptsAvailable: opts.receiptsAvailable,
    proofs: { currentMonth, current: proofMonth(currentMonth), history },
    adjustments,
    nextAdjustment,
    reports,
    canReportPayment: uploadsOpen && pendingReports < MAX_PENDING_TENANT_REPORTS,
    canUpload: uploadsOpen,
  };
}
