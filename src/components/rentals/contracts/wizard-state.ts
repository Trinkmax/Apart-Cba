import { parseAmountInput, parsePercentInput } from "@/lib/format";
import type { ContractInput } from "@/lib/rentals/server/contracts";
import { LEGAL_REGIME_META } from "@/lib/rentals/labels";
import { REGIME_IN_FORCE } from "@/lib/rentals/renewal";
import { adjustmentCount, contractEndDate } from "@/lib/rentals/schedule";
import { isYmd } from "@/lib/rentals/ymd";
import type {
  RentalAdjustmentMethod,
  RentalCommissionBasis,
  RentalCommissionRule,
  RentalContract,
  RentalContractParty,
  RentalContractService,
  RentalEarlyTerminationRule,
  RentalExpensasMode,
  RentalExpensasPayer,
  RentalGuaranteeType,
  RentalIndexCode,
  RentalLateFeeType,
  RentalLegalRegime,
  RentalMoneyOwner,
  RentalPayer,
  RentalRounding,
  RentalSettings,
  RentalStampTaxStatus,
  RentalUsage,
} from "@/lib/types/database";

/**
 * Estado del asistente de alta/edición de contratos (puro).
 *
 * Los importes y porcentajes se guardan como TEXTO tal cual los tipeó la
 * persona ("500.000", "0,5"): se convierten recién al validar, con
 * `parseAmountInput` / `parsePercentInput`, y si no se pueden leer se muestra
 * el error (nunca se guarda 0 por las dudas).
 */

export const WIZARD_STEPS = [
  { key: "propiedad", label: "Propiedad" },
  { key: "partes", label: "Inquilino y garantes" },
  { key: "plazo", label: "Plazo y precio" },
  { key: "ajuste", label: "Actualización" },
  { key: "cobro", label: "Cobro" },
  { key: "honorarios", label: "Honorarios y depósito" },
  { key: "servicios", label: "Expensas y servicios" },
  { key: "revision", label: "Revisión" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

export interface WizardParty {
  /** Clave local para las listas de React. */
  key: string;
  person_id: string;
  role: "inquilino" | "garante";
  is_primary: boolean;
  guarantee_type: RentalGuaranteeType | null;
  /** Detalle libre de la garantía ("Inmueble en Gral. Paz 120, matrícula…"). */
  guarantee_detail: string;
  guarantor_consent_at: string;
}

export interface CommissionDraft {
  basis: RentalCommissionBasis;
  value: string;
  vat: boolean;
}

export interface OverrideDraft {
  amount: string;
  reason: string;
}

export interface WizardState {
  property_id: string;
  parties: WizardParty[];
  usage: RentalUsage;
  legal_regime: RentalLegalRegime;
  start_date: string;
  duration_months: string;
  signed_at: string;
  currency: "ARS" | "USD";
  initial_rent: string;
  early_termination_rule: RentalEarlyTerminationRule;
  early_termination_notes: string;
  adjustment_method: RentalAdjustmentMethod;
  index_code: RentalIndexCode;
  adjustment_every_months: string;
  index_lag_months: number;
  fixed_pct: string;
  steps: string[];
  rounding: RentalRounding;
  cap_pct: string;
  allow_decrease: boolean;
  payment_window_days: string;
  grace_days: string;
  late_fee_type: RentalLateFeeType;
  late_fee_value: string;
  late_fee_payee: RentalMoneyOwner;
  collector: RentalMoneyOwner;
  /** false = se cobra desde un período posterior al inicio (contrato que ya venía corriendo). */
  billing_from_start: boolean;
  billing_starts_on: string;
  admin_fee_pct: string;
  admin_fee_vat: boolean;
  tenant_commission: CommissionDraft;
  owner_commission: CommissionDraft;
  deposit_amount: string;
  deposit_currency: "ARS" | "USD";
  deposit_holder: RentalMoneyOwner;
  stamp_tax_status: RentalStampTaxStatus;
  stamp_tax_amount: string;
  /** Generar el cargo de ingreso (depósito, honorarios, sellado) al activar. */
  generate_entry_charge: boolean;
  expensas_payer: RentalExpensasPayer;
  expensas_mode: RentalExpensasMode;
  expensas_extra_payer: RentalPayer;
  services: RentalContractService[];
  insurance_required: boolean;
  insurance_company: string;
  insurance_policy: string;
  insurance_expires_at: string;
  reli_code: string;
  special_clauses: string;
  notes: string;
  /** Montos reales de ajustes que ya rigieron (sequence → monto + motivo). Sólo borradores. */
  overrides: Record<string, OverrideDraft>;
  /**
   * Es la renovación de otro contrato (no se edita: sale de renewed_from_id).
   * Cada garante tiene que firmarla (art. 1225 CCyC): se pide la fecha.
   */
  is_renewal: boolean;
}

export type WizardSettings = Pick<
  RentalSettings,
  | "payment_window_days"
  | "grace_days"
  | "late_fee_type"
  | "late_fee_value"
  | "late_fee_payee"
  | "admin_fee_pct"
  | "admin_fee_vat"
  | "tenant_commission"
  | "owner_commission"
  | "default_index"
  | "default_adjustment_every"
  | "default_lag_months"
  | "default_rounding"
  | "default_duration_months"
>;

let keySeq = 0;
export function newPartyKey(): string {
  keySeq += 1;
  return `p${Date.now().toString(36)}${keySeq}`;
}

/** Número a texto editable en es-AR ("500000" → "500.000", "0.5" → "0,5"). */
export function editableNumber(n: number | null | undefined, opts: { percent?: boolean } = {}): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  const v = Math.round(Number(n) * 100) / 100;
  if (opts.percent) return String(v).replace(".", ",");
  return v.toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: true });
}

