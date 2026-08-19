"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BOOKING_STATUS_META } from "@/lib/constants";
import { changeBookingStatus } from "@/lib/actions/bookings";
import type { BookingStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";

/**
 * El estado de la reserva, editable desde el badge.
 *
 * Por qué existe: los botones de `BookingActions` modelan el camino feliz
 * (confirmar → check-in → check-out) y no dejan volver atrás. En la vida real el
 * estado se desincroniza — la OTA cancela algo que en verdad sigue en pie, se
 * marca un check-out de más, una cancelación fue un error — y el único camino
 * para arreglarlo era abrir "Editar", encontrar el select de Estado en medio del
 * formulario y guardar todo el resto. Una reserva cancelada quedaba directamente
 * sin ninguna acción a la vista.
 *
 * Cambiar el estado acá es lo mismo que cambiarlo por cualquier otro camino: la
 * reserva entra o sale de Caja, liquidaciones, KPIs, parte diario y limpieza
 * automática, que filtran por `status`. La única diferencia deliberada es que
 * reactivar NO dispara el evento de CRM: corregir un estado no es motivo para
 * volver a escribirle al huésped (para eso está "Reenviar confirmación").
 *
 * La confirmación de los estados destructivos vive DENTRO del menú, no en un
 * dialog: este componente se renderiza también dentro del popover del
 * calendario, y un modal anidado adentro de un popover de Radix se cierra solo
 * (el modal roba el foco, el popover lo lee como "click afuera" y desmonta a los
 * dos). Un paso más en el mismo menú no tiene ese problema.
 */

interface Props {
  bookingId: string;
  status: BookingStatus;
  /** Sin permiso de edición se muestra el estado como texto, sin menú. */
  canEdit?: boolean;
  /** "badge" para el header del detalle; "inline" para el popover del calendario. */
  variant?: "badge" | "inline";
  onChanged?: (next: BookingStatus) => void;
}

const ORDER: BookingStatus[] = [
  "pendiente",
  "confirmada",
  "check_in",
  "check_out",
  "cancelada",
  "no_show",
];

/** Los que sacan la reserva de la operación y liberan las fechas. */
const DESTRUCTIVE: BookingStatus[] = ["cancelada", "no_show"];

export function BookingStatusMenu({
  bookingId,
  status,
  canEdit = true,
  variant = "badge",
  onChanged,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<BookingStatus | null>(null);
  const meta = BOOKING_STATUS_META[status];
  const wasInactive = DESTRUCTIVE.includes(status);

  function apply(next: BookingStatus) {
    if (next === status) return;
    if (DESTRUCTIVE.includes(next)) {
      setConfirming(next); // segundo paso dentro del mismo menú
      return;
    }
    run(next);
  }

  function run(next: BookingStatus) {
    startTransition(async () => {
      try {
        await changeBookingStatus(bookingId, next);
        toast.success(`Reserva marcada como ${BOOKING_STATUS_META[next].label}`, {
          description: wasInactive
            ? "Vuelve a contar en Caja, liquidaciones, KPIs, parte diario y limpieza."
            : undefined,
        });
        setConfirming(null);
        setOpen(false);
        onChanged?.(next);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo cambiar el estado", {
          description: friendly((e as Error).message),
        });
      }
    });
  }

  if (!canEdit) {
    return <StatusChip status={status} variant={variant} />;
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setConfirming(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            variant === "badge"
              ? "border px-2 py-0.5 text-xs font-normal hover:brightness-95 dark:hover:brightness-125"
              : "text-[11px] font-semibold uppercase tracking-wider hover:opacity-80",
            pending && "opacity-60",
          )}
          style={
            variant === "badge"
              ? {
                  color: meta.color,
                  backgroundColor: meta.color + "15",
                  borderColor: meta.color + "30",
                }
              : { color: meta.color }
          }
          title="Cambiar estado"
        >
          {pending ? (
            <Loader2 size={variant === "badge" ? 11 : 10} className="animate-spin" />
          ) : (
            <span
              className={variant === "badge" ? "status-dot" : "size-2 rounded-full"}
              style={{ backgroundColor: meta.color }}
            />
          )}
          {meta.label}
          <ChevronDown size={variant === "badge" ? 12 : 10} className="opacity-60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        {confirming ? (
          <div className="p-2.5 space-y-2.5">
            <div className="flex gap-2">
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
              />
              <p className="text-[11px] leading-relaxed">
                <span className="font-semibold">
                  {confirming === "no_show"
                    ? "Marcar como no-show"
                    : "Cancelar esta reserva"}
                </span>
                {" — "}las fechas quedan libres para vender y sale de Caja, de las
                liquidaciones, del parte diario y de la limpieza automática. Se
                puede reactivar desde este mismo menú.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 flex-1 text-xs"
                disabled={pending}
                onClick={() => setConfirming(null)}
              >
                Volver
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 flex-1 gap-1.5 text-xs"
                disabled={pending}
                onClick={() => run(confirming)}
              >
                {pending && <Loader2 size={12} className="animate-spin" />}
                Confirmar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Estado de la reserva
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ORDER.map((s) => {
              const m = BOOKING_STATUS_META[s];
              return (
                <DropdownMenuItem
                  key={s}
                  // Los destructivos abren el paso de confirmación acá adentro,
                  // así que el menú NO se puede cerrar con el select.
                  onSelect={(e) => {
                    if (DESTRUCTIVE.includes(s)) e.preventDefault();
                    apply(s);
                  }}
                  disabled={pending}
                  className={cn("gap-2 text-xs", DESTRUCTIVE.includes(s) && "text-destructive")}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: m.color }}
                  />
                  <span className="flex-1">{m.label}</span>
                  {s === status && <Check size={13} className="opacity-70" />}
                </DropdownMenuItem>
              );
            })}
            {wasInactive && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => apply("confirmada")}
                  disabled={pending}
                  className="gap-2 text-xs font-medium"
                >
                  <RotateCcw size={13} />
                  Reactivar como confirmada
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusChip({
  status,
  variant,
}: {
  status: BookingStatus;
  variant: "badge" | "inline";
}) {
  const m = BOOKING_STATUS_META[status];
  if (variant === "inline") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: m.color }}
      >
        <span className="size-2 rounded-full" style={{ backgroundColor: m.color }} />
        {m.label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-normal"
      style={{ color: m.color, backgroundColor: m.color + "15", borderColor: m.color + "30" }}
    >
      <span className="status-dot" style={{ backgroundColor: m.color }} />
      {m.label}
    </span>
  );
}

/** El check-out con saldo llega con un prefijo machine-readable del server. */
function friendly(raw: string): string {
  return raw.startsWith("CHECKOUT_PENDING_BALANCE:")
    ? raw.replace("CHECKOUT_PENDING_BALANCE: ", "")
    : raw;
}
