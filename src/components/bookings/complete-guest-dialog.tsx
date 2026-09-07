"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Banknote, Loader2, Mail, Moon, Phone, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { completeChannelGuest, completeChannelPrice } from "@/lib/actions/bookings";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDate, formatMoney, formatNights } from "@/lib/format";
import {
  channelCommissionPctFor,
  computeBookingEconomics,
  DEFAULT_COMMISSION_BASE,
  type CommissionBase,
} from "@/lib/finance/booking-economics";
import { formatMoneyValue, parseMoneyInput } from "@/components/bookings/money-input";
import type { BookingSource, BookingWithRelations, Unit } from "@/lib/types/database";

/** Lo que el diálogo dejó guardado — el board lo aplica localmente sin esperar realtime. */
export type CompletedPatch = {
  guest?: { id: string; full_name: string; phone: string | null; email: string | null };
  price?: {
    total_amount: number;
    currency: string;
    commission_pct: number | null;
    commission_amount: number | null;
    channel_commission_pct: number | null;
    channel_commission_amount: number | null;
  };
};

interface CompleteGuestDialogProps {
  booking: BookingWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sin permiso de plata no se muestra (ni se manda) la sección de precio. */
  canViewMoney?: boolean;
  /** Moneda por defecto de la org — la reserva de OTA entra con "ARS" fijo. */
  orgCurrency?: string;
  /**
   * La unidad de la reserva. Su moneda base es el mejor default para el
   * precio, y su fee de limpieza es lo que `completeChannelPrice` va a
   * snapshotear al guardar — sin esto el desglose en vivo no lo restaba y
   * prometía un neto mayor al que después mostraba la reserva.
   */
  unit?: Pick<Unit, "cleaning_fee" | "base_price_currency"> | null;
  /** % que se lleva cada canal (organizations.channel_commissions). */
  channelCommissionDefaults?: Partial<Record<BookingSource, number>>;
  /** Base de la comisión de administración — sólo para el desglose en vivo. */
  commissionBase?: CommissionBase;
  /** Notifica al parent para actualizar listas/barras sin esperar realtime. */
  onCompleted?: (bookingId: string, patch: CompletedPatch) => void;
}

const CURRENCIES = ["ARS", "USD", "EUR", "USDT"] as const;

/**
 * Form rápido para completar una reserva entrada por canal (Airbnb/Booking
 * vía iCal): el huésped, el precio, o los dos. El iCal no trae ninguno de
 * los dos — los datos están en el mail o la app de la OTA; acá sólo se
 * tipean. Cada parte se guarda con su propia acción y se puede completar de
 * a una: la fila sigue en "por completar" hasta que estén las dos.
 */
