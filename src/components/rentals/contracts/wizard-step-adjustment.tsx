"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { INDEX_CODES, INDEX_META } from "@/lib/rentals/indices";
import { ROUNDING_LABEL } from "@/lib/rentals/labels";
import { buildContractPlan } from "@/lib/rentals/plan";
import { isYmd } from "@/lib/rentals/ymd";
import type { RentalAdjustmentMethod, RentalIndexCode, RentalRounding } from "@/lib/types/database";
import { indexKeyLabel, lagExample } from "./adjustment-view";
import { Callout, ChipGroup, Field, MoneyInput, StepIntro, ToggleRow } from "./wizard-fields";
import { AdjustmentPreview } from "./wizard-adjustment-preview";
import type { StepProps } from "./wizard-step-props";

/** Paso 4: cómo se actualiza el precio, con la vista previa del cronograma con índices reales. */

const METHODS: { value: RentalAdjustmentMethod; label: string; hint: string }[] = [
  { value: "indice", label: "Por índice", hint: "IPC, ICL, Casa Propia…: el sistema lo calcula solo cuando sale el dato." },
  { value: "porcentaje_fijo", label: "Porcentaje fijo", hint: "Ej.: 8 % cada 3 meses." },
  { value: "escalonado", label: "Montos escalonados", hint: "Montos pactados de antemano para cada tramo." },
  { value: "manual", label: "Lo cargo a mano", hint: "En cada ajuste cargás el monto nuevo." },
  { value: "sin_ajuste", label: "Sin ajuste", hint: "El mismo precio todo el contrato." },
];

const EVERY_PRESETS = ["3", "4", "6", "12"] as const;
const EVERY_LABEL: Record<(typeof EVERY_PRESETS)[number], string> = { "3": "Trimestral", "4": "Cuatrimestral", "6": "Semestral", "12": "Anual" };

