"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Moon, Phone, UserPlus, Users } from "lucide-react";
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
import { completeChannelGuest } from "@/lib/actions/bookings";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDate, formatNights } from "@/lib/format";
import type { BookingWithRelations } from "@/lib/types/database";

interface CompleteGuestDialogProps {
  booking: BookingWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Notifica al parent para actualizar listas/barras sin esperar realtime. */
  onCompleted?: (
    bookingId: string,
    guest: { id: string; full_name: string; phone: string | null; email: string | null }
  ) => void;
}

/**
 * Form rápido para completar el huésped de una reserva entrada por canal
 * (Airbnb/Booking vía iCal). 3 campos, Enter guarda. Los datos salen del mail
 * o la app de la OTA; acá sólo se tipean nombre y contacto.
 */
export function CompleteGuestDialog({
  booking,
  open,
  onOpenChange,
  onCompleted,
}: CompleteGuestDialogProps) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [guestsCount, setGuestsCount] = useState(String(booking.guests_count ?? 1));
  const [pending, startTransition] = useTransition();
  const sourceMeta = BOOKING_SOURCE_META[booking.source];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (fullName.trim().length < 2) {
      toast.error("Ingresá el nombre del huésped");
      return;
    }
    startTransition(async () => {
      try {
        const res = await completeChannelGuest({
          booking_id: booking.id,
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          guests_count: Number(guestsCount) || undefined,
        });
        toast.success("Huésped asignado", {
          description: `${res.guest.full_name} · ${booking.unit?.code ?? ""}`,
        });
        onCompleted?.(booking.id, res.guest);
        onOpenChange(false);
      } catch (err) {
        toast.error("No se pudo guardar", { description: (err as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus size={16} className="text-amber-600 dark:text-amber-400" />
            Completar datos del huésped
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5 pt-1 text-left">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: sourceMeta?.color ?? "#94a3b8" }}
                  />
                  {sourceMeta?.label ?? booking.source}
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
              <p className="text-[11px] text-muted-foreground">
                Los datos están en el mail o la app de {sourceMeta?.label ?? "la OTA"}.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
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
              <Mail size={11} /> Email <span className="text-muted-foreground font-normal">(opcional)</span>
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
          <Button type="submit" className="w-full gap-1.5" disabled={pending}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Guardar huésped
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
