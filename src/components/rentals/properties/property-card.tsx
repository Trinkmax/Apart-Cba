import Link from "next/link";
import { CalendarClock, ChevronRight, FilePenLine, KeyRound, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate, getInitials } from "@/lib/format";
import { CONTRACT_STATE_META, PROPERTY_TYPE_LABEL, formatContractNumber, propertyAddress } from "@/lib/rentals/labels";
import { diffDays } from "@/lib/rentals/ymd";
import { Money, StatusBadge } from "@/components/rentals/ui";
import { PROPERTY_STATE_META, propertyFeatures, sinceLabel } from "./property-helpers";
import type { PropertyListItem, PropertyOwnerView } from "./property-types";

export function OwnerAvatars({ owners, max = 3 }: { owners: PropertyOwnerView[]; max?: number }) {
  if (!owners.length) return <span className="text-xs text-amber-700 dark:text-amber-300">Sin propietario</span>;
  const shown = owners.slice(0, max);
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="flex -space-x-1.5 shrink-0">
        {shown.map((o) => (
          <span
            key={o.owner_id}
            title={`${o.full_name} · ${o.ownership_pct.toLocaleString("es-AR")} %`}
            className="size-6 rounded-full bg-primary/10 text-primary ring-2 ring-card flex items-center justify-center text-[9px] font-semibold"
          >
            {getInitials(o.full_name)}
          </span>
        ))}
      </span>
      <span className="text-xs text-muted-foreground truncate">
        {owners[0].full_name}
        {owners.length > 1 ? ` +${owners.length - 1}` : ""}
      </span>
    </span>
  );
}

/** Saldo del inquilino en una línea: vencido (rosa), a vencer o al día (verde). */
export function BalanceLine({ balance, overdue, currency, className }: { balance: number; overdue: number; currency: string; className?: string }) {
  if (overdue > 0.004) {
    return (
      <span className={cn("text-xs font-medium text-rose-600 dark:text-rose-400", className)}>
        Debe <Money amount={overdue} currency={currency} tone="out" />
      </span>
    );
  }
  if (balance > 0.004) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        A vencer <Money amount={balance} currency={currency} />
      </span>
    );
  }
  return <span className={cn("text-xs font-medium text-emerald-700 dark:text-emerald-400", className)}>Al día</span>;
}

export function PropertyCard({ item, today }: { item: PropertyListItem; today: string }) {
  const { property: p, current, draft } = item;
  const features = [PROPERTY_TYPE_LABEL[p.property_type], ...propertyFeatures(p).slice(0, 2)];
  const daysToEnd = current ? diffDays(today, current.end_date) : null;
  return (
    <Link href={`/dashboard/alquileres/propiedades/${p.id}`} className="group block h-full focus-visible:outline-none">
      <Card className="h-full p-4 gap-3 transition-all group-hover:shadow-md group-hover:border-teal-600/30 group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[60%]">{p.code}</span>
          <StatusBadge meta={PROPERTY_STATE_META[item.state]} compact />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold leading-snug truncate">{propertyAddress(p)}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {[p.neighborhood, ...features].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="rounded-lg bg-muted/40 px-3 py-2.5 space-y-1 min-h-[4.25rem]">
          {current ? (
            <>
              <p className="text-sm flex items-center gap-1.5 min-w-0">
                <UserRound size={13} className="text-muted-foreground shrink-0" />
                <span className="truncate font-medium">{current.tenant?.full_name ?? "Sin inquilino cargado"}</span>
              </p>
              <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                <Money amount={current.current_rent} currency={current.currency} className="font-semibold text-foreground" /> / mes
                <span aria-hidden>·</span>
                <span className={cn(daysToEnd != null && daysToEnd <= 90 && "text-amber-700 dark:text-amber-300 font-medium")}>
                  {daysToEnd != null && daysToEnd < 0 ? `venció el ${formatDate(current.end_date)}` : `vence ${formatDate(current.end_date)}`}
                </span>
              </p>
              <BalanceLine balance={current.balance} overdue={current.overdue} currency={current.currency} />
            </>
          ) : draft ? (
            <>
              <p className="text-sm flex items-center gap-1.5">
                <FilePenLine size={13} className="text-muted-foreground" />
                <span className="font-medium">Contrato en borrador</span>
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {draft.tenant?.full_name ? `${draft.tenant.full_name} · ` : ""}arranca el {formatDate(draft.start_date)}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm flex items-center gap-1.5">
                <KeyRound size={13} className="text-muted-foreground" />
                <span className="font-medium">{item.vacant_since ? `Sin inquilino ${sinceLabel(item.vacant_since, today)}` : "Sin contrato todavía"}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {p.listing_rent ? (
                  <>
                    Pide <Money amount={p.listing_rent} currency={p.listing_currency ?? "ARS"} className="font-medium text-foreground" /> / mes
                  </>
                ) : (
                  "Sin precio pretendido cargado"
                )}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-auto">
          <OwnerAvatars owners={item.owners} />
          <ChevronRight size={16} className="text-muted-foreground/60 group-hover:text-foreground transition-colors shrink-0" />
        </div>
      </Card>
    </Link>
  );
}

export function ContractStateHint({ item, today }: { item: PropertyListItem; today: string }) {
  if (!item.current) return null;
  const state = item.current.display_state;
  if (state !== "por_vencer" && state !== "vencido_ocupado") return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
      <CalendarClock size={12} /> {CONTRACT_STATE_META[state].label}
      {state === "por_vencer" ? ` (${diffDays(today, item.current.end_date)} días)` : ""} · {formatContractNumber(item.current.number)}
    </span>
  );
}
