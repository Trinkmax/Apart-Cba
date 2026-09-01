"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { countPendingRequestsForOrg } from "@/lib/actions/booking-requests";
import { useLiveTable } from "@/lib/realtime/use-live";
import { cn } from "@/lib/utils";

/**
 * Contador de solicitudes del marketplace esperando respuesta.
 *
 * Por qué en el sidebar y no sólo en su pantalla: una solicitud NO bloquea la
 * disponibilidad (la fila en `bookings` recién existe cuando alguien la
 * aprueba) y expira a las 48 h. La ventana en la que nadie la ve es exactamente
 * la ventana en la que el equipo vende esas mismas fechas por otro canal. Tiene
 * que verse desde cualquier pantalla, no sólo si alguien pasa por la ruta.
 *
 * Se recuenta con una query barata en vez de refrescar toda la ruta: el
 * calendario no tiene por qué re-ejecutar sus consultas porque entró una
 * solicitud.
 */
export function PendingRequestsBadge({
  initialCount,
  canViewChannels = false,
  className,
}: {
  initialCount: number;
  /**
   * Sin esto el badge suscribía `channel_reservations` para cualquier rol con
   * `bookings:view` — `owner_view` incluido — y recibía por WebSocket cada
   * INSERT/UPDATE con `guest` y `amounts` de todas las unidades, esquivando el
   * `can(role,'channels','view')` que sí aplica al conteo.
   */
  canViewChannels?: boolean;
  className?: string;
}) {
  const [count, setCount] = useState(initialCount);
  const [prevInitial, setPrevInitial] = useState(initialCount);
  if (prevInitial !== initialCount) {
    setPrevInitial(initialCount);
    setCount(initialCount);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recount = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      try {
        setCount(await countPendingRequestsForOrg());
      } catch {
        /* el badge no puede tumbar el sidebar */
      }
    }, 800);
  }, []);

  useEffect(() => {
    const t = timer;
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, []);

  useLiveTable({
    table: "booking_requests",
    onChange: recount,
    onResync: recount,
  });


  if (count <= 0) return canViewChannels ? <ChannelRequestsWatcher onEvent={recount} /> : null;
  return (
    <>
      {canViewChannels ? <ChannelRequestsWatcher onEvent={recount} /> : null}
    <span
      aria-label={`${count} ${count === 1 ? "solicitud pendiente" : "solicitudes pendientes"}`}
      className={cn(
        "ml-auto inline-flex min-w-[1.25rem] h-5 items-center justify-center rounded-full px-1.5",
        "bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-semibold tabular-nums",
        "ring-1 ring-amber-500/30",
        className
      )}
    >
      {count > 99 ? "99+" : count}
      </span>
    </>
  );
}

/**
 * Suscripción aparte para poder montarla sólo con permiso de canales: un hook
 * no se puede llamar condicionalmente, pero un componente sí.
 */
function ChannelRequestsWatcher({ onEvent }: { onEvent: () => void }) {
  useLiveTable({
    table: "channel_reservations",
    onChange: onEvent,
    onResync: onEvent,
  });
  return null;
}
