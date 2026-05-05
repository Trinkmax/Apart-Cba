"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarCheck2,
  CalendarX2,
  Moon,
  Users,
  DollarSign,
  ExternalLink,
  Loader2,
  Pencil,
  Phone,
  Mail,
  CircleDot,
  Lock,
  LogIn,
  LogOut,
  Ban,
  Plus,
  StickyNote,
  Pencil as PencilIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BOOKING_STATUS_META, BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDate, formatMoney, formatNights, getInitials } from "@/lib/format";
import {
  addBookingPayment,
  changeBookingStatus,
  getUnitReadinessForCheckIn,
  type UnitReadiness,
} from "@/lib/actions/bookings";
import { CheckInReadinessDialog } from "@/components/bookings/check-in-readiness-dialog";
import type {
  BookingWithRelations,
  BookingStatus,
  CashAccount,
} from "@/lib/types/database";
import { cn } from "@/lib/utils";

type AccountLite = Pick<CashAccount, "id" | "name" | "currency" | "type">;

interface PmsBookingPopoverProps {
  booking: BookingWithRelations;
  unitCode: string;
  unitName: string;
  accounts?: AccountLite[];
  onEdit: () => void;
  onStatusChanged?: (nextStatus: BookingStatus) => void;
  onPaymentAdded?: (newPaid: number) => void;
  /**
   * Callback al pedir cambio de fecha desde las cards check-in/check-out.
   * El parent (PmsBoard) abre el flujo MoveConfirmDialog con el preview
   * (conflictos, recálculo de precio, reason, etc.) consistente con el drag.
   */
  onRequestDateChange?: (
    field: "check_in_date" | "check_out_date",
    newDateISO: string
  ) => void;
}

