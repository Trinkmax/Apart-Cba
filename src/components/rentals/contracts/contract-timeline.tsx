import type { ReactNode } from "react";
import { Flag, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { MONTHS } from "@/lib/settlements/labels";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { pctLabel } from "./adjustment-view";
import type { SegmentCertainty, TimelineModel, TimelineSegment } from "./timeline-model";

/**
 * Línea de tiempo del contrato: del inicio al fin, un tramo por ciclo de
 * ajuste con su precio, el marcador de "hoy" y cuánto falta. Horizontal en
 * pantallas anchas, vertical en el celular. Sin estado: sirve en la ficha
 * (server) y en el resumen del alta (client).
 */

export const CERTAINTY_META: Record<SegmentCertainty, { label: string; draftLabel?: string; color: string; dashed?: boolean }> = {
  inicial: { label: "Precio inicial", color: RENTALS_ACCENT },
  aplicado: { label: "Aplicado", color: "#10b981" },
  calculado: { label: "Listo para aplicar", draftLabel: "Según el índice", color: "#3b82f6" },
  esperando: { label: "Esperando índice", color: "#f59e0b", dashed: true },
  a_cargar: { label: "Falta cargar el monto", color: "#f97316", dashed: true },
  omitido: { label: "No se aplicó", color: "#64748b" },
  futuro: { label: "A calcular", color: "#94a3b8", dashed: true },
};

const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3).toLowerCase());
const monthYear = (ymd: string) => `${MONTHS_SHORT[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(2, 4)}`;

export interface ContractTimelineProps {
  model: TimelineModel;
  currency: string;
  startDate: string;
  endDate: string;
  /** Contrato en borrador / vista previa: cambia algunos textos. */
  draft?: boolean;
  /** "IPC" → "Esperando IPC". */
  indexLabel?: string | null;
  /** "mini": barra fina sin textos (resumen del alta). */
  variant?: "full" | "mini";
  /** El contrato ya terminó (finalizado / rescindido) en esta fecha. */
  endedOn?: string | null;
  className?: string;
}

function segmentLabel(s: TimelineSegment, draft: boolean | undefined, indexLabel: string | null | undefined): string {
  const meta = CERTAINTY_META[s.certainty];
  if (s.certainty === "esperando" && indexLabel) return `Esperando ${indexLabel}`;
  return (draft && meta.draftLabel) || meta.label;
}

function amountText(s: TimelineSegment, currency: string): string {
  return s.amount != null ? formatMoney(s.amount, currency) : "—";
}

function daysLeftText(model: TimelineModel): string {
  if (model.todayPhase === "before") return model.daysToStart === 1 ? "Empieza mañana" : `Empieza en ${model.daysToStart} días`;
  if (model.todayPhase === "after") return model.daysToEnd === -1 ? "Venció ayer" : `Venció hace ${-model.daysToEnd} días`;
  if (model.daysToEnd === 0) return "Termina hoy";
  return model.daysToEnd === 1 ? "Falta 1 día" : `Faltan ${model.daysToEnd} días`;
}

export function ContractTimeline(props: ContractTimelineProps) {
  if (!props.model.segments.length) return null;
  if (props.variant === "mini") return <MiniTimeline {...props} />;
  return (
    <div className={cn("@container", props.className)}>
      <div className="hidden @[40rem]:block">
        <HorizontalTimeline {...props} />
      </div>
      <div className="@[40rem]:hidden">
        <VerticalTimeline {...props} />
      </div>
    </div>
  );
}

function TodayFlag({ pct, children }: { pct: number; children: ReactNode }) {
  const shift = pct < 7 ? "translate-x-0" : pct > 93 ? "-translate-x-full" : "-translate-x-1/2";
  return (
    <div className="absolute top-0 bottom-0 pointer-events-none z-10" style={{ left: `${pct}%` }}>
      <div className={cn("absolute -top-7 whitespace-nowrap", shift)}>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
          style={{ backgroundColor: RENTALS_ACCENT }}
        >
          {children}
        </span>
      </div>
      <div className="absolute inset-y-0 -translate-x-1/2 w-0.5 rounded-full" style={{ backgroundColor: RENTALS_ACCENT }} />
    </div>
  );
}

function endText(model: TimelineModel, endedOn: string | null | undefined): string {
  return endedOn ? `Terminó el ${formatDate(endedOn)}` : daysLeftText(model);
}

function ProgressLine({ model, endedOn }: { model: TimelineModel; endedOn?: string | null }) {
  const period = model.currentPeriod;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
      <span className="text-muted-foreground">
        {period ? (
          <>
            Período <span className="font-semibold text-foreground tabular-nums">{period.index}</span> de{" "}
            <span className="tabular-nums">{model.periodsTotal}</span>
          </>
        ) : (
          `${model.periodsTotal} períodos mensuales`
        )}
      </span>
      <span className={cn("font-medium tabular-nums", model.todayPhase === "after" && !endedOn && "text-amber-700 dark:text-amber-300")}>{endText(model, endedOn)}</span>
    </div>
  );
}

