"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Coins,
  Loader2,
  MoveHorizontal,
  Package,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  moveBookingTransaction,
  previewBookingChange,
  type BookingChangePreview,
} from "@/lib/actions/bookings";
import { BOOKING_MODE_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  BookingMode,
  BookingWithRelations,
} from "@/lib/types/database";

export type MoveOperation = "move" | "resize-left" | "resize-right";

export interface PendingMove {
  booking: BookingWithRelations;
  operation: MoveOperation;
  /** unit_id destino (igual al original si es resize) */
  targetUnitId: string;
  targetUnitCode: string | null;
  targetUnitName: string | null;
  newCheckInDate: string;
  newCheckOutDate: string;
}

interface MoveConfirmDialogProps {
  pending: PendingMove | null;
  /** Callback cuando se confirmó (server respondió OK). El padre debe limpiar el ghost. */
  onConfirmed: () => void;
  /** Cancelar / cerrar. El padre debe revertir el ghost. */
  onCancel: () => void;
}

const OPERATION_META: Record<
  MoveOperation,
  { title: string; icon: typeof MoveHorizontal; primaryAction: string; tone: string }
> = {
  move: {
    title: "Mover reserva",
    icon: MoveHorizontal,
    primaryAction: "Confirmar y mover",
    tone: "text-blue-600 dark:text-blue-400",
  },
  "resize-left": {
    title: "Cambiar check-in",
    icon: ArrowRight,
    primaryAction: "Confirmar nuevo check-in",
    tone: "text-cyan-600 dark:text-cyan-400",
  },
  "resize-right": {
    title: "Extender estadía",
    icon: ArrowRight,
    primaryAction: "Confirmar y extender",
    tone: "text-violet-600 dark:text-violet-400",
  },
};

