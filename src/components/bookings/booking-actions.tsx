"use client";

import { useTransition } from "react";
import { LogIn, LogOut, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { changeBookingStatus } from "@/lib/actions/bookings";
import type { Booking } from "@/lib/types/database";

export function BookingActions({ booking }: { booking: Booking }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handle(newStatus: "check_in" | "check_out" | "cancelada") {
    if (newStatus === "cancelada" && !confirm("¿Cancelar la reserva?")) return;
    startTransition(async () => {
      try {
        await changeBookingStatus(booking.id, newStatus);
        toast.success(
          newStatus === "check_in" ? "Check-in registrado" : newStatus === "check_out" ? "Check-out registrado" : "Reserva cancelada"
        );
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  if (booking.status === "confirmada") {
    return (
      <Button onClick={() => handle("check_in")} disabled={isPending} className="gap-2">
        {isPending ? <Loader2 className="animate-spin" /> : <LogIn size={14} />}
        Hacer check-in
      </Button>
    );
  }
  if (booking.status === "check_in") {
    return (
      <Button onClick={() => handle("check_out")} disabled={isPending} className="gap-2" variant="default">
        {isPending ? <Loader2 className="animate-spin" /> : <LogOut size={14} />}
        Hacer check-out
      </Button>
    );
  }
  if (booking.status === "pendiente") {
    return (
      <Button onClick={() => handle("cancelada")} variant="outline" disabled={isPending} className="gap-2 text-destructive hover:text-destructive">
        <X size={14} /> Cancelar
      </Button>
    );
  }
  return null;
}
