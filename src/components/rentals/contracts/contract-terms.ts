import { formatDate, formatMoney } from "@/lib/format";
import {
  DEPOSIT_STATUS_LABEL,
  EARLY_TERMINATION_LABEL,
  EXPENSAS_MODE_LABEL,
  LEGAL_REGIME_META,
  ROUNDING_LABEL,
  SERVICE_KIND_META,
  STAMP_STATUS_LABEL,
  USAGE_LABEL,
} from "@/lib/rentals/labels";
import { INDEX_META, isIndexCode } from "@/lib/rentals/indices";
import type { RentalCommissionRule, RentalContract } from "@/lib/types/database";
import { adjustmentSummary, lagExample, pctLabel } from "./adjustment-view";

/**
 * Condiciones del contrato en castellano, agrupadas. Fuente única para la
 * ficha (pestaña Resumen) y la revisión del asistente: lo que se muestra
 * antes de guardar es exactamente lo que después figura en la ficha.
 */

export type ContractTerms = Pick<
  RentalContract,
  | "legal_regime"
  | "usage"
  | "start_date"
  | "end_date"
  | "duration_months"
  | "signed_at"
  | "currency"
  | "initial_rent"
  | "adjustment_method"
  | "index_code"
  | "adjustment_every_months"
  | "index_lag_months"
  | "fixed_pct"
  | "steps"
  | "rounding"
  | "cap_pct"
  | "allow_decrease"
  | "payment_window_days"
  | "grace_days"
  | "late_fee_type"
  | "late_fee_value"
  | "late_fee_payee"
  | "collector"
  | "billing_starts_on"
  | "admin_fee_pct"
  | "admin_fee_vat"
  | "tenant_commission"
  | "owner_commission"
  | "deposit_amount"
  | "deposit_currency"
  | "deposit_holder"
  | "stamp_tax_status"
  | "stamp_tax_amount"
  | "expensas_payer"
  | "expensas_mode"
  | "expensas_extra_payer"
  | "services"
  | "insurance_required"
  | "insurance_company"
  | "insurance_policy"
  | "insurance_expires_at"
  | "early_termination_rule"
  | "reli_code"
> & { deposit_status?: RentalContract["deposit_status"] };

export interface TermRow {
  label: string;
  value: string;
  hint?: string;
}

export interface TermGroup {
  title: string;
  rows: TermRow[];
}

const num = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

/** "0,5 % diario (≈ 15 % por mes)". */
export function lateFeeText(type: RentalContract["late_fee_type"], value: number, currency: string): string {
  switch (type) {
    case "diario_pct":
      return `${num(value)} % por día (≈ ${num(Math.round(value * 30 * 100) / 100)} % por mes)`;
    case "mensual_pct":
      return `${num(value)} % por mes (≈ ${num(Math.round((value / 30) * 1000) / 1000)} % por día)`;
    case "fijo_diario":
      return `${formatMoney(value, currency)} por día de atraso`;
    default:
      return "Sin punitorios";
  }
}

/** "Del 1 al 10 de cada mes" o "Hasta 10 días desde el inicio de cada período". */
export function paymentWindowText(startDate: string, days: number): string {
  const startDay = Number(startDate.slice(8, 10));
  if (startDay === 1) return `Del 1 al ${days} de cada mes`;
  return `Dentro de los ${days} días desde el inicio de cada período (el ${startDay} de cada mes)`;
}

export function commissionText(rule: RentalCommissionRule | null | undefined, currency: string): string {
  if (!rule || rule.basis === "ninguna" || !(rule.value > 0)) return "Sin honorarios";
  const vat = rule.vat ? " + IVA" : "";
  if (rule.basis === "pct_total_contrato") return `${num(rule.value)} % del valor total del contrato${vat}`;
  if (rule.basis === "meses") return `${num(rule.value)} ${rule.value === 1 ? "mes" : "meses"} de alquiler${vat}`;
  return `${formatMoney(rule.value, currency)} fijo${vat}`;
}

export function lagText(lag: number): string {
  if (lag >= 2) return "Último dato publicado al momento del ajuste";
  if (lag === 1) return "Los meses del ciclo que termina";
  return "Mismo mes del ajuste";
}

