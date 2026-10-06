"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getSettlementPaymentUndoPreview,
  undoSettlementPayment,
} from "@/lib/actions/settlements";
import { formatDate, formatMoney } from "@/lib/format";
import {
  PAYMENT_UNDO_REASON_MAX,
  PAYMENT_UNDO_REASON_MIN,
  PAYMENT_UNDO_WARNING,
  paymentUndoBalanceText,
  paymentUndoMovementLabel,
  paymentUndoSuccessText,
  summarizePaymentUndo,
  type PaymentUndoPreview,
} from "@/lib/settlements/payment-undo";
import { cn } from "@/lib/utils";

/**
 * «Anular el pago» de una liquidación pagada (migración 069).
 *
 * Antes de hacer nada muestra QUÉ se borra de Caja — cuenta, fecha e importe
 * de cada movimiento — y pide el motivo, que queda en el historial de la
 * liquidación y en el de Caja. La lista que se ve es la que se manda: si
 * cambió en el medio (alguien editó la liquidación pagada y entró un ajuste),
 * el RPC no borra nada y acá se vuelve a cargar.
 */
export function UndoPaymentDialog({
  open,
  onOpenChange,
  settlementId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settlementId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* El contenido se monta al abrir: cada apertura arranca limpia y
            lee los movimientos de ese momento. */}
        <UndoPaymentBody
          settlementId={settlementId}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type Loaded =
  | { ok: true; preview: PaymentUndoPreview }
  | { ok: false; error: string };

function UndoPaymentBody({
  settlementId,
  onClose,
}: {
  settlementId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getSettlementPaymentUndoPreview(settlementId)
      .then((res) => {
        if (!cancelled) setLoaded(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoaded({
            ok: false,
            error:
              e instanceof Error
                ? e.message
                : "No se pudieron leer los movimientos del pago",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settlementId, reloadKey]);

  const preview = loaded?.ok ? loaded.preview : null;

  function confirm() {
    if (!preview) return;
    const r = reason.trim();
    if (r.length < PAYMENT_UNDO_REASON_MIN) {
      setError("Contá en pocas palabras por qué anulás el pago.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const res = await undoSettlementPayment(settlementId, {
          reason: r,
          expectedMovementIds: preview.movements.map((m) => m.id),
        });
        if (!res.ok) {
          setError(res.error);
          toast.error("No se pudo anular el pago", { description: res.error });
          // Si la lista cambió (o el pago ya no está), que se vea la de ahora.
          setReloadKey((k) => k + 1);
          return;
        }
        toast.success("Pago anulado", {
          description: paymentUndoSuccessText(res.summary),
        });
        onClose();
        router.refresh();
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        toast.error("No se pudo anular el pago", { description: msg });
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <Undo2 size={16} />
          </span>
          Anular el pago
        </DialogTitle>
        <DialogDescription>
          {preview
            ? `${preview.owner_name ?? "Propietario"} · ${preview.period_label}. `
            : ""}
          La liquidación vuelve a Revisada y queda lista para registrar el pago
          de nuevo.
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <p>{PAYMENT_UNDO_WARNING}</p>
      </div>

      {loaded === null ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Buscando los movimientos del pago…
        </div>
      ) : !loaded.ok ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700 dark:text-rose-300">
          {loaded.error}
        </p>
      ) : (
        <PaymentMovementsList preview={loaded.preview} />
      )}

      {preview && (
        <div className="space-y-1.5">
          <label
            htmlFor="undo-payment-reason"
            className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Motivo
          </label>
          <Textarea
            id="undo-payment-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            rows={2}
            maxLength={PAYMENT_UNDO_REASON_MAX}
            placeholder="Ej.: la transferencia no salió"
            disabled={pending}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Queda en el historial de la liquidación y en el de Caja.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}

      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Volver
        </Button>
        <Button
          variant="destructive"
          onClick={confirm}
          disabled={pending || !preview}
          className="gap-2"
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Undo2 size={14} />
          )}
          Anular el pago
        </Button>
      </DialogFooter>
    </>
  );
}

function PaymentMovementsList({ preview }: { preview: PaymentUndoPreview }) {
  const { movements } = preview;
  if (movements.length === 0) {
    return (
      <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        No hay movimientos del pago en Caja: sólo cambia el estado a Revisada.
      </p>
    );
  }
  const balance = paymentUndoBalanceText(summarizePaymentUndo(movements));
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {movements.length === 1
          ? "Se borra de Caja"
          : `Se borran de Caja (${movements.length})`}
      </div>
      <ul className="divide-y rounded-lg border">
        {movements.map((m) => (
          <li
            key={m.id}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {m.account_name}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {paymentUndoMovementLabel(m)} · {formatDate(m.occurred_at)}
              </div>
            </div>
            <div
              className={cn(
                "shrink-0 text-sm font-semibold tabular-nums",
                m.direction === "out"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {m.direction === "out" ? "−" : "+"}
              {formatMoney(m.amount, m.currency)}
            </div>
          </li>
        ))}
      </ul>
      {balance && <p className="text-xs text-muted-foreground">{balance}</p>}
    </div>
  );
}
