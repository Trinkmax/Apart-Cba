import Link from "next/link";
import { ArrowRight, FileCheck2, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SettledTotals } from "@/lib/settlements/settled-model";
import type { MonthlyResults } from "@/lib/actions/results";
import { RESULT_BUCKET_META } from "./results-meta";

/**
 * Cabecera de "Liquidado": de todo lo que entró, cuánto se le giró a los
 * propietarios. Es la misma cascada que la proyección pero con los números del
 * documento — ingreso bruto, comisión, gastos, transferido — para que el número
 * grande sea el que el dueño de la inmobiliaria efectivamente pagó.
 */
export function ResultsSettledSummary({
  totals,
  pending,
  outside,
  year,
  month,
}: {
  totals: SettledTotals[];
  pending: MonthlyResults["owners_pending_settlement"];
  outside: MonthlyResults["bookings_outside_settlements"];
  year: number;
  month: number;
}) {
  return (
    <div className="space-y-3">
      {totals.map((t) => (
        <SettledCard key={t.currency} t={t} showCurrency={totals.length > 1} />
      ))}
      {pending.length > 0 && (
        <Link
          href={`/dashboard/liquidaciones?tab=periodo&year=${year}&month=${month}`}
          className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/40 border hover:border-foreground/20 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <TriangleAlert size={16} className="text-muted-foreground shrink-0" />
            <span className="text-sm leading-snug">
              {pending.length === 1
                ? `Falta liquidar a ${pending[0].owner_name}`
                : `Faltan liquidar ${pending.length} propietarios`}
              <span className="text-muted-foreground">
                {" "}
                — {formatMoney(
                  pending.reduce((a, p) => a + p.projected_net, 0),
                  pending[0].currency,
                )}{" "}
                estimados que todavía no están acá
              </span>
            </span>
          </span>
          <span className="text-xs shrink-0 flex items-center gap-1 opacity-80">
            Generar <ArrowRight size={12} />
          </span>
        </Link>
      )}
      {outside && (
        <Link
          href={`/dashboard/liquidaciones?tab=periodo&year=${year}&month=${month}`}
          className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors text-amber-800 dark:text-amber-200"
        >
          <span className="flex items-center gap-2 min-w-0">
            <TriangleAlert size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm leading-snug">
              {outside.count === 1
                ? "1 reserva del mes no entró en ninguna liquidación"
                : `${outside.count} reservas del mes no entraron en ninguna liquidación`}{" "}
              ({formatMoney(outside.amount, outside.currency)}) — sus propietarios ya tienen la del período
            </span>
          </span>
          <span className="text-xs shrink-0 flex items-center gap-1 opacity-80">
            Revisar <ArrowRight size={12} />
          </span>
        </Link>
      )}
    </div>
  );
}

