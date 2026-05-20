"use client";

import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCalendarPrices, type CalendarDayPrice } from "@/lib/actions/pricing";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { EditBasePriceDialog } from "./edit-base-price-dialog";
import { ApplyRateDialog } from "./apply-rate-dialog";
import { RulesTable } from "./rules-table";
import type { UnitPricingRule } from "@/lib/types/database";

const WEEKDAY_HEADERS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

interface Props {
  unitId: string;
  initialYear: number;
  initialMonth: number;
  initialDays: CalendarDayPrice[];
  initialBasePrice: number;
  initialCurrency: string;
  initialRules: UnitPricingRule[];
}

export function RateCalendarClient({
  unitId,
  initialYear,
  initialMonth,
  initialDays,
  initialBasePrice,
  initialCurrency,
  initialRules,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [days, setDays] = useState(initialDays);
  const [basePrice, setBasePrice] = useState(initialBasePrice);
  const [currency, setCurrency] = useState(initialCurrency);
  const [rules, setRules] = useState(initialRules);
  const [isPending, startTransition] = useTransition();

  // Selection for creating rules
  const [selectedRange, setSelectedRange] = useState<{ from: string; to: string } | null>(null);
  const [showRateDialog, setShowRateDialog] = useState(false);

  function refreshMonth(y: number, m: number) {
    startTransition(async () => {
      try {
        const data = await getCalendarPrices(unitId, y, m);
        setDays(data.days);
        setBasePrice(data.basePrice);
        setCurrency(data.currency);
      } catch (e) {
        toast.error("Error cargando precios", { description: (e as Error).message });
      }
    });
  }

  function refreshAll() {
    startTransition(async () => {
      try {
        const [calData, { listActiveRules }] = await Promise.all([
          getCalendarPrices(unitId, year, month),
          import("@/lib/actions/pricing"),
        ]);
        const rulesData = await listActiveRules(unitId);
        setDays(calData.days);
        setBasePrice(calData.basePrice);
        setCurrency(calData.currency);
        setRules(rulesData);
      } catch (e) {
        toast.error("Error actualizando", { description: (e as Error).message });
      }
    });
  }

  function goMonth(delta: number) {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth < 1) { newMonth = 12; newYear--; }
    if (newMonth > 12) { newMonth = 1; newYear++; }
    setMonth(newMonth);
    setYear(newYear);
    refreshMonth(newYear, newMonth);
  }

  function handleCellClick(date: string) {
    if (!selectedRange) {
      setSelectedRange({ from: date, to: date });
    } else if (selectedRange.from === date && selectedRange.to === date) {
      // Click same cell again — open dialog
      setShowRateDialog(true);
    } else if (date < selectedRange.from) {
      setSelectedRange({ from: date, to: selectedRange.to });
    } else {
      setSelectedRange({ from: selectedRange.from, to: date });
      setShowRateDialog(true);
    }
  }

  // Calendar grid
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
  // Convert Sunday=0 to Monday-based (0=Mon, 6=Sun)
  const startPad = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  return (
    <div className="space-y-4">
      {/* Header: base price + navigation */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Card className="px-4 py-2.5">
            <div className="text-xs text-muted-foreground">Precio base / noche</div>
            <div className="text-lg font-semibold">{formatCurrency(basePrice, currency)}</div>
          </Card>
          <EditBasePriceDialog
            unitId={unitId}
            currentPrice={basePrice}
            currentCurrency={currency}
            onSaved={refreshAll}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => goMonth(-1)} disabled={isPending}>
            <ChevronLeft size={16} />
          </Button>
          <span className="text-sm font-medium w-40 text-center">
            {isPending ? (
              <Loader2 className="animate-spin size-4 mx-auto" />
            ) : (
              `${MONTH_NAMES[month - 1]} ${year}`
            )}
          </span>
          <Button size="icon" variant="outline" onClick={() => goMonth(1)} disabled={isPending}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <Card className="p-3 sm:p-4 overflow-x-auto">
        <div className="grid grid-cols-7 gap-px min-w-[420px]">
          {WEEKDAY_HEADERS.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1.5">
              {d}
            </div>
          ))}
          {/* Padding for first week */}
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map((day) => {
            const isSelected =
              selectedRange &&
              day.date >= selectedRange.from &&
              day.date <= selectedRange.to;
            const hasRule = day.ruleId !== null;
            const isModified = day.price !== basePrice;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => handleCellClick(day.date)}
                className={`
                  relative p-1.5 sm:p-2 rounded-md text-left transition-colors min-h-[56px]
                  hover:ring-2 hover:ring-primary/40
                  ${day.hasBooking ? "bg-rose-500/10" : ""}
                  ${isSelected ? "ring-2 ring-primary bg-primary/5" : ""}
                  ${hasRule && !day.hasBooking ? "bg-amber-500/5" : ""}
                `}
              >
                <div className="text-[11px] text-muted-foreground">
                  {parseInt(day.date.slice(-2))}
                </div>
                <div className={`text-xs font-medium ${isModified ? "text-amber-600 dark:text-amber-400" : ""}`}>
                  {formatCurrency(day.price, currency)}
                </div>
                {day.ruleName && (
                  <div className="text-[8px] text-muted-foreground truncate mt-0.5">{day.ruleName}</div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Apply rate dialog */}
      {showRateDialog && selectedRange && (
        <ApplyRateDialog
          unitId={unitId}
          dateFrom={selectedRange.from}
          dateTo={selectedRange.to}
          onClose={() => {
            setShowRateDialog(false);
            setSelectedRange(null);
          }}
          onSaved={() => {
            setShowRateDialog(false);
            setSelectedRange(null);
            refreshAll();
          }}
        />
      )}

      {/* Rules table */}
      <RulesTable
        rules={rules}
        basePrice={basePrice}
        currency={currency}
        onChanged={refreshAll}
      />
    </div>
  );
}
