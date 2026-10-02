"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/lib/format";
import { EARLY_TERMINATION_LABEL, LEGAL_REGIME_META, USAGE_LABEL } from "@/lib/rentals/labels";
import { contractMonthsElapsed } from "@/lib/rentals/ymd";
import type { RentalEarlyTerminationRule, RentalLegalRegime, RentalUsage } from "@/lib/types/database";
import { Callout, ChipGroup, Field, MoneyInput, StepIntro } from "./wizard-fields";
import { applyRegime, editableNumber, endDateOf } from "./wizard-state";
import type { StepProps } from "./wizard-step-props";

/** Paso 3: régimen legal, plazo, moneda y alquiler inicial. */

const REGIMES: RentalLegalRegime[] = ["dnu_70_2023", "ley_27737", "ley_27551", "ccyc_2015"];

export function StepTerms({ state, set, errors, properties, today, hasPayments }: StepProps) {
  const [customDuration, setCustomDuration] = useState(!["24", "36"].includes(state.duration_months));
  const end = endDateOf(state);
  const property = properties.find((p) => p.id === state.property_id);
  const elapsed = state.start_date && state.start_date < today ? contractMonthsElapsed(state.start_date, today) : -1;

  return (
    <div className="space-y-6">
      <StepIntro title="Plazo y precio">Elegí el régimen: precarga el plazo, el índice y la regla de rescisión que corresponden. Después podés cambiar todo.</StepIntro>
      {hasPayments && <Callout tone="warn">Este contrato ya tiene cobros: las fechas, el precio y el ajuste no se pueden cambiar. Si hubo un error, anulá los cobros primero.</Callout>}

      <Field label="Régimen legal" hint="Depende de cuándo se firmó el contrato.">
        <ChipGroup<RentalLegalRegime>
          ariaLabel="Régimen legal"
          value={state.legal_regime}
          onChange={(v) => {
            set((s) => applyRegime(s, v));
            const preset = LEGAL_REGIME_META[v].preset.duration;
            setCustomDuration(![24, 36].includes(preset));
          }}
          options={REGIMES.map((r) => ({ value: r, label: LEGAL_REGIME_META[r].label, hint: LEGAL_REGIME_META[r].description }))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Empieza el" htmlFor="w-start" error={errors.start_date}>
          <Input id="w-start" type="date" value={state.start_date} onChange={(e) => set({ start_date: e.target.value })} className="h-10" />
        </Field>
        <Field label="Plazo" error={errors.duration_months}>
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipGroup<"24" | "36" | "otro">
              ariaLabel="Plazo en meses"
              value={customDuration ? "otro" : (state.duration_months as "24" | "36")}
              onChange={(v) => {
                if (v === "otro") setCustomDuration(true);
                else {
                  setCustomDuration(false);
                  set({ duration_months: v });
                }
              }}
              options={[
                { value: "24", label: "24 meses" },
                { value: "36", label: "36 meses" },
                { value: "otro", label: "Otro" },
              ]}
            />
            {customDuration && (
              <div className="flex items-center gap-1.5">
                <Input
                  inputMode="numeric"
                  value={state.duration_months}
                  onChange={(e) => set({ duration_months: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                  className="h-10 w-20 text-center tabular-nums"
                  aria-label="Meses"
                />
                <span className="text-sm text-muted-foreground">meses</span>
              </div>
            )}
          </div>
        </Field>
      </div>

      {end && (
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3.5 py-2.5 text-sm">
          <CalendarRange size={16} className="text-muted-foreground shrink-0" />
          <span>
            Va del <span className="font-medium">{formatDate(state.start_date)}</span> al <span className="font-medium">{formatDate(end)}</span>
            <span className="text-muted-foreground"> · el último día es el anterior al aniversario</span>
          </span>
        </div>
      )}
      {elapsed >= 1 && (
        <Callout>
          Empezó hace {elapsed} {elapsed === 1 ? "mes" : "meses"}. En «Actualización» vas a ver cuánto debería pagar hoy según el índice (y podés cargar lo que paga de verdad), y en «Cobro» elegís desde qué mes se cobra con el sistema.
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field
          label={`Alquiler del primer mes (${state.currency})`}
          htmlFor="w-rent"
          error={errors.initial_rent}
          hint={
            property?.listingRent ? (
              <button type="button" className="underline hover:no-underline" onClick={() => set({ initial_rent: editableNumber(property.listingRent) })}>
                Usar el pretendido: {formatMoney(property.listingRent, property.listingCurrency || "ARS")}
              </button>
            ) : (
              "Escribilo así: 500.000"
            )
          }
        >
          <MoneyInput id="w-rent" value={state.initial_rent} onChange={(v) => set({ initial_rent: v })} currency={state.currency} invalid={Boolean(errors.initial_rent)} large />
        </Field>
        <Field label="Moneda">
          <ChipGroup<"ARS" | "USD">
            ariaLabel="Moneda"
            value={state.currency}
            onChange={(v) => set({ currency: v, deposit_currency: v })}
            options={[
              { value: "ARS", label: "Pesos" },
              { value: "USD", label: "Dólares" },
            ]}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Uso">
          <Select value={state.usage} onValueChange={(v) => set({ usage: v as RentalUsage })}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(USAGE_LABEL) as RentalUsage[]).map((u) => (
                <SelectItem key={u} value={u}>
                  {USAGE_LABEL[u]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Firmado el" htmlFor="w-signed" hint="Opcional." error={errors.signed_at}>
          <Input id="w-signed" type="date" value={state.signed_at} onChange={(e) => set({ signed_at: e.target.value })} className="h-10" />
        </Field>
        <Field label="Si el inquilino se va antes">
          <Select value={state.early_termination_rule} onValueChange={(v) => set({ early_termination_rule: v as RentalEarlyTerminationRule })}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(EARLY_TERMINATION_LABEL) as RentalEarlyTerminationRule[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {EARLY_TERMINATION_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {state.early_termination_rule === "pactada" && (
        <Field label="Qué dice el contrato sobre la rescisión" htmlFor="w-term-notes">
          <Textarea id="w-term-notes" value={state.early_termination_notes} onChange={(e) => set({ early_termination_notes: e.target.value })} rows={2} placeholder="Ej.: un mes de alquiler si avisa con 60 días…" />
        </Field>
      )}
    </div>
  );
}
