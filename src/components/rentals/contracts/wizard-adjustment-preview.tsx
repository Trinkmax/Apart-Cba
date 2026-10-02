"use client";

import { useState } from "react";
import { Loader2, PencilLine, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money, RENTALS_ACCENT } from "@/components/rentals/ui";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { addMonthsToMonth } from "@/lib/rentals/ymd";
import { indexKeyLabel, pctLabel, type TimelineAdjustment } from "./adjustment-view";
import { CERTAINTY_META } from "./contract-timeline";
import type { PlanPreview } from "./types";
import { MoneyInput } from "./wizard-fields";
import type { StepProps } from "./wizard-step-props";

/**
 * Vista previa del cronograma de ajustes con los índices reales. En un
 * contrato que ya venía corriendo muestra cuánto debería pagar hoy y deja
 * cargar el monto real de los ajustes que ya pasaron.
 */

function monthsText(a: TimelineAdjustment, preview: PlanPreview): string {
  if (!a.fromKey || !a.toKey) return "—";
  if (preview.index?.frequency === "daily") return `${indexKeyLabel(a.fromKey, "daily")} → ${indexKeyLabel(a.toKey, "daily")}`;
  const first = addMonthsToMonth(a.fromKey, 1);
  return first === a.toKey ? indexKeyLabel(a.toKey) : `${indexKeyLabel(first)} a ${indexKeyLabel(a.toKey)}`;
}

function statusOf(a: TimelineAdjustment, indexLabel: string | null): { label: string; color: string } {
  if (a.overridden) return { label: "Monto real", color: "#10b981" };
  switch (a.status) {
    case "calculado":
      return { label: "Según el índice", color: CERTAINTY_META.calculado.color };
    case "pendiente_indice":
      return { label: indexLabel ? `Esperando ${indexLabel}` : "Esperando índice", color: CERTAINTY_META.esperando.color };
    case "pendiente_manual":
      return { label: "Lo cargás a mano", color: CERTAINTY_META.a_cargar.color };
    case "aplicado":
      return { label: "Aplicado", color: CERTAINTY_META.aplicado.color };
    default:
      return { label: "A calcular", color: CERTAINTY_META.futuro.color };
  }
}

