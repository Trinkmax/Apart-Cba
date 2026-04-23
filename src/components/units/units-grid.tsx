"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, MapPin, Bed, Bath, Users, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UNIT_STATUSES, UNIT_STATUS_META } from "@/lib/constants";
import { formatMoney, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UnitWithRelations, UnitStatus } from "@/lib/types/database";

export function UnitsGrid({ units }: { units: UnitWithRelations[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UnitStatus | "all">("all");

  const filtered = useMemo(() => {
    return units.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          u.code.toLowerCase().includes(q) ||
          u.name.toLowerCase().includes(q) ||
          (u.neighborhood?.toLowerCase().includes(q) ?? false) ||
          (u.address?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [units, query, statusFilter]);

  return (
    <>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, nombre, barrio…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as UnitStatus | "all")}>
          <SelectTrigger className="w-44 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {UNIT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                <span className="flex items-center gap-2">
                  <span className="status-dot" style={{ backgroundColor: UNIT_STATUS_META[s].color }} />
                  {UNIT_STATUS_META[s].label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Building2 className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Sin unidades</p>
          <p className="text-xs text-muted-foreground mt-1">
            {query || statusFilter !== "all" ? "Probá ajustando los filtros" : "Cargá tu primera unidad"}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((unit) => {
            const meta = UNIT_STATUS_META[unit.status];
            return (
              <Link
                key={unit.id}
                href={`/dashboard/unidades/${unit.id}`}
                className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
              >
                <Card className={cn(
                  "overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/30 group-hover:-translate-y-0.5"
                )}>
                  <div className="h-1" style={{ backgroundColor: meta.color }} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold tracking-tight font-mono text-sm">{unit.code}</div>
                        <div className="text-sm text-muted-foreground truncate">{unit.name}</div>
                      </div>
                      <Badge
                        variant="secondary"
                        className="text-[10px] gap-1 font-normal shrink-0"
                        style={{ color: meta.color, borderColor: meta.color + "40" }}
                      >
                        <span className="status-dot" style={{ backgroundColor: meta.color }} />
                        {meta.label}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                      {unit.bedrooms !== null && unit.bedrooms !== undefined && (
                        <span className="flex items-center gap-1"><Bed size={11} /> {unit.bedrooms}</span>
                      )}
                      {unit.bathrooms !== null && unit.bathrooms !== undefined && (
                        <span className="flex items-center gap-1"><Bath size={11} /> {unit.bathrooms}</span>
                      )}
                      {unit.max_guests && (
                        <span className="flex items-center gap-1"><Users size={11} /> {unit.max_guests}</span>
                      )}
                    </div>

                    {unit.neighborhood && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <MapPin size={11} />
                        <span className="truncate">{unit.neighborhood}</span>
                      </div>
                    )}

                    {unit.base_price && (
                      <div className="text-sm font-semibold mt-3">
                        {formatMoney(Number(unit.base_price), unit.base_price_currency ?? "ARS")}
                        <span className="text-xs text-muted-foreground font-normal ml-1">/ noche</span>
                      </div>
                    )}

                    {unit.primary_owner && (
                      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border/50">
                        <Avatar className="size-5">
                          <AvatarFallback className="text-[8px] bg-muted">
                            {getInitials(unit.primary_owner.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[11px] text-muted-foreground truncate">
                          {unit.primary_owner.full_name}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
