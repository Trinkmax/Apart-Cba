"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { addDays, format, parseISO, differenceInDays, isWeekend, isSameDay, isToday } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BookingFormDialog } from "./booking-form-dialog";
import { BOOKING_STATUS_META, UNIT_STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { BookingWithRelations, Unit, UnitWithRelations } from "@/lib/types/database";

interface BookingsTimelineProps {
  units: UnitWithRelations[];
  bookings: BookingWithRelations[];
  startDate: string;
  days: number;
}

const COL_WIDTH = 56; // px per day
const ROW_HEIGHT = 56;

export function BookingsTimeline({ units, bookings, startDate, days }: BookingsTimelineProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const start = parseISO(startDate);
  const today = new Date();

  const dateRange = useMemo(
    () => Array.from({ length: days }).map((_, i) => addDays(start, i)),
    [start, days]
  );

  const bookingsByUnit = useMemo(() => {
    const map = new Map<string, BookingWithRelations[]>();
    bookings.forEach((b) => {
      if (b.status === "cancelada" || b.status === "no_show") return;
      const arr = map.get(b.unit_id) ?? [];
      arr.push(b);
      map.set(b.unit_id, arr);
    });
    return map;
  }, [bookings]);

  const todayOffset = differenceInDays(today, start);

  return (
    <div className="flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20 text-xs">
        <span className="text-muted-foreground">
          {format(start, "MMM yyyy", { locale: es })} — {format(addDays(start, days - 1), "MMM yyyy", { locale: es })}
        </span>
        <span className="ml-auto text-muted-foreground">
          {bookings.length} reservas
        </span>
      </div>

      <ScrollArea className="h-[calc(100%-2.5rem)] w-full">
        <div className="relative" style={{ width: 220 + days * COL_WIDTH }}>
          {/* Header de fechas */}
          <div className="sticky top-0 z-20 flex bg-background border-b">
            <div className="sticky left-0 z-30 w-[220px] shrink-0 bg-background border-r p-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Unidades
            </div>
            {dateRange.map((d) => {
              const isWk = isWeekend(d);
              const isHoy = isToday(d);
              return (
                <div
                  key={d.toISOString()}
                  className={cn(
                    "shrink-0 border-r flex flex-col items-center justify-center text-[10px] py-1.5",
                    isWk && "bg-amber-500/5",
                    isHoy && "bg-primary/15 ring-1 ring-primary/40"
                  )}
                  style={{ width: COL_WIDTH }}
                >
                  <span className="text-muted-foreground uppercase font-medium">
                    {format(d, "EEE", { locale: es }).slice(0, 3)}
                  </span>
                  <span className={cn("font-bold", isHoy && "text-primary")}>
                    {format(d, "d")}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Today indicator line */}
          {todayOffset >= 0 && todayOffset < days && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-primary/40 pointer-events-none z-10"
              style={{ left: 220 + todayOffset * COL_WIDTH + COL_WIDTH / 2 }}
            />
          )}

          {/* Filas: unidades */}
          {units.map((unit, rowIdx) => {
            const unitBookings = bookingsByUnit.get(unit.id) ?? [];
            const unitMeta = UNIT_STATUS_META[unit.status];
            return (
              <div
                key={unit.id}
                className={cn(
                  "flex border-b relative",
                  rowIdx % 2 === 1 && "bg-muted/10"
                )}
                style={{ height: ROW_HEIGHT }}
              >
                <Link
                  href={`/dashboard/unidades/${unit.id}`}
                  className="sticky left-0 z-10 w-[220px] shrink-0 bg-background border-r p-2 hover:bg-accent/30 transition-colors flex items-center gap-2"
                >
                  <span className="status-dot shrink-0" style={{ backgroundColor: unitMeta.color }} />
                  <div className="min-w-0">
                    <div className="font-semibold text-xs font-mono truncate">{unit.code}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{unit.name}</div>
                  </div>
                </Link>
                {/* Cells background grid */}
                {dateRange.map((d) => (
                  <div
                    key={d.toISOString()}
                    className={cn(
                      "shrink-0 border-r border-border/30",
                      isWeekend(d) && "bg-amber-500/5"
                    )}
                    style={{ width: COL_WIDTH }}
                  />
                ))}
                {/* Booking bars */}
                {unitBookings.map((b) => {
                  const ci = parseISO(b.check_in_date);
                  const co = parseISO(b.check_out_date);
                  const startOffset = differenceInDays(ci, start);
                  const length = differenceInDays(co, ci);
                  if (startOffset + length < 0 || startOffset >= days) return null;
                  const visStart = Math.max(startOffset, 0);
                  const visEnd = Math.min(startOffset + length, days);
                  const visLength = visEnd - visStart;
                  if (visLength <= 0) return null;
                  const sm = BOOKING_STATUS_META[b.status];

                  return (
                    <TooltipProvider key={b.id}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            href={`/dashboard/reservas/${b.id}`}
                            className={cn(
                              "absolute h-9 rounded-md text-[10px] font-medium px-2 flex items-center overflow-hidden",
                              "shadow-sm hover:shadow-md hover:z-10 transition-all",
                              "border border-white/40 dark:border-black/40"
                            )}
                            style={{
                              top: 8,
                              left: 220 + visStart * COL_WIDTH + 2,
                              width: visLength * COL_WIDTH - 4,
                              backgroundColor: sm.color,
                              color: "white",
                            }}
                          >
                            <span className="truncate">{b.guest?.full_name ?? "Reserva"}</span>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="space-y-0.5">
                            <div className="font-semibold">{b.guest?.full_name ?? "Sin huésped"}</div>
                            <div className="text-xs">
                              {format(ci, "d MMM", { locale: es })} → {format(co, "d MMM", { locale: es })}
                            </div>
                            <div className="text-xs opacity-80">{sm.label} · {b.guests_count} pax</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
        <ScrollBar orientation="vertical" />
      </ScrollArea>
    </div>
  );
}
