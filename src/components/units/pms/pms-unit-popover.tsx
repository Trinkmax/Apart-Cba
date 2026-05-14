"use client";

import Link from "next/link";
import {
  Bed,
  Bath,
  Users,
  MapPin,
  DollarSign,
  ExternalLink,
  Wrench,
  Sparkles,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UNIT_STATUS_META } from "@/lib/constants";
import { formatDate, formatMoney, getInitials } from "@/lib/format";
import type { UnitWithRelations } from "@/lib/types/database";

interface PmsUnitPopoverProps {
  unit: UnitWithRelations;
  occupancyPct: number; // 0..100 dentro de la ventana visible
  nightsOccupied: number;
  nightsTotal: number;
  revenue: number;
  currency: string;
  /** Si es false, esconde "Ingresos" y la tarifa por noche. */
  canViewMoney?: boolean;
}

export function PmsUnitPopoverContent({
  unit,
  occupancyPct,
  nightsOccupied,
  nightsTotal,
  revenue,
  currency,
  canViewMoney = true,
}: PmsUnitPopoverProps) {
  const meta = UNIT_STATUS_META[unit.status];

  return (
    <div className="w-[340px] max-w-[92vw]">
      {/* Header */}
      <div
        className="px-4 py-3 border-b"
        style={{
          background: `linear-gradient(135deg, ${meta.color}18, transparent 70%)`,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ backgroundColor: meta.color }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="font-mono font-semibold text-base">{unit.code}</span>
          <span className="text-xs text-muted-foreground truncate">{unit.name}</span>
        </div>
        {unit.neighborhood && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
            <MapPin size={10} /> {unit.neighborhood}
          </div>
        )}
      </div>

      {/* Occupancy stats */}
      <div className={canViewMoney ? "px-4 py-3 grid grid-cols-3 gap-2" : "px-4 py-3 grid grid-cols-2 gap-2"}>
        <Stat label="Ocupación" value={`${occupancyPct.toFixed(0)}%`} tone={occupancyPct >= 70 ? "ok" : occupancyPct >= 40 ? "warn" : "bad"} />
        <Stat label="Noches" value={`${nightsOccupied}/${nightsTotal}`} />
        {canViewMoney && (
          <Stat label="Ingresos" value={formatMoney(revenue, currency)} compact />
        )}
      </div>

      <Separator />

      {/* Specs */}
      <div className="px-4 py-3 grid grid-cols-2 gap-2 text-[11px]">
        {unit.bedrooms !== null && (
          <SpecRow icon={<Bed size={11} />} label={`${unit.bedrooms} ${unit.bedrooms === 1 ? "hab" : "habs"}`} />
        )}
        {unit.bathrooms !== null && (
          <SpecRow icon={<Bath size={11} />} label={`${unit.bathrooms} ${unit.bathrooms === 1 ? "baño" : "baños"}`} />
        )}
        {unit.max_guests && (
          <SpecRow icon={<Users size={11} />} label={`hasta ${unit.max_guests}`} />
        )}
        {canViewMoney && unit.base_price !== null && unit.base_price !== undefined && (
          <SpecRow
            icon={<DollarSign size={11} />}
            label={`${formatMoney(Number(unit.base_price), unit.base_price_currency ?? "ARS")} /noche`}
          />
        )}
      </div>

      {/* Owner */}
      {unit.primary_owner && (
        <>
          <Separator />
          <div className="px-4 py-2.5 flex items-center gap-2">
            <Avatar className="size-6">
              <AvatarFallback className="text-[9px] bg-muted">
                {getInitials(unit.primary_owner.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Propietario</div>
              <div className="text-xs font-medium truncate">{unit.primary_owner.full_name}</div>
            </div>
          </div>
        </>
      )}

      {/* Next booking */}
      {unit.next_booking && (
        <>
          <Separator />
          <div className="px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Próxima llegada
            </div>
            <div className="text-xs font-medium">
              {formatDate(unit.next_booking.check_in_date, "EEE d 'de' MMM")}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {unit.next_booking.guest?.full_name ?? "Sin huésped"} · {unit.next_booking.guests_count}p
            </div>
          </div>
        </>
      )}

      {/* Open ticket */}
      {unit.open_ticket && (
        <>
          <Separator />
          <div className="px-4 py-2.5 bg-amber-500/10 border-l-2 border-amber-500">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-0.5">
              <Wrench size={10} /> Ticket abierto
            </div>
            <div className="text-xs font-medium truncate">{unit.open_ticket.title}</div>
            <Badge variant="outline" className="text-[9px] mt-1 h-4">
              {unit.open_ticket.priority}
            </Badge>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="px-4 py-3 border-t bg-muted/30 flex gap-1.5">
        <Link href={`/dashboard/unidades/${unit.id}`} className="flex-1">
          <Button size="sm" variant="outline" className="w-full h-7 gap-1.5 text-xs">
            <ExternalLink size={12} /> Ver unidad
          </Button>
        </Link>
        {unit.status !== "limpieza" && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" title="Programar limpieza (próximamente)">
            <Sparkles size={12} />
          </Button>
        )}
        {unit.status !== "bloqueado" && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-muted-foreground" title="Bloquear (próximamente)">
            <Ban size={12} />
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  compact,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
  compact?: boolean;
}) {
  const toneCls =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-rose-600 dark:text-rose-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border bg-background p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-semibold mt-0.5 tabular-nums ${compact ? "text-[11px]" : "text-sm"} ${toneCls}`}>{value}</div>
    </div>
  );
}

function SpecRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {icon}
      <span className="text-foreground/90">{label}</span>
    </div>
  );
}