export function termGroups(t: ContractTerms): TermGroup[] {
  const cur = t.currency;
  const code = t.index_code && isIndexCode(t.index_code) ? t.index_code : null;
  const meta = code ? INDEX_META[code] : null;
  const firstAdjMonth = t.adjustment_every_months ? ((Number(t.start_date.slice(5, 7)) - 1 + t.adjustment_every_months) % 12) + 1 : 6;

  const update: TermRow[] = [{ label: "Actualización", value: adjustmentSummary(t) }];
  if (t.adjustment_method === "indice" && meta) {
    update.push({ label: "Índice", value: `${meta.name} (${meta.publisher})` });
    if (meta.frequency === "monthly" && t.adjustment_every_months) {
      update.push({
        label: "Meses que se usan",
        value: lagText(t.index_lag_months),
        hint: lagExample({ effectiveMonth: firstAdjMonth, every: t.adjustment_every_months, lag: t.index_lag_months, indexLabel: meta.label }),
      });
    } else if (meta.frequency === "daily") {
      update.push({ label: "Cómo se calcula", value: "Valor del día del ajuste ÷ valor del día en que empezó el ciclo" });
    }
  }
  if (t.adjustment_method === "escalonado" && t.steps?.length) {
    update.push({ label: "Montos pactados", value: t.steps.map((s) => formatMoney(s, cur)).join(" → ") });
  }
  if (t.adjustment_method !== "sin_ajuste" && t.adjustment_method !== "escalonado") {
    update.push({ label: "Redondeo", value: ROUNDING_LABEL[t.rounding] });
    if (t.cap_pct != null) update.push({ label: "Tope por ajuste", value: pctLabel(Number(t.cap_pct), { signed: false }) });
    update.push({ label: "Si el índice baja", value: t.allow_decrease ? "El precio también baja" : "El precio queda igual" });
  }

  const depositCur = t.deposit_currency || cur;
  return [
    {
      title: "Plazo",
      rows: [
        { label: "Régimen legal", value: LEGAL_REGIME_META[t.legal_regime].label },
        { label: "Uso", value: USAGE_LABEL[t.usage] },
        { label: "Inicio", value: formatDate(t.start_date) },
        { label: "Fin", value: formatDate(t.end_date) },
        { label: "Plazo", value: `${t.duration_months} meses` },
        { label: "Firma", value: t.signed_at ? formatDate(t.signed_at) : "Sin cargar" },
        { label: "Rescisión anticipada", value: EARLY_TERMINATION_LABEL[t.early_termination_rule] },
      ],
    },
    {
      title: "Precio y actualización",
      rows: [{ label: "Alquiler inicial", value: formatMoney(t.initial_rent, cur) }, ...update],
    },
    {
      title: "Cobro",
      rows: [
        { label: "Plazo para pagar", value: paymentWindowText(t.start_date, t.payment_window_days) },
        { label: "Días de gracia", value: t.grace_days ? `${t.grace_days} ${t.grace_days === 1 ? "día" : "días"} sin punitorios` : "Sin gracia" },
        { label: "Punitorios", value: lateFeeText(t.late_fee_type, Number(t.late_fee_value), cur), hint: t.late_fee_type !== "ninguno" ? `Son para ${t.late_fee_payee === "inmobiliaria" ? "la inmobiliaria" : "el propietario"}` : undefined },
        { label: "Quién cobra", value: t.collector === "propietario" ? "El propietario, directo" : "La inmobiliaria (entra a Caja y se rinde)" },
        ...(t.billing_starts_on && t.billing_starts_on > t.start_date ? [{ label: "Se cobra desde", value: formatDate(t.billing_starts_on), hint: "El contrato ya venía corriendo" }] : []),
      ],
    },
    {
      title: "Honorarios, depósito y sellado",
      rows: [
        { label: "Administración", value: `${num(Number(t.admin_fee_pct))} % de lo cobrado${t.admin_fee_vat ? " + IVA" : ""}`, hint: "A cargo del propietario" },
        { label: "Honorarios del inquilino", value: commissionText(t.tenant_commission, cur) },
        { label: "Honorarios del propietario", value: commissionText(t.owner_commission, cur) },
        {
          label: "Depósito",
          value: Number(t.deposit_amount) > 0 ? formatMoney(t.deposit_amount, depositCur) : "Sin depósito",
          hint: Number(t.deposit_amount) > 0 ? `Lo guarda ${t.deposit_holder === "propietario" ? "el propietario" : "la inmobiliaria"}${t.deposit_status ? ` · ${DEPOSIT_STATUS_LABEL[t.deposit_status]}` : ""}` : undefined,
        },
        { label: "Sellado", value: `${STAMP_STATUS_LABEL[t.stamp_tax_status]}${t.stamp_tax_amount ? ` · ${formatMoney(t.stamp_tax_amount, cur)}` : ""}` },
      ],
    },
    {
      title: "Expensas y servicios",
      rows: [
        {
          label: "Expensas ordinarias",
          value:
            t.expensas_payer === "no_aplica"
              ? "No tiene expensas"
              : t.expensas_payer === "propietario"
                ? "Las paga el propietario"
                : EXPENSAS_MODE_LABEL[t.expensas_mode],
        },
        ...(t.expensas_payer !== "no_aplica" ? [{ label: "Extraordinarias", value: t.expensas_extra_payer === "inquilino" ? "Las paga el inquilino" : "Las paga el propietario" }] : []),
        ...(t.services ?? []).map((s) => ({
          label: SERVICE_KIND_META[s.kind]?.label ?? s.kind,
          value: `Paga el ${s.payer}${s.proof_required ? ` · pide comprobante ${s.frequency === "bimestral" ? "cada 2 meses" : "cada mes"}` : ""}`,
        })),
        {
          label: "Seguro",
          value: t.insurance_required ? [t.insurance_company, t.insurance_policy ? `póliza ${t.insurance_policy}` : null].filter(Boolean).join(" · ") || "Pedido" : "No se pidió",
          hint: t.insurance_required && t.insurance_expires_at ? `Vence el ${formatDate(t.insurance_expires_at)}` : undefined,
        },
        ...(t.reli_code ? [{ label: "Código RELI", value: t.reli_code }] : []),
      ],
    },
  ];
}
