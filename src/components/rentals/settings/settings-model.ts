import type {
  RentalCommissionBasis,
  RentalCommissionRule,
  RentalIndexCode,
  RentalLateFeeType,
  RentalMoneyOwner,
  RentalRounding,
  RentalSettings,
  RentalVatCondition,
} from "@/lib/types/database";
import { parseAmountInput, parsePercentInput } from "@/lib/format";

/**
 * Lo que edita la pantalla Configuración → Alquileres (todo menos las
 * columnas de auditoría). Puro: lo comparten el formulario y la action.
 */
export type RentalSettingsValues = Omit<RentalSettings, "organization_id" | "created_at" | "updated_at" | "updated_by">;

const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/**
 * Equivalente que ayuda a dimensionar el punitorio:
 * "0,5 % diario ≈ 15 % por mes" · "3 % mensual ≈ 0,1 % por día".
 * null si no hay punitorio o el valor no es válido.
 */
export function lateFeeEquivalent(type: RentalLateFeeType, value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  switch (type) {
    case "diario_pct":
      return `${NUM.format(value)} % diario ≈ ${NUM.format(value * 30)} % por mes`;
    case "mensual_pct":
      return `${NUM.format(value)} % mensual ≈ ${NUM.format(value / 30)} % por día`;
    case "fijo_diario":
      return `≈ ${NUM.format(value * 30)} por cada mes de atraso`;
    default:
      return null;
  }
}

/** Advertencia cuando el punitorio es tan alto que un juez lo puede reducir (art. 771 CCyC). */
export function lateFeeWarning(type: RentalLateFeeType, value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const monthly = type === "diario_pct" ? value * 30 : type === "mensual_pct" ? value : null;
  if (monthly != null && monthly > 30) {
    return "Más de 30 % por mes es muy alto: si el inquilino lo discute, un juez lo puede reducir (art. 771 CCyC).";
  }
  return null;
}

/** "Del 1 al 10 de cada mes" para la ventana de pago. */
export function paymentWindowText(days: number | null | undefined): string {
  if (!days || days < 1) return "";
  return days === 1 ? "El primer día de cada período" : `Del 1 al ${days} de cada período`;
}

// ─── Estado del formulario (los números viajan como texto mientras se tipean) ──

export interface CommissionForm {
  basis: RentalCommissionBasis;
  value: string;
  vat: boolean;
}

export interface RentalSettingsForm {
  payment_window_days: string;
  grace_days: string;
  late_fee_type: RentalLateFeeType;
  late_fee_value: string;
  late_fee_payee: RentalMoneyOwner;
  admin_fee_pct: string;
  admin_fee_vat: boolean;
  tenant_commission: CommissionForm;
  owner_commission: CommissionForm;
  default_index: RentalIndexCode;
  default_adjustment_every: string;
  default_lag_months: string;
  default_rounding: RentalRounding;
  default_duration_months: string;
  auto_apply_adjustments: boolean;
  stamp_tax_rate_pct: string;
  stamp_tax_exempt_monthly: string;
  stamp_tax_tenant_share_pct: string;
  vat_condition: RentalVatCondition;
  broker_name: string;
  broker_license: string;
  payment_instructions: string;
  receipt_footer: string;
  charge_lead_days: string;
}

const txt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 4, useGrouping: false });
const money = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

function commissionForm(c: RentalCommissionRule | null | undefined): CommissionForm {
  const rule = c ?? { basis: "ninguna", value: 0, vat: false };
  return { basis: rule.basis, value: rule.basis === "monto_fijo" ? money(rule.value) : txt(rule.value), vat: !!rule.vat };
}

export function toSettingsForm(s: RentalSettingsValues): RentalSettingsForm {
  return {
    payment_window_days: txt(s.payment_window_days),
    grace_days: txt(s.grace_days),
    late_fee_type: s.late_fee_type,
    late_fee_value: s.late_fee_type === "fijo_diario" ? money(s.late_fee_value) : txt(s.late_fee_value),
    late_fee_payee: s.late_fee_payee,
    admin_fee_pct: txt(s.admin_fee_pct),
    admin_fee_vat: s.admin_fee_vat,
    tenant_commission: commissionForm(s.tenant_commission),
    owner_commission: commissionForm(s.owner_commission),
    default_index: s.default_index,
    default_adjustment_every: txt(s.default_adjustment_every),
    default_lag_months: txt(s.default_lag_months),
    default_rounding: s.default_rounding,
    default_duration_months: txt(s.default_duration_months),
    auto_apply_adjustments: s.auto_apply_adjustments,
    stamp_tax_rate_pct: txt(s.stamp_tax_rate_pct),
    stamp_tax_exempt_monthly: money(s.stamp_tax_exempt_monthly),
    stamp_tax_tenant_share_pct: txt(s.stamp_tax_tenant_share_pct),
    vat_condition: s.vat_condition,
    broker_name: s.broker_name ?? "",
    broker_license: s.broker_license ?? "",
    payment_instructions: s.payment_instructions ?? "",
    receipt_footer: s.receipt_footer ?? "",
    charge_lead_days: txt(s.charge_lead_days),
  };
}