function segmentStyle(s: TimelineSegment) {
  const meta = CERTAINTY_META[s.certainty];
  if (s.phase === "current") {
    return { backgroundColor: `${RENTALS_ACCENT}14`, borderColor: RENTALS_ACCENT, borderStyle: "solid" as const };
  }
  return {
    backgroundColor: s.phase === "past" ? undefined : `${meta.color}0d`,
    borderColor: s.phase === "past" ? "transparent" : `${meta.color}55`,
    borderStyle: meta.dashed && s.phase !== "past" ? ("dashed" as const) : ("solid" as const),
  };
}

function HorizontalTimeline({ model, currency, startDate, endDate, draft, indexLabel, endedOn }: ContractTimelineProps) {
  const dense = model.segments.length > 10;
  return (
    <div className="space-y-3">
      <ProgressLine model={model} endedOn={endedOn} />
      <div className="relative pt-8">
        <div className="flex gap-[3px]">
          {model.segments.map((s) => {
            const meta = CERTAINTY_META[s.certainty];
            const label = segmentLabel(s, draft, indexLabel);
            const title = `${s.cycle === 1 ? "Inicio" : `Ajuste ${s.adjustment?.sequence ?? s.cycle - 1}`} · desde ${formatDate(s.start)} · ${s.amount != null ? formatMoney(s.amount, currency) : label}`;
            if (dense) {
              return (
                <div
                  key={s.key}
                  title={title}
                  className={cn("h-3 rounded-full min-w-[4px]", s.phase === "past" && "opacity-50", s.afterTermination && "opacity-25")}
                  style={{ flexGrow: s.widthPct, flexBasis: 0, backgroundColor: s.phase === "current" ? RENTALS_ACCENT : meta.color }}
                />
              );
            }
            return (
              <div
                key={s.key}
                title={title}
                className={cn(
                  "relative min-w-0 overflow-hidden rounded-lg border px-2.5 pt-2.5 pb-2 h-[4.5rem] flex flex-col justify-between",
                  s.phase === "past" && "bg-muted/50 text-muted-foreground",
                  s.phase === "current" && "shadow-sm",
                  s.afterTermination && "opacity-40 [background-image:repeating-linear-gradient(135deg,transparent,transparent_6px,var(--border)_6px,var(--border)_7px)]",
                )}
                style={{ flexGrow: s.widthPct, flexBasis: 0, ...segmentStyle(s) }}
              >
                <span
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: s.phase === "current" ? RENTALS_ACCENT : meta.color, opacity: s.phase === "past" ? 0.45 : 1 }}
                />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                  {s.cycle === 1 ? "Inicio" : `Ajuste ${s.adjustment?.sequence ?? s.cycle - 1}`}
                </span>
                <span className={cn("text-sm font-semibold tabular-nums truncate", s.amount == null && "text-xs font-medium")}>
                  {s.amount != null ? amountText(s, currency) : label}
                </span>
                <span className="text-[10px] font-medium truncate" style={{ color: s.phase === "past" ? undefined : meta.color }}>
                  {s.adjustment?.variationPct != null && s.amount != null && s.certainty !== "omitido" ? `${pctLabel(s.adjustment.variationPct)} · ${label}` : label}
                </span>
              </div>
            );
          })}
        </div>
        {model.todayPct != null && !endedOn && <TodayFlag pct={model.todayPct}>Hoy</TodayFlag>}
        {model.terminatedPct != null && (
          <div className="absolute top-8 bottom-0 w-0.5 bg-rose-500 -translate-x-1/2" style={{ left: `${model.terminatedPct}%` }} title="Terminó antes" />
        )}
      </div>
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-1.5 h-px bg-border" />
        {model.segments.slice(1).map((s) => (
          <div key={s.key} className="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={{ left: `${s.leftPct}%` }}>
            <span className="size-3 rounded-full ring-2 ring-background" style={{ backgroundColor: CERTAINTY_META[s.certainty].color }} />
            {!dense && <span className="mt-1 text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">{monthYear(s.start)}</span>}
          </div>
        ))}
        <div className="absolute left-0 top-0 flex flex-col items-start">
          <span className="size-3 rounded-full ring-2 ring-background" style={{ backgroundColor: RENTALS_ACCENT }} />
          <span className="mt-1 text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(startDate, "dd/MM/yy")}</span>
        </div>
        <div className="absolute right-0 top-0 flex flex-col items-end">
          <Flag size={12} className="text-foreground/70" />
          <span className="mt-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap">Fin {formatDate(endDate, "dd/MM/yy")}</span>
        </div>
      </div>
      <Legend model={model} draft={draft} />
    </div>
  );
}

