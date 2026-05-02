"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postponeSchedule } from "@/lib/actions/payment-schedule";
import { MarkPaidDialog } from "./mark-paid-dialog";
import type {
  BookingPaymentSchedule,
  CashAccount,
} from "@/lib/types/database";

interface CuotaBadgeProps {
  schedule: BookingPaymentSchedule;
  bookingId: string;
  accounts: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
  /** Si se pasa, click navega a la reserva en lugar de abrir popover. Útil en cells densas. */
  hrefOnly?: boolean;
  /** Tamaño del badge — default 'md'. Usar 'sm' en cells del calendario mensual. */
  size?: "sm" | "md";
}

export function CuotaBadge({
  schedule,
  bookingId,
  accounts,
  hrefOnly,
  size = "md",
}: CuotaBadgeProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const tone = STATUS_TONE[schedule.status];
  const Icon = STATUS_ICON[schedule.status];
  const label = `${schedule.sequence_number}/${schedule.total_count}`;
  const sizing =
    size === "sm"
      ? "h-4 px-1 text-[8px]"
      : "h-4 px-1.5 text-[9px]";

  const remaining = Math.max(
    0,
    Number(schedule.expected_amount) - Number(schedule.paid_amount ?? 0)
  );

  function handlePostpone() {
    const newDate = window.prompt(
      `Posponer cuota ${label} (vence ${schedule.due_date}). Nueva fecha (YYYY-MM-DD):`,
      schedule.due_date
    );
    if (!newDate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      toast.error("Formato inválido. Usá YYYY-MM-DD");
      return;
    }
    startTransition(async () => {
      try {
        await postponeSchedule({
          schedule_id: schedule.id,
          new_due_date: newDate,
          reason: null,
        });
        toast.success("Cuota pospuesta");
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error("Error", { description: (err as Error).message });
      }
    });
  }

  const badge = (
    <span
      aria-label={`Cuota ${label} · ${STATUS_LABEL[schedule.status]}`}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm font-bold tabular-nums tracking-tight ring-1 shrink-0",
        sizing,
        tone.bg,
        tone.text,
        tone.ring,
        schedule.status === "overdue" && "animate-pulse"
      )}
    >
      <Icon size={size === "sm" ? 7 : 8} strokeWidth={3} />
      {label}
    </span>
  );

  if (hrefOnly) {
    return (
      <Link href={`/dashboard/reservas/${bookingId}`} aria-label={`Ver reserva`}>
        {badge}
      </Link>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setOpen(true);
            }}
            className="cursor-pointer hover:scale-110 active:scale-95 transition-transform"
          >
            {badge}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="w-72 p-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className={cn("px-3 py-2 border-b", tone.headerBg)}>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center justify-center size-7 rounded-md ring-1",
                  tone.bg,
                  tone.text,
                  tone.ring
                )}
              >
                <Icon size={14} strokeWidth={2.5} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Cuota mensual
                </div>
                <div className="text-sm font-semibold leading-tight">
                  {label} · {STATUS_LABEL[schedule.status]}
                </div>
              </div>
            </div>
          </div>
          <div className="px-3 py-2.5 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Vence
                </div>
                <div className="font-medium">{schedule.due_date}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Esperado
                </div>
                <div className="font-mono font-semibold">
                  {schedule.currency}{" "}
                  {Number(schedule.expected_amount).toLocaleString("es-AR", {
                    maximumFractionDigits: 0,
                  })}
                </div>
              </div>
              {Number(schedule.paid_amount ?? 0) > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Cobrado
                  </div>
                  <div className="font-mono text-emerald-700 dark:text-emerald-400">
                    {schedule.currency}{" "}
                    {Number(schedule.paid_amount).toLocaleString("es-AR", {
                      maximumFractionDigits: 0,
                    })}
                  </div>
                </div>
              )}
              {remaining > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Saldo
                  </div>
                  <div
                    className={cn(
                      "font-mono font-semibold",
                      schedule.status === "overdue"
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-amber-700 dark:text-amber-400"
                    )}
                  >
                    {schedule.currency}{" "}
                    {remaining.toLocaleString("es-AR", {
                      maximumFractionDigits: 0,
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="border-t p-2 flex items-center gap-1.5">
            {schedule.status !== "paid" &&
              schedule.status !== "cancelled" && (
                <Button
                  type="button"
                  size="sm"
                  className="flex-1 h-7 gap-1 text-[11px]"
                  onClick={() => {
                    setOpen(false);
                    setPaidOpen(true);
                  }}
                >
                  <CalendarCheck size={12} />
                  Marcar pagada
                </Button>
              )}
            {schedule.status !== "paid" &&
              schedule.status !== "cancelled" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-[11px]"
                  onClick={handlePostpone}
                  disabled={isPending}
                >
                  <Calendar size={12} />
                  Posponer
                </Button>
              )}
            <Button
              asChild
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-[11px]"
            >
              <Link href={`/dashboard/reservas/${bookingId}`}>
                <ExternalLink size={12} />
                Ver
              </Link>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <MarkPaidDialog
        schedule={schedule}
        accounts={accounts}
        open={paidOpen}
        onOpenChange={setPaidOpen}
      />
    </>
  );
}

const STATUS_TONE: Record<
  string,
  {
    bg: string;
    text: string;
    ring: string;
    headerBg: string;
  }
> = {
  pending: {
    bg: "bg-violet-100 dark:bg-violet-950",
    text: "text-violet-800 dark:text-violet-200",
    ring: "ring-violet-300/70 dark:ring-violet-700/60",
    headerBg: "bg-violet-50 dark:bg-violet-950/50",
  },
  partial: {
    bg: "bg-amber-100 dark:bg-amber-950",
    text: "text-amber-900 dark:text-amber-200",
    ring: "ring-amber-400/80 dark:ring-amber-600/70",
    headerBg: "bg-amber-50 dark:bg-amber-950/50",
  },
  paid: {
    bg: "bg-emerald-100 dark:bg-emerald-950",
    text: "text-emerald-900 dark:text-emerald-200",
    ring: "ring-emerald-400/80 dark:ring-emerald-600/70",
    headerBg: "bg-emerald-50 dark:bg-emerald-950/50",
  },
  overdue: {
    bg: "bg-rose-200 dark:bg-rose-950",
    text: "text-rose-900 dark:text-rose-200",
    ring: "ring-rose-500/80 dark:ring-rose-600/80",
    headerBg: "bg-rose-50 dark:bg-rose-950/50",
  },
  cancelled: {
    bg: "bg-slate-200 dark:bg-slate-800",
    text: "text-slate-700 dark:text-slate-300",
    ring: "ring-slate-400/60 dark:ring-slate-600/60",
    headerBg: "bg-slate-50 dark:bg-slate-900/50",
  },
};

const STATUS_ICON = {
  pending: Clock,
  partial: AlertCircle,
  paid: CheckCircle2,
  overdue: AlertCircle,
  cancelled: Clock,
} as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Cobrada",
  overdue: "Vencida",
  cancelled: "Cancelada",
};