function SettledCard({ t, showCurrency }: { t: SettledTotals; showCurrency: boolean }) {
  const cur = t.currency;
  // Misma barra apilada que la proyección: las partes se normalizan por su
  // suma, así un neto negativo (gastos > ingreso) no rompe el dibujo.
  const parts = [
    { key: "channel", label: "Plataformas", amount: Math.max(0, t.channel), color: RESULT_BUCKET_META.channel.color },
    { key: "commission", label: "Tu comisión", amount: Math.max(0, t.commission), color: RESULT_BUCKET_META.commission.color },
    { key: "expenses", label: "Gastos", amount: Math.max(0, t.expenses), color: RESULT_BUCKET_META.cleaning.color },
    { key: "owner", label: "A propietarios", amount: Math.max(0, t.net), color: RESULT_BUCKET_META.owner.color },
  ].filter((p) => p.amount > 0 || p.key === "owner");
  const partsSum = parts.reduce((a, p) => a + p.amount, 0);
  const pctOf = (n: number) => (partsSum > 0 ? (n / partsSum) * 100 : 0);
  const docs = t.settlements === 1 ? "1 liquidación" : `${t.settlements} liquidaciones`;
  const allPaid = t.paid === t.settlements && t.settlements > 0;
  const pendingAmount = Math.max(0, Math.round((t.net - t.net_paid) * 100) / 100);

  return (
    <Card className="p-4 sm:p-5 gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:flex lg:flex-wrap lg:gap-x-8 lg:gap-y-4">
        {/* El número que manda. "Transferido" sólo si de verdad se pagó: en
            producción casi todas las liquidaciones están en "revisada", así
            que llamarlo transferido sería mentira en casi todas. */}
        <div className="col-span-2 min-w-0 lg:flex-[2_1_240px]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            {allPaid ? "Transferido a propietarios" : "A transferir a propietarios"}
            {showCurrency && (
              <span className="rounded-full border px-1.5 py-px text-[9px] font-semibold tabular-nums">{cur}</span>
            )}
          </div>
          <div
            className={cn(
              "text-2xl sm:text-3xl font-bold tabular-nums leading-tight mt-1 whitespace-nowrap",
              RESULT_BUCKET_META.owner.text,
            )}
          >
            {formatMoney(t.net, cur)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">
            {docs}
            {" · "}
            <span className="text-emerald-700 dark:text-emerald-300 font-medium">
              girado {formatMoney(t.net_paid, cur)}
            </span>
            {pendingAmount > 0 && (
              <>
                {" · "}
                <span className="text-amber-700 dark:text-amber-300 font-medium">
                  pendiente {formatMoney(pendingAmount, cur)}
                </span>
              </>
            )}
          </div>
        </div>

        <Kpi
          label="Ingreso bruto"
          amount={t.gross}
          currency={cur}
          hint={
            t.reimbursements > 0
              ? `incluye ${formatMoney(t.reimbursements, cur)} de servicios reembolsados`
              : "lo que produjeron los deptos"
          }
        />
        <Kpi
          label="Se llevan las plataformas"
          amount={t.channel}
          currency={cur}
          negative
          tone={RESULT_BUCKET_META.channel.text}
          dot={RESULT_BUCKET_META.channel.color}
          hint={`${pctOf(t.channel).toFixed(1)}% del bruto`}
        />
        <Kpi
          label="Tu comisión"
          amount={t.commission}
          currency={cur}
          negative
          tone={RESULT_BUCKET_META.commission.text}
          dot={RESULT_BUCKET_META.commission.color}
          hint={t.gross > 0 ? `${((t.commission / t.gross) * 100).toFixed(1)}% del bruto` : undefined}
        />
        <Kpi
          label="Gastos descontados"
          amount={t.expenses}
          currency={cur}
          negative
          tone={RESULT_BUCKET_META.cleaning.text}
          dot={RESULT_BUCKET_META.cleaning.color}
          hint="limpieza, mantenimiento y expensas"
        />
      </div>

      {partsSum > 0 && (
        <div className="space-y-1.5">
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={parts.map((p) => `${p.label}: ${formatMoney(p.amount, cur)}`).join(", ")}
          >
            {parts.map((p) =>
              p.amount > 0 ? (
                <div
                  key={p.key}
                  className="h-full"
                  style={{ width: `${pctOf(p.amount)}%`, backgroundColor: p.color }}
                  title={`${p.label}: ${formatMoney(p.amount, cur)}`}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {parts.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-1.5 tabular-nums">
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} aria-hidden />
                {p.label} {pctOf(p.amount).toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Kpi({
  label,
  amount,
  currency,
  hint,
  negative,
  tone,
  dot,
}: {
  label: string;
  amount: number;
  currency: string;
  hint?: string;
  negative?: boolean;
  tone?: string;
  dot?: string;
}) {
  return (
    <div className="min-w-0 lg:flex-[1_1_150px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {dot ? (
          <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: dot }} aria-hidden />
        ) : (
          <FileCheck2 size={11} className="shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("text-lg sm:text-xl font-semibold tabular-nums leading-tight mt-1 whitespace-nowrap", tone)}>
        {negative && amount > 0 ? "− " : ""}
        {formatMoney(amount, currency)}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{hint}</div>}
    </div>
  );
}
