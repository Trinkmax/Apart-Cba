"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarCheck2,
  CalendarX2,
  Moon,
  Users,
  DollarSign,
  ExternalLink,
  Pencil,
  Phone,
  Mail,
  CircleDot,
  LogIn,
  LogOut,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BOOKING_STATUS_META, BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDate, formatMoney, formatNights, getInitials } from "@/lib/format";
import { changeBookingStatus } from "@/lib/actions/bookings";
import type { BookingWithRelations, BookingStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface PmsBookingPopoverProps {
  booking: BookingWithRelations;
  unitCode: string;
  unitName: string;
  onEdit: () => void;
  onStatusChanged?: (nextStatus: BookingStatus) => void;
}

export function PmsBookingPopoverContent({
  booking,
  unitCode,
  unitName,
  onEdit,
  onStatusChanged,
}: PmsBookingPopoverProps) {
  const [pending, startTransition] = useTransition();
  const statusMeta = BOOKING_STATUS_META[booking.status];
  const sourceMeta = BOOKING_SOURCE_META[booking.source];
  const nights = formatNights(booking.check_in_date, booking.check_out_date);
  const pendingAmount = Math.max(0, Number(booking.total_amount) - Number(booking.paid_amount));

  function applyStatus(next: BookingStatus, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    startTransition(async () => {
      try {
        await changeBookingStatus(booking.id, next);
        toast.success(`Reserva marcada como ${BOOKING_STATUS_META[next].label}`);
        onStatusChanged?.(next);
      } catch (err) {
        toast.error("No se pudo actualizar", { description: (err as Error).message });
      }
    });
  }

  return (
    <div className="w-[380px] max-w-[92vw] text-sm">
      {/* Header: status banner */}
      <div
        className="px-4 pt-3 pb-3 border-b relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${statusMeta.color}18, transparent 70%)`,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full shadow-sm animate-pulse"
              style={{ backgroundColor: statusMeta.color }}
            />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: statusMeta.color }}>
              {statusMeta.label}
            </span>
          </div>
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: sourceMeta.color }} />
            {sourceMeta.label}
          </Badge>
        </div>

        <div className="flex items-start gap-3 mt-2">
          <Avatar className="size-10">
            <AvatarFallback className="text-xs font-semibold bg-background">
              {getInitials(booking.guest?.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">{booking.guest?.full_name ?? "Sin huésped"}</div>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
              {booking.guest?.phone && (
                <a href={`tel:${booking.guest.phone}`} className="flex items-center gap-1 hover:text-foreground">
                  <Phone size={10} /> {booking.guest.phone}
                </a>
              )}
              {booking.guest?.email && (
                <a
                  href={`mailto:${booking.guest.email}`}
                  className="flex items-center gap-1 hover:text-foreground truncate"
                >
                  <Mail size={10} /> <span className="truncate">{booking.guest.email}</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Unit + stay */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <CircleDot size={12} className="text-muted-foreground" />
          <span className="font-mono font-semibold">{unitCode}</span>
          <span className="text-muted-foreground truncate">· {unitName}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StayCard
            icon={<LogIn size={13} className="text-emerald-600 dark:text-emerald-400" />}
            label="Check-in"
            value={formatDate(booking.check_in_date, "EEE d MMM")}
            sub={booking.check_in_time?.slice(0, 5) ?? "15:00"}
          />
          <StayCard
            icon={<LogOut size={13} className="text-rose-600 dark:text-rose-400" />}
            label="Check-out"
            value={formatDate(booking.check_out_date, "EEE d MMM")}
            sub={booking.check_out_time?.slice(0, 5) ?? "11:00"}
          />
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
          <span className="flex items-center gap-1"><Moon size={11} /> {nights} {nights === 1 ? "noche" : "noches"}</span>
          <span className="flex items-center gap-1"><Users size={11} /> {booking.guests_count} {booking.guests_count === 1 ? "persona" : "personas"}</span>
        </div>
      </div>

      <Separator />

      {/* Money */}
      <div className="px-4 py-3 space-y-1.5">
        <MoneyRow label="Total" value={formatMoney(Number(booking.total_amount), booking.currency)} highlight />
        <MoneyRow label="Cobrado" value={formatMoney(Number(booking.paid_amount), booking.currency)} />
        <MoneyRow
          label="Saldo"
          value={formatMoney(pendingAmount, booking.currency)}
          intent={pendingAmount > 0 ? "warn" : "ok"}
        />
        {booking.commission_amount !== null && (
          <MoneyRow
            label="Comisión"
            value={formatMoney(Number(booking.commission_amount), booking.currency)}
            subtle
          />
        )}
        {booking.cleaning_fee !== null && booking.cleaning_fee !== undefined && (
          <MoneyRow
            label="Fee limpieza"
            value={formatMoney(Number(booking.cleaning_fee), booking.currency)}
            subtle
          />
        )}
      </div>

      {booking.notes && (
        <>
          <Separator />
          <div className="px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notas</div>
            <p className="text-xs text-foreground/90">{booking.notes}</p>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="px-4 py-3 border-t bg-muted/30 flex flex-wrap gap-1.5">
        {booking.status === "confirmada" && (
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1.5 text-xs"
            disabled={pending}
            onClick={() => applyStatus("check_in")}
          >
            <CalendarCheck2 size={12} /> Check-in
          </Button>
        )}
        {booking.status === "check_in" && (
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1.5 text-xs"
            disabled={pending}
            onClick={() => applyStatus("check_out")}
          >
            <CalendarX2 size={12} /> Check-out
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onEdit}>
          <Pencil size={12} /> Editar
        </Button>
        <Link href={`/dashboard/reservas/${booking.id}`}>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
            <ExternalLink size={12} /> Ver completo
          </Button>
        </Link>
        {booking.status !== "cancelada" && booking.status !== "check_out" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 ml-auto"
            disabled={pending}
            onClick={() => applyStatus("cancelada", "¿Cancelar esta reserva?")}
          >
            <Ban size={12} /> Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

function StayCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-semibold text-xs mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

function MoneyRow({
  label,
  value,
  highlight,
  subtle,
  intent,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  subtle?: boolean;
  intent?: "ok" | "warn";
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={cn(
          "text-[11px]",
          subtle ? "text-muted-foreground/70" : "text-muted-foreground",
          highlight && "font-medium"
        )}
      >
        <DollarSign size={10} className="inline opacity-40 -ml-0.5" /> {label}
      </span>
      <span
        className={cn(
          "font-mono tabular-nums text-xs",
          highlight && "font-semibold text-foreground",
          intent === "warn" && "text-amber-600 dark:text-amber-400 font-semibold",
          intent === "ok" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value}
      </span>
    </div>
  );
}
