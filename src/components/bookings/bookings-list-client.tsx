"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, CalendarDays, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { BOOKING_STATUS_META, BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDate, formatMoney, formatNights } from "@/lib/format";
import type { BookingStatus, BookingWithRelations, Unit } from "@/lib/types/database";

interface Props {
  bookings: BookingWithRelations[];
  units: Pick<Unit, "id" | "code" | "name">[];
}

export function BookingsListClient({ bookings }: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">("all");

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
    <>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por unidad, huésped, ID externo…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 h-10" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as BookingStatus | "all")}>
          <SelectTrigger className="w-44 h-10"><SelectValue /></SelectTrigger>
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
                  className="grid grid-cols-12 items-center gap-3 p-3 hover:bg-accent/30 transition-colors group"
                >
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
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}