export function CompleteGuestDialog({
  booking,
  open,
  onOpenChange,
  canViewMoney = false,
  orgCurrency = "ARS",
  unit = null,
  channelCommissionDefaults = {},
  commissionBase = DEFAULT_COMMISSION_BASE,
  onCompleted,
}: CompleteGuestDialogProps) {
  // Si el huésped se guardó pero falló el precio, el diálogo sigue abierto con
  // la misma prop `booking` (es una foto): sin esto, reintentar volvería a
  // llamar a completeChannelGuest y el server lo rechaza ("ya tiene huésped").
  const [savedGuest, setSavedGuest] = useState<CompletedPatch["guest"] | null>(null);
  const needsGuest = !booking.guest_id && !savedGuest;
  // Un bloqueo vale $0 de verdad — ahí no falta precio.
  const needsPrice = !booking.is_block && Number(booking.total_amount ?? 0) <= 0;
  const showPrice = needsPrice && canViewMoney;

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [guestsCount, setGuestsCount] = useState(String(booking.guests_count ?? 1));

  const [total, setTotal] = useState("");
  // Mientras la reserva no tiene precio, su moneda es un placeholder (el
  // ingest escribe "ARS" fijo): mandan la moneda de la unidad y después la
  // de la org. Con precio cargado, la de la reserva es un dato.
  const [currency, setCurrency] = useState(
    needsPrice
      ? unit?.base_price_currency || orgCurrency || booking.currency || "ARS"
      : booking.currency || orgCurrency || "ARS"
  );
  // formatMoneyValue: un 0% explícito se ve como "0", no como vacío.
  const [channelPct, setChannelPct] = useState(
    formatMoneyValue(
      booking.channel_commission_pct !== null && booking.channel_commission_pct !== undefined
        ? booking.channel_commission_pct
        : channelCommissionPctFor(channelCommissionDefaults, booking.source)
    )
  );

  const [pending, startTransition] = useTransition();
  const sourceMeta = BOOKING_SOURCE_META[booking.source];
  const sourceLabel = sourceMeta?.label ?? booking.source;

  const totalNum = parseMoneyInput(total);
  const channelPctNum = parseMoneyInput(channelPct);
  // La comisión de administración de una reserva de OTA suele venir vacía (la
  // resuelve el server con la de la unidad al guardar): si no la sabemos, el
  // desglose lo dice en vez de inventar un 0.
  const knowsCommission =
    booking.commission_pct !== null && booking.commission_pct !== undefined;
  // Misma regla de limpieza que el server al guardar: la de la reserva si la
  // tiene; si no, la de la unidad siempre que sea menor al total tipeado.
  const bookingCleaning = Number(booking.cleaning_fee ?? 0);
  const unitCleaning = Number(unit?.cleaning_fee ?? 0);
  const cleaningFee =
    bookingCleaning > 0
      ? bookingCleaning
      : unitCleaning > 0 && totalNum !== null && unitCleaning < totalNum
        ? unitCleaning
        : 0;
  const econ = computeBookingEconomics({
    total: totalNum,
    cleaningFee,
    channelPct: channelPctNum,
    commissionPct: knowsCommission ? booking.commission_pct : 0,
    commissionBase,
  });

  const guestTyped =
    fullName.trim().length > 0 || phone.trim().length > 0 || email.trim().length > 0;
  const priceTyped = total.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    const doGuest = needsGuest && guestTyped;
    const doPrice = showPrice && priceTyped;

    if (!doGuest && !doPrice) {
      toast.error(
        needsGuest && showPrice
          ? "Cargá el huésped o el precio"
          : needsGuest
            ? "Ingresá el nombre del huésped"
            : "Cargá el precio"
      );
      return;
    }
    if (doGuest && fullName.trim().length < 2) {
      toast.error("Ingresá el nombre del huésped");
      return;
    }
    if (doPrice && (totalNum === null || totalNum <= 0)) {
      toast.error("Cargá un total mayor a 0");
      return;
    }
    if (doPrice && channelPctNum !== null && (channelPctNum < 0 || channelPctNum > 100)) {
      toast.error("La comisión del canal tiene que estar entre 0 y 100");
      return;
    }

    startTransition(async () => {
      const patch: CompletedPatch = {};
      try {
        if (doGuest) {
          const res = await completeChannelGuest({
            booking_id: booking.id,
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            email: email.trim() || null,
            guests_count: Number(guestsCount) || undefined,
          });
          patch.guest = res.guest;
          setSavedGuest(res.guest);
        }
        if (doPrice && totalNum !== null) {
          const res = await completeChannelPrice({
            booking_id: booking.id,
            total_amount: totalNum,
            currency,
            channel_commission_pct: channelPctNum,
          });
          if (!res.ok) throw new Error(res.error);
          patch.price = {
            total_amount: Number(res.booking.total_amount),
            currency: res.booking.currency,
            commission_pct: res.booking.commission_pct,
            commission_amount: res.booking.commission_amount,
            channel_commission_pct: res.booking.channel_commission_pct,
            channel_commission_amount: res.booking.channel_commission_amount,
          };
        }
        const parts: string[] = [];
        if (patch.guest) parts.push(patch.guest.full_name);
        if (patch.price) parts.push(formatMoney(patch.price.total_amount, patch.price.currency));
        toast.success(
          patch.guest && patch.price
            ? "Huésped y precio guardados"
            : patch.guest
              ? "Huésped asignado"
              : "Precio cargado",
          { description: `${parts.join(" · ")} · ${booking.unit?.code ?? ""}` }
        );
        onCompleted?.(booking.id, patch);
        onOpenChange(false);
      } catch (err) {
        // Si el huésped ya se guardó y falló el precio, el parent igual se
        // entera del huésped: la fila queda como "sin precio" y no se pierde.
        if (patch.guest) onCompleted?.(booking.id, patch);
        toast.error("No se pudo guardar", { description: (err as Error).message });
      }
    });
  }

  const title =
    needsGuest && showPrice
      ? "Completar huésped y precio"
      : showPrice
        ? "Cargar el precio"
        : "Completar datos del huésped";

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {showPrice && !needsGuest ? (
              <Banknote size={16} className="text-amber-600 dark:text-amber-400" />
            ) : (
              <UserPlus size={16} className="text-amber-600 dark:text-amber-400" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5 pt-1 text-left">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: sourceMeta?.color ?? "#94a3b8" }}
                  />
                  {sourceLabel}
                </span>
                <span className="font-mono font-semibold text-foreground">
                  {booking.unit?.code}
                </span>
                <span className="truncate">{booking.unit?.name}</span>
              </div>
              <div className="flex items-center gap-2 text-xs tabular-nums">
                <span>
                  {formatDate(booking.check_in_date, "EEE d MMM")} →{" "}
                  {formatDate(booking.check_out_date, "EEE d MMM")}
                </span>
                <span className="flex items-center gap-0.5 text-muted-foreground">
                  <Moon size={10} />
                  {formatNights(booking.check_in_date, booking.check_out_date)}n
                </span>
              </div>
              {booking.external_id && (
                <div className="text-[11px] text-muted-foreground">
                  Código de confirmación:{" "}
                  <span className="font-mono text-foreground">{booking.external_id}</span>
                </div>
              )}
              {!needsGuest && (savedGuest?.full_name || booking.guest?.full_name) && (
                <div className="text-[11px] text-muted-foreground">
                  Huésped:{" "}
                  <span className="font-medium text-foreground">
                    {savedGuest?.full_name ?? booking.guest?.full_name}
                  </span>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Los datos están en el mail o la app de {sourceLabel}.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          {needsGuest && (
            <>
              {showPrice && (
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Huésped
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="cg-name">Nombre completo</Label>
                <Input
                  id="cg-name"
                  autoFocus
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Como figura en la reserva"
                  disabled={pending}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cg-phone" className="flex items-center gap-1">
                    <Phone size={11} /> Teléfono{" "}
                    <span className="text-muted-foreground font-normal">(opcional)</span>
                  </Label>
                  <Input
                    id="cg-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+54 9 …"
                    disabled={pending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cg-guests" className="flex items-center gap-1">
                    <Users size={11} /> Huéspedes
                  </Label>
                  <Input
                    id="cg-guests"
                    type="number"
                    min={1}
                    max={30}
                    value={guestsCount}
                    onChange={(e) => setGuestsCount(e.target.value)}
                    disabled={pending}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-email" className="flex items-center gap-1">
                  <Mail size={11} /> Email{" "}
                  <span className="text-muted-foreground font-normal">(opcional)</span>
                </Label>
                <Input
                  id="cg-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="huesped@email.com"
                  disabled={pending}
                />
              </div>
            </>
          )}

          {/* Precio — sólo si la reserva entró en $0 y el rol ve plata. El
              iCal de la OTA no trae importe; el total es lo que paga el
              huésped con la limpieza adentro. */}
          {showPrice && (
            <div className={needsGuest ? "border-t pt-3 space-y-3" : "space-y-3"}>
              {needsGuest && (
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Precio
                </div>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cg-total">Total</Label>
                  <Input
                    id="cg-total"
                    type="text"
                    inputMode="decimal"
                    autoFocus={!needsGuest}
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    placeholder="0"
                    disabled={pending}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Paga el huésped, incluye limpieza
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cg-currency">Moneda</Label>
                  <Select value={currency} onValueChange={setCurrency} disabled={pending}>
                    <SelectTrigger id="cg-currency" className="w-[92px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-channel-pct">Comisión del canal %</Label>
                <Input
                  id="cg-channel-pct"
                  type="text"
                  inputMode="decimal"
                  value={channelPct}
                  onChange={(e) => setChannelPct(e.target.value)}
                  placeholder="0"
                  disabled={pending}
                />
                <p className="text-[10px] text-muted-foreground">
                  Lo que se lleva {sourceLabel}. Se puede cambiar después desde la reserva.
                </p>
              </div>
              {totalNum !== null && totalNum > 0 && (
                <p className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {econ.channelPct > 0 && (
                    <>
                      Se lleva {sourceLabel}{" "}
                      <span className="font-mono tabular-nums">
                        −{formatMoney(econ.channelCommission, currency)}
                      </span>
                      {" · "}
                    </>
                  )}
                  {knowsCommission ? (
                    <>
                      Tu comisión{" "}
                      <span className="font-mono tabular-nums">
                        −{formatMoney(econ.commission, currency)}
                      </span>
                      {" · "}
                    </>
                  ) : null}
                  {econ.cleaning > 0 && (
                    <>
                      Limpieza{" "}
                      <span className="font-mono tabular-nums">
                        −{formatMoney(econ.cleaning, currency)}
                      </span>
                      {" · "}
                    </>
                  )}
                  {knowsCommission ? "Al propietario" : "Antes de tu comisión"}{" "}
                  <span className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                    {formatMoney(econ.ownerNet, currency)}
                  </span>
                </p>
              )}
            </div>
          )}

          <Button type="submit" className="w-full gap-1.5" disabled={pending}>
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : showPrice && !needsGuest ? (
              <Banknote size={14} />
            ) : (
              <UserPlus size={14} />
            )}
            {needsGuest && showPrice ? "Guardar" : showPrice ? "Cargar precio" : "Guardar huésped"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
