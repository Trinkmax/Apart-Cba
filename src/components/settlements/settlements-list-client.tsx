"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, FileText, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SettlementDeleteButton } from "@/components/settlements/settlement-delete-button";
import { formatMoney, getInitials } from "@/lib/format";
import { formatPeriod, SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import { cn } from "@/lib/utils";
import type {
  OwnerSettlement,
  Owner,
  SettlementStatus,
} from "@/lib/types/database";

type SettlementWithOwner = OwnerSettlement & {
  owner: Pick<Owner, "id" | "full_name" | "email" | "preferred_currency">;
};

type StatusFilter = SettlementStatus | "all";

const STATUS_ORDER: SettlementStatus[] = [
  "borrador",
  "revisada",
  "enviada",
  "pagada",
  "disputada",
  "anulada",
];

/**
 * "Pendiente de pago" — misma definición que usa el subtítulo de la página
 * (`page.tsx`), para que los conteos por mes no contradigan el total de arriba.
 */
const PENDING_STATUSES: SettlementStatus[] = ["borrador", "revisada", "enviada"];

interface MonthGroup {
  key: string;
  year: number;
  month: number;
  items: SettlementWithOwner[];
}

interface Props {
  settlements: SettlementWithOwner[];
}

export function SettlementsListClient({ settlements }: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Plegados manuales por mes, atados a la "firma" del filtro (búsqueda +
  // estado). Cuando la firma cambia, el mapa guardado se ignora y vuelven los
  // defaults (buscando → todo abierto; navegando → solo el más reciente). Es
  // puramente derivado: sin refs ni setState durante el render.
  const [overrides, setOverrides] = useState<{
    sig: string;
    map: Record<string, boolean>;
  }>({ sig: "|all", map: {} });

  const statusCounts = useMemo(() => {
    const counts = new Map<SettlementStatus, number>();
    for (const s of settlements) {
      counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    }
    return counts;
  }, [settlements]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return settlements.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!q) return true;
      const period = formatPeriod(s.period_year, s.period_month).toLowerCase();
      const status =
        SETTLEMENT_STATUS_META[
          s.status as keyof typeof SETTLEMENT_STATUS_META
        ]?.label.toLowerCase() ?? "";
      return (
        s.owner.full_name.toLowerCase().includes(q) ||
        period.includes(q) ||
        String(s.period_year).includes(q) ||
        status.includes(q)
      );
    });
  }, [settlements, query, statusFilter]);

  // Agrupá por mes preservando el orden — `filtered` ya viene ordenado
  // period_year DESC, period_month DESC desde `listSettlements`.
  const groups = useMemo<MonthGroup[]>(() => {
    const out: MonthGroup[] = [];
    const index = new Map<string, number>();
    for (const s of filtered) {
      const key = `${s.period_year}-${s.period_month}`;
      let gi = index.get(key);
      if (gi === undefined) {
        gi = out.length;
        index.set(key, gi);
        out.push({ key, year: s.period_year, month: s.period_month, items: [] });
      }
      out[gi].items.push(s);
    }
    return out;
  }, [filtered]);

  const searchActive = query.trim() !== "" || statusFilter !== "all";
  const filterSig = `${query.trim()}|${statusFilter}`;
  // Overrides vigentes solo si la firma coincide con el filtro actual; si no,
  // {} → los defaults mandan. Así el auto-expand al buscar nunca queda tapado
  // por un plegado manual viejo, sin tocar estado durante el render.
  const activeOverrides = overrides.sig === filterSig ? overrides.map : {};

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative w-40 sm:w-56 shrink-0">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Buscar…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div
          role="tablist"
          aria-label="Filtrar por estado"
          className="flex items-center gap-1 flex-nowrap overflow-x-auto min-w-0 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <StatusChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label="Todas"
            count={settlements.length}
          />
          {STATUS_ORDER.map((s) => {
            const count = statusCounts.get(s) ?? 0;
            if (count === 0) return null;
            const meta = SETTLEMENT_STATUS_META[s];
            return (
              <StatusChip
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                label={meta.label}
                count={count}
                color={meta.color}
              />
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed">
          <FileText className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="text-xs text-muted-foreground mt-1">
            {statusFilter !== "all" || query
              ? "Probá con otro propietario, período o estado."
              : "Aún no hay liquidaciones."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {groups.map((g, i) => {
            const override = activeOverrides[g.key];
            const open =
              override !== undefined ? override : searchActive ? true : i === 0;
            const pending = g.items.reduce(
              (n, s) => n + (PENDING_STATUSES.includes(s.status) ? 1 : 0),
              0,
            );
            return (
              <MonthSection
                key={g.key}
                id={`liq-mes-${g.key}`}
                title={formatPeriod(g.year, g.month)}
                count={g.items.length}
                pending={pending}
                open={open}
                onToggle={() =>
                  setOverrides((prev) => {
                    const base = prev.sig === filterSig ? prev.map : {};
                    return {
                      sig: filterSig,
                      map: { ...base, [g.key]: !open },
                    };
                  })
                }
                items={g.items}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonthSection({
  id,
  title,
  count,
  pending,
  open,
  onToggle,
  items,
}: {
  id: string;
  title: string;
  count: number;
  pending: number;
  open: boolean;
  onToggle: () => void;
  items: SettlementWithOwner[];
}) {
  const headerId = `${id}-header`;
  return (
    <section>
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className={cn(
          "sticky top-0 z-20 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left",
          "bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70",
          "transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <ChevronRight
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span className="font-semibold text-sm">{title}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          <span className="hidden sm:inline">
            {count} {count === 1 ? "liquidación" : "liquidaciones"}
            {pending > 0 &&
              ` · ${pending} ${
                pending === 1 ? "pendiente" : "pendientes"
              } de pago`}
          </span>
          <span className="sm:hidden">
            {count}
            {pending > 0 && ` · ${pending} pend.`}
          </span>
        </span>
      </button>

      {/* Colapso suave con grid-rows 0fr↔1fr; `inert` saca los links del tab
          order y del árbol de accesibilidad mientras la sección está plegada. */}
      <div
        id={id}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <Card className="overflow-hidden">
            <div className="divide-y">
              {items.map((s) => (
                <SettlementRow key={s.id} s={s} />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function SettlementRow({ s }: { s: SettlementWithOwner }) {
  const meta =
    SETTLEMENT_STATUS_META[s.status as keyof typeof SETTLEMENT_STATUS_META];
  return (
    <div className="flex items-center group hover:bg-accent/30 transition-colors">
      <Link
        href={`/dashboard/liquidaciones/${s.id}`}
        className="flex items-center gap-3 p-3 sm:p-4 flex-1 min-w-0"
      >
        <Avatar className="size-9 sm:size-10 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            {getInitials(s.owner.full_name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {s.owner.full_name}
          </div>
          <Badge
            className="font-normal gap-1.5 mt-1 sm:hidden text-[10px] h-4 px-1.5"
            style={{
              color: meta.color,
              backgroundColor: meta.color + "15",
              borderColor: meta.color + "30",
            }}
          >
            <span
              className="status-dot"
              style={{ backgroundColor: meta.color }}
            />
            {meta.label}
          </Badge>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            Neto
          </div>
          <div
            className={cn(
              "font-semibold tabular-nums text-sm sm:text-base",
              s.net_payable >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {formatMoney(s.net_payable, s.currency)}
          </div>
        </div>
        <Badge
          className="hidden sm:inline-flex font-normal gap-1.5"
          style={{
            color: meta.color,
            backgroundColor: meta.color + "15",
            borderColor: meta.color + "30",
          }}
        >
          <span className="status-dot" style={{ backgroundColor: meta.color }} />
          {meta.label}
        </Badge>
        <ChevronRight
          size={16}
          className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0"
        />
      </Link>
      <div className="pr-2 sm:pr-3 shrink-0">
        <SettlementDeleteButton
          id={s.id}
          ownerName={s.owner.full_name}
          period={formatPeriod(s.period_year, s.period_month)}
          paid={s.status === "pagada" || !!s.paid_movement_id}
        />
      </div>
    </div>
  );
}

function StatusChip({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={
        active && color
          ? {
              color,
              backgroundColor: color + "15",
              borderColor: color + "40",
            }
          : undefined
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1 h-7 rounded-full border px-2 text-[11px] font-medium transition-colors",
        active
          ? color
            ? ""
            : "bg-foreground text-background border-foreground"
          : "bg-card text-muted-foreground border-input hover:text-foreground hover:bg-accent/40",
      )}
    >
      {color && (
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      <span
        className={cn(
          "tabular-nums text-[10px] font-normal",
          active ? "opacity-80" : "opacity-60",
        )}
      >
        {count}
      </span>
    </button>
  );
}
