"use client";

import { KeyRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, parseAmountInput, parsePercentInput } from "@/lib/format";
import { commissionAmount } from "@/lib/rentals/entry-costs";
import { STAMP_STATUS_LABEL } from "@/lib/rentals/labels";
import { hasStipulatedAmounts } from "@/lib/rentals/plan";
import type { RentalCommissionBasis, RentalMoneyOwner, RentalStampTaxStatus } from "@/lib/types/database";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import type { EntryBreakdown } from "./entry-breakdown";
import { Callout, ChipGroup, Field, MoneyInput, StepIntro, ToggleRow } from "./wizard-fields";
import { entryOf } from "./wizard-derived";
import { editableNumber, previewInputOf, type CommissionDraft, type PlanPreviewInput } from "./wizard-state";
import type { StepProps } from "./wizard-step-props";

/** Paso 6: honorarios, depósito, sellado y el costo de entrada del inquilino. */

const BASIS_LABEL: Record<RentalCommissionBasis, string> = {
  pct_total_contrato: "% del total del contrato",
  meses: "Meses de alquiler",
  monto_fijo: "Monto fijo",
  ninguna: "Sin honorarios",
};

/**
 * En palabras, qué valor del contrato toman el sellado y los honorarios "% del
 * total" (el mismo que va al cargo de ingreso): con montos pactados, su suma;
 * si el precio se ajusta por índice o a mano, el alquiler a la firma × meses.
 * Sin decirlo, un contrato por índice cargado con fecha pasada mostraría un
 * "valor del contrato" distinto del que figura en el resumen.
 */
function contractValueBasis(p: PlanPreviewInput, currency: string): { total: string; average: string; atSigning: boolean } {
  if (hasStipulatedAmounts(p.adjustment_method)) {
    return { total: "la suma de los alquileres pactados", average: "el promedio de los alquileres pactados", atSigning: false };
  }
  // Índice o manual: los ajustes no entran (art. 285 CTP); sin ajuste no hay nada que aclarar.
  const atSigning = p.adjustment_method !== "sin_ajuste";
  return {
    total: `${formatMoney(p.initial_rent, currency)} × ${p.duration_months} meses${atSigning ? " a precio de la firma" : ""}`,
    average: atSigning ? "el alquiler a la firma" : "el alquiler",
    atSigning,
  };
}

