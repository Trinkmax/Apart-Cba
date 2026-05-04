"use client";

import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertCircle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  House,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BOOKING_MODE_META } from "@/lib/constants";
import { CuotaBadge } from "@/components/payment-schedule/cuota-badge";
import type { MonthlyViewCell } from "@/lib/actions/bookings";
import type {
  BookingPaymentSchedule,
  CashAccount,
} from "@/lib/types/database";

interface PmsMonthlyBoardProps {
  cells: MonthlyViewCell[];
  schedule?: BookingPaymentSchedule[];
  accounts?: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
  fromYear: number;
  fromMonth: number; // 1..12
  monthsCount: number; // cuántos meses mostrar
  orgCurrency: string;
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return amount.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  }
}

/**
 * Vista mensual: una grilla unidad × mes pensada para inquilinos largos.
 * Cada celda muestra:
 *   - Inquilino activo (si lo hay) / multi si hay rotación
 *   - Renta esperada del mes
 *   - Cobrado del mes
 *   - Estado de pago (al día / parcial / vencido)
 *   - % de ocupación del mes
 */
export function PmsMonthlyBoard({
  cells,
  schedule = [],
  accounts = [],
  fromYear,
  fromMonth,
  monthsCount,
  orgCurrency,
}: PmsMonthlyBoardProps) {
  const [query, setQuery] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Indexar cuotas por (booking_id, year-month) para overlay rápido en cells
  const scheduleByKey = useMemo(() => {
    const m = new Map<string, BookingPaymentSchedule[]>();
    schedule.forEach((s) => {
      const y = parseInt(s.due_date.slice(0, 4), 10);
      const mo = parseInt(s.due_date.slice(5, 7), 10);
      const key = `${s.booking_id}|${y}-${mo}`;
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
    });
    return m;
  }, [schedule]);

  const bookingsWithOverdue = useMemo(() => {
    const set = new Set<string>();
    schedule.forEach((s) => {
      if (s.status === "overdue") set.add(s.booking_id);
    });
    return set;
  }, [schedule]);
  // Scroll horizontal: los botones < / Hoy / > navegan visualmente entre meses
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const monthColRef = useRef<HTMLTableCellElement | null>(null);

  function scrollByCols(delta: number) {
    const el = scrollRef.current;
    const colWidth = monthColRef.current?.getBoundingClientRect().width ?? 200;
    if (!el) return;
    el.scrollBy({ left: delta * colWidth, behavior: "smooth" });
  }
  function scrollToToday() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: "smooth" });
  }

  // Generar header de meses
  const months = useMemo(() => {
    const out: { year: number; month: number; label: string }[] = [];
    let yy = fromYear;
    let mm = fromMonth;
    for (let i = 0; i < monthsCount; i++) {
      out.push({
        year: yy,
        month: mm,
        label: format(new Date(yy, mm - 1, 1), "MMM yyyy", { locale: es }),
      });
      mm += 1;
      if (mm > 12) {
        mm = 1;
        yy += 1;
      }
    }
    return out;
  }, [fromYear, fromMonth, monthsCount]);

  // Agrupar por unidad
  const unitsMap = useMemo(() => {
    const m = new Map<
      string,
      { unit_id: string; unit_code: string; unit_name: string; cellsByYM: Map<string, MonthlyViewCell> }
    >();
    cells.forEach((c) => {
      const ymKey = `${c.year}-${c.month}`;
      const existing = m.get(c.unit_id);
      if (existing) {
        existing.cellsByYM.set(ymKey, c);
      } else {
        m.set(c.unit_id, {
          unit_id: c.unit_id,
          unit_code: c.unit_code,
          unit_name: c.unit_name,
          cellsByYM: new Map([[ymKey, c]]),
        });
      }
    });
    return m;
  }, [cells]);

  // Filtrado por query + filtrar unidades sin reservas mensuales
  const visibleUnits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Array.from(unitsMap.values())
      .filter((u) => {
        if (!q) return true;
        return (
          u.unit_code.toLowerCase().includes(q) ||
          u.unit_name.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.unit_code.localeCompare(b.unit_code));
  }, [unitsMap, query]);

  const totalRevenueExpected = cells.reduce((s, c) => s + c.total_expected, 0);
  const totalRevenueCollected = cells.reduce((s, c) => s + c.total_collected, 0);

  // Sumario por mes (footer)
  const monthSummaries = useMemo(() => {
    const sums = new Map<string, { expected: number; collected: number }>();
    cells.forEach((c) => {
      const key = `${c.year}-${c.month}`;
      const prev = sums.get(key) ?? { expected: 0, collected: 0 };
      prev.expected += c.total_expected;
      prev.collected += c.total_collected;
      sums.set(key, prev);
    });
    return sums;
  }, [cells]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-[calc(100svh-3.5rem)] md:h-[calc(100svh-4rem)] bg-background">
        {/* Toolbar */}
        <div className="shrink-0 border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/30">
          {/* MOBILE TOOLBAR */}
          <div className="md:hidden flex items-center gap-1 px-2 py-2 safe-x">
            <Button size="icon" variant="ghost" className="size-9 shrink-0 tap" onClick={() => scrollByCols(-1)} aria-label="Mes anterior">
              <ChevronLeft size={17} />
            </Button>
            <Button size="sm" variant="secondary" className="h-9 gap-1 text-[11px] px-2 tap shrink-0" onClick={scrollToToday}>
              <CalendarRange size={13} /> Hoy
            </Button>
            <Button size="icon" variant="ghost" className="size-9 shrink-0 tap" onClick={() => scrollByCols(1)} aria-label="Mes siguiente">
              <ChevronRight size={17} />
            </Button>
            <div className="relative flex-1 min-w-0 ml-1">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-7 h-9 w-full text-[12px]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {bookingsWithOverdue.size > 0 && (
              <Button
                type="button"
                size="icon"
                variant={overdueOnly ? "default" : "outline"}
                onClick={() => setOverdueOnly((v) => !v)}
                className="size-9 shrink-0 relative"
                aria-pressed={overdueOnly}
                aria-label="Filtrar cuotas vencidas"
              >
                <AlertCircle size={14} />
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold tabular-nums">
                  {bookingsWithOverdue.size}
                </span>
              </Button>
            )}
          </div>

          {/* DESKTOP TOOLBAR */}
          <div className="hidden md:flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center ring-1 ring-violet-500/20">
                <House size={15} className="text-violet-700 dark:text-violet-300" />
              </div>
              <div className="hidden md:block">
                <h1 className="text-sm font-semibold leading-none tracking-tight">
                  Calendario Mensual
                </h1>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {visibleUnits.length} unidades · vista pensada para inquilinos largos
                </p>
              </div>
            </div>

            <div className="h-6 w-px bg-border mx-1" />

            <div className="flex items-center gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => scrollByCols(-1)}
              >
                <ChevronLeft size={15} />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 gap-1.5 text-xs"
                onClick={scrollToToday}
              >
                <CalendarRange size={13} /> Hoy
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => scrollByCols(1)}
              >
                <ChevronRight size={15} />
              </Button>
            </div>

            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  placeholder="Buscar unidad…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-7 h-8 w-36 sm:w-56 text-xs"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant={overdueOnly ? "default" : "outline"}
                    onClick={() => setOverdueOnly((v) => !v)}
                    className={cn(
                      "h-8 gap-1 text-xs",
                      bookingsWithOverdue.size > 0 && !overdueOnly &&
                        "border-rose-300/70 dark:border-rose-700/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    )}
                    aria-pressed={overdueOnly}
                  >
                    <AlertCircle size={12} />
                    Cuotas vencidas
                    {bookingsWithOverdue.size > 0 && (
                      <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold tabular-nums">
                        {bookingsWithOverdue.size}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {bookingsWithOverdue.size === 0
                    ? "No hay cuotas vencidas"
                    : `${bookingsWithOverdue.size} reserva${bookingsWithOverdue.size === 1 ? "" : "s"} con cuota vencida`}
                </TooltipContent>
              </Tooltip>
              <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                <Link href="/dashboard/unidades/kanban">
                  <CalendarRange size={12} /> Vista diaria
                </Link>
              </Button>
            </div>
          </div>
          {/* KPIs strip */}
          <div className="hidden md:flex items-center gap-4 px-4 pb-2 text-[11px] text-muted-foreground">
            <span>
              Esperado total:{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatCurrency(totalRevenueExpected, orgCurrency)}
              </span>
            </span>
            <span>
              Cobrado:{" "}
              <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatCurrency(totalRevenueCollected, orgCurrency)}
              </span>
            </span>
            {totalRevenueExpected > 0 && (
              <span>
                Cobranza:{" "}
                <span className="font-semibold tabular-nums">
                  {((totalRevenueCollected / totalRevenueExpected) * 100).toFixed(0)}%
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Grid */}
        <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain touch-pan-x touch-pan-y">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-20 bg-background border-b border-r px-2 sm:px-3 py-1.5 sm:py-2 text-left text-[10px] uppercase tracking-widest text-muted-foreground font-semibold w-20 sm:w-56"
                >
                  Unidad
                </th>
                {months.map((m, idx) => (
                  <th
                    key={`${m.year}-${m.month}`}
                    ref={idx === 0 ? monthColRef : undefined}
                    scope="col"
                    className="border-b border-r px-2 sm:px-3 py-1.5 sm:py-2 text-left text-[10px] uppercase tracking-widest text-muted-foreground font-semibold min-w-[140px] sm:min-w-[180px]"
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleUnits.length === 0 && (
                <tr>
                  <td
                    colSpan={months.length + 1}
                    className="text-center py-12 text-sm text-muted-foreground"
                  >
                    No hay reservas en el rango seleccionado
                  </td>
                </tr>
              )}
              {visibleUnits.map((u, idx) => (
                <tr
                  key={u.unit_id}
                  className={cn(idx % 2 === 1 && "bg-muted/15")}
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-inherit border-b border-r px-2 sm:px-3 py-1.5 sm:py-2 text-left align-top"
                  >
                    <div className="flex flex-col">
                      <span className="font-mono text-[11px] sm:text-xs font-semibold">
                        {u.unit_code}
                      </span>
                      <span className="hidden sm:inline text-[10px] text-muted-foreground truncate">
                        {u.unit_name}
                      </span>
                    </div>
                  </th>
                  {months.map((m) => {
                    const cell = u.cellsByYM.get(`${m.year}-${m.month}`);
                    const cellSchedule: BookingPaymentSchedule[] = [];
                    if (cell) {
                      cell.bookings.forEach((b) => {
                        const key = `${b.id}|${m.year}-${m.month}`;
                        const arr = scheduleByKey.get(key);
                        if (arr) cellSchedule.push(...arr);
                      });
                    }
                    const hasOverdue = cellSchedule.some(
                      (s) => s.status === "overdue"
                    );
                    if (overdueOnly && !hasOverdue) {
                      return (
                        <td
                          key={`${u.unit_id}-${m.year}-${m.month}`}
                          className="border-b border-r p-1.5 sm:p-2 align-top min-w-[140px] sm:min-w-[180px] opacity-30"
                        />
                      );
                    }
                    return (
                      <td
                        key={`${u.unit_id}-${m.year}-${m.month}`}
                        className="border-b border-r p-1.5 sm:p-2 align-top min-w-[140px] sm:min-w-[180px]"
                      >
                        <MonthCell
                          cell={cell}
                          currency={orgCurrency}
                          cellSchedule={cellSchedule}
                          accounts={accounts}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {visibleUnits.length > 0 && (
              <tfoot>
                <tr className="bg-muted/40 font-medium">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-muted/40 border-t border-r px-2 sm:px-3 py-1.5 sm:py-2 text-left text-[10px] sm:text-[11px] uppercase tracking-wider"
                  >
                    Total
                  </th>
                  {months.map((m) => {
                    const sum = monthSummaries.get(`${m.year}-${m.month}`) ?? {
                      expected: 0,
                      collected: 0,
                    };
                    const pct = sum.expected > 0 ? (sum.collected / sum.expected) * 100 : 0;
                    return (
                      <td
                        key={`sum-${m.year}-${m.month}`}
                        className="border-t border-r px-2 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-[11px]"
                      >
                        <div className="font-mono tabular-nums">
                          {formatCurrency(sum.expected, orgCurrency)}
                        </div>
                        <div className="text-[9px] sm:text-[10px] text-muted-foreground tabular-nums">
                          {formatCurrency(sum.collected, orgCurrency)} ·{" "}
                          {pct.toFixed(0)}%
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────

interface MonthCellProps {
  cell: MonthlyViewCell | undefined;
  currency: string;
  cellSchedule?: BookingPaymentSchedule[];
  accounts?: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
}

function MonthCell({
  cell,
  currency,
  cellSchedule = [],
  accounts = [],
}: MonthCellProps) {
  if (!cell || cell.bookings.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground/60 italic">Vacío</div>
    );
  }
  // Booking dominante: el de mayor cantidad de días en el mes (o el primer mensual)
  const dominant =
    cell.bookings.find((b) => (b.mode ?? "temporario") === "mensual") ??
    cell.bookings[0];
  const isMensual = (dominant.mode ?? "temporario") === "mensual";
  const meta = BOOKING_MODE_META[isMensual ? "mensual" : "temporario"];
  const occupancyPct = (cell.occupied_days / cell.days_in_month) * 100;
  const collectionPct =
    cell.total_expected > 0
      ? Math.min(100, (cell.total_collected / cell.total_expected) * 100)
      : 0;
  let payState: "ok" | "partial" | "due" = "ok";
  if (collectionPct < 1) payState = "due";
  else if (collectionPct < 99) payState = "partial";

  return (
    <Link
      href={`/dashboard/reservas/${dominant.id}`}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-2 hover:ring-2 hover:ring-primary/30 transition-all",
        meta.bgClass,
        "border-transparent"
      )}
    >
      <div className="flex items-center gap-1.5">
        <Badge
          variant="secondary"
          className={cn(
            "text-[9px] gap-1 px-1.5 h-4",
            meta.badgeBgClass,
            meta.textClass
          )}
        >
          {meta.shortLabel}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-label={`Cobranza ${payState}`}
              className={cn(
                "size-2 rounded-full ml-auto",
                payState === "ok" && "bg-emerald-500",
                payState === "partial" && "bg-amber-500",
                payState === "due" && "bg-rose-500"
              )}
            />
          </TooltipTrigger>
          <TooltipContent side="top">
            {payState === "ok"
              ? "Cobranza al día"
              : payState === "partial"
                ? "Cobranza parcial"
                : "Sin cobrar"}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="text-[11px] font-semibold truncate">
        {dominant.guest?.full_name ?? "Sin huésped"}
      </div>
      <div className="text-[10px] tabular-nums font-mono">
        {formatCurrency(cell.total_expected, currency)}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full transition-all",
              collectionPct >= 99
                ? "bg-emerald-500"
                : collectionPct > 0
                  ? "bg-amber-500"
                  : "bg-rose-500/40"
            )}
            style={{ width: `${collectionPct}%` }}
          />
        </div>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {occupancyPct.toFixed(0)}%
        </span>
      </div>
      {cell.bookings.length > 1 && (
        <span className="text-[9px] text-muted-foreground">
          +{cell.bookings.length - 1} más
        </span>
      )}
      {cellSchedule.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-0.5">
          {cellSchedule.map((s) => (
            <span
              key={s.id}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="contents"
            >
              <CuotaBadge
                schedule={s}
                bookingId={s.booking_id}
                accounts={accounts}
                size="sm"
              />
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