export function AdjustmentPreview({ state, set, preview, previewLoading, today, isDraft, errors }: StepProps) {
  const [editing, setEditing] = useState<number | null>(null);
  if (!preview) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        {previewLoading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Calculando con los índices oficiales…
          </span>
        ) : (
          "Completá el inicio, el plazo y el alquiler para ver el cronograma."
        )}
      </div>
    );
  }
  const idx = preview.index?.label ?? null;
  const currency = state.currency;

  return (
    <div className="space-y-3">
      {preview.started && preview.rentToday != null && preview.adjustments.some((a) => a.effectiveDate <= today) && (
        <div className="rounded-xl border px-4 py-3 flex items-start gap-3" style={{ borderColor: `${RENTALS_ACCENT}55`, backgroundColor: `${RENTALS_ACCENT}0d` }}>
          <Sparkles size={18} className="shrink-0 mt-0.5" style={{ color: RENTALS_ACCENT }} />
          <div className="min-w-0">
            <p className="text-sm">
              {idx ? `Según ${idx}, hoy` : "Hoy"} el alquiler es <span className="font-semibold tabular-nums">{formatMoney(preview.rentToday, currency)}</span>
              {preview.todayPeriodIndex ? <span className="text-muted-foreground"> · período {preview.todayPeriodIndex} de {preview.schedule.length}</span> : null}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {preview.waitingIndex
                ? "Hay un ajuste que ya rige y todavía espera el índice: se cobra la diferencia cuando salga."
                : isDraft
                  ? "Si en la realidad paga otro monto, tocá «Corregir» en el ajuste que corresponda."
                  : "Calculado con los índices publicados."}
            </p>
          </div>
        </div>
      )}

      {!isDraft && (
        <p className="text-[11px] text-muted-foreground">
          Vista previa con las condiciones de este formulario. Lo que ya se aplicó (y las correcciones) está en la pestaña Ajustes del contrato.
        </p>
      )}
      {preview.adjustments.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg bg-muted/40 px-3.5 py-2.5">Con estas condiciones el precio no cambia en todo el contrato.</p>
      ) : (
        <div className={cn("rounded-xl border overflow-hidden transition-opacity", previewLoading && "opacity-60")}>
          <div className="hidden sm:grid grid-cols-[2rem_6.5rem_minmax(0,1fr)_8rem_4.5rem_8.5rem] gap-2 px-3 py-2 bg-muted/40 border-b text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <span>#</span>
            <span>Rige desde</span>
            <span>{preview.index ? "Índice de" : "Detalle"}</span>
            <span className="text-right">Alquiler</span>
            <span className="text-right">Var.</span>
            <span>Estado</span>
          </div>
          <ul className="divide-y">
            {preview.adjustments.map((a) => {
              const st = statusOf(a, idx);
              const past = a.effectiveDate <= today;
              const canFix = isDraft && past;
              const ov = state.overrides[String(a.sequence)];
              const open = editing === a.sequence;
              return (
                <li key={a.sequence} className={cn("px-3 py-2.5", past && "bg-muted/20")}>
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] sm:grid-cols-[2rem_6.5rem_minmax(0,1fr)_8rem_4.5rem_8.5rem] gap-x-2 gap-y-1 items-center">
                    <span className="text-xs text-muted-foreground tabular-nums">{a.sequence}</span>
                    <span className="text-sm tabular-nums">{formatDate(a.effectiveDate)}</span>
                    <span className="hidden sm:block text-xs text-muted-foreground truncate">{preview.index ? monthsText(a, preview) : "—"}</span>
                    <span className="text-right">{a.amount != null ? <Money amount={a.amount} currency={currency} className="text-sm font-semibold" /> : <span className="text-xs text-muted-foreground">—</span>}</span>
                    <span className="hidden sm:block text-right text-xs tabular-nums text-muted-foreground">{a.variationPct != null && a.amount != null ? pctLabel(a.variationPct) : ""}</span>
                    <span className="col-span-2 col-start-2 sm:col-span-1 sm:col-start-auto flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: st.color }}>
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                        {st.label}
                      </span>
                      {canFix && (
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setEditing(open ? null : a.sequence)}>
                          {open ? <X size={12} /> : <PencilLine size={12} />} {open ? "Listo" : ov?.amount ? "Editar" : "Corregir"}
                        </Button>
                      )}
                    </span>
                  </div>
                  {open && (
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center rounded-lg bg-background border p-2.5">
                      <MoneyInput
                        value={ov?.amount ?? ""}
                        onChange={(v) => set((s) => ({ overrides: { ...s.overrides, [String(a.sequence)]: { amount: v, reason: s.overrides[String(a.sequence)]?.reason ?? "" } } }))}
                        currency={currency}
                        placeholder={a.amount != null ? String(Math.round(a.amount)) : "Monto real"}
                        ariaLabel={`Monto real del ajuste ${a.sequence}`}
                        invalid={Boolean(errors.overrides) && Boolean(ov?.amount)}
                      />
                      <Input
                        value={ov?.reason ?? ""}
                        onChange={(e) => set((s) => ({ overrides: { ...s.overrides, [String(a.sequence)]: { amount: s.overrides[String(a.sequence)]?.amount ?? "", reason: e.target.value } } }))}
                        placeholder="Motivo (ej.: lo acordaron así)"
                        className="h-10"
                        aria-label="Motivo"
                      />
                      {ov?.amount && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 text-xs"
                          onClick={() =>
                            set((s) => {
                              const next = { ...s.overrides };
                              delete next[String(a.sequence)];
                              return { overrides: next };
                            })
                          }
                        >
                          Usar el del índice
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {errors.overrides && <p className="text-[12px] text-rose-600 dark:text-rose-400">{errors.overrides}</p>}
    </div>
  );
}
