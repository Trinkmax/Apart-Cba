import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileCheck2,
  FilePen,
  HandCoins,
  Landmark,
  OctagonAlert,
  PencilLine,
  ShieldAlert,
  TrendingUp,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Money } from "@/components/rentals/ui";
import { RegisterPaymentButton } from "@/components/rentals/collections/register-payment-button";
import type { Agenda, AgendaItem, AgendaKind, AgendaUrgency } from "./agenda";

/**
 * "Para hacer hoy": la agenda del resumen. Cada fila dice qué pasa, por qué
 * importa y tiene el botón que lo resuelve (registrar el cobro ahí mismo,
 * aplicar el ajuste, revisar el comprobante…). Lo urgente primero.
 */

const KIND_ICON: Record<AgendaKind, LucideIcon> = {
  two_unpaid: OctagonAlert,
  overdue: HandCoins,
  payment_report: BellRing,
  adjustment_ready: TrendingUp,
  adjustment_manual: PencilLine,
  adjustment_stuck: Clock3,
  expired_open: CalendarX2,
  expiring: CalendarClock,
  insurance: ShieldAlert,
  deposit_return: Undo2,
  proof_review: FileCheck2,
  statement_unpaid: Landmark,
  draft: FilePen,
};

const URGENCY: Record<AgendaUrgency, { label: string; chip: string; bar: string }> = {
  critical: { label: "Urgente", chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400", bar: "before:bg-rose-500" },
  high: { label: "Importante", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", bar: "before:bg-amber-500" },
  medium: { label: "Para revisar", chip: "bg-blue-500/15 text-blue-600 dark:text-blue-400", bar: "before:bg-blue-400/70" },
  low: { label: "Cuando puedas", chip: "bg-muted text-muted-foreground", bar: "before:bg-transparent" },
};

const VISIBLE = 6;

function Row({ item }: { item: AgendaItem }) {
  const Icon = KIND_ICON[item.kind];
  const u = URGENCY[item.urgency];
  const pay = item.kind === "overdue" && item.contractId;
  return (
    <li
      className={cn(
        "relative flex flex-col gap-2.5 px-4 py-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-4",
        "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full",
        u.bar,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg", u.chip)}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{item.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 pl-12 sm:justify-end sm:pl-0">
        {item.amount != null && item.currency && (
          <Money amount={item.amount} currency={item.currency} tone={item.urgency === "critical" || item.kind === "overdue" ? "out" : "neutral"} className="text-sm font-semibold" />
        )}
        {pay ? (
          <RegisterPaymentButton contractId={item.contractId!} defaultAmount={item.amount} size="sm" variant="outline">
            {item.cta}
          </RegisterPaymentButton>
        ) : (
          <Button asChild size="sm" variant={item.urgency === "critical" ? "default" : "outline"} className="gap-1.5">
            <Link href={item.href}>
              {item.cta} <ArrowRight size={13} />
            </Link>
          </Button>
        )}
      </div>
    </li>
  );
}

export function TodoAgenda({ agenda }: { agenda: Agenda }) {
  const { items, counts } = agenda;
  const visible = items.slice(0, VISIBLE);
  const rest = items.slice(VISIBLE);
  const summary = [
    counts.critical ? `${counts.critical} ${counts.critical === 1 ? "urgente" : "urgentes"}` : null,
    counts.high ? `${counts.high} ${counts.high === 1 ? "importante" : "importantes"}` : null,
    counts.medium + counts.low ? `${counts.medium + counts.low} para revisar` : null,
  ].filter(Boolean);

  return (
    <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="agenda-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b px-4 py-3">
        <h2 id="agenda-title" className="flex items-center gap-2 text-sm font-semibold">
          Para hacer hoy
          {items.length > 0 && (
            <span className="inline-flex min-w-5 justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold tabular-nums text-background">
              {items.length}
            </span>
          )}
        </h2>
        {summary.length > 0 && <p className="text-xs text-muted-foreground">{summary.join(" · ")}</p>}
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={22} />
          </span>
          <p className="text-base font-semibold">Todo al día</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            No hay cobros vencidos, ajustes trabados ni comprobantes esperando. Cuando algo necesite tu atención, aparece acá.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y">
            {visible.map((it) => (
              <Row key={it.key} item={it} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="group border-t">
              <summary className="flex cursor-pointer list-none items-center gap-1 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                Ver {rest.length} más
                <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
              </summary>
              <ul className="divide-y border-t">
                {rest.map((it) => (
                  <Row key={it.key} item={it} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