export type FormParse = { ok: true; values: RentalSettingsValues } | { ok: false; error: string; field: string };

function int(raw: string, field: string, label: string): number | { error: string; field: string } {
  const n = Number(raw.trim());
  if (!raw.trim() || !Number.isInteger(n)) return { error: `${label}: ingresá un número entero.`, field };
  return n;
}

function pct(raw: string, field: string, label: string): number | { error: string; field: string } {
  const n = parsePercentInput(raw);
  if (n == null) return { error: `${label}: ingresá un número (por ejemplo 0,5).`, field };
  return n;
}

function commissionValue(c: CommissionForm, field: string, label: string): RentalCommissionRule | { error: string; field: string } {
  if (c.basis === "ninguna") return { basis: "ninguna", value: 0, vat: false };
  const n = c.basis === "monto_fijo" ? parseAmountInput(c.value) : parsePercentInput(c.value);
  if (n == null || n < 0) return { error: `${label}: ingresá un valor válido.`, field };
  return { basis: c.basis, value: n, vat: c.vat };
}

const isErr = (x: unknown): x is { error: string; field: string } => typeof x === "object" && x !== null && "error" in x;
const blankToNull = (s: string): string | null => (s.trim() ? s.trim() : null);

/**
 * Formulario → valores para guardar. Devuelve el primer error con el campo,
 * para enfocarlo. Los rangos finos los vuelve a validar el servidor.
 */
export function fromSettingsForm(f: RentalSettingsForm): FormParse {
  const window = int(f.payment_window_days, "payment_window_days", "Plazo para pagar");
  if (isErr(window)) return { ok: false, ...window };
  const grace = int(f.grace_days || "0", "grace_days", "Días de gracia");
  if (isErr(grace)) return { ok: false, ...grace };
  let lateValue = 0;
  if (f.late_fee_type !== "ninguno") {
    const v = f.late_fee_type === "fijo_diario" ? parseAmountInput(f.late_fee_value) : parsePercentInput(f.late_fee_value);
    if (v == null || v <= 0) return { ok: false, error: "Punitorio: cargá el valor o elegí \"Sin punitorios\".", field: "late_fee_value" };
    lateValue = v;
  }
  const admin = pct(f.admin_fee_pct || "0", "admin_fee_pct", "Administración");
  if (isErr(admin)) return { ok: false, ...admin };
  const tenant = commissionValue(f.tenant_commission, "tenant_commission", "Honorarios del inquilino");
  if (isErr(tenant)) return { ok: false, ...tenant };
  const owner = commissionValue(f.owner_commission, "owner_commission", "Honorarios del propietario");
  if (isErr(owner)) return { ok: false, ...owner };
  const every = int(f.default_adjustment_every, "default_adjustment_every", "Frecuencia de ajuste");
  if (isErr(every)) return { ok: false, ...every };
  const lag = int(f.default_lag_months, "default_lag_months", "Meses del índice");
  if (isErr(lag)) return { ok: false, ...lag };
  const duration = int(f.default_duration_months, "default_duration_months", "Duración");
  if (isErr(duration)) return { ok: false, ...duration };
  const stampRate = pct(f.stamp_tax_rate_pct || "0", "stamp_tax_rate_pct", "Alícuota de sellos");
  if (isErr(stampRate)) return { ok: false, ...stampRate };
  let exempt: number | null = null;
  if (f.stamp_tax_exempt_monthly.trim()) {
    exempt = parseAmountInput(f.stamp_tax_exempt_monthly);
    if (exempt == null || exempt < 0) return { ok: false, error: "Tope de exención: ingresá un monto válido o dejalo vacío.", field: "stamp_tax_exempt_monthly" };
  }
  const share = pct(f.stamp_tax_tenant_share_pct || "0", "stamp_tax_tenant_share_pct", "Parte del inquilino");
  if (isErr(share)) return { ok: false, ...share };
  const lead = int(f.charge_lead_days || "0", "charge_lead_days", "Anticipación del cargo");
  if (isErr(lead)) return { ok: false, ...lead };
  return {
    ok: true,
    values: {
      payment_window_days: window,
      grace_days: grace,
      late_fee_type: f.late_fee_type,
      late_fee_value: lateValue,
      late_fee_payee: f.late_fee_payee,
      admin_fee_pct: admin,
      admin_fee_vat: f.admin_fee_vat,
      tenant_commission: tenant,
      owner_commission: owner,
      default_index: f.default_index,
      default_adjustment_every: every,
      default_lag_months: lag,
      default_rounding: f.default_rounding,
      default_duration_months: duration,
      auto_apply_adjustments: f.auto_apply_adjustments,
      stamp_tax_rate_pct: stampRate,
      stamp_tax_exempt_monthly: exempt,
      stamp_tax_tenant_share_pct: share,
      vat_condition: f.vat_condition,
      broker_name: blankToNull(f.broker_name),
      broker_license: blankToNull(f.broker_license),
      payment_instructions: blankToNull(f.payment_instructions),
      receipt_footer: blankToNull(f.receipt_footer),
      charge_lead_days: lead,
    },
  };
}
