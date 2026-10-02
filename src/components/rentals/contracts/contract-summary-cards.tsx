import type { ReactNode } from "react";
import { CalendarClock, CheckCircle2, PiggyBank, Receipt, ShieldCheck, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Money, PeriodPill } from "@/components/rentals/ui";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { ADJUSTMENT_STATUS_META, DEPOSIT_STATUS_LABEL, cyclePositionLabel } from "@/lib/rentals/labels";
import { INDEX_META, isIndexCode } from "@/lib/rentals/indices";
import { diffDays } from "@/lib/rentals/ymd";
import { adjustmentSummary, pctLabel } from "./adjustment-view";
import type { ContractDetailData } from "./types";

/** Las 6 tarjetas de la ficha: alquiler, próximo ajuste, saldo, próximo vencimiento, depósito y seguro. */

function SummaryCard({
  icon: Icon,
  label,
  children,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  tone?: "in" | "out" | "warn";
}) {
  return (
    <Card
      className={cn(
        "p-3 sm:p-4 gap-1 min-w-0",
        tone === "out" && "border-rose-500/30 bg-rose-500/[0.04]",
        tone === "warn" && "border-amber-500/30 bg-amber-500/[0.04]",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="text-base sm:text-xl font-semibold tabular-nums leading-tight min-w-0 break-words">{children}</div>
      {hint && <div className="text-[11px] text-muted-foreground leading-snug">{hint}</div>}
    </Card>
  );
}

function inDays(days: number): string {
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}

export function ContractSummaryCards({ detail }: { detail: ContractDetailData }) {
  const { contract: c, today, balance } = detail;
  // Un ajuste que ya rige y todavía no tiene monto (o falta confirmarlo) pesa más que el próximo.
  const pendingNow = detail.adjustments.find(
    (a) => a.effectiveDate <= today && (a.status === "pendiente_indice" || a.status === "pendiente_manual" || a.status === "calculado"),
  );
  const next = pendingNow ?? detail.nextAdjustment;
  const draft = c.status === "borrador";
  const currentPeriod = detail.schedule.find((p) => today >= p.start && today <= p.end) ?? null;
  const lastApplied = [...detail.adjustments].reverse().find((a) => a.effectiveDate <= today && (a.status === "aplicado" || a.status === "omitido"));
  const indexLabel = c.index_code && isIndexCode(c.index_code) ? INDEX_META[c.index_code].label : null;
  const insuranceDays = c.insurance_expires_at ? diffDays(today, c.insurance_expires_at) : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
      <SummaryCard
        icon={Wallet}
        label={draft ? "Alquiler inicial" : "Alquiler vigente"}
        hint={
          draft ? (
            `Empieza el ${formatDate(c.start_date)}`
          ) : (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {currentPeriod && <PeriodPill>{cyclePositionLabel(currentPeriod.indexInCycle, currentPeriod.cycleLength)}</PeriodPill>}
              {lastApplied ? `desde el ${formatDate(lastApplied.effectiveDate)}` : "precio inicial"}
            </span>
          )
        }
      >
        <Money amount={detail.rentInForce} currency={c.currency} />
      </SummaryCard>

      <SummaryCard
        icon={TrendingUp}
        label={pendingNow ? "Ajuste pendiente" : "Próximo ajuste"}
        tone={pendingNow ? "warn" : undefined}
        hint={
          next ? (
            <>
              {adjustmentSummary(c)} ·{" "}
              <span style={{ color: ADJUSTMENT_STATUS_META[next.status].color }}>
                {next.status === "pendiente_indice" && indexLabel ? `Esperando ${indexLabel}` : ADJUSTMENT_STATUS_META[next.status].label}
              </span>
            </>
          ) : (
            adjustmentSummary(c)
          )
        }
      >
        {next ? (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span>{formatDate(next.effectiveDate)}</span>
            <span className="text-xs font-normal text-muted-foreground">{inDays(diffDays(today, next.effectiveDate))}</span>
            {next.amount != null && (
              <span className="w-full text-sm font-medium">
                {formatMoney(next.amount, c.currency)}
                {next.variationPct != null && <span className="text-muted-foreground font-normal"> ({pctLabel(next.variationPct)})</span>}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground text-base">{c.adjustment_method === "sin_ajuste" ? "Precio fijo" : "Sin más ajustes"}</span>
        )}
      </SummaryCard>

      <SummaryCard
        icon={Receipt}
        label="Saldo del inquilino"
        tone={balance.overdue > 0.004 ? "out" : undefined}
        hint={
          balance.overdue > 0.004
            ? `Vencido desde el ${formatDate(balance.oldestOverdueDue)}${balance.debt - balance.overdue > 0.004 ? ` · ${formatMoney(balance.debt - balance.overdue, c.currency)} a vencer` : ""}`
            : balance.debt > 0.004
              ? `${balance.openCharges} cargo${balance.openCharges === 1 ? "" : "s"} a vencer`
              : balance.credit > 0.004
                ? "Se descuenta del próximo cargo"
                : draft
                  ? "Los cargos se generan al activar"
                  : "No debe nada"
        }
      >
        {balance.overdue > 0.004 ? (
          <Money amount={balance.overdue} currency={c.currency} tone="out" />
        ) : balance.debt > 0.004 ? (
          <Money amount={balance.debt} currency={c.currency} />
        ) : balance.credit > 0.004 ? (
          <span className="text-emerald-700 dark:text-emerald-400">A favor {formatMoney(balance.credit, c.currency)}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={18} /> {draft ? "—" : "Al día"}
          </span>
        )}
      </SummaryCard>

      <SummaryCard
        icon={CalendarClock}
        label="Próximo vencimiento"
        hint={balance.nextDue ? `${balance.nextDue.label} · ${inDays(diffDays(today, balance.nextDue.dueDate))}` : draft ? "Desde el primer período" : "Sin cargos por vencer"}
      >
        {balance.nextDue ? (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Money amount={balance.nextDue.outstanding} currency={c.currency} />
            <span className="text-xs font-normal text-muted-foreground">vence {formatDate(balance.nextDue.dueDate, "dd/MM")}</span>
          </span>
        ) : (
          <span className="text-muted-foreground text-base">—</span>
        )}
      </SummaryCard>

      <SummaryCard
        icon={PiggyBank}
        label="Depósito"
        hint={c.deposit_amount > 0 ? `${DEPOSIT_STATUS_LABEL[c.deposit_status]} · lo guarda ${c.deposit_holder === "propietario" ? "el propietario" : "la inmobiliaria"}` : "El contrato no tiene depósito"}
      >
        {c.deposit_amount > 0 ? <Money amount={c.deposit_amount} currency={c.deposit_currency || c.currency} /> : <span className="text-muted-foreground text-base">Sin depósito</span>}
      </SummaryCard>

      <SummaryCard
        icon={ShieldCheck}
        label="Seguro"
        tone={c.insurance_required && insuranceDays != null && insuranceDays <= 30 ? (insuranceDays < 0 ? "out" : "warn") : undefined}
        hint={
          c.insurance_required
            ? c.insurance_expires_at
              ? insuranceDays != null && insuranceDays < 0
                ? `Venció el ${formatDate(c.insurance_expires_at)}: pedí la renovación`
                : `Vence el ${formatDate(c.insurance_expires_at)}${insuranceDays != null && insuranceDays <= 30 ? ` (${inDays(insuranceDays)})` : ""}`
              : "Falta la fecha de vencimiento"
            : "No se pidió seguro"
        }
      >
        {c.insurance_required ? (
          <span className="text-base">{c.insurance_company || "Pedido en el contrato"}</span>
        ) : (
          <span className="text-muted-foreground text-base">No aplica</span>
        )}
      </SummaryCard>
    </div>
  );
}