function Legend({ model, draft }: { model: TimelineModel; draft?: boolean }) {
  const present = [...new Set(model.segments.map((s) => s.certainty))];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {present.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-[3px] border"
            style={{ backgroundColor: `${CERTAINTY_META[c].color}30`, borderColor: CERTAINTY_META[c].color, borderStyle: CERTAINTY_META[c].dashed ? "dashed" : "solid" }}
          />
          {(draft && CERTAINTY_META[c].draftLabel) || CERTAINTY_META[c].label}
        </span>
      ))}
      {model.todayPct != null && (
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={11} style={{ color: RENTALS_ACCENT }} /> Hoy
        </span>
      )}
    </div>
  );
}

function VerticalTimeline({ model, currency, endDate, draft, indexLabel, endedOn }: ContractTimelineProps) {
  return (
    <div className="space-y-3">
      <ProgressLine model={model} endedOn={endedOn} />
      <ol className="relative ml-1.5 border-l border-border/70 pl-5 space-y-1.5">
        {model.segments.map((s) => {
          const meta = CERTAINTY_META[s.certainty];
          const label = segmentLabel(s, draft, indexLabel);
          const current = s.phase === "current" && !endedOn;
          return (
            <li key={s.key} className={cn("relative", s.afterTermination && "opacity-40")}>
              <span
                className={cn("absolute -left-[27px] top-3 size-3 rounded-full ring-4 ring-background", s.phase === "past" && "opacity-60")}
                style={{ backgroundColor: current ? RENTALS_ACCENT : meta.color }}
                aria-hidden
              />
              <div
                className={cn("rounded-lg px-3 py-2", current ? "border shadow-sm" : s.phase === "past" ? "text-muted-foreground" : "")}
                style={current ? { backgroundColor: `${RENTALS_ACCENT}12`, borderColor: `${RENTALS_ACCENT}66` } : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {s.cycle === 1 ? "Inicio" : `Ajuste ${s.adjustment?.sequence ?? s.cycle - 1}`} · desde {formatDate(s.start)}
                  </p>
                  {current && (
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: RENTALS_ACCENT }}>
                      Hoy
                    </span>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-2 mt-0.5">
                  <p className={cn("tabular-nums", s.amount != null ? "text-sm font-semibold" : "text-xs font-medium")}>
                    {s.amount != null ? amountText(s, currency) : label}
                  </p>
                  <p className="text-[11px] font-medium text-right" style={{ color: s.phase === "past" ? undefined : meta.color }}>
                    {s.adjustment?.variationPct != null && s.amount != null && s.certainty !== "omitido" ? pctLabel(s.adjustment.variationPct) : s.amount != null ? label : ""}
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {s.months === 1 ? `Período ${s.fromPeriod}` : `Períodos ${s.fromPeriod} a ${s.toPeriod}`} · {s.months} {s.months === 1 ? "mes" : "meses"}
                </p>
              </div>
            </li>
          );
        })}
        <li className="relative">
          <span className="absolute -left-[28px] top-1 flex size-3.5 items-center justify-center rounded-full bg-background ring-4 ring-background" aria-hidden>
            <Flag size={12} className="text-foreground/70" />
          </span>
          <p className="px-3 text-xs">
            <span className="font-medium">Fin · {formatDate(endDate)}</span>
            <span className="text-muted-foreground"> · {endText(model, endedOn).toLowerCase()}</span>
          </p>
        </li>
      </ol>
    </div>
  );
}

function MiniTimeline({ model, startDate, endDate, className }: ContractTimelineProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="relative pt-1">
        <div className="flex gap-[2px]">
          {model.segments.map((s) => (
            <div
              key={s.key}
              className={cn("h-2 rounded-full min-w-[3px]", s.phase === "past" && "opacity-50")}
              style={{
                flexGrow: s.widthPct,
                flexBasis: 0,
                backgroundColor: s.phase === "current" ? RENTALS_ACCENT : CERTAINTY_META[s.certainty].color,
                opacity: CERTAINTY_META[s.certainty].dashed && s.phase === "future" ? 0.45 : undefined,
              }}
            />
          ))}
        </div>
        {model.todayPct != null && (
          <span
            className="absolute -top-0.5 size-3 -translate-x-1/2 rounded-full border-2 border-background"
            style={{ left: `${model.todayPct}%`, backgroundColor: RENTALS_ACCENT }}
            title="Hoy"
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{formatDate(startDate, "dd/MM/yy")}</span>
        <span>{model.segments.length > 1 ? `${model.segments.length - 1} ajuste${model.segments.length === 2 ? "" : "s"}` : "Sin ajustes"}</span>
        <span>{formatDate(endDate, "dd/MM/yy")}</span>
      </div>
    </div>
  );
}
