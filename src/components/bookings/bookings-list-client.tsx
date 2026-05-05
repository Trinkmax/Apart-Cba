"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Search, CalendarDays, User, Wifi } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { BookingStatus, BookingWithRelations, Unit } from "@/lib/types/database";

interface Props {
  bookings: BookingWithRelations[];
  units: Pick<Unit, "id" | "code" | "name">[];
  organizationId: string;
}

export function BookingsListClient({ bookings: initialBookings, organizationId }: Props) {
  // Sync con server data cuando llega nuevo prop (router.refresh tras crear/editar).
  // Patrón "ajuste de state durante render" — reemplaza al useEffect+setState.
  const [prevInitial, setPrevInitial] = useState(initialBookings);
  const [bookings, setBookings] = useState(initialBookings);
  if (prevInitial !== initialBookings) {
    setPrevInitial(initialBookings);
    setBookings(initialBookings);
  }
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">("all");
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Realtime — refresca la lista cuando otros usuarios crean/editan reservas.
  useEffect(() => {
    const supabase = createBrowserSupabase();

    async function fetchWithRelations(id: string): Promise<BookingWithRelations | null> {
      const { data } = await supabase
        .from("bookings")
        .select(
          "*, unit:units(id, code, name), guest:guests(id, full_name, phone, email)"
        )
        .eq("id", id)
        .maybeSingle();
      return (data as BookingWithRelations | null) ?? null;
    }

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
        async (payload) => {
          const id =
            (payload.new as { id?: string })?.id ??
            (payload.old as { id?: string })?.id;
          if (!id) return;

          if (payload.eventType === "DELETE") {
            setBookings((prev) => prev.filter((x) => x.id !== id));
            return;
          }

          const full = await fetchWithRelations(id);
          if (!full) return;
          setBookings((prev) => {
            const idx = prev.findIndex((x) => x.id === id);
            if (idx === -1) return [full, ...prev];
            const next = prev.slice();
            next[idx] = full;
            return next;
          });
        }
      )
      .subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          b.unit?.code.toLowerCase().includes(q) ||
          b.unit?.name.toLowerCase().includes(q) ||
          b.guest?.full_name.toLowerCase().includes(q) ||
          b.external_id?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [bookings, query, statusFilter]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex gap-2 sm:gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px] sm:max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar unidad, huésped…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 h-10" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as BookingStatus | "all")}>
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

      {filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <CalendarDays className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Sin reservas</p>
          <p className="text-xs text-muted-foreground mt-1">
            {query || statusFilter !== "all" ? "Probá otros filtros" : "Cargá tu primera reserva"}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y">
            {filtered.map((b) => {
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
                          <div className="text-sm font-semibold tabular-nums">{formatMoney(b.total_amount, b.currency)}</div>
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
                      {b.paid_amount < b.total_amount && (
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
                      <div className="text-sm font-semibold">{formatMoney(b.total_amount, b.currency)}</div>
                      {b.paid_amount < b.total_amount && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400">
                          Falta {formatMoney(b.total_amount - b.paid_amount, b.currency)}
                        </div>
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
      )}
    </TooltipProvider>
  );
}
