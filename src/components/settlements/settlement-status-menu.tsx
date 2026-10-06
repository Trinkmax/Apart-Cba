"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2, Lock, Undo2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { changeSettlementStatus } from "@/lib/actions/settlements";
import {
  MANUAL_SETTLEMENT_STATUSES,
  SETTLEMENT_STATUS_META,
  type ManualSettlementStatus,
} from "@/lib/settlements/labels";
import type { SettlementStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { UndoPaymentDialog } from "./undo-payment-dialog";

/**
 * El estado de la liquidación, editable desde el chip del encabezado.
 *
 * Los botones de `SettlementActions` sólo avanzan (borrador → revisada →
 * enviada): una liquidación enviada no tenía forma de volver a revisada o a
 * borrador. Acá se elige cualquiera de MANUAL_SETTLEMENT_STATUSES, en cualquier
 * dirección. "Pagada" no se elige: la marca «Registrar pago» junto con el
 * egreso en Caja. Una pagada sale sólo con «Anular el pago» (migración 069),
 * que borra ese egreso y la deja revisada: elegir otro estado a mano dejaría
 * en Caja un pago que la liquidación ya no reconoce.
 */
export function SettlementStatusMenu({
  settlementId,
  status,
  paid,
}: {
  settlementId: string;
  status: string;
  /** Pago registrado en Caja (status pagada o paid_movement_id). */
  paid: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const meta = SETTLEMENT_STATUS_META[status as SettlementStatus] ?? {
    label: status,
    color: "#64748b",
    description: "",
  };

  const chip = (
    <>
      {pending ? (
        <Loader2 size={10} className="animate-spin" />
      ) : (
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: meta.color }}
        />
      )}
      {meta.label}
    </>
  );

  // Anulada es terminal: el documento queda de sólo lectura.
  if (status === "anulada") {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/15">
        {chip}
      </div>
    );
  }

  function apply(next: ManualSettlementStatus) {
    if (next === status) return;
    start(async () => {
      try {
        const res = await changeSettlementStatus(settlementId, next);
        if (!res.ok) {
          toast.error("No se pudo cambiar el estado", { description: res.error });
          return;
        }
        toast.success(
          `Marcada como ${SETTLEMENT_STATUS_META[next].label.toLowerCase()}`,
        );
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo cambiar el estado", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={pending}
            title="Cambiar estado"
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full",
              "bg-white/15 hover:bg-white/25 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
              pending && "opacity-70",
            )}
          >
            {chip}
            <ChevronDown size={11} className="opacity-70" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="w-64"
          // Al abrir el diálogo, el foco no vuelve al chip: se lo robaría al
          // diálogo mientras termina la animación de cierre del menú.
          onCloseAutoFocus={(e) => {
            if (undoOpen) e.preventDefault();
          }}
        >
          {paid ? (
            <>
              <div className="p-2.5 flex gap-2">
                <Lock size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Pagada.</span> El
                  pago está registrado en Caja: el estado sólo cambia anulando
                  ese pago.
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setUndoOpen(true)}
                className="gap-2 items-start text-xs text-rose-600 focus:text-rose-700 dark:text-rose-400 dark:focus:text-rose-300"
              >
                <Undo2 size={13} className="mt-0.5 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium">Anular el pago</span>
                  <span className="block text-[10.5px] text-muted-foreground">
                    Vuelve a Revisada y borra el egreso de Caja.
                  </span>
                </span>
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                Estado de la liquidación
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {MANUAL_SETTLEMENT_STATUSES.map((s) => {
                const m = SETTLEMENT_STATUS_META[s];
                return (
                  <DropdownMenuItem
                    key={s}
                    // El menú queda abierto con el spinner hasta que responde;
                    // elegir el estado actual sólo lo cierra.
                    onSelect={(e) => {
                      if (s === status) return;
                      e.preventDefault();
                      apply(s);
                    }}
                    disabled={pending}
                    className="gap-2 items-start text-xs"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full mt-1"
                      style={{ backgroundColor: m.color }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block">{m.label}</span>
                      <span className="block text-[10.5px] text-muted-foreground">
                        {m.description}
                      </span>
                    </span>
                    {s === status && <Check size={13} className="mt-0.5 opacity-70" />}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled className="gap-2 items-start text-xs">
                <span
                  className="size-2 shrink-0 rounded-full mt-1"
                  style={{ backgroundColor: SETTLEMENT_STATUS_META.pagada.color }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block">{SETTLEMENT_STATUS_META.pagada.label}</span>
                  <span className="block text-[10.5px] text-muted-foreground">
                    Se marca con «Registrar pago».
                  </span>
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Hermano del menú, no adentro: un diálogo dentro del contenido del
          menú se desmonta con él apenas se cierra. Siempre montado (cerrado
          no renderiza nada): al anular, la página se refresca y `paid` pasa a
          false mientras el diálogo todavía hace su animación de cierre. */}
      <UndoPaymentDialog
        open={undoOpen}
        onOpenChange={setUndoOpen}
        settlementId={settlementId}
      />
    </>
  );
}
