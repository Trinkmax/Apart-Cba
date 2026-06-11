"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, CalendarDays, User, Wifi, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BOOKING_STATUS_META, BOOKING_SOURCE_META } from "@/lib/constants";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { formatDate, formatMoney, formatNights } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingStatus, BookingListRow } from "@/lib/types/database";

interface Props {
  rows: BookingListRow[];
  total: number;
  page: number;
  pageSize: number;
  initialQuery: string;
  initialStatus: BookingStatus | "all";
  organizationId: string;
  canViewMoney?: boolean;
}

export function BookingsListClient({
  rows,
  total,
  page,
  pageSize,
  initialQuery,
  initialStatus,
  organizationId,
  canViewMoney = true,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Input local (controlado) — el filtro real vive en la URL (server-side).
  const [query, setQuery] = useState(initialQuery);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Empuja los filtros a la URL; el server re-renderiza la página filtrada.
  // Resetea a page 0 ante cualquier cambio de filtro.
  const pushParams = (next: { q?: string; status?: string; page?: number }) => {
    const params = new URLSearchParams(searchParams.toString());
    const setOrDelete = (key: string, val: string | undefined) => {
      if (val && val.length > 0 && val !== "all") params.set(key, val);
      else params.delete(key);
    };
    if ("q" in next) setOrDelete("q", next.q);
    if ("status" in next) setOrDelete("status", next.status);
    if ("page" in next && next.page && next.page > 0) params.set("page", String(next.page));
    else if ("page" in next) params.delete("page");
    router.replace(`/dashboard/reservas?${params.toString()}`, { scroll: false });
  };

  // Debounce de la búsqueda: no navegamos en cada tecla.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ q: value, page: 0 });
    }, 350);
  };

  // Realtime — refresca la página cuando otros usuarios crean/editan reservas.
  // Con paginación server-side un prepend local rompería el orden/ventana, así
  // que refrescamos throttleado (máx 1 cada 4 s) y dejamos que el server
  // recomponga la página vigente.
  const lastRefreshRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const throttledRefresh = () => {
      const REFRESH_MS = 4000;
      const now = Date.now();
      const elapsed = now - lastRefreshRef.current;
      if (elapsed >= REFRESH_MS) {
        lastRefreshRef.current = now;
        router.refresh();
      } else if (!refreshTimerRef.current) {
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          lastRefreshRef.current = Date.now();
          router.refresh();
        }, REFRESH_MS - elapsed);
      }
    };

    const channel = supabase
      .channel(`apartcba:bookings-list:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "apartcba",
          table: "bookings",
          filter: `organization_id=eq.${organizationId}`,
        },
        throttledRefresh
      )
      .subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [organizationId, router]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(total, (page + 1) * pageSize);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex gap-2 sm:gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px] sm:max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar unidad, huésped…" value={query} onChange={(e) => onQueryChange(e.target.value)} className="pl-9 h-10" />
        </div>
        <Select value={initialStatus} onValueChange={(v) => pushParams({ status: v, page: 0 })}>
          <SelectTrigger className="w-full xs:w-44 sm:w-44 h-10 flex-1 sm:flex-none min-w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(BOOKING_STATUS_META).map(([k, m]) => (
              <SelectItem key={k} value={k}>
                <span className="flex items-center gap-2">
                  <span className="status-dot" style={{ backgroundColor: m.color }} />
                  {m.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "hidden sm:flex ml-auto items-center gap-1.5 text-[11px] font-medium px-2.5 h-8 rounded-md",
                realtimeConnected
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Wifi
                size={12}
                className={cn(realtimeConnected && "animate-pulse")}
              />
              <span className="hidden md:inline">
                {realtimeConnected ? "En vivo" : "Sin conexión"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {realtimeConnected
              ? "Las reservas se sincronizan en tiempo real"
              : "Reconectando…"}
          </TooltipContent>
        </Tooltip>
      </div>

      {rows.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <CalendarDays className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Sin reservas</p>
          <p className="text-xs text-muted-foreground mt-1">
            {initialQuery || initialStatus !== "all" ? "Probá otros filtros" : "Cargá tu primera reserva"}
          </p>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="divide-y">
              {rows.map((b) => {
                const sm = BOOKING_STATUS_META[b.status];
                const src = BOOKING_SOURCE_META[b.source];
                const nights = formatNights(b.check_in_date, b.check_out_date);
                return (
                  <Link
                    key={b.id}
                    href={`/dashboard/reservas/${b.id}`}
                    className="block hover:bg-accent/30 transition-colors group"
                  >
                    {/* MOBILE: tarjeta stackeada — info densa pero legible */}
                    <div className="md:hidden p-3 flex items-start gap-3">
                      <div
                        className="w-1 self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: sm.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-mono text-[10px] text-muted-foreground">{b.unit?.code}</div>
                            <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                              {b.guest?.full_name ?? "Sin huésped"}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {canViewMoney && (
                              <div className="text-sm font-semibold tabular-nums">{formatMoney(b.total_amount, b.currency)}</div>
                            )}
                            <Badge className="font-normal text-[9px] gap-1 mt-0.5" style={{ color: sm.color, backgroundColor: sm.color + "15", borderColor: sm.color + "30" }}>
                              {sm.label}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-muted-foreground">
                          <div className="flex items-center gap-1 truncate">
                            <CalendarDays size={11} className="shrink-0" />
                            <span className="truncate">
                              {formatDate(b.check_in_date)} → {formatDate(b.check_out_date)}
                            </span>
                          </div>
                          <span className="shrink-0">{nights}n · {b.guests_count}p</span>
                        </div>
                        {canViewMoney && b.paid_amount < b.total_amount && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                            Falta {formatMoney(b.total_amount - b.paid_amount, b.currency)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* DESKTOP: grilla de 12 columnas */}
                    <div className="hidden md:grid grid-cols-12 items-center gap-3 p-3">
                      <div className="col-span-3 min-w-0">
                        <div className="font-mono text-xs text-muted-foreground">{b.unit?.code}</div>
                        <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">{b.unit?.name}</div>
                      </div>
                      <div className="col-span-3 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                          <User size={12} className="text-muted-foreground" />
                          {b.guest?.full_name ?? "Sin huésped"}
                        </div>
                        <div className="text-xs text-muted-foreground">{b.guests_count} {b.guests_count === 1 ? "persona" : "personas"}</div>
                      </div>
                      <div className="col-span-3">
                        <div className="text-sm font-medium">
                          {formatDate(b.check_in_date)} → {formatDate(b.check_out_date)}
                        </div>
                        <div className="text-xs text-muted-foreground">{nights} {nights === 1 ? "noche" : "noches"}</div>
                      </div>
                      <div className="col-span-2 text-right">
                        {canViewMoney ? (
                          <>
                            <div className="text-sm font-semibold">{formatMoney(b.total_amount, b.currency)}</div>
                            {b.paid_amount < b.total_amount && (
                              <div className="text-[10px] text-amber-600 dark:text-amber-400">
                                Falta {formatMoney(b.total_amount - b.paid_amount, b.currency)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="col-span-1 flex flex-col items-end gap-1">
                        <Badge className="font-normal text-[10px] gap-1" style={{ color: sm.color, backgroundColor: sm.color + "15", borderColor: sm.color + "30" }}>
                          {sm.label}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{src.label}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>

          {/* Paginación */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground tabular-nums">
              {rangeStart}–{rangeEnd} de {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page <= 0}
                onClick={() => pushParams({ page: page - 1 })}
              >
                <ChevronLeft size={14} /> Anterior
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums px-1">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page + 1 >= totalPages}
                onClick={() => pushParams({ page: page + 1 })}
              >
                Siguiente <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </TooltipProvider>
  );
}
