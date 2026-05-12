"use client";

import { useEffect, useState } from "react";

/**
 * Devuelve las horas restantes hasta un timestamp ISO.
 * Se recalcula cada minuto en cliente para mostrar countdown vivo.
 */
export function TimeUntil({
  isoDeadline,
  expiredLabel = "Expirada",
}: {
  isoDeadline: string;
  expiredLabel?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const initial = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);

  if (now === null) {
    // Render inicial server-side: solo mostramos el deadline ISO sin diff
    return <span>—</span>;
  }
  const diffMs = new Date(isoDeadline).getTime() - now;
  if (diffMs <= 0) return <span>{expiredLabel}</span>;
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours >= 1) return <span>en {hours}h</span>;
  const minutes = Math.floor(diffMs / (60 * 1000));
  return <span>en {minutes}m</span>;
}

/**
 * Devuelve `true` si el deadline pasó. Útil para condicionales server-side
 * dentro de una expresión simple (se calcula post-hidratación).
 */
export function useIsPastDeadline(iso: string): boolean | null {
  const [past, setPast] = useState<boolean | null>(null);
  useEffect(() => {
    const update = () => setPast(new Date(iso).getTime() <= Date.now());
    const initial = setTimeout(update, 0);
    const id = setInterval(update, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [iso]);
  return past;
}
