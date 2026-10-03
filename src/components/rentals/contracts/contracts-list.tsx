"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, ChevronRight, FileSearch, Search, TrendingUp, Wallet, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateTile, Money, PeriodPill, StatusBadge } from "@/components/rentals/ui";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { ADJUSTMENT_STATUS_META, CONTRACT_STATE_META, formatContractNumber } from "@/lib/rentals/labels";
import { pctLabel } from "./adjustment-view";
import type { ContractListRow, ContractListView } from "./types";

/**
 * Lista de contratos: buscador + filtros rápidos + filas que responden de un
 * vistazo "¿cuánto paga, cuándo ajusta, cuándo vence, debe algo?".
 */

const EMPTY_VIEW: Record<ContractListView, string> = {
  vigentes: "No hay contratos vigentes.",
  por_vencer: "Ningún contrato vence en los próximos 90 días.",
  borradores: "No hay borradores: todo lo cargado ya está activo.",
  terminados: "Todavía no terminó ningún contrato.",
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function ContractsList({ rows, view }: { rows: ContractListRow[]; view: ContractListView }) {
  const [q, setQ] = useState("");
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [onlyAdjust, setOnlyAdjust] = useState(false);

  const haystacks = useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.id,
          normalize([r.address, r.city, r.propertyCode, r.tenantName ?? "", formatContractNumber(r.number), String(r.number)].join(" ")),
        ]),
      ),
    [rows],
  );
  const debtCount = rows.filter((r) => r.overdue > 0.004).length;
  const adjustCount = rows.filter((r) => r.adjustsThisMonth).length;
  const filtered = useMemo(() => {
    const needle = normalize(q.trim());
    return rows.filter((r) => {
      if (onlyDebt && !(r.overdue > 0.004)) return false;
      if (onlyAdjust && !r.adjustsThisMonth) return false;
      return !needle || (haystacks.get(r.id) ?? "").includes(needle);
    });
  }, [rows, q, onlyDebt, onlyAdjust, haystacks]);

  if (!rows.length) {
    return (
      <Card className="p-8 sm:p-12 text-center border-dashed gap-2">
        <FileSearch className="size-10 mx-auto text-muted-foreground/50" />
        <p className="text-sm font-medium">{EMPTY_VIEW[view]}</p>
      </Card>
    );
  }

  const showChips = view === "vigentes" || view === "por_vencer";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por inquilino, dirección o N°"
            className="pl-8 h-9 text-sm"
            aria-label="Buscar contratos"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 size-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Limpiar búsqueda"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {showChips && (
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterChip active={onlyDebt} onClick={() => setOnlyDebt((v) => !v)} icon={Wallet} label="Con deuda" count={debtCount} tone="out" />
            <FilterChip active={onlyAdjust} onClick={() => setOnlyAdjust((v) => !v)} icon={TrendingUp} label="Ajuste este mes" count={adjustCount} tone="warn" />
          </div>
        )}
        <span className="text-xs text-muted-foreground tabular-nums sm:ml-auto">
          {filtered.length === rows.length ? `${rows.length} contrato${rows.length === 1 ? "" : "s"}` : `${filtered.length} de ${rows.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed gap-1">
          <FileSearch className="size-10 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="text-xs text-muted-foreground">Probá con otro nombre, dirección o número, o sacá los filtros.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 gap-0">
          <div className="hidden md:grid grid-cols-[minmax(0,2.3fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_1rem] gap-3 px-4 py-2 bg-muted/40 border-b text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <span>Propiedad</span>
            <span>Inquilino</span>
            <span className="text-right">Alquiler</span>
            <span>Próximo ajuste</span>
            <span>Vence</span>
            <span className="text-right">Saldo</span>
            <span />
          </div>
          <ul className="divide-y">
            {filtered.map((r) => (
              <ContractRow key={r.id} row={r} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Wallet;
  label: string;
  count: number;
  tone: "out" | "warn";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 h-8 rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? tone === "out"
            ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
          : "bg-card text-muted-foreground border-input hover:text-foreground hover:bg-accent/40",
      )}
    >
      <Icon size={13} />
      {label}
      <span className="tabular-nums text-[10px] opacity-70">{count}</span>
    </button>
  );
}

function daysText(days: number): string {
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (days > 0) return `en ${days} días`;
  return `hace ${-days} días`;
}

function BalanceCell({ row, align = "right" }: { row: ContractListRow; align?: "right" | "left" }) {
  const cls = align === "right" ? "text-right" : "";
  if (row.overdue > 0.004) {
    return (
      <div className={cls}>
        <Money amount={row.overdue} currency={row.currency} tone="out" className="text-sm font-semibold" />
        <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80">vencido</p>
      </div>
    );
  }
  if (row.debt > 0.004) {
    return (
      <div className={cls}>
        <Money amount={row.debt} currency={row.currency} className="text-sm font-medium" />
        <p className="text-[10px] text-muted-foreground">a vencer</p>
      </div>
    );
  }
  if (row.credit > 0.004) {
    return (
      <div className={cls}>
        <Money amount={row.credit} currency={row.currency} tone="in" className="text-sm font-medium" />
        <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80">a favor</p>
      </div>
    );
  }
  return <p className={cn("text-xs text-muted-foreground", cls)}>{row.status === "vigente" ? "Al día" : "—"}</p>;
}

function NextAdjustmentCell({ row }: { row: ContractListRow }) {
  const next = row.nextAdjustment;
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground truncate">{row.methodLabel}</p>
      {next ? (
        <>
          <p className="text-xs mt-0.5 flex items-center gap-1.5 min-w-0">
            <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: ADJUSTMENT_STATUS_META[next.status].color }} />
            <span className="font-medium tabular-nums">{formatDate(next.date, "dd/MM")}</span>
            <span className="text-muted-foreground truncate">· {daysText(next.days)}</span>
          </p>
          {next.amount != null && (
            <p className="text-[11px] text-muted-foreground tabular-nums truncate">
              → {formatMoney(next.amount, row.currency)}
              {next.variationPct != null ? ` (${pctLabel(next.variationPct)})` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs mt-0.5 text-muted-foreground">{row.status === "vigente" ? "Sin más ajustes" : "—"}</p>
      )}
    </div>
  );
}

function EndCell({ row }: { row: ContractListRow }) {
  if (row.status === "finalizado" || row.status === "rescindido") {
    return (
      <div className="min-w-0">
        <StatusBadge meta={CONTRACT_STATE_META[row.status]} compact />
        {row.terminatedAt && <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">{formatDate(row.terminatedAt)}</p>}
      </div>
    );
  }
  // Salida registrada (rescisión notificada o entrega programada): lo que importa es el día que desocupa, no el fin pactado.
  if ((row.displayState === "rescision_notificada" || row.displayState === "salida_programada") && row.terminatedAt) {
    return (
      <div className="min-w-0">
        <p className="text-xs tabular-nums font-semibold text-amber-700 dark:text-amber-300">{formatDate(row.terminatedAt)}</p>
        <StatusBadge meta={CONTRACT_STATE_META[row.displayState]} compact className="mt-1" />
      </div>
    );
  }
  const soon = row.displayState === "por_vencer" || row.displayState === "vencido_ocupado";
  return (
    <div className="min-w-0">
      <p className={cn("text-xs tabular-nums", soon ? "font-semibold text-amber-700 dark:text-amber-300" : "")}>{formatDate(row.endDate)}</p>
      {soon ? (
        <StatusBadge meta={CONTRACT_STATE_META[row.displayState]} compact className="mt-1" />
      ) : row.status === "borrador" ? (
        <StatusBadge meta={CONTRACT_STATE_META.borrador} compact className="mt-1" />
      ) : (
        <p className="text-[10px] text-muted-foreground">{row.daysToEnd > 0 ? `faltan ${Math.round(row.daysToEnd / 30)} meses` : ""}</p>
      )}
    </div>
  );
}

function ContractRow({ row }: { row: ContractListRow }) {
  const href = `/dashboard/alquileres/contratos/${row.id}`;
  const tenant = row.tenantName ? `${row.tenantName}${row.extraTenants ? ` +${row.extraTenants}` : ""}` : "Sin inquilino";
  return (
    <li className="group hover:bg-accent/30 transition-colors">
      <Link href={href} className="block focus-visible:outline-none focus-visible:bg-accent/40">
        {/* Desktop */}
        <div className="hidden md:grid grid-cols-[minmax(0,2.3fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_1rem] items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{row.address}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              <span className="font-mono">{formatContractNumber(row.number)}</span> · <span className="font-mono">{row.propertyCode}</span>
              {row.city ? ` · ${row.city}` : ""}
            </p>
          </div>
          <p className="text-sm truncate">{tenant}</p>
          <div className="text-right min-w-0">
            <Money amount={row.currentRent} currency={row.currency} className="text-sm font-semibold" />
            {row.periodLabel && (
              <div className="mt-0.5">
                <PeriodPill>{row.periodLabel}</PeriodPill>
              </div>
            )}
          </div>
          <NextAdjustmentCell row={row} />
          <EndCell row={row} />
          <BalanceCell row={row} />
          <ChevronRight size={16} className="text-muted-foreground/50 group-hover:text-foreground transition-colors" />
        </div>
        {/* Mobile */}
        <div className="md:hidden p-3.5 space-y-2.5">
          <div className="flex items-start gap-3">
            {row.nextAdjustment && row.nextAdjustment.days <= 31 && row.nextAdjustment.days >= 0 ? (
              <DateTile date={row.nextAdjustment.date} tone="warn" />
            ) : (
              <DateTile date={row.endDate} tone={row.displayState === "por_vencer" || row.displayState === "vencido_ocupado" ? "warn" : "neutral"} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug truncate">{row.address}</p>
              <p className="text-xs text-muted-foreground truncate">{tenant}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{formatContractNumber(row.number)}</p>
            </div>
            <BalanceCell row={row} />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Alquiler</p>
              <div className="flex items-center gap-1.5">
                <Money amount={row.currentRent} currency={row.currency} className="text-sm font-semibold" />
                {row.periodLabel && <PeriodPill>{row.periodLabel}</PeriodPill>}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
                <CalendarClock size={11} /> {row.nextAdjustment ? "Ajusta" : "Vence"}
              </p>
              <p className="text-xs font-medium tabular-nums">
                {row.nextAdjustment ? `${formatDate(row.nextAdjustment.date)} · ${daysText(row.nextAdjustment.days)}` : formatDate(row.endDate)}
              </p>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
