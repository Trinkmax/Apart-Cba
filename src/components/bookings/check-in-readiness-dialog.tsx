"use client";

import { AlertTriangle, Building2, Loader2, Sparkles, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { UnitReadiness } from "@/lib/actions/bookings";

const UNIT_STATUS_LABEL: Record<UnitReadiness["unit_status"], string> = {
  disponible: "Disponible",
  reservado: "Reservada",
  ocupado: "Ocupada",
  limpieza: "Pendiente de limpieza",
  mantenimiento: "En mantenimiento",
  bloqueado: "Bloqueada",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readiness: UnitReadiness | null;
  isPending: boolean;
  onConfirm: () => void;
}

/**
 * Dialog de advertencia que se muestra cuando se intenta hacer check-in en una
 * unidad que NO está lista (sucia, con limpieza pendiente o con tickets de
 * mantenimiento abiertos). Permite cancelar o forzar el check-in.
 */
export function CheckInReadinessDialog({
  open,
  onOpenChange,
  readiness,
  isPending,
  onConfirm,
}: Props) {
  const dirty = readiness?.unit_status === "limpieza";
  const hasPendingCleaning = (readiness?.pending_cleaning.length ?? 0) > 0;
  const hasOpenTickets = (readiness?.open_maintenance.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle size={18} /> La unidad no está lista
          </DialogTitle>
          <DialogDescription>
            Revisá los pendientes antes de hacer el check-in. Podés continuar
            igual si ya está coordinado con el equipo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {readiness && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Building2 size={14} /> Estado de la unidad
              </span>
              <Badge
                variant="outline"
                className={
                  dirty
                    ? "border-amber-400 text-amber-700 dark:text-amber-300"
                    : readiness.unit_status === "mantenimiento"
                      ? "border-rose-400 text-rose-700 dark:text-rose-300"
                      : ""
                }
              >
                {UNIT_STATUS_LABEL[readiness.unit_status]}
              </Badge>
            </div>
          )}

          {hasPendingCleaning && readiness && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-200">
                <Sparkles size={12} />
                Limpieza pendiente · {readiness.pending_cleaning.length}
              </div>
              <ul className="space-y-1 text-xs">
                {readiness.pending_cleaning.slice(0, 3).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="capitalize">{c.status.replace("_", " ")}</span>
                    <span className="tabular-nums text-amber-900/80 dark:text-amber-200/80">
                      {formatDateTime(c.scheduled_for)}
                    </span>
                  </li>
                ))}
                {readiness.pending_cleaning.length > 3 && (
                  <li className="text-[11px] text-amber-800/70 dark:text-amber-200/70">
                    + {readiness.pending_cleaning.length - 3} más…
                  </li>
                )}
              </ul>
            </div>
          )}

          {hasOpenTickets && readiness && (
            <div className="rounded-lg border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800/40 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rose-800 dark:text-rose-200">
                <Wrench size={12} />
                Mantenimiento abierto · {readiness.open_maintenance.length}
              </div>
              <ul className="space-y-1 text-xs">
                {readiness.open_maintenance.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{t.title}</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] capitalize shrink-0"
                    >
                      {t.priority}
                    </Badge>
                  </li>
                ))}
                {readiness.open_maintenance.length > 3 && (
                  <li className="text-[11px] text-rose-800/70 dark:text-rose-200/70">
                    + {readiness.open_maintenance.length - 3} más…
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="default"
            onClick={onConfirm}
            disabled={isPending}
            className="gap-1.5"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Hacer check-in igual
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
