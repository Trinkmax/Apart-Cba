"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { startWatchdog, stopWatchdog } from "@/lib/realtime/manager";
import type { UserRole } from "@/lib/types/database";

/**
 * Identidad mínima que necesita la capa en vivo, disponible en cualquier
 * componente cliente sin prop-drilling: con qué filtramos el canal
 * (`organizationId`), a quién NO le avisamos de sus propios cambios (`userId`)
 * y qué puede ver (`role`).
 */
export interface LiveContextValue {
  organizationId: string;
  userId: string;
  role: UserRole;
  /** Zona horaria de la organización, para fechas en los avisos. */
  timezone: string;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider({
  organizationId,
  userId,
  role,
  timezone = "America/Argentina/Cordoba",
  children,
}: Omit<LiveContextValue, "timezone"> & { timezone?: string; children: ReactNode }) {
  const value = useMemo(
    () => ({ organizationId, userId, role, timezone }),
    [organizationId, userId, role, timezone]
  );

  // El watchdog es la última red: si el canal dice estar vivo pero no llega
  // nada (sesión vencida, socket zombi), compara contra la base y avisa.
  useEffect(() => {
    if (!organizationId) return;
    startWatchdog(organizationId);
    return () => stopWatchdog();
  }, [organizationId]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** Devuelve null fuera del provider (marketplace, login, superadmin). */
export function useLiveContext(): LiveContextValue | null {
  return useContext(LiveContext);
}
