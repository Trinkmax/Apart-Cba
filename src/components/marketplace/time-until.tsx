"use client";

import { useEffect, useState } from "react";
import { remainingLabel } from "@/components/marketplace/reservation/format";

/**
 * Cuenta regresiva hasta un timestamp ISO. Se recalcula cada minuto en el
 * cliente. Antes de hidratar no muestra nada calculado (la hora del server y
 * la del navegador no coinciden), así que conviene acompañarla SIEMPRE con la
 * fecha absoluta ("antes del jue 2 oct a las 14 h").
 *
 * - compact (por defecto, panel): "en 5h", "en 12m".
 * - friendly (web): "faltan 5 horas", "falta 1 hora", "faltan 2 días".
 */
export function TimeUntil({
  isoDeadline,
  expiredLabel = "Expirada",
  variant = "compact",
  className,
}: {
  isoDeadline: string;
  expiredLabel?: string;
  variant?: "compact" | "friendly";
  className?: string;
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
    // Render del server: sin diferencia calculada (evita saltos al hidratar).
    // friendly va siempre junto a la fecha absoluta: antes de hidratar no se
    // muestra nada (evita una pastilla vacía).
    return variant === "friendly" ? null : <span className={className}>—</span>;
  }

  const diffMs = new Date(isoDeadline).getTime() - now;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return <span className={className}>{expiredLabel}</span>;

  if (variant === "friendly") {
    return <span className={className}>{remainingLabel(diffMs)}</span>;
  }

  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours >= 1) return <span className={className}>en {hours}h</span>;
  const minutes = Math.floor(diffMs / (60 * 1000));
  return <span className={className}>en {minutes}m</span>;
}

/**
 * Devuelve `true` si el deadline pasó (null antes de hidratar). Se recalcula
 * cada minuto.
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