export function PmsBookingPopoverContent({
  booking,
  unitCode,
  unitName,
  accounts = [],
  onEdit,
  onStatusChanged,
  onPaymentAdded,
  onRequestDateChange,
}: PmsBookingPopoverProps) {
  const [pending, startTransition] = useTransition();
  const statusMeta = BOOKING_STATUS_META[booking.status];
  const sourceMeta = BOOKING_SOURCE_META[booking.source];
  const nights = formatNights(booking.check_in_date, booking.check_out_date);
  const pendingAmount = Math.max(0, Number(booking.total_amount) - Number(booking.paid_amount));

  const matchingAccounts = accounts.filter((a) => a.currency === booking.currency);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payAccountId, setPayAccountId] = useState<string>("");
  const [paying, startPaying] = useTransition();
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readiness, setReadiness] = useState<UnitReadiness | null>(null);

  function performCheckIn() {
    startTransition(async () => {
      try {
        await changeBookingStatus(booking.id, "check_in");
        toast.success(`Reserva marcada como ${BOOKING_STATUS_META.check_in.label}`);
        setReadinessOpen(false);
        onStatusChanged?.("check_in");
      } catch (err) {
        toast.error("No se pudo actualizar", {
          description: (err as Error).message,
        });
      }
    });
  }

  function openPayForm() {
    setPayAmount(pendingAmount > 0 ? String(pendingAmount) : "");
    setPayAccountId(matchingAccounts[0]?.id ?? "");
    setShowPayForm(true);
  }

  function submitPayment() {
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Ingresá un importe válido");
      return;
    }
    if (!payAccountId) {
      toast.error("Elegí una cuenta de caja");
      return;
    }
    startPaying(async () => {
      try {
        const updated = await addBookingPayment(booking.id, amount, payAccountId);
        toast.success(`Pago de ${formatMoney(amount, booking.currency)} registrado`);
        setShowPayForm(false);
        setPayAmount("");
        onPaymentAdded?.(Number(updated.paid_amount));
      } catch (e) {
        toast.error("No se pudo registrar el pago", {
          description: (e as Error).message,
        });
      }
    });
  }

  function applyStatus(next: BookingStatus, confirmMsg?: string) {
    // Atajo de UX: si vamos a check_out con saldo pendiente, redirigimos a la
    // página de detalle (donde está el dialog completo con "Cobrar saldo" o
    // "Forzar"). El server igual valida si alguien evita este atajo.
    if (next === "check_out") {
      const total = Number(booking.total_amount ?? 0);
      const paid = Number(booking.paid_amount ?? 0);
      if (total - paid > 0.01) {
        toast.error("La reserva tiene saldo pendiente", {
          description: "Te llevamos al detalle para cobrar antes de hacer check-out.",
        });
        // Pequeña espera para que el toast sea visible antes del navigate
        setTimeout(() => {
          window.location.href = `/dashboard/reservas/${booking.id}`;
        }, 600);
        return;
      }
    }
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    if (next === "check_in") {
      // Verificamos limpieza/mantenimiento antes de avanzar.
      startTransition(async () => {
        try {
          const snap = await getUnitReadinessForCheckIn(booking.unit_id);
          if (snap.ready) {
            await changeBookingStatus(booking.id, "check_in");
            toast.success(
              `Reserva marcada como ${BOOKING_STATUS_META.check_in.label}`
            );
            onStatusChanged?.("check_in");
            return;
          }
          setReadiness(snap);
          setReadinessOpen(true);
        } catch (err) {
          toast.error("No se pudo actualizar", {
            description: (err as Error).message,
          });
        }
      });
      return;
    }
    startTransition(async () => {
      try {
        await changeBookingStatus(booking.id, next);
        toast.success(`Reserva marcada como ${BOOKING_STATUS_META[next].label}`);
        onStatusChanged?.(next);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.startsWith("CHECKOUT_PENDING_BALANCE:")) {
          toast.error("La reserva tiene saldo pendiente", {
            description: msg.replace("CHECKOUT_PENDING_BALANCE: ", ""),
          });
        } else {
          toast.error("No se pudo actualizar", { description: msg });
        }
      }
    });
  }

  return (
    <>
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
          <DateEditCard
            icon={<LogIn size={13} className="text-emerald-600 dark:text-emerald-400" />}
            label="Check-in"
            valueISO={booking.check_in_date}
            value={formatDate(booking.check_in_date, "EEE d MMM")}
            sub={booking.check_in_time?.slice(0, 5) ?? "14:00"}
            // Para check-in: el límite superior es check_out - 1 día
            maxISO={subDaysISO(booking.check_out_date, 1)}
            disabled={
              booking.status === "cancelada" ||
              booking.status === "no_show" ||
              !onRequestDateChange
            }
            onPick={(iso) => onRequestDateChange?.("check_in_date", iso)}
          />
          <DateEditCard
            icon={<LogOut size={13} className="text-rose-600 dark:text-rose-400" />}
            label="Check-out"
            valueISO={booking.check_out_date}
            value={formatDate(booking.check_out_date, "EEE d MMM")}
            sub={booking.check_out_time?.slice(0, 5) ?? "10:00"}
            // Para check-out: el límite inferior es check_in + 1 día
            minISO={addDaysISO(booking.check_in_date, 1)}
            disabled={
              booking.status === "cancelada" ||
              booking.status === "no_show" ||
              !onRequestDateChange
            }
            onPick={(iso) => onRequestDateChange?.("check_out_date", iso)}
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

        {/* Registrar pago */}
        {pendingAmount > 0 && booking.status !== "cancelada" && (
          <div className="pt-2">
            {!showPayForm ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full gap-1.5 text-xs"
                onClick={openPayForm}
              >
                <Plus size={12} /> Registrar pago
              </Button>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Nuevo pago
                  </span>
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPayForm(false)}
                  >
                    Cancelar
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Importe ({booking.currency})</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="h-8 text-xs"
                      autoFocus
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    disabled={paying}
                    onClick={submitPayment}
                  >
                    {paying && <Loader2 className="animate-spin" size={12} />}
                    Cobrar
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Cuenta de caja</Label>
                  {matchingAccounts.length === 0 ? (
                    <div className="text-[10px] text-amber-600 dark:text-amber-400">
                      No hay cuentas en {booking.currency}. Creá una en{" "}
                      <Link href="/dashboard/caja" className="underline">
                        Caja
                      </Link>
                      .
                    </div>
                  ) : (
                    <Select value={payAccountId} onValueChange={setPayAccountId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Elegí cuenta" />
                      </SelectTrigger>
                      <SelectContent>
                        {matchingAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id} className="text-xs">
                            {a.name} · {a.currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <button
                    type="button"
                    className="hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setPayAmount(String(pendingAmount))}
                  >
                    Saldar {formatMoney(pendingAmount, booking.currency)}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {booking.notes && (
        <>
          <Separator />
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              <StickyNote size={10} />
              Notas
            </div>
            <p className="text-xs text-foreground/90 whitespace-pre-wrap">{booking.notes}</p>
          </div>
        </>
      )}

      {booking.internal_notes && (
        <>
          <Separator />
          <div className="px-4 py-3 bg-amber-50/60 dark:bg-amber-500/10">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-amber-800 dark:text-amber-300">
                <Lock size={10} />
                Comentario interno
              </div>
              <Badge
                variant="outline"
                className="text-[9px] h-4 px-1.5 font-normal border-amber-500/40 text-amber-800 dark:text-amber-300"
              >
                Solo equipo
              </Badge>
            </div>
            <p className="text-xs text-amber-900/90 dark:text-amber-100/90 whitespace-pre-wrap">
              {booking.internal_notes}
            </p>
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

    <CheckInReadinessDialog
      open={readinessOpen}
      onOpenChange={setReadinessOpen}
      readiness={readiness}
      isPending={pending}
      onConfirm={performCheckIn}
    />
    </>
  );
}

// ─── Helpers de fecha ───────────────────────────────────────────────────────
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function subDaysISO(iso: string, days: number): string {
  return addDaysISO(iso, -days);
}
function isoFromDate(d: Date): string {
  // toISOString tira UTC; usamos local components para evitar off-by-one en DST
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DateEditCard({
  icon,
  label,
  valueISO,
  value,
  sub,
  minISO,
  maxISO,
  disabled,
  onPick,
}: {
  icon: React.ReactNode;
  label: string;
  valueISO: string;
  value: string;
  sub?: string;
  minISO?: string;
  maxISO?: string;
  disabled?: boolean;
  onPick: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Date(valueISO + "T12:00:00");
  const minDate = minISO ? new Date(minISO + "T12:00:00") : undefined;
  const maxDate = maxISO ? new Date(maxISO + "T12:00:00") : undefined;

  if (disabled) {
    return (
      <div className="rounded-lg border bg-background p-2 opacity-90">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="font-semibold text-xs mt-1">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground tabular-nums">{sub}</div>}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group relative w-full rounded-lg border bg-background p-2 text-left transition-all",
            "hover:bg-accent/40 hover:border-primary/40 hover:shadow-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            open && "ring-2 ring-primary/40 border-primary/40"
          )}
          aria-label={`Cambiar ${label}`}
        >
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {icon}
            {label}
            <PencilIcon
              size={9}
              className="ml-auto opacity-0 group-hover:opacity-60 transition-opacity"
            />
          </div>
          <div className="font-semibold text-xs mt-1">{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground tabular-nums">{sub}</div>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-auto p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={(d) => {
            if (minDate && d < minDate) return true;
            if (maxDate && d > maxDate) return true;
            return false;
          }}
          onSelect={(d) => {
            if (!d) return;
            const iso = isoFromDate(d);
            if (iso === valueISO) {
              setOpen(false);
              return;
            }
            setOpen(false);
            onPick(iso);
          }}
        />
        <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
          Vas a confirmar el cambio en el siguiente paso.
        </div>
      </PopoverContent>
    </Popover>
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