export function StepAdjustment(props: StepProps) {
  const { state, set, errors, preview, hasPayments } = props;
  const [customEvery, setCustomEvery] = useState(!(EVERY_PRESETS as readonly string[]).includes(state.adjustment_every_months));
  const meta = INDEX_META[state.index_code];
  const every = Number(state.adjustment_every_months) || 0;
  const duration = Number(state.duration_months) || 0;
  const startMonth = isYmd(state.start_date) ? Number(state.start_date.slice(5, 7)) : 3;
  const firstAdjMonth = every ? ((startMonth - 1 + every) % 12) + 1 : 6;

  // Fechas de cada cambio de precio (para los montos escalonados): sin índices, sólo el calendario.
  const windows = useMemo(() => {
    if (!isYmd(state.start_date) || !duration || !every) return [];
    return buildContractPlan({
      start_date: state.start_date,
      duration_months: duration,
      initial_rent: 1,
      adjustment_method: "manual",
      index_code: null,
      adjustment_every_months: every,
      index_lag_months: 2,
      fixed_pct: null,
      steps: null,
      rounding: "none",
      cap_pct: null,
      allow_decrease: false,
      payment_window_days: 10,
    }).windows;
  }, [state.start_date, duration, every]);

  return (
    <div className="space-y-6">
      <StepIntro title="¿Cómo se actualiza el precio?">Con índice, el sistema calcula cada ajuste con los datos oficiales (INDEC, BCRA) y avisa cuándo toca.</StepIntro>
      {hasPayments && <Callout tone="warn">Con cobros registrados no se puede cambiar cómo se ajusta. Para corregir un ajuste puntual, usá la pestaña Ajustes del contrato.</Callout>}

      <Field label="Método">
        <ChipGroup<RentalAdjustmentMethod> ariaLabel="Método de actualización" value={state.adjustment_method} onChange={(v) => set({ adjustment_method: v })} options={METHODS} columns={3} />
      </Field>

      {state.adjustment_method === "indice" && (
        <Field label="Índice" error={errors.index_code}>
          <ChipGroup<RentalIndexCode>
            ariaLabel="Índice"
            value={state.index_code}
            onChange={(v) => set({ index_code: v })}
            columns={3}
            options={INDEX_CODES.map((c) => ({ value: c, label: `${INDEX_META[c].label} · ${INDEX_META[c].publisher}`, hint: INDEX_META[c].hint }))}
          />
          {preview?.index && preview.index.code === state.index_code && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {preview.index.lastKey
                ? `Último dato que tenemos: ${indexKeyLabel(preview.index.lastKey, preview.index.frequency)}.`
                : `Todavía no tenemos datos de ${preview.index.label}: los ajustes van a quedar esperando el índice.`}
            </p>
          )}
        </Field>
      )}

      {state.adjustment_method !== "sin_ajuste" && (
        <Field label="Cada cuánto cambia el precio" error={errors.adjustment_every_months}>
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipGroup<string>
              ariaLabel="Frecuencia"
              value={customEvery ? "otra" : state.adjustment_every_months}
              onChange={(v) => {
                if (v === "otra") setCustomEvery(true);
                else {
                  setCustomEvery(false);
                  set({ adjustment_every_months: v });
                }
              }}
              options={[...EVERY_PRESETS.map((e) => ({ value: e as string, label: EVERY_LABEL[e] })), { value: "otra", label: "Otra" }]}
            />
            {customEvery && (
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">cada</span>
                <Input
                  inputMode="numeric"
                  value={state.adjustment_every_months}
                  onChange={(e) => set({ adjustment_every_months: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                  className="h-10 w-16 text-center tabular-nums"
                  aria-label="Meses entre ajustes"
                />
                <span className="text-sm text-muted-foreground">meses</span>
              </div>
            )}
          </div>
        </Field>
      )}

      {state.adjustment_method === "indice" && meta.frequency === "monthly" && every > 0 && (
        <Field label="Qué meses del índice se usan">
          <ChipGroup<string>
            ariaLabel="Convención de meses"
            value={String(state.index_lag_months >= 2 ? 2 : 1)}
            onChange={(v) => set({ index_lag_months: Number(v) })}
            options={[
              {
                value: "2",
                label: "El último dato publicado (lo habitual)",
                hint: `${lagExample({ effectiveMonth: firstAdjMonth, every, lag: 2, indexLabel: meta.label })} Así se avisa el precio nuevo antes de que empiece el mes.`,
              },
              {
                value: "1",
                label: "Los meses del ciclo",
                hint: `${lagExample({ effectiveMonth: firstAdjMonth, every, lag: 1, indexLabel: meta.label })} El último dato sale a mitad de mes: se calcula unos días tarde.`,
              },
            ]}
          />
        </Field>
      )}
      {state.adjustment_method === "indice" && meta.frequency === "daily" && (
        <Callout>
          El {meta.label} se publica todos los días: cada ajuste compara el valor del día del ajuste con el del día en que empezó el ciclo.
        </Callout>
      )}

      {state.adjustment_method === "porcentaje_fijo" && (
        <Field label="Porcentaje de cada ajuste" htmlFor="w-fixed" error={errors.fixed_pct} hint="Ej.: 8,5 sube el precio un 8,5 % en cada ajuste.">
          <div className="flex items-center gap-2">
            <Input id="w-fixed" inputMode="decimal" value={state.fixed_pct} onChange={(e) => set({ fixed_pct: e.target.value })} className="h-10 w-28 tabular-nums" />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </Field>
      )}

      {state.adjustment_method === "escalonado" && (
        <Field label="Monto de cada tramo" error={errors.steps} hint="El primer tramo es el alquiler inicial del paso anterior.">
          {windows.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {windows.map((w, i) => (
                <div key={w.sequence} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2">
                  <span className="text-xs text-muted-foreground">Desde {formatDate(w.effectiveDate)}</span>
                  <MoneyInput
                    value={state.steps[i] ?? ""}
                    onChange={(v) => set((s) => ({ steps: Array.from({ length: windows.length }, (_, k) => (k === i ? v : (s.steps[k] ?? ""))) }))}
                    currency={state.currency}
                    ariaLabel={`Monto desde ${formatDate(w.effectiveDate)}`}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Elegí el inicio, el plazo y cada cuánto cambia para cargar los montos.</p>
          )}
        </Field>
      )}

      {(state.adjustment_method === "indice" || state.adjustment_method === "porcentaje_fijo" || state.adjustment_method === "manual") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Redondeo">
            <Select value={state.rounding} onValueChange={(v) => set({ rounding: v as RentalRounding })}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROUNDING_LABEL) as RentalRounding[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROUNDING_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tope por ajuste (opcional)" htmlFor="w-cap" error={errors.cap_pct} hint="Si el contrato dice «nunca más de X %».">
            <div className="flex items-center gap-2">
              <Input id="w-cap" inputMode="decimal" value={state.cap_pct} onChange={(e) => set({ cap_pct: e.target.value })} placeholder="Sin tope" className="h-10 w-28 tabular-nums" />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </Field>
          {state.adjustment_method === "indice" && (
            <div className="sm:col-span-2">
              <ToggleRow
                id="w-decrease"
                checked={state.allow_decrease}
                onChange={(v) => set({ allow_decrease: v })}
                title="Si el índice baja, el precio también baja"
                description="Apagado (lo habitual): si hay deflación, el precio queda igual."
              />
            </div>
          )}
        </div>
      )}

      {state.adjustment_method !== "sin_ajuste" && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cronograma de ajustes</h3>
          <AdjustmentPreview {...props} />
        </section>
      )}
    </div>
  );
}