function nightsBetween(ci: string, co: string): number {
  const a = new Date(ci + "T12:00:00").getTime();
  const b = new Date(co + "T12:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return amount.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  }
}

function formatDateLong(iso: string): string {
  return format(parseISO(iso), "d MMM yyyy", { locale: es });
}

/**
 * Modal de confirmación obligatorio para todo cambio de fechas/unit hecho por
 * drag & drop. Muestra resumen before/after, conflictos, advertencias, recálculo
 * sugerido de precio y un campo de razón (obligatorio para deltas grandes).
 *
 * UX:
 *   - Modal centrado en desktop. Mobile podría usar Sheet bottom (TODO si hace falta).
 *   - ESC y "Cancelar" revierten. Enter en el form confirma (si no hay blocking).
 *   - Foco inicial en "Cancelar" para evitar Enter accidentales.
 *   - El botón "Confirmar" se deshabilita ante warnings blocking.
 *   - Loading state durante el roundtrip; ghost del padre permanece.
 */
export function MoveConfirmDialog(props: MoveConfirmDialogProps) {
  // Re-mount completo al cambiar la operación pendiente: evita stale-state en
  // preview/reason y elimina el useEffect de reset (anti-pattern en React 19).
  const key = props.pending
    ? `${props.pending.booking.id}|${props.pending.targetUnitId}|${props.pending.newCheckInDate}|${props.pending.newCheckOutDate}|${props.pending.operation}`
    : "idle";
  return <MoveConfirmDialogInner key={key} {...props} />;
}

function MoveConfirmDialogInner({
  pending,
  onConfirmed,
  onCancel,
}: MoveConfirmDialogProps) {
  // Loading inicial = true cuando hay pending, así no necesito setState en effect
  const [preview, setPreview] = useState<BookingChangePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(!!pending);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [acceptSuggestedPrice, setAcceptSuggestedPrice] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  const open = !!pending;

  // Fetch del preview al montar. El cleanup cancela si el componente se
  // desmonta antes (raro porque cada cambio re-monta vía key).
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    previewBookingChange({
      id: pending.booking.id,
      unit_id: pending.targetUnitId,
      check_in_date: pending.newCheckInDate,
      check_out_date: pending.newCheckOutDate,
    })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) setPreviewError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const meta = pending ? OPERATION_META[pending.operation] : null;
  const Icon = meta?.icon ?? MoveHorizontal;

  const oldNights = pending
    ? nightsBetween(pending.booking.check_in_date, pending.booking.check_out_date)
    : 0;
  const newNights = pending
    ? nightsBetween(pending.newCheckInDate, pending.newCheckOutDate)
    : 0;
  const deltaNights = newNights - oldNights;

  const unitChanged =
    pending && pending.targetUnitId !== pending.booking.unit_id;

  const requiresReason = useMemo(() => {
    if (!pending) return false;
    if (unitChanged) return true;
    return Math.abs(deltaNights) > 30;
  }, [pending, unitChanged, deltaNights]);

  const hasBlocking =
    !!preview?.warnings?.some((w) => w.kind === "blocking") ||
    !!preview?.in_closed_settlement_period ||
    (preview?.conflicts?.length ?? 0) > 0;

  const canConfirm =
    !!pending &&
    !!preview &&
    !previewLoading &&
    !hasBlocking &&
    (!requiresReason || reason.trim().length > 3);

  const currency = pending?.booking.currency ?? "ARS";
  const previousTotal = preview?.price_diff.previous_total ?? 0;
  const suggestedTotal = preview?.price_diff.suggested_total ?? 0;
  const totalToSend =
    preview && preview.price_diff.basis !== "unchanged" && acceptSuggestedPrice
      ? suggestedTotal
      : null;

  function handleConfirm(e?: React.FormEvent) {
    e?.preventDefault();
    if (!pending || !canConfirm) return;
    setServerError(null);
    startSubmit(async () => {
      try {
        await moveBookingTransaction({
          id: pending.booking.id,
          unit_id: pending.targetUnitId,
          check_in_date: pending.newCheckInDate,
          check_out_date: pending.newCheckOutDate,
          total_amount: totalToSend,
          reason: reason.trim() || null,
        });
        toast.success("Reserva actualizada", {
          description: `${formatDateLong(pending.newCheckInDate)} → ${formatDateLong(pending.newCheckOutDate)}`,
          icon: <CheckCircle2 size={16} />,
        });
        onConfirmed();
      } catch (err) {
        setServerError((err as Error).message);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isSubmitting) onCancel();
      }}
    >
      <DialogContent
        className="max-w-xl"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            handleConfirm();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-lg ring-1 ring-border bg-muted",
                meta?.tone
              )}
            >
              <Icon size={16} />
            </span>
            <span>{meta?.title ?? "Cambio de reserva"}</span>
            {pending && (
              <Badge
                variant="secondary"
                className={cn(
                  "ml-auto text-[10px] gap-1",
                  BOOKING_MODE_META[pending.booking.mode as BookingMode].badgeBgClass,
                  BOOKING_MODE_META[pending.booking.mode as BookingMode].textClass
                )}
              >
                {BOOKING_MODE_META[pending.booking.mode as BookingMode].label}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {pending?.booking.guest?.full_name ?? "Reserva sin huésped"} ·{" "}
            {pending?.booking.unit?.code ?? "—"}
          </DialogDescription>
        </DialogHeader>

        {previewLoading && (
          <div className="py-6 flex items-center justify-center text-muted-foreground gap-2 text-sm">
            <Loader2 className="animate-spin" size={16} />
            Calculando impacto…
          </div>
        )}

        {previewError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle size={14} className="inline mr-1" />
            {previewError}
          </div>
        )}

        {pending && preview && !previewLoading && (
          <form onSubmit={handleConfirm} className="space-y-4">
            {/* Before / after */}
            <div className="rounded-lg border bg-card overflow-hidden">
              <BeforeAfterRow
                label="Unidad"
                before={
                  pending.booking.unit?.code
                    ? `${pending.booking.unit.code} · ${pending.booking.unit.name ?? ""}`
                    : "—"
                }
                after={
                  pending.targetUnitCode
                    ? `${pending.targetUnitCode} · ${pending.targetUnitName ?? ""}`
                    : "—"
                }
                changed={!!unitChanged}
              />
              <Separator />
              <BeforeAfterRow
                label="Check-in"
                before={formatDateLong(pending.booking.check_in_date)}
                after={formatDateLong(pending.newCheckInDate)}
                changed={pending.booking.check_in_date !== pending.newCheckInDate}
              />
              <Separator />
              <BeforeAfterRow
                label="Check-out"
                before={formatDateLong(pending.booking.check_out_date)}
                after={formatDateLong(pending.newCheckOutDate)}
                changed={pending.booking.check_out_date !== pending.newCheckOutDate}
              />
              <Separator />
              <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-muted-foreground">Noches</span>
                <span className="flex items-center gap-2 font-medium">
                  <span className="tabular-nums">{oldNights}</span>
                  <ArrowRight size={12} className="text-muted-foreground" />
                  <span className="tabular-nums">{newNights}</span>
                  {deltaNights !== 0 && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "tabular-nums",
                        deltaNights > 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      )}
                    >
                      {deltaNights > 0 ? "+" : ""}
                      {deltaNights}
                    </Badge>
                  )}
                </span>
              </div>
            </div>

            {/* Price preview */}
            {preview.price_diff.basis !== "unchanged" && (
              <div
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  preview.price_diff.delta_amount >= 0
                    ? "border-emerald-300/60 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/20"
                    : "border-amber-300/60 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20"
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Coins size={14} />
                  <span className="font-semibold">
                    Sugerencia de precio
                    <span className="font-normal text-muted-foreground ml-1.5">
                      ({preview.price_diff.basis === "monthly_prorated" ? "prorrateo mensual" : "tarifa por noche"})
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono tabular-nums">
                    {formatCurrency(previousTotal, currency)}
                  </span>
                  <ArrowRight size={12} className="text-muted-foreground" />
                  <span className="font-mono tabular-nums font-semibold">
                    {formatCurrency(suggestedTotal, currency)}
                  </span>
                  <span className="font-mono tabular-nums text-xs">
                    ({preview.price_diff.delta_amount >= 0 ? "+" : ""}
                    {formatCurrency(preview.price_diff.delta_amount, currency)})
                  </span>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={acceptSuggestedPrice}
                    onChange={(e) => setAcceptSuggestedPrice(e.target.checked)}
                  />
                  Actualizar el total al sugerido
                  <span className="text-muted-foreground">
                    (destildá si el precio fue cerrado con el huésped)
                  </span>
                </label>
              </div>
            )}

            {/* Warnings */}
            {(preview.warnings.length > 0 ||
              preview.conflicts.length > 0 ||
              preview.cleaning_tasks_affected.length > 0 ||
              preview.open_tickets_in_dest.length > 0) && (
              <div
                className="space-y-1.5"
                aria-live="polite"
                aria-atomic="true"
              >
                {preview.conflicts.map((c) => (
                  <WarningRow
                    key={c.booking_id}
                    kind="blocking"
                    icon={X}
                    text={`Conflicto: solapa con ${c.guest_name ?? "huésped"} (${c.range})`}
                  />
                ))}
                {preview.warnings.map((w, i) => (
                  <WarningRow
                    key={i}
                    kind={w.kind}
                    icon={AlertTriangle}
                    text={w.message}
                  />
                ))}
                {preview.cleaning_tasks_affected.length > 0 && (
                  <WarningRow
                    kind="info"
                    icon={Sparkles}
                    text={`Se reprogramará ${preview.cleaning_tasks_affected.length} limpieza${preview.cleaning_tasks_affected.length === 1 ? "" : "s"} asociada${preview.cleaning_tasks_affected.length === 1 ? "" : "s"}`}
                  />
                )}
                {preview.open_tickets_in_dest.map((t) => (
                  <WarningRow
                    key={t.id}
                    kind={t.priority === "alta" || t.priority === "urgente" ? "blocking" : "info"}
                    icon={Wrench}
                    text={`Ticket ${t.priority} abierto en la unidad destino: ${t.title}`}
                  />
                ))}
              </div>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="flex items-center gap-1">
                Motivo del cambio
                {requiresReason && (
                  <span className="text-rose-600 dark:text-rose-400 text-[10px] uppercase tracking-wider">
                    requerido
                  </span>
                )}
              </Label>
              <Textarea
                id="reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  requiresReason
                    ? "Cambio mayor: justificá el motivo (huésped pidió extender, error de carga, etc.)"
                    : "Opcional. Queda registrado en el historial de la reserva."
                }
                aria-describedby="reason-help"
              />
              {requiresReason && (
                <p
                  id="reason-help"
                  className="text-[10px] text-muted-foreground"
                >
                  Se requiere motivo cuando cambia la unidad o el delta supera los 30 días.
                </p>
              )}
            </div>

            {/* Server error */}
            {serverError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle size={14} className="inline mr-1" />
                {serverError}
              </div>
            )}
          </form>
        )}

        <DialogFooter className="gap-2 mt-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
            autoFocus
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            onClick={handleConfirm}
            disabled={!canConfirm || isSubmitting}
            aria-disabled={!canConfirm || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {meta?.primaryAction ?? "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Subcomponentes (top-level, no inline) ──────────────────────────────────

function BeforeAfterRow({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr_16px_1fr] items-center gap-2 px-4 py-2.5 text-sm">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      <span
        className={cn(
          "truncate",
          changed ? "text-muted-foreground line-through" : "font-medium"
        )}
      >
        {before}
      </span>
      <ArrowRight
        size={12}
        className={cn(
          changed ? "text-foreground" : "text-muted-foreground/50"
        )}
      />
      <span
        className={cn(
          "truncate",
          changed ? "font-semibold text-primary" : "text-muted-foreground"
        )}
      >
        {after}
      </span>
    </div>
  );
}

function WarningRow({
  kind,
  icon: Icon,
  text,
}: {
  kind: "blocking" | "info";
  icon: typeof Package;
  text: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        kind === "blocking"
          ? "border-rose-300/60 bg-rose-50 text-rose-900 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-200"
          : "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200"
      )}
    >
      <Icon size={13} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

