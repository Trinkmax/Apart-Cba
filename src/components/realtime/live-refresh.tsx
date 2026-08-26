"use client";

import { useLiveContext } from "@/lib/realtime/live-context";
import { useLiveRefresh } from "@/lib/realtime/use-live";
import { defaultRefreshGate } from "@/lib/realtime/gates";
import { LiveUpdatesPill } from "@/components/realtime/live-updates-pill";

/**
 * Conecta una pantalla renderizada en el server a la capa en vivo con una sola
 * línea. No pinta nada salvo la píldora "N novedades" cuando hay cambios
 * retenidos (diálogo abierto, pestaña de fondo).
 *
 *   <LiveRefresh tables={["booking_requests"]} label="solicitud" labelPlural="solicitudes" />
 */
export function LiveRefresh({
  tables,
  throttleMs = 3_000,
  label,
  labelPlural,
  /**
   * Para limpieza y mantenimiento: esos roles sólo ven las filas asignadas a
   * ellos, pero el filtro del canal era por organización — o sea que el
   * WebSocket les mandaba igual toda la operación de la org (montos, teléfonos)
   * y el descarte era cosmético, en el navegador. Con esto el filtro viaja al
   * server y sólo reciben lo suyo. La RLS sigue garantizando el alcance de org.
   */
  assigneeScoped = false,
  pollMs,
}: {
  tables: string[];
  throttleMs?: number;
  label?: string;
  labelPlural?: string;
  assigneeScoped?: boolean;
  pollMs?: number;
}) {
  const ctx = useLiveContext();
  const restricted =
    assigneeScoped && (ctx?.role === "limpieza" || ctx?.role === "mantenimiento");

  const live = useLiveRefresh({
    tables,
    throttleMs,
    canRefresh: defaultRefreshGate,
    filterFor: restricted && ctx ? () => `assigned_to=eq.${ctx.userId}` : undefined,
    // Realtime admite UN solo filtro por suscripción: al filtrar por asignado
    // perdemos el de organización, y la RLS deja pasar TODAS las membresías
    // del usuario. Un operador que trabaja en dos organizaciones recibiría
    // filas de la otra. Lo volvemos a atar acá.
    accept: restricted && ctx
      ? (change) => {
          const org = (change.new ?? change.old)?.organization_id;
          return typeof org !== "string" || org === ctx.organizationId;
        }
      : undefined,
    // Con el filtro por asignado, una tarea que se reasigna a OTRA persona no
    // genera evento para quien la pierde. El poll corto tapa ese hueco sin
    // volver a mandarle por el cable toda la operación de la organización.
    pollMs: pollMs ?? (restricted ? 60_000 : undefined),
  });

  return (
    <LiveUpdatesPill
      count={live.pending}
      onApply={live.apply}
      isRefreshing={live.isRefreshing}
      label={label}
      labelPlural={labelPlural}
    />
  );
}
