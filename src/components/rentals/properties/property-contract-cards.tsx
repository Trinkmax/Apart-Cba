import Link from "next/link";
import { ArrowRight, DoorOpen, FilePenLine, FilePlus2, History, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { CONTRACT_STATE_META, formatContractNumber } from "@/lib/rentals/labels";
import { diffDays } from "@/lib/rentals/ymd";
import { Money, StatusBadge } from "@/components/rentals/ui";
import { BalanceLine } from "./property-card";
import { sinceLabel } from "./property-helpers";
import type { ContractSummary, PropertyListItem } from "./property-types";

/** Barra del plazo del contrato con el "hoy" marcado. */
export function ContractProgress({ start, end, today }: { start: string; end: string; today: string }) {
  const total = Math.max(1, diffDays(start, end));
  const elapsed = Math.min(total, Math.max(0, diffDays(start, today)));
  const pct = Math.round((elapsed / total) * 100);
  const left = diffDays(today, end);
  return (
    <div className="space-y-1.5">
      <div className="relative h-2 rounded-full bg-muted" role="img" aria-label={`Transcurrió el ${pct} % del contrato`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-teal-600/70" style={{ width: `${pct}%` }} />
        <div className="absolute top-1/2 size-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-card bg-teal-600 shadow" style={{ left: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{formatDate(start)}</span>
        <span className={cn(left <= 90 && "text-amber-700 dark:text-amber-300 font-medium")}>
          {left < 0 ? `Venció hace ${-left} días` : left === 0 ? "Vence hoy" : `Faltan ${left} días`}
        </span>
        <span>{formatDate(end)}</span>
      </div>
    </div>
  );
}

function guarantorsOf(c: ContractSummary): string {
  return c.parties
    .filter((p) => p.role === "garante")
    .map((p) => p.full_name)
    .join(", ");
}

export function CurrentContractCard({ item, today, propertyId }: { item: PropertyListItem; today: string; propertyId: string }) {
  const { current, draft } = item;
  if (current) {
    const guarantors = guarantorsOf(current);
    return (
      <Card className="p-4 sm:p-5 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-muted-foreground">Contrato vigente</h2>
          <div className="flex items-center gap-2">
            <StatusBadge meta={CONTRACT_STATE_META[current.display_state]} compact />
            <span className="font-mono text-xs text-muted-foreground">{formatContractNumber(current.number)}</span>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0 space-y-1">
            {current.tenant ? (
              <Link href={`/dashboard/alquileres/personas/${current.tenant.id}`} className="inline-flex items-center gap-2 text-base font-semibold hover:underline underline-offset-2 min-w-0">
                <span className="size-8 rounded-full bg-teal-600/10 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
                  <UserRound size={15} />
                </span>
                <span className="truncate">{current.tenant.full_name}</span>
              </Link>
            ) : (
              <p className="text-base font-semibold">Sin inquilino cargado</p>
            )}
            {guarantors && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                <ShieldCheck size={12} className="shrink-0" /> <span className="truncate">Garantes: {guarantors}</span>
              </p>
            )}
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Alquiler vigente</p>
            <Money amount={current.current_rent} currency={current.currency} className="text-2xl font-bold tracking-tight" />
            <div>
              <BalanceLine balance={current.balance} overdue={current.overdue} currency={current.currency} />
            </div>
          </div>
        </div>
        <ContractProgress start={current.start_date} end={current.end_date} today={today} />
        <Button asChild variant="outline" size="sm" className="self-start gap-1.5">
          <Link href={`/dashboard/alquileres/contratos/${current.id}`}>
            Ver el contrato <ArrowRight size={13} />
          </Link>
        </Button>
      </Card>
    );
  }
  if (draft) {
    return (
      <Card className="p-4 sm:p-5 gap-3 border-dashed">
        <div className="flex items-center gap-2.5">
          <span className="size-9 rounded-lg bg-slate-500/15 text-slate-700 dark:text-slate-300 flex items-center justify-center">
            <FilePenLine size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Contrato en borrador · {formatContractNumber(draft.number)}</p>
            <p className="text-xs text-muted-foreground truncate">
              {draft.tenant?.full_name ? `${draft.tenant.full_name} · ` : ""}arranca el {formatDate(draft.start_date)}. Todavía no genera cobros.
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="self-start gap-1.5">
          <Link href={`/dashboard/alquileres/contratos/${draft.id}`}>
            Seguir con el borrador <ArrowRight size={13} />
          </Link>
        </Button>
      </Card>
    );
  }
  const p = item.property;
  return (
    <Card className="p-4 sm:p-5 gap-3 border-amber-500/30 bg-amber-500/[0.04]">
      <div className="flex items-start gap-3">
        <span className="size-10 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
          <DoorOpen size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold">{item.vacant_since ? `Vacante ${sinceLabel(item.vacant_since, today)}` : "Todavía sin contrato"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {p.listing_rent ? (
              <>
                El dueño pide <Money amount={p.listing_rent} currency={p.listing_currency ?? "ARS"} className="font-semibold text-foreground" /> por mes.
              </>
            ) : (
              "Cargá el precio pretendido para tenerlo a mano cuando consulten."
            )}
          </p>
        </div>
      </div>
      {p.active && (
        <Button asChild size="sm" className="self-start gap-1.5">
          <Link href={`/dashboard/alquileres/contratos/nuevo?propiedad=${propertyId}`}>
            <FilePlus2 size={14} /> Cargar un contrato
          </Link>
        </Button>
      )}
    </Card>
  );
}

export function ContractsHistoryCard({ contracts, excludeId }: { contracts: ContractSummary[]; excludeId?: string | null }) {
  const rows = contracts.filter((c) => c.id !== excludeId && c.status !== "borrador");
  if (!rows.length) return null;
  return (
    <Card className="p-4 sm:p-5 gap-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <History size={15} className="text-muted-foreground" /> Contratos anteriores
        <span className="font-normal text-muted-foreground tabular-nums">({rows.length})</span>
      </h2>
      <ul className="divide-y -my-1">
        {rows.map((c) => (
          <li key={c.id}>
            <Link href={`/dashboard/alquileres/contratos/${c.id}`} className="flex items-center gap-3 py-2.5 hover:bg-accent/30 -mx-2 px-2 rounded-lg transition-colors">
              <span className="font-mono text-xs text-muted-foreground w-14 shrink-0">{formatContractNumber(c.number)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{c.tenant?.full_name ?? "Sin inquilino"}</span>
                <span className="block text-[11px] text-muted-foreground tabular-nums">
                  {formatDate(c.start_date)} → {formatDate(c.terminated_at ?? c.end_date)}
                </span>
              </span>
              <StatusBadge meta={CONTRACT_STATE_META[c.display_state]} compact className="hidden sm:inline-flex" />
              <Money amount={c.current_rent} currency={c.currency} className="text-sm text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
