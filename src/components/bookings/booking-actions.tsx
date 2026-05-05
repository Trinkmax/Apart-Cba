"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { LogIn, LogOut, X, Loader2, AlertTriangle, ShieldAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  changeBookingStatus,
  getUnitReadinessForCheckIn,
  type UnitReadiness,
} from "@/lib/actions/bookings";
import { listAccounts } from "@/lib/actions/cash";
import { formatMoney } from "@/lib/format";
import type { Booking, CashAccount } from "@/lib/types/database";
import { CheckInReadinessDialog } from "./check-in-readiness-dialog";
import { QuickPayCard } from "./quick-pay-card";

interface Props {
  booking: Booking;
  /** El rol viene del layout que ya invoca getCurrentOrg(). Si no se pasa, asumimos no-admin (más restrictivo). */
  role?: "admin" | "recepcion" | "mantenimiento" | "limpieza" | "owner_view";
}

export function BookingActions({ booking, role }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  const [forceReason, setForceReason] = useState("");
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readiness, setReadiness] = useState<UnitReadiness | null>(null);
  // Cuentas de caja para cobrar saldo in-place dentro del dialog.
  // Se cargan lazy al abrir el dialog para no bloquear el render inicial.
  const [accounts, setAccounts] = useState<CashAccount[] | null>(null);

  const total = Number(booking.total_amount ?? 0);
  const paid = Number(booking.paid_amount ?? 0);
  const pending = Number((total - paid).toFixed(2));
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!pendingDialogOpen || accounts !== null) return;
    let cancelled = false;
    listAccounts()
      .then((rows) => {
        if (!cancelled) setAccounts(rows);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingDialogOpen, accounts]);

  function performCheckIn() {
    startTransition(async () => {
      try {
        await changeBookingStatus(booking.id, "check_in");
        toast.success("Check-in registrado");
        setReadinessOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: friendly((e as Error).message) });
      }
    });
  }

  function handle(newStatus: "check_in" | "check_out" | "cancelada") {
    if (newStatus === "cancelada" && !confirm("¿Cancelar la reserva?")) return;
    // Atajo en cliente: si vamos a check_out con saldo, abrimos el dialog
    // sin ir al server (el server igual valida; esto es UX preventivo).
    if (newStatus === "check_out" && pending > 0.01) {
      setPendingDialogOpen(true);
      return;
    }
    if (newStatus === "check_in") {
      // Antes de hacer el check-in chequeamos si la unidad está sucia,
      // tiene limpieza pendiente o tickets de mantenimiento abiertos.
      // Si todo está OK avanzamos directo; sino mostramos un warning.
      startTransition(async () => {
        try {
          const snap = await getUnitReadinessForCheckIn(booking.unit_id);
          if (snap.ready) {
            await changeBookingStatus(booking.id, "check_in");
            toast.success("Check-in registrado");
            router.refresh();
            return;
          }
          setReadiness(snap);
          setReadinessOpen(true);
        } catch (e) {
          toast.error("Error", {
            description: friendly((e as Error).message),
          });
        }
      });
      return;
    }
    startTransition(async () => {
      try {
        await changeBookingStatus(booking.id, newStatus);
        toast.success(
          newStatus === "check_out"
            ? "Check-out registrado"
            : "Reserva cancelada"
        );
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: friendly((e as Error).message) });
      }
    });
  }

  function forceCheckout() {
    const trimmed = forceReason.trim();
    if (trimmed.length < 5) {
      toast.error("Indicá una razón (mínimo 5 caracteres)");
      return;
    }
    startTransition(async () => {
      try {
        await changeBookingStatus(booking.id, "check_out", trimmed, { force_checkout: true });
        toast.success("Check-out forzado registrado", {
          description: "Quedó anotado en notas internas con tu razón.",
        });
        setPendingDialogOpen(false);
        setForceReason("");
        router.refresh();
      } catch (e) {
        toast.error("No se pudo forzar el check-out", { description: friendly((e as Error).message) });
      }
    });
  }

  return (
    <>
      {booking.status === "confirmada" && (
        <Button onClick={() => handle("check_in")} disabled={isPending} className="gap-2">
          {isPending ? <Loader2 className="animate-spin" /> : <LogIn size={14} />}
          Hacer check-in
        </Button>
      )}
      {booking.status === "check_in" && (
        <Button onClick={() => handle("check_out")} disabled={isPending} className="gap-2" variant="default">
          {isPending ? <Loader2 className="animate-spin" /> : <LogOut size={14} />}
          Hacer check-out
        </Button>
      )}
      {booking.status === "pendiente" && (
        <Button
          onClick={() => handle("cancelada")}
          variant="outline"
          disabled={isPending}
          className="gap-2 text-destructive hover:text-destructive"
        >
          <X size={14} /> Cancelar
        </Button>
      )}

      <Dialog open={pendingDialogOpen} onOpenChange={setPendingDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <AlertTriangle size={18} /> Saldo pendiente
            </DialogTitle>
            <DialogDescription>
              No se puede hacer check-out hasta saldar la reserva. Cobrá el saldo
              acá mismo y volvé a intentar el check-out.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold tabular-nums">{formatMoney(total, booking.currency)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Cobrado</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                {formatMoney(paid, booking.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-amber-300/40 pt-2">
              <span className="font-semibold text-amber-900 dark:text-amber-200">Saldo pendiente</span>
              <span className="font-bold text-lg text-amber-900 dark:text-amber-200 tabular-nums">
                {formatMoney(pending, booking.currency)}
              </span>
            </div>
          </div>

          {/* Cobro inline — se carga el listado de cuentas al abrir el dialog */}
          {accounts === null ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
              <Loader2 size={14} className="animate-spin" /> Cargando cuentas de caja...
            </div>
          ) : (
            <QuickPayCard
              bookingId={booking.id}
              currency={booking.currency}
              totalAmount={total}
              paidAmount={paid}
              accounts={accounts}
              disabled={
                booking.status === "cancelada" || booking.status === "no_show"
              }
            />
          )}

          {isAdmin && (
            <div className="rounded-xl border border-rose-300/60 bg-rose-50/50 dark:bg-rose-950/20 dark:border-rose-800/40 p-3 space-y-2">
              <Label className="flex items-center gap-1.5 text-rose-900 dark:text-rose-200 text-[11px] uppercase tracking-wider font-semibold">
                <ShieldAlert size={12} /> Forzar check-out (solo admin)
              </Label>
              <Input
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                placeholder="Razón obligatoria (queda en notas internas)"
                className="bg-background"
              />
              <p className="text-[10px] text-rose-800/80 dark:text-rose-200/80">
                Sólo en casos excepcionales. Queda registrado quién y cuándo lo forzó.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDialogOpen(false)}>
              Cerrar
            </Button>
            <Button asChild variant="outline" className="gap-1.5">
              <Link href={`/dashboard/reservas/${booking.id}`}>
                <Wallet size={14} /> Ver detalle
              </Link>
            </Button>
            {isAdmin && (
              <Button
                variant="destructive"
                onClick={forceCheckout}
                disabled={isPending || forceReason.trim().length < 5}
                className="gap-1.5"
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
                Forzar check-out
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CheckInReadinessDialog
        open={readinessOpen}
        onOpenChange={setReadinessOpen}
        readiness={readiness}
        isPending={isPending}
        onConfirm={performCheckIn}
      />
    </>
  );
}

function friendly(raw: string): string {
  if (raw.startsWith("CHECKOUT_PENDING_BALANCE:")) {
    return raw.replace("CHECKOUT_PENDING_BALANCE: ", "");
  }
  return raw;
}
