"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeftRight,
  ArrowRight,
  History,
  Loader2,
  MoveHorizontal,
} from "lucide-react";
import { listBookingExtensions } from "@/lib/actions/bookings";
import { cn } from "@/lib/utils";
import type { BookingExtension } from "@/lib/types/database";

interface ExtensionHistoryProps {
  bookingId: string;
}

const OPERATION_LABEL: Record<BookingExtension["operation"], { label: string; tone: string }> = {
  move: { label: "Movida en grilla", tone: "text-blue-700 dark:text-blue-300" },
  extend_right: { label: "Extendida (check-out)", tone: "text-violet-700 dark:text-violet-300" },
  shorten_right: { label: "Acortada (check-out)", tone: "text-amber-700 dark:text-amber-300" },
  extend_left: { label: "Adelantada (check-in)", tone: "text-cyan-700 dark:text-cyan-300" },
  shorten_left: { label: "Demorada (check-in)", tone: "text-amber-700 dark:text-amber-300" },
  change_unit: { label: "Cambio de unidad", tone: "text-emerald-700 dark:text-emerald-300" },
};

/**
 * Lista las modificaciones de fechas/unit de una reserva (audit log).
 * Aparece en la página de detalle. Sin contenido = oculto (evita ruido).
 */
export function ExtensionHistory({ bookingId }: ExtensionHistoryProps) {
  const [extensions, setExtensions] = useState<BookingExtension[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Wrapping con key en el padre garantiza re-mount al cambiar booking, así
  // este effect sólo corre una vez con loading=true por defecto.
  useEffect(() => {
    let cancelled = false;
    listBookingExtensions(bookingId)
      .then((data) => {
        if (!cancelled) setExtensions(data);
      })
      .catch(() => {
        if (!cancelled) setExtensions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 size={12} className="animate-spin" />
        Cargando historial…
      </div>
    );
  }

  if (!extensions || extensions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <History size={12} /> Historial de cambios ({extensions.length})
      </h2>
      <ol className="space-y-2">
        {extensions.map((ext) => (
          <li
            key={ext.id}
            className="rounded-md border bg-card/60 p-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span
                className={cn(
                  "font-semibold inline-flex items-center gap-1.5",
                  OPERATION_LABEL[ext.operation]?.tone
                )}
              >
                {ext.operation === "change_unit" ? (
                  <ArrowLeftRight size={12} />
                ) : (
                  <MoveHorizontal size={12} />
                )}
                {OPERATION_LABEL[ext.operation]?.label ?? ext.operation}
                {ext.delta_days !== 0 && (
                  <span
                    className={cn(
                      "font-mono ml-1",
                      ext.delta_days > 0 ? "text-emerald-600" : "text-amber-600"
                    )}
                  >
                    ({ext.delta_days > 0 ? "+" : ""}
                    {ext.delta_days}d)
                  </span>
                )}
              </span>
              <time
                className="text-[10px] text-muted-foreground tabular-nums"
                dateTime={ext.created_at}
              >
                {format(parseISO(ext.created_at), "d MMM yyyy HH:mm", { locale: es })}
              </time>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
              <span>
                {ext.previous_check_in_date} → {ext.previous_check_out_date}
              </span>
              <ArrowRight size={10} />
              <span className="font-medium text-foreground">
                {ext.new_check_in_date} → {ext.new_check_out_date}
              </span>
            </div>
            {ext.reason && (
              <p className="mt-1.5 text-[11px] italic text-muted-foreground">
                &ldquo;{ext.reason}&rdquo;
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
