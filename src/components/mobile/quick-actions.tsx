"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarPlus, HandCoins, Search, Wrench } from "lucide-react";
import { haptic } from "@/lib/ui/haptics";
import { openTex, originOf } from "./shell-store";

/**
 * Accesos rápidos de Hoy en el celular (nov-2026): lo que más se hace con el
 * teléfono en la mano. Con Tex, "Cobrar" y "Disponibilidad" se los piden a él
 * (que arma la propuesta y vos confirmás); sin Tex, llevan a la pantalla.
 * El gasto usa el diálogo de siempre (`expenseSlot`).
 */
export function QuickActions({
  texEnabled,
  canBookings,
  canPayments,
  canTickets,
  expenseSlot,
}: {
  texEnabled: boolean;
  canBookings: boolean;
  canPayments: boolean;
  canTickets: boolean;
  /** El botón de "Registrar gasto" ya envuelto en su diálogo (server). */
  expenseSlot?: React.ReactNode;
}) {
  const pill =
    "lg-tile flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2.5 text-[14px] font-semibold whitespace-nowrap active:scale-[0.97]";
  const ask = (e: React.MouseEvent<HTMLButtonElement>, prompt: string) => {
    haptic("impact");
    openTex({ origin: originOf(e.currentTarget), prompt });
  };
  return (
    <div className="no-scrollbar -mx-[0.875rem] flex gap-2 overflow-x-auto px-[0.875rem] py-0.5 md:hidden">
      {canBookings ? (
        <Link href="/dashboard/unidades/kanban" className={pill}>
          <CalendarPlus className="size-[18px] text-[oklch(0.45_0.09_152)] dark:text-[oklch(0.84_0.09_150)]" aria-hidden />
          Nueva reserva
        </Link>
      ) : null}
      {expenseSlot}
      {canPayments ? (
        texEnabled ? (
          <button type="button" className={pill} onClick={(e) => ask(e, "Quiero registrar un cobro de una reserva.")}>
            <HandCoins className="size-[18px] text-emerald-600" aria-hidden />
            Cobrar
          </button>
        ) : (
          <Link href="/dashboard/reservas" className={pill}>
            <HandCoins className="size-[18px] text-emerald-600" aria-hidden />
            Cobrar
          </Link>
        )
      ) : null}
      {canBookings && texEnabled ? (
        <button type="button" className={pill} onClick={(e) => ask(e, "¿Qué unidades están libres este fin de semana?")}>
          <Search className="size-[18px] text-sky-600" aria-hidden />
          Disponibilidad
        </button>
      ) : null}
      {canTickets ? (
        <Link href="/dashboard/mantenimiento" className={pill}>
          <Wrench className="size-[18px] text-amber-600" aria-hidden />
          Ticket
        </Link>
      ) : null}
    </div>
  );
}
