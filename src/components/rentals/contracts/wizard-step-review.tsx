"use client";

import { AlertTriangle, ArrowRight, CalendarRange, FileSignature, MapPin, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { formatDate, formatMoney } from "@/lib/format";
import type { ContractInput } from "@/lib/rentals/server/contracts";
import type { RentalCommissionRule, RentalContractService, RentalIndexCode } from "@/lib/types/database";
import { adjustmentSummary } from "./adjustment-view";
import { ContractTimeline } from "./contract-timeline";
import { TermsGrid } from "./contract-overview";
import { termGroups, type ContractTerms } from "./contract-terms";
import { buildTimelineModel } from "./timeline-model";
import { Field, StepIntro } from "./wizard-fields";
import { EntryCostCard } from "./wizard-step-fees";
import { entryOf } from "./wizard-derived";
import { WIZARD_STEPS, endDateOf, parseWizard } from "./wizard-state";
import type { StepProps } from "./wizard-step-props";

/** Paso 8: la "portada" del contrato con todo, lo que falta y los datos finales. */

function termsOf(i: ContractInput, end: string): ContractTerms {
  return {
    legal_regime: i.legal_regime,
    usage: i.usage,
    start_date: i.start_date,
    end_date: end,
    duration_months: Number(i.duration_months),
    signed_at: i.signed_at || null,
    currency: i.currency,
    initial_rent: Number(i.initial_rent),
    adjustment_method: i.adjustment_method,
    index_code: (i.index_code ?? null) as RentalIndexCode | null,
    adjustment_every_months: i.adjustment_every_months != null ? Number(i.adjustment_every_months) : null,
    index_lag_months: Number(i.index_lag_months ?? 2),
    fixed_pct: i.fixed_pct != null ? Number(i.fixed_pct) : null,
    steps: i.steps ? i.steps.map(Number) : null,
    rounding: i.rounding,
    cap_pct: i.cap_pct != null ? Number(i.cap_pct) : null,
    allow_decrease: Boolean(i.allow_decrease),
    payment_window_days: Number(i.payment_window_days),
    grace_days: Number(i.grace_days),
    late_fee_type: i.late_fee_type,
    late_fee_value: Number(i.late_fee_value),
    late_fee_payee: i.late_fee_payee,
    collector: i.collector,
    billing_starts_on: i.billing_starts_on || null,
    admin_fee_pct: Number(i.admin_fee_pct),
    admin_fee_vat: i.admin_fee_vat,
    tenant_commission: (i.tenant_commission ?? null) as RentalCommissionRule | null,
    owner_commission: (i.owner_commission ?? null) as RentalCommissionRule | null,
    deposit_amount: Number(i.deposit_amount),
    deposit_currency: i.deposit_currency ?? null,
    deposit_holder: i.deposit_holder,
    stamp_tax_status: i.stamp_tax_status,
    stamp_tax_amount: i.stamp_tax_amount != null ? Number(i.stamp_tax_amount) : null,
    expensas_payer: i.expensas_payer,
    expensas_mode: i.expensas_mode,
    expensas_extra_payer: i.expensas_extra_payer,
    services: i.services as RentalContractService[],
    insurance_required: i.insurance_required,
    insurance_company: i.insurance_company || null,
    insurance_policy: i.insurance_policy || null,
    insurance_expires_at: i.insurance_expires_at || null,
    early_termination_rule: i.early_termination_rule,
    reli_code: i.reli_code || null,
  };
}

export function StepReview(props: StepProps) {
  const { state, set, properties, people, preview, today, goTo, options, contractLabel } = props;
  const { input, issues } = parseWizard(state);
  const end = endDateOf(state);
  const property = properties.find((p) => p.id === state.property_id);
  const tenants = state.parties.filter((p) => p.role === "inquilino" && p.person_id);
  const names = tenants.map((t) => people.find((x) => x.id === t.person_id)?.fullName ?? "Persona");
  const entry = entryOf(state, options.settings);
  const model =
    preview && end
      ? buildTimelineModel({ startDate: state.start_date, endDate: end, today, initialRent: input ? Number(input.initial_rent) : 0, schedule: preview.schedule, adjustments: preview.adjustments })
      : null;

  return (
    <div className="space-y-6">
      <StepIntro title="Revisá y guardá">Así va a quedar el contrato. Podés guardarlo como borrador y activarlo cuando esté firmado.</StepIntro>

      {issues.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3.5 space-y-2">
          <p className="text-sm font-medium flex items-center gap-2 text-amber-900 dark:text-amber-100">
            <AlertTriangle size={16} /> Antes de guardar, revisá:
          </p>
          <ul className="space-y-1">
            {issues.map((i) => (
              <li key={`${i.step}-${i.field}-${i.message}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{i.message}</span>
                <button type="button" onClick={() => goTo(i.step)} className="inline-flex items-center gap-1 text-xs font-medium underline hover:no-underline">
                  Ir a {WIZARD_STEPS.find((s) => s.key === i.step)?.label} <ArrowRight size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border overflow-hidden">
        <div className="px-5 py-4 text-white relative overflow-hidden" style={{ backgroundColor: RENTALS_ACCENT }}>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(1_0_0/0.16),transparent_60%)]" aria-hidden />
          <p className="relative text-[11px] uppercase tracking-[0.14em] opacity-80 flex items-center gap-1.5">
            <FileSignature size={12} /> {contractLabel ? `Contrato ${contractLabel}` : "Contrato nuevo"}
          </p>
          <p className="relative text-lg font-semibold mt-1 flex items-center gap-1.5">
            <MapPin size={16} className="opacity-80" /> {property?.address ?? "Sin propiedad"}
          </p>
          <div className="relative mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] opacity-95">
            <span className="inline-flex items-center gap-1.5">
              <UserRound size={13} /> {names.length ? names.join(", ") : "Sin inquilino"}
            </span>
            {end && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange size={13} /> {formatDate(state.start_date)} → {formatDate(end)}
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-b">
          <Cell label="Alquiler inicial" value={input ? formatMoney(Number(input.initial_rent), state.currency) : "—"} />
          <Cell label="Actualización" value={input ? adjustmentSummary({ adjustment_method: input.adjustment_method, index_code: (input.index_code ?? null) as RentalIndexCode | null, adjustment_every_months: input.adjustment_every_months != null ? Number(input.adjustment_every_months) : null, fixed_pct: input.fixed_pct != null ? Number(input.fixed_pct) : null }) : "—"} />
          <Cell label="Valor del contrato" value={preview ? formatMoney(preview.projectedTotal, state.currency) : "—"} hint="Con los ajustes conocidos" />
          <Cell label="Entrada del inquilino" value={entry ? formatMoney(entry.tenantTotal, state.currency) : "—"} />
        </div>
        {model && (
          <div className="p-4 sm:p-5">
            <ContractTimeline model={model} currency={state.currency} startDate={state.start_date} endDate={end as string} draft indexLabel={preview?.index?.label ?? null} />
          </div>
        )}
      </div>

      {input && end && <TermsGrid groups={termGroups(termsOf(input, end))} />}

      <EntryCostCard entry={entry} currency={state.currency} generate={state.generate_entry_charge} onToggle={(v) => set({ generate_entry_charge: v })} />

      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="Código RELI (opcional)" hint="Registro de locaciones, si lo registraron.">
          <Input value={state.reli_code} onChange={(e) => set({ reli_code: e.target.value })} className="h-10" />
        </Field>
        <Field label="Cláusulas especiales (opcional)">
          <Textarea value={state.special_clauses} onChange={(e) => set({ special_clauses: e.target.value })} rows={3} placeholder="Mascotas, mejoras, uso de cochera…" />
        </Field>
      </div>
      {props.isDraft && (
        <p className="text-xs text-muted-foreground rounded-lg bg-muted/40 px-3.5 py-2.5">
          «Activar contrato» lo pone a regir: arma el cronograma, genera los cargos y le da al inquilino su link. Después subí el contrato firmado en la pestaña Documentos.
        </p>
      )}
      <Field label="Notas internas (sólo las ve el equipo)">
        <Textarea value={state.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="Ej.: el inquilino prefiere que lo llamen a la tarde." />
      </Field>
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card px-4 py-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums mt-0.5 break-words">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