function CommissionField({
  label,
  value,
  onChange,
  currency,
  rent,
  months,
  contractValue,
  atSigning,
  error,
}: {
  label: string;
  value: CommissionDraft;
  onChange: (v: CommissionDraft) => void;
  currency: string;
  rent: number;
  months: number;
  /** El mismo valor del contrato que usa el cargo de ingreso (montos pactados o precio a la firma). */
  contractValue: number | null;
  /** El valor es a precio de la firma: puede no coincidir con el "valor total" del resumen. */
  atSigning: boolean;
  error?: string;
}) {
  const parsed = value.basis === "monto_fijo" ? parseAmountInput(value.value) : parsePercentInput(value.value);
  const amount =
    value.basis !== "ninguna" && parsed != null && Number.isFinite(parsed)
      ? commissionAmount({ basis: value.basis, value: parsed, vat: value.vat }, { monthlyRent: rent, durationMonths: months, contractValue })
      : null;
  // En "% del total" se muestra sobre qué valor: en un escalonado no es alquiler × meses.
  const details = [
    value.basis === "pct_total_contrato" && parsed != null && contractValue != null && contractValue > 0
      ? `${parsed.toLocaleString("es-AR")} % de ${formatMoney(contractValue, currency)}${atSigning ? " a precio de la firma" : ""}`
      : null,
    amount?.vat ? `IVA incluido: ${formatMoney(amount.vat, currency)}` : null,
  ].filter(Boolean);
  return (
    <Field label={label} error={error} hint={amount && amount.total > 0 ? `= ${formatMoney(amount.total, currency)}${details.length ? ` (${details.join("; ")})` : ""}` : undefined}>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <Select value={value.basis} onValueChange={(v) => onChange({ ...value, basis: v as RentalCommissionBasis })}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(BASIS_LABEL) as RentalCommissionBasis[]).map((b) => (
              <SelectItem key={b} value={b}>
                {BASIS_LABEL[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value.basis !== "ninguna" && (
          <Input
            inputMode="decimal"
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
            placeholder={value.basis === "monto_fijo" ? "0,00" : value.basis === "meses" ? "1" : "5"}
            className="h-10 tabular-nums"
            aria-label={`${label}: valor`}
          />
        )}
      </div>
      {value.basis !== "ninguna" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer mt-1.5">
          <Checkbox checked={value.vat} onCheckedChange={(v) => onChange({ ...value, vat: v === true })} /> Sumar IVA (21 %)
        </label>
      )}
    </Field>
  );
}

export function EntryCostCard({ entry, currency, generate, onToggle }: { entry: EntryBreakdown | null; currency: string; generate: boolean; onToggle?: (v: boolean) => void }) {
  const tenantLines = entry?.lines.filter((l) => l.payer === "inquilino") ?? [];
  const ownerLines = entry?.lines.filter((l) => l.payer === "propietario") ?? [];
  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ backgroundColor: `${RENTALS_ACCENT}0d` }}>
        <KeyRound size={16} style={{ color: RENTALS_ACCENT }} />
        <p className="text-sm font-semibold">Costo de entrada del inquilino</p>
        <p className="ml-auto text-lg font-semibold tabular-nums">{entry ? formatMoney(entry.tenantTotal, currency) : "—"}</p>
      </div>
      <div className="px-4 py-3 space-y-1.5">
        {!entry ? (
          <p className="text-xs text-muted-foreground">Completá el alquiler y el plazo para calcularlo.</p>
        ) : (
          <>
            {tenantLines.map((l, i) => (
              <div key={`${l.kind}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{l.concept}</span>
                <span className="tabular-nums font-medium">{formatMoney(l.amount, currency)}</span>
              </div>
            ))}
            {entry.separateDeposit && (
              <p className="text-xs text-muted-foreground">+ depósito de {formatMoney(entry.separateDeposit.amount, entry.separateDeposit.currency)} (en otra moneda, va aparte).</p>
            )}
            {ownerLines.length > 0 && (
              <p className="text-[11px] text-muted-foreground pt-1 border-t mt-2">
                Paga el propietario: {ownerLines.map((l) => `${l.concept.toLowerCase()} ${formatMoney(l.amount, currency)}`).join(" · ")}.
              </p>
            )}
          </>
        )}
      </div>
      {onToggle && (
        <label className="flex items-start gap-2.5 px-4 py-3 border-t bg-muted/30 cursor-pointer">
          <Checkbox checked={generate} onCheckedChange={(v) => onToggle(v === true)} className="mt-0.5" />
          <span className="text-sm">
            Generar el cargo de ingreso al activar
            <span className="block text-[11px] text-muted-foreground">Depósito, honorarios y sellado en un cargo. El primer mes sale con su cargo mensual.</span>
          </span>
        </label>
      )}
    </div>
  );
}

export function StepFees({ state, set, errors, options }: StepProps) {
  const p = previewInputOf(state);
  const rent = p?.initial_rent ?? 0;
  const months = p?.duration_months ?? 0;
  const entry = entryOf(state, options.settings);
  const stamp = entry?.stamp;
  const contractValue = entry?.contractValue ?? null;
  const basis = p ? contractValueBasis(p, state.currency) : null;
  const threshold = options.settings.stamp_tax_exempt_monthly;
  const currencyWord = state.currency === "USD" ? "dólares" : state.currency;
  const ri = options.settings.vat_condition === "responsable_inscripto";

  return (
    <div className="space-y-6">
      <StepIntro title="Honorarios, depósito y sellado">Vienen de la configuración de la inmobiliaria; cambialos sólo si este contrato es distinto.</StepIntro>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Administración (a cargo del propietario)" error={errors.admin_fee_pct} hint="Se descuenta de lo cobrado en cada rendición. Ley 9445: 10 % de plaza.">
          <div className="flex items-center gap-2">
            <Input inputMode="decimal" value={state.admin_fee_pct} onChange={(e) => set({ admin_fee_pct: e.target.value })} className="h-10 w-24 tabular-nums" aria-label="Porcentaje de administración" />
            <span className="text-sm text-muted-foreground">% de lo cobrado</span>
          </div>
        </Field>
        <div className="sm:pt-6">
          <ToggleRow
            id="w-admin-vat"
            checked={state.admin_fee_vat}
            onChange={(v) => set({ admin_fee_vat: v })}
            title="Sumar IVA a la administración"
            description={ri ? "La inmobiliaria es Responsable Inscripta: corresponde IVA." : "Sólo si la inmobiliaria es Responsable Inscripta."}
          />
        </div>
        <CommissionField label="Honorarios del inquilino" value={state.tenant_commission} onChange={(v) => set({ tenant_commission: v })} currency={state.currency} rent={rent} months={months} contractValue={contractValue} atSigning={basis?.atSigning ?? false} error={errors.tenant_commission} />
        <CommissionField label="Honorarios del propietario" value={state.owner_commission} onChange={(v) => set({ owner_commission: v })} currency={state.currency} rent={rent} months={months} contractValue={contractValue} atSigning={basis?.atSigning ?? false} error={errors.owner_commission} />
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field
          label="Depósito en garantía"
          error={errors.deposit_amount}
          hint={
            rent > 0 ? (
              <button type="button" className="underline hover:no-underline" onClick={() => set({ deposit_amount: editableNumber(rent), deposit_currency: state.currency })}>
                Igual a un mes: {formatMoney(rent, state.currency)}
              </button>
            ) : (
              "Dejalo vacío si no hay depósito."
            )
          }
        >
          <MoneyInput value={state.deposit_amount} onChange={(v) => set({ deposit_amount: v })} currency={state.deposit_currency} invalid={Boolean(errors.deposit_amount)} placeholder="Sin depósito" />
        </Field>
        <Field label="Moneda del depósito">
          <ChipGroup<"ARS" | "USD">
            ariaLabel="Moneda del depósito"
            value={state.deposit_currency}
            onChange={(v) => set({ deposit_currency: v })}
            options={[
              { value: "ARS", label: "Pesos" },
              { value: "USD", label: "Dólares" },
            ]}
          />
        </Field>
      </div>
      {parseAmountInput(state.deposit_amount) ? (
        <Field label="¿Quién guarda el depósito?">
          <ChipGroup<RentalMoneyOwner>
            ariaLabel="Quién guarda el depósito"
            value={state.deposit_holder}
            onChange={(v) => set({ deposit_holder: v })}
            options={[
              { value: "inmobiliaria", label: "La inmobiliaria" },
              { value: "propietario", label: "El propietario" },
            ]}
          />
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sellado (Impuesto de Sellos)">
          <Select value={state.stamp_tax_status} onValueChange={(v) => set({ stamp_tax_status: v as RentalStampTaxStatus })}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STAMP_STATUS_LABEL) as RentalStampTaxStatus[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {STAMP_STATUS_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {state.stamp_tax_status === "pendiente" && (
          <Field label="Monto del sellado (opcional)" error={errors.stamp_tax_amount} hint="Si Rentas ya lo liquidó, ponelo; si no, lo calculamos.">
            <MoneyInput value={state.stamp_tax_amount} onChange={(v) => set({ stamp_tax_amount: v })} currency={state.currency} placeholder={stamp && !stamp.manual ? editableNumber(stamp.tax) : "0,00"} />
          </Field>
        )}
      </div>
      {stamp && state.stamp_tax_status === "pendiente" && !stamp.manual && (
        stamp.exempt ? (
          <Callout tone="ok">
            Exento: {basis?.average ?? "el promedio mensual"} ({formatMoney(stamp.averageMonthlyArs ?? stamp.averageMonthly, "ARS")}) no supera {formatMoney(threshold, "ARS")}.{" "}
            <button type="button" className="font-medium underline hover:no-underline" onClick={() => set({ stamp_tax_status: "exento" })}>
              Marcar como exento
            </button>
          </Callout>
        ) : (
          <Callout>
            {stamp.needsRate && (
              <>
                Contrato en {currencyWord}: el tope de exención ({formatMoney(threshold, "ARS")} por mes) se compara en pesos, al dólar BNA vendedor del día
                hábil anterior a la firma, así que no lo damos por exento. Si en pesos no lo supera, elegí «Exento»; si Rentas ya liquidó el sellado, cargá
                el monto en {currencyWord}.{" "}
              </>
            )}
            {formatMoney(stamp.tax, state.currency)}: {options.settings.stamp_tax_rate_pct.toLocaleString("es-AR")} % del valor del contrato ({formatMoney(stamp.base, state.currency)}{basis ? `, ${basis.total}` : ""}). Paga el inquilino el {options.settings.stamp_tax_tenant_share_pct.toLocaleString("es-AR")} %: {formatMoney(stamp.tenantPart, state.currency)}.
          </Callout>
        )
      )}

      <EntryCostCard entry={entry} currency={state.currency} generate={state.generate_entry_charge} onToggle={(v) => set({ generate_entry_charge: v })} />
    </div>
  );
}
