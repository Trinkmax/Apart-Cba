"use client";

import type { ReactNode } from "react";
import { CalendarRange, KeyRound, Loader2, MapPin, Sigma, Sparkles, TrendingUp, UserRound, Wallet, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { adjustmentSummary, pctLabel } from "./adjustment-view";
import { ContractTimeline } from "./contract-timeline";
import { buildTimelineModel } from "./timeline-model";
import { entryOf } from "./wizard-derived";
import { endDateOf, previewInputOf } from "./wizard-state";
import type { StepProps } from "./wizard-step-props";

/** Panel "Resumen" del alta: se actualiza en vivo mientras se completa el asistente. */

function Row({ icon: Icon, label, children, muted }: { icon: LucideIcon; label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className={cn("text-sm leading-snug break-words", muted ? "text-muted-foreground" : "font-medium")}>{children}</div>
      </div>
    </div>
  );
}

export function WizardSummary({ state, properties, people, preview, previewLoading, options, today }: StepProps) {
  const p = previewInputOf(state);
  const end = endDateOf(state);
  const property = properties.find((x) => x.id === state.property_id);
  const tenants = state.parties.filter((x) => x.role === "inquilino" && x.person_id).map((x) => people.find((pp) => pp.id === x.person_id)?.fullName ?? "Persona");
  const guarantors = state.parties.filter((x) => x.role === "garante" && x.person_id).length;
  const entry = entryOf(state, options.settings);
  const next = preview?.nextAdjustment ?? null;
  const model =
    preview && end && p
      ? buildTimelineModel({ startDate: state.start_date, endDate: end, today, initialRent: p.initial_rent, schedule: preview.schedule, adjustments: preview.adjustments })
      : null;

  return (
    <Card className="p-4 gap-0">
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resumen</p>
        {previewLoading && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 size={12} className="animate-spin" /> calculando
          </span>
        )}
      </div>
      <div className="divide-y">
        <Row icon={MapPin} label="Propiedad" muted={!property}>
          {property ? property.address : "Elegí la propiedad"}
        </Row>
        <Row icon={UserRound} label="Inquilino" muted={!tenants.length}>
          {tenants.length ? tenants.join(", ") : "Falta el inquilino"}
          {guarantors > 0 && <span className="block text-[11px] font-normal text-muted-foreground">{guarantors} garante{guarantors === 1 ? "" : "s"}</span>}
        </Row>
        <Row icon={CalendarRange} label="Plazo" muted={!end}>
          {end ? (
            <>
              {state.duration_months} meses
              <span className="block text-[11px] font-normal text-muted-foreground tabular-nums">
                {formatDate(state.start_date)} → {formatDate(end)}
              </span>
            </>
          ) : (
            "—"
          )}
        </Row>
        <Row icon={Wallet} label="Alquiler inicial" muted={!p}>
          {p ? <span className="tabular-nums">{formatMoney(p.initial_rent, p.currency)}</span> : "—"}
        </Row>
        <Row icon={TrendingUp} label="Actualización">
          {adjustmentSummary({
            adjustment_method: state.adjustment_method,
            index_code: state.adjustment_method === "indice" ? state.index_code : null,
            adjustment_every_months: Number(state.adjustment_every_months) || null,
            fixed_pct: p?.fixed_pct ?? null,
          })}
          {next && (
            <span className="block text-[11px] font-normal text-muted-foreground">
              Próximo: {formatDate(next.effectiveDate)}
              {next.amount != null ? ` · ${formatMoney(next.amount, state.currency)}${next.variationPct != null ? ` (${pctLabel(next.variationPct)})` : ""}` : ""}
            </span>
          )}
        </Row>
        {preview?.started && preview.rentToday != null && p && preview.rentToday !== p.initial_rent && (
          <Row icon={Sparkles} label={preview.index ? `Hoy, según ${preview.index.label}` : "Hoy"}>
            <span className="tabular-nums" style={{ color: RENTALS_ACCENT }}>
              {formatMoney(preview.rentToday, state.currency)}
            </span>
          </Row>
        )}
        <Row icon={Sigma} label="Valor total del contrato" muted={!preview}>
          {preview ? (
            <>
              <span className="tabular-nums">{formatMoney(preview.projectedTotal, state.currency)}</span>
              <span className="block text-[11px] font-normal text-muted-foreground">Con los ajustes que ya se conocen</span>
            </>
          ) : (
            "—"
          )}
        </Row>
        <Row icon={KeyRound} label="Costo de entrada del inquilino" muted={!entry}>
          {entry ? <span className="tabular-nums">{formatMoney(entry.tenantTotal, state.currency)}</span> : "—"}
        </Row>
      </div>
      {model && (
        <div className="pt-3 border-t">
          <ContractTimeline model={model} currency={state.currency} startDate={state.start_date} endDate={end as string} variant="mini" />
        </div>
      )}
    </Card>
  );
}