function commissionDraft(rule: RentalCommissionRule | null | undefined, fallbackBasis: RentalCommissionBasis = "ninguna"): CommissionDraft {
  if (!rule) return { basis: fallbackBasis, value: "", vat: false };
  return {
    basis: rule.basis,
    value: rule.basis === "monto_fijo" ? editableNumber(rule.value) : editableNumber(rule.value, { percent: true }),
    vat: Boolean(rule.vat),
  };
}

/** Inicio sugerido: hoy si es día 1, si no el 1° del mes que viene. */
export function suggestedStartDate(today: string): string {
  if (today.slice(8, 10) === "01") return today;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export const DEFAULT_SERVICES: RentalContractService[] = [
  { kind: "luz", payer: "inquilino", proof_required: true, frequency: "mensual" },
  { kind: "gas", payer: "inquilino", proof_required: true, frequency: "bimestral" },
  { kind: "agua", payer: "inquilino", proof_required: true, frequency: "bimestral" },
  { kind: "municipal", payer: "inquilino", proof_required: false, frequency: "mensual" },
  { kind: "inmobiliario", payer: "propietario", proof_required: false, frequency: "mensual" },
];

export function defaultWizardState(settings: WizardSettings, today: string): WizardState {
  return {
    property_id: "",
    parties: [],
    usage: "vivienda",
    legal_regime: REGIME_IN_FORCE,
    start_date: suggestedStartDate(today),
    duration_months: String(settings.default_duration_months || 24),
    signed_at: "",
    currency: "ARS",
    initial_rent: "",
    early_termination_rule: LEGAL_REGIME_META[REGIME_IN_FORCE].preset.termination,
    early_termination_notes: "",
    adjustment_method: "indice",
    index_code: settings.default_index || "ipc",
    adjustment_every_months: String(settings.default_adjustment_every || 3),
    index_lag_months: settings.default_lag_months ?? 2,
    fixed_pct: "",
    steps: [],
    rounding: settings.default_rounding || "hundred",
    cap_pct: "",
    allow_decrease: false,
    payment_window_days: String(settings.payment_window_days || 10),
    grace_days: String(settings.grace_days ?? 0),
    late_fee_type: settings.late_fee_type,
    late_fee_value: editableNumber(settings.late_fee_value, { percent: settings.late_fee_type !== "fijo_diario" }),
    late_fee_payee: settings.late_fee_payee,
    collector: "inmobiliaria",
    billing_from_start: true,
    billing_starts_on: "",
    admin_fee_pct: editableNumber(settings.admin_fee_pct, { percent: true }),
    admin_fee_vat: settings.admin_fee_vat,
    tenant_commission: commissionDraft(settings.tenant_commission),
    owner_commission: commissionDraft(settings.owner_commission),
    deposit_amount: "",
    deposit_currency: "ARS",
    deposit_holder: "inmobiliaria",
    stamp_tax_status: "pendiente",
    stamp_tax_amount: "",
    generate_entry_charge: true,
    expensas_payer: "inquilino",
    expensas_mode: "paga_inquilino",
    expensas_extra_payer: "propietario",
    services: DEFAULT_SERVICES.map((s) => ({ ...s })),
    insurance_required: false,
    insurance_company: "",
    insurance_policy: "",
    insurance_expires_at: "",
    reli_code: "",
    special_clauses: "",
    notes: "",
    overrides: {},
    is_renewal: false,
  };
}

export function wizardStateFromContract(
  c: RentalContract,
  parties: Pick<RentalContractParty, "person_id" | "role" | "is_primary" | "guarantee_type" | "guarantee_details" | "guarantor_consent_at">[],
  overrides: { sequence: number; amount: number; reason: string | null }[] = [],
): WizardState {
  const detailOf = (d: Record<string, string | number | null> | null | undefined) => {
    if (!d) return "";
    if (typeof d.detalle === "string") return d.detalle;
    return Object.values(d).filter((v) => v != null && v !== "").join(" · ");
  };
  return {
    property_id: c.property_id,
    parties: parties.map((p) => ({
      key: newPartyKey(),
      person_id: p.person_id,
      role: p.role,
      is_primary: p.is_primary,
      guarantee_type: p.guarantee_type,
      guarantee_detail: detailOf(p.guarantee_details),
      guarantor_consent_at: p.guarantor_consent_at ?? "",
    })),
    usage: c.usage,
    legal_regime: c.legal_regime,
    start_date: c.start_date,
    duration_months: String(c.duration_months),
    signed_at: c.signed_at ?? "",
    currency: c.currency === "USD" ? "USD" : "ARS",
    initial_rent: editableNumber(c.initial_rent),
    early_termination_rule: c.early_termination_rule,
    early_termination_notes: c.early_termination_notes ?? "",
    adjustment_method: c.adjustment_method,
    index_code: c.index_code ?? "ipc",
    adjustment_every_months: c.adjustment_every_months ? String(c.adjustment_every_months) : "3",
    index_lag_months: c.index_lag_months ?? 2,
    fixed_pct: editableNumber(c.fixed_pct, { percent: true }),
    steps: (c.steps ?? []).map((n) => editableNumber(n)),
    rounding: c.rounding,
    cap_pct: editableNumber(c.cap_pct, { percent: true }),
    allow_decrease: c.allow_decrease,
    payment_window_days: String(c.payment_window_days),
    grace_days: String(c.grace_days),
    late_fee_type: c.late_fee_type,
    late_fee_value: editableNumber(c.late_fee_value, { percent: c.late_fee_type !== "fijo_diario" }),
    late_fee_payee: c.late_fee_payee,
    collector: c.collector,
    billing_from_start: !c.billing_starts_on || c.billing_starts_on <= c.start_date,
    billing_starts_on: c.billing_starts_on ?? "",
    admin_fee_pct: editableNumber(c.admin_fee_pct, { percent: true }),
    admin_fee_vat: c.admin_fee_vat,
    tenant_commission: commissionDraft(c.tenant_commission),
    owner_commission: commissionDraft(c.owner_commission),
    deposit_amount: c.deposit_amount > 0 ? editableNumber(c.deposit_amount) : "",
    deposit_currency: c.deposit_currency === "USD" ? "USD" : "ARS",
    deposit_holder: c.deposit_holder,
    stamp_tax_status: c.stamp_tax_status,
    stamp_tax_amount: editableNumber(c.stamp_tax_amount),
    generate_entry_charge: true,
    expensas_payer: c.expensas_payer,
    expensas_mode: c.expensas_mode,
    expensas_extra_payer: c.expensas_extra_payer,
    services: (c.services ?? []).map((s) => ({ ...s })),
    insurance_required: c.insurance_required,
    insurance_company: c.insurance_company ?? "",
    insurance_policy: c.insurance_policy ?? "",
    insurance_expires_at: c.insurance_expires_at ?? "",
    reli_code: c.reli_code ?? "",
    special_clauses: c.special_clauses ?? "",
    notes: c.notes ?? "",
    overrides: Object.fromEntries(overrides.map((o) => [String(o.sequence), { amount: editableNumber(o.amount), reason: o.reason ?? "" }])),
    is_renewal: Boolean(c.renewed_from_id),
  };
}

/**
 * Garantes de una renovación que todavía no tienen la fecha en que la
 * firmaron (art. 1225 CCyC). El borrador se puede guardar igual; activar o
 * guardar una renovación vigente, no. Con `today`, una fecha futura cuenta
 * como faltante (todavía no firmó).
 */
export function guarantorsMissingConsent(s: WizardState, today?: string): WizardParty[] {
  if (!s.is_renewal) return [];
  return s.parties.filter(
    (p) => p.role === "garante" && p.person_id && (!isYmd(p.guarantor_consent_at) || (today != null && p.guarantor_consent_at > today)),
  );
}

/** Elegir el régimen legal precarga plazo, índice, frecuencia y rescisión. */
export function applyRegime(s: WizardState, regime: RentalLegalRegime): WizardState {
  const p = LEGAL_REGIME_META[regime].preset;
  return {
    ...s,
    legal_regime: regime,
    duration_months: String(p.duration),
    early_termination_rule: p.termination,
    ...(p.index && p.every
      ? { adjustment_method: "indice" as const, index_code: p.index, adjustment_every_months: String(p.every) }
      : {}),
  };
}

// ─── Validación y armado del input ──────────────────────────────────────────

export interface StepIssue {
  step: WizardStepKey;
  field: string;
  message: string;
}

const intOf = (s: string): number | null => (/^\s*\d{1,4}\s*$/.test(s) ? Number(s.trim()) : null);
const textOrNull = (s: string): string | null => (s.trim() ? s.trim() : null);

function parseCommission(d: CommissionDraft): RentalCommissionRule | null | "error" {
  if (d.basis === "ninguna") return { basis: "ninguna", value: 0, vat: false };
  if (!d.value.trim()) return "error";
  const value = d.basis === "monto_fijo" ? parseAmountInput(d.value) : parsePercentInput(d.value);
  if (value == null || value < 0) return "error";
  return { basis: d.basis, value, vat: d.vat };
}

/** Pasos del método que necesitan "cada cuántos meses". */
export function usesEvery(method: RentalAdjustmentMethod): boolean {
  return method !== "sin_ajuste";
}

/** Valida TODO el asistente y, si está bien, arma el input del servicio. */
export function parseWizard(s: WizardState): { input: ContractInput | null; issues: StepIssue[] } {
  const issues: StepIssue[] = [];
  const add = (step: WizardStepKey, field: string, message: string) => issues.push({ step, field, message });

  if (!s.property_id) add("propiedad", "property_id", "Elegí la propiedad o cargá una nueva.");

  const filled = s.parties.filter((p) => p.person_id);
  if (s.parties.some((p) => !p.person_id)) add("partes", "parties", "Hay una fila sin persona: elegila o sacala.");
  if (!filled.some((p) => p.role === "inquilino")) add("partes", "parties", "Falta el inquilino: buscalo o cargalo.");
  if (filled.filter((p) => p.role === "inquilino" && p.is_primary).length > 1) add("partes", "parties", "Marcá un solo titular de los recibos.");
  const ids = filled.map((p) => `${p.person_id}:${p.role}`);
  if (new Set(ids).size !== ids.length) add("partes", "parties", "Hay una persona repetida con el mismo rol.");
  if (filled.some((p) => p.role === "garante" && p.guarantor_consent_at && !isYmd(p.guarantor_consent_at))) {
    add("partes", "parties", "Revisá la fecha en que firmó el garante.");
  }

  if (!isYmd(s.start_date)) add("plazo", "start_date", "Poné la fecha de inicio.");
  const duration = intOf(s.duration_months);
  if (!duration || duration < 1 || duration > 120) add("plazo", "duration_months", "El plazo va de 1 a 120 meses.");
  const rent = parseAmountInput(s.initial_rent);
  if (rent == null || rent <= 0) {
    add("plazo", "initial_rent", s.initial_rent.trim() ? "No pudimos leer el alquiler: escribilo así, 500.000" : "Poné el alquiler del primer mes.");
  }
  if (s.signed_at && !isYmd(s.signed_at)) add("plazo", "signed_at", "La fecha de firma no es válida.");

  const every = usesEvery(s.adjustment_method) ? intOf(s.adjustment_every_months) : null;
  if (usesEvery(s.adjustment_method) && (!every || every < 1 || every > 12)) {
    add("ajuste", "adjustment_every_months", "Elegí cada cuántos meses cambia el precio (de 1 a 12).");
  }
  const fixed = s.adjustment_method === "porcentaje_fijo" ? parsePercentInput(s.fixed_pct) : null;
  if (s.adjustment_method === "porcentaje_fijo" && fixed == null) add("ajuste", "fixed_pct", "Poné el porcentaje de cada ajuste (por ejemplo 8,5).");
  let steps: number[] | null = null;
  if (s.adjustment_method === "escalonado") {
    const count = duration && every ? adjustmentCount(duration, every) : 0;
    const parsed = s.steps.slice(0, count).map((x) => parseAmountInput(x));
    if (parsed.length < count || parsed.some((x) => x == null || x <= 0)) {
      add("ajuste", "steps", `Completá el monto de cada cambio de precio (son ${count}).`);
    } else steps = parsed as number[];
  }
  const cap = s.cap_pct.trim() ? parsePercentInput(s.cap_pct) : null;
  if (s.cap_pct.trim() && (cap == null || cap < 0)) add("ajuste", "cap_pct", "No pudimos leer el tope: escribilo así, 15");
  for (const [seq, o] of Object.entries(s.overrides)) {
    if (!o.amount.trim()) continue;
    const n = parseAmountInput(o.amount);
    if (n == null || n <= 0) add("ajuste", "overrides", `Revisá el monto real del ajuste ${seq}.`);
  }

  const window = intOf(s.payment_window_days);
  if (!window || window < 1 || window > 28) add("cobro", "payment_window_days", "El plazo para pagar va de 1 a 28 días.");
  const grace = intOf(s.grace_days);
  if (grace == null || grace > 30) add("cobro", "grace_days", "Los días de gracia van de 0 a 30.");
  const lateFee =
    s.late_fee_type === "ninguno" ? 0 : s.late_fee_type === "fijo_diario" ? parseAmountInput(s.late_fee_value) : parsePercentInput(s.late_fee_value);
  if (lateFee == null || lateFee < 0) add("cobro", "late_fee_value", "Poné el valor del punitorio (o elegí «Sin punitorios»).");
  if (!s.billing_from_start) {
    if (!isYmd(s.billing_starts_on)) add("cobro", "billing_starts_on", "Poné desde qué fecha se empieza a cobrar.");
    else if (isYmd(s.start_date) && s.billing_starts_on < s.start_date) add("cobro", "billing_starts_on", "No puede ser antes del inicio del contrato.");
  }

  const adminFee = s.admin_fee_pct.trim() ? parsePercentInput(s.admin_fee_pct) : 0;
  if (adminFee == null || adminFee < 0 || adminFee > 100) add("honorarios", "admin_fee_pct", "Los honorarios de administración van de 0 a 100 %.");
  const tenantCommission = parseCommission(s.tenant_commission);
  if (tenantCommission === "error") add("honorarios", "tenant_commission", "Revisá los honorarios del inquilino.");
  const ownerCommission = parseCommission(s.owner_commission);
  if (ownerCommission === "error") add("honorarios", "owner_commission", "Revisá los honorarios del propietario.");
  const deposit = s.deposit_amount.trim() ? parseAmountInput(s.deposit_amount) : 0;
  if (deposit == null || deposit < 0) add("honorarios", "deposit_amount", "No pudimos leer el depósito: escribilo así, 500.000");
  const stampAmount = s.stamp_tax_amount.trim() ? parseAmountInput(s.stamp_tax_amount) : null;
  if (s.stamp_tax_amount.trim() && (stampAmount == null || stampAmount < 0)) add("honorarios", "stamp_tax_amount", "Revisá el monto del sellado.");

  if (s.insurance_expires_at && !isYmd(s.insurance_expires_at)) add("servicios", "insurance_expires_at", "La fecha de vencimiento del seguro no es válida.");

  if (issues.length) return { input: null, issues };

  const input: ContractInput = {
    property_id: s.property_id,
    usage: s.usage,
    legal_regime: s.legal_regime,
    start_date: s.start_date,
    duration_months: duration as number,
    signed_at: s.signed_at || null,
    currency: s.currency,
    initial_rent: rent as number,
    adjustment_method: s.adjustment_method,
    index_code: s.adjustment_method === "indice" ? s.index_code : null,
    adjustment_every_months: every,
    index_lag_months: s.index_lag_months,
    fixed_pct: fixed,
    steps,
    rounding: s.rounding,
    cap_pct: cap,
    allow_decrease: s.allow_decrease,
    payment_window_days: window as number,
    grace_days: grace as number,
    late_fee_type: s.late_fee_type,
    late_fee_value: lateFee as number,
    late_fee_payee: s.late_fee_payee,
    collector: s.collector,
    billing_starts_on: s.billing_from_start ? null : s.billing_starts_on,
    admin_fee_pct: adminFee as number,
    admin_fee_vat: s.admin_fee_vat,
    tenant_commission: tenantCommission as RentalCommissionRule | null,
    owner_commission: ownerCommission as RentalCommissionRule | null,
    deposit_amount: deposit as number,
    deposit_currency: s.deposit_currency,
    deposit_holder: s.deposit_holder,
    stamp_tax_status: s.stamp_tax_status,
    stamp_tax_amount: stampAmount,
    expensas_payer: s.expensas_payer,
    expensas_mode: s.expensas_payer === "no_aplica" ? "no_aplica" : s.expensas_mode,
    expensas_extra_payer: s.expensas_extra_payer,
    services: s.services,
    insurance_required: s.insurance_required,
    insurance_company: textOrNull(s.insurance_company),
    insurance_policy: textOrNull(s.insurance_policy),
    insurance_expires_at: s.insurance_expires_at || null,
    early_termination_rule: s.early_termination_rule,
    early_termination_notes: textOrNull(s.early_termination_notes),
    reli_code: textOrNull(s.reli_code),
    special_clauses: textOrNull(s.special_clauses),
    notes: textOrNull(s.notes),
    parties: filled.map((p) => ({
      person_id: p.person_id,
      role: p.role,
      is_primary: p.role === "inquilino" && p.is_primary,
      guarantee_type: p.role === "garante" ? p.guarantee_type : null,
      guarantee_details: (p.guarantee_detail.trim() ? { detalle: p.guarantee_detail.trim().slice(0, 500) } : {}) as Record<string, string | number | null>,
      guarantor_consent_at: p.guarantor_consent_at || null,
    })),
  };
  return { input, issues };
}

export function stepIssue(step: WizardStepKey, s: WizardState): StepIssue | null {
  return parseWizard(s).issues.find((i) => i.step === step) ?? null;
}

const FIELD_STEP: Record<string, WizardStepKey> = {
  property_id: "propiedad",
  parties: "partes",
  usage: "plazo",
  legal_regime: "plazo",
  start_date: "plazo",
  duration_months: "plazo",
  signed_at: "plazo",
  currency: "plazo",
  initial_rent: "plazo",
  early_termination_rule: "plazo",
  early_termination_notes: "plazo",
  adjustment_method: "ajuste",
  index_code: "ajuste",
  adjustment_every_months: "ajuste",
  index_lag_months: "ajuste",
  fixed_pct: "ajuste",
  steps: "ajuste",
  rounding: "ajuste",
  cap_pct: "ajuste",
  overrides: "ajuste",
  payment_window_days: "cobro",
  grace_days: "cobro",
  late_fee_type: "cobro",
  late_fee_value: "cobro",
  late_fee_payee: "cobro",
  collector: "cobro",
  billing_starts_on: "cobro",
  admin_fee_pct: "honorarios",
  tenant_commission: "honorarios",
  owner_commission: "honorarios",
  deposit_amount: "honorarios",
  deposit_currency: "honorarios",
  stamp_tax_status: "honorarios",
  stamp_tax_amount: "honorarios",
  expensas_payer: "servicios",
  expensas_mode: "servicios",
  services: "servicios",
  insurance_expires_at: "servicios",
};

/** Paso donde vive un campo (para llevar a la persona al error que devolvió el servidor). */
export function stepOfField(field: string | null | undefined): WizardStepKey | null {
  return field ? (FIELD_STEP[field] ?? null) : null;
}

// ─── Vista previa (lo que se manda al servidor mientras se tipea) ───────────

export interface PlanPreviewInput {
  start_date: string;
  duration_months: number;
  currency: "ARS" | "USD";
  initial_rent: number;
  adjustment_method: RentalAdjustmentMethod;
  index_code: RentalIndexCode | null;
  adjustment_every_months: number | null;
  index_lag_months: number;
  fixed_pct: number | null;
  steps: number[] | null;
  rounding: RentalRounding;
  cap_pct: number | null;
  allow_decrease: boolean;
  payment_window_days: number;
  deposit_amount: number;
  deposit_currency: "ARS" | "USD";
  tenant_commission: RentalCommissionRule | null;
  owner_commission: RentalCommissionRule | null;
  stamp_tax_status: RentalStampTaxStatus;
  stamp_tax_amount: number | null;
  /** Montos reales de ajustes que ya rigieron. */
  overrides: { sequence: number; amount: number }[];
}

/** Datos económicos para la vista previa, tolerante: null si todavía no alcanza (sin inicio, plazo o alquiler). */
export function previewInputOf(s: WizardState): PlanPreviewInput | null {
  const duration = intOf(s.duration_months);
  const rent = parseAmountInput(s.initial_rent);
  if (!isYmd(s.start_date) || !duration || duration < 1 || duration > 120 || rent == null || rent <= 0) return null;
  const every = usesEvery(s.adjustment_method) ? intOf(s.adjustment_every_months) : null;
  const okEvery = every && every >= 1 && every <= 12 ? every : null;
  const commission = (d: CommissionDraft) => {
    const r = parseCommission(d);
    return r === "error" ? null : r;
  };
  return {
    start_date: s.start_date,
    duration_months: duration,
    currency: s.currency,
    initial_rent: rent,
    adjustment_method: okEvery || s.adjustment_method === "sin_ajuste" ? s.adjustment_method : "sin_ajuste",
    index_code: s.adjustment_method === "indice" ? s.index_code : null,
    adjustment_every_months: okEvery,
    index_lag_months: s.index_lag_months,
    fixed_pct: s.adjustment_method === "porcentaje_fijo" ? parsePercentInput(s.fixed_pct) : null,
    steps: s.adjustment_method === "escalonado" ? s.steps.map((x) => parseAmountInput(x) ?? 0) : null,
    rounding: s.rounding,
    cap_pct: s.cap_pct.trim() ? parsePercentInput(s.cap_pct) : null,
    allow_decrease: s.allow_decrease,
    payment_window_days: Math.min(28, Math.max(1, intOf(s.payment_window_days) ?? 10)),
    deposit_amount: s.deposit_amount.trim() ? (parseAmountInput(s.deposit_amount) ?? 0) : 0,
    deposit_currency: s.deposit_currency,
    tenant_commission: commission(s.tenant_commission),
    owner_commission: commission(s.owner_commission),
    stamp_tax_status: s.stamp_tax_status,
    stamp_tax_amount: s.stamp_tax_amount.trim() ? parseAmountInput(s.stamp_tax_amount) : null,
    overrides: Object.entries(s.overrides)
      .map(([seq, o]) => ({ sequence: Number(seq), amount: parseAmountInput(o.amount) ?? 0 }))
      .filter((o) => Number.isInteger(o.sequence) && o.sequence > 0 && o.amount > 0),
  };
}

/** Fin del contrato según lo tipeado (o null). */
export function endDateOf(s: WizardState): string | null {
  const duration = intOf(s.duration_months);
  return isYmd(s.start_date) && duration && duration >= 1 && duration <= 120 ? contractEndDate(s.start_date, duration) : null;
}

/** Montos reales para guardar (borradores): [{sequence, amount, reason}]. */
export function overridesForSave(s: WizardState): { sequence: number; amount: number; reason: string }[] {
  return Object.entries(s.overrides)
    .map(([seq, o]) => ({ sequence: Number(seq), amount: parseAmountInput(o.amount) ?? 0, reason: o.reason.trim() || "Monto real al cargar el contrato" }))
    .filter((o) => Number.isInteger(o.sequence) && o.sequence > 0 && o.amount > 0);
}
