"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, parseAmountInput, parsePercentInput } from "@/lib/format";
import { LATE_FEE_TYPE_LABEL } from "@/lib/rentals/labels";
import { buildSchedule, periodAt } from "@/lib/rentals/schedule";
import { isYmd } from "@/lib/rentals/ymd";
import type { RentalLateFeeType, RentalMoneyOwner } from "@/lib/types/database";
import { lateFeeText, paymentWindowText } from "./contract-terms";
import { Callout, ChipGroup, Field, MoneyInput, StepIntro, ToggleRow } from "./wizard-fields";
import type { StepProps } from "./wizard-step-props";

/** Paso 5: plazo para pagar, punitorios, quién cobra y desde qué mes se cobra con el sistema. */

const WINDOWS = ["5", "10", "15"] as const;

export function StepBilling({ state, set, errors, today }: StepProps) {
  const [customWindow, setCustomWindow] = useState(!(WINDOWS as readonly string[]).includes(state.payment_window_days));
  const windowDays = Number(state.payment_window_days) || 0;
  const feeValue = state.late_fee_type === "fijo_diario" ? parseAmountInput(state.late_fee_value) : parsePercentInput(state.late_fee_value);
  const duration = Number(state.duration_months) || 0;
  const current =
    isYmd(state.start_date) && duration > 0 && state.start_date < today
      ? periodAt(buildSchedule({ startDate: state.start_date, durationMonths: duration, adjustmentEveryMonths: null, paymentWindowDays: 10 }), today)
      : null;

  return (
    <div className="space-y-6">
      <StepIntro title="¿Cómo se cobra?">El sistema genera cada mes lo que debe el inquilino unos días antes de que empiece el período.</StepIntro>

      <Field label="Plazo para pagar" error={errors.payment_window_days} hint={isYmd(state.start_date) && windowDays > 0 ? paymentWindowText(state.start_date, windowDays) : undefined}>
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipGroup<string>
            ariaLabel="Plazo para pagar"
            value={customWindow ? "otro" : state.payment_window_days}
            onChange={(v) => {
              if (v === "otro") setCustomWindow(true);
              else {
                setCustomWindow(false);
                set({ payment_window_days: v });
              }
            }}
            options={[...WINDOWS.map((w) => ({ value: w as string, label: `Del 1 al ${w}` })), { value: "otro", label: "Otro" }]}
          />
          {customWindow && (
            <div className="flex items-center gap-1.5">
              <Input
                inputMode="numeric"
                value={state.payment_window_days}
                onChange={(e) => set({ payment_window_days: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                className="h-10 w-16 text-center tabular-nums"
                aria-label="Días para pagar"
              />
              <span className="text-sm text-muted-foreground">días</span>
            </div>
          )}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
        <Field label="Punitorios">
          <Select value={state.late_fee_type} onValueChange={(v) => set({ late_fee_type: v as RentalLateFeeType })}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LATE_FEE_TYPE_LABEL) as RentalLateFeeType[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {LATE_FEE_TYPE_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {state.late_fee_type !== "ninguno" && (
          <Field label={state.late_fee_type === "fijo_diario" ? `Monto por día (${state.currency})` : "Porcentaje"} error={errors.late_fee_value}>
            {state.late_fee_type === "fijo_diario" ? (
              <MoneyInput value={state.late_fee_value} onChange={(v) => set({ late_fee_value: v })} currency={state.currency} invalid={Boolean(errors.late_fee_value)} />
            ) : (
              <div className="flex items-center gap-2">
                <Input inputMode="decimal" value={state.late_fee_value} onChange={(e) => set({ late_fee_value: e.target.value })} className="h-10 tabular-nums" aria-label="Porcentaje" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            )}
          </Field>
        )}
        <Field label="Días de gracia" error={errors.grace_days} hint="Sin punitorios.">
          <Input inputMode="numeric" value={state.grace_days} onChange={(e) => set({ grace_days: e.target.value.replace(/\D/g, "").slice(0, 2) })} className="h-10 tabular-nums" aria-label="Días de gracia" />
        </Field>
      </div>
      {state.late_fee_type !== "ninguno" && feeValue != null && (
        <Callout>
          {lateFeeText(state.late_fee_type, feeValue, state.currency)}. Corren desde el día siguiente al vencimiento: la mora es automática (art. 886 CCyC).
        </Callout>
      )}
      {state.late_fee_type !== "ninguno" && (
        <Field label="Los punitorios son para">
          <ChipGroup<RentalMoneyOwner>
            ariaLabel="Destino de los punitorios"
            value={state.late_fee_payee}
            onChange={(v) => set({ late_fee_payee: v })}
            options={[
              { value: "propietario", label: "El propietario" },
              { value: "inmobiliaria", label: "La inmobiliaria" },
            ]}
          />
        </Field>
      )}

      <Field label="¿Quién cobra el alquiler?">
        <ChipGroup<RentalMoneyOwner>
          ariaLabel="Quién cobra"
          value={state.collector}
          onChange={(v) => set({ collector: v })}
          options={[
            { value: "inmobiliaria", label: "La inmobiliaria", hint: "Entra a Caja, se hace el recibo y se le rinde al propietario." },
            { value: "propietario", label: "El propietario, directo", hint: "Igual registrás los pagos para saber quién debe y emitir recibos." },
          ]}
        />
      </Field>

      <div className="space-y-2">
        <ToggleRow
          id="w-billing-start"
          checked={state.billing_from_start}
          onChange={(v) => set({ billing_from_start: v, billing_starts_on: v ? "" : state.billing_starts_on || current?.start || "" })}
          title="Cobrar desde el primer mes"
          description="Apagalo si el contrato ya venía corriendo y los meses anteriores ya se cobraron por fuera."
        />
        {!state.billing_from_start && (
          <Field label="Se empieza a cobrar desde" htmlFor="w-billing-on" error={errors.billing_starts_on} hint="Se genera desde el período que contiene esta fecha.">
            <Input id="w-billing-on" type="date" value={state.billing_starts_on} onChange={(e) => set({ billing_starts_on: e.target.value })} className="h-10 sm:w-52" />
          </Field>
        )}
        {state.billing_from_start && current && current.index > 1 && (
          <Callout tone="warn">
            El contrato empezó el {formatDate(state.start_date)}: así se generarían los {current.index - 1} meses anteriores como deuda.{" "}
            <button type="button" className="font-medium underline hover:no-underline" onClick={() => set({ billing_from_start: false, billing_starts_on: current.start })}>
              Cobrar desde este mes ({formatDate(current.start)})
            </button>
          </Callout>
        )}
      </div>
    </div>
  );
}
