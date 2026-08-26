"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { requestResync } from "@/lib/realtime/manager";
import { useLiveStatus, type LiveConnection } from "@/lib/realtime/use-live";
import { cn } from "@/lib/utils";

/**
 * Único indicador de conexión de la app, en la barra superior.
 *
 * La regla dura: **nunca verde si el dato puede estar viejo.** El equipo va a
 * dejar de apretar F5 en cuanto esto exista, así que el día que el canal se
 * caiga en silencio, el daño es peor que hoy si el indicador miente.
 */

type Look = {
  dot: string;
  label: string;
  tone: string;
  actionable: boolean;
};

function relative(ms: number | null, now: number): string {
  if (!ms) return "sin novedades todavía";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "recién";
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return `hace ${h} h`;
}

export function LiveIndicator({ className }: { className?: string }) {
  const router = useRouter();
  const { connection, lastEventAt, channels } = useLiveStatus();
  // `now` tiene que ser un valor reactivo que ENTRE al cálculo: con
  // reactCompiler, un `forceTick` cuyo estado se descarta no invalida el memo
  // de `relative(lastEventAt)` y el "hace X" quedaba congelado.
  const [now, setNow] = useState(() => Date.now());

  // Latido honesto: un pulso por evento recibido, no una animación permanente
  // (una animación que corre siempre no informa nada). El `key` reinicia la
  // animación CSS; el ajuste de estado durante el render evita el setState
  // dentro de un efecto.
  const [prevEventAt, setPrevEventAt] = useState(lastEventAt);
  const [pulseKey, setPulseKey] = useState(0);
  if (prevEventAt !== lastEventAt) {
    setPrevEventAt(lastEventAt);
    setPulseKey((n) => n + 1);
  }

  // Un corte de medio segundo no merece pintar la UI de ámbar: los estados
  // degradados sólo se muestran si se sostienen unos segundos. Los definitivos
  // (en vivo, sesión vencida, datos viejos) se aplican al instante.
  const [settled, setSettled] = useState<LiveConnection>(connection);
  const [prevConn, setPrevConn] = useState(connection);
  if (prevConn !== connection) {
    setPrevConn(connection);
    if (connection === "live" || connection === "auth-lost" || connection === "stale") {
      setSettled(connection);
    }
  }
  useEffect(() => {
    if (connection === "live" || connection === "auth-lost" || connection === "stale") {
      return;
    }
    const t = setTimeout(() => setSettled(connection), 3_000);
    return () => clearTimeout(t);
  }, [connection]);

  // Refresca el "hace X" del tooltip sin re-renderizar el resto de la app.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const look: Look = {
    live: {
      dot: "bg-emerald-500",
      label: "En vivo",
      tone: "text-muted-foreground",
      actionable: false,
    },
    connecting: {
      dot: "bg-muted-foreground/50",
      label: "Conectando…",
      tone: "text-muted-foreground",
      actionable: false,
    },
    reconnecting: {
      dot: "bg-amber-500",
      label: "Reconectando…",
      tone: "text-amber-600 dark:text-amber-400",
      actionable: true,
    },
    stale: {
      dot: "bg-amber-500",
      label: "Hay datos nuevos",
      tone: "text-amber-600 dark:text-amber-400",
      actionable: true,
    },
    offline: {
      dot: "bg-muted-foreground/50",
      label: "Sin conexión",
      tone: "text-muted-foreground",
      actionable: false,
    },
    "auth-lost": {
      dot: "bg-red-500",
      label: "Sesión vencida",
      tone: "text-red-600 dark:text-red-400",
      actionable: true,
    },
  }[settled];

  // Sin ningún canal suscripto no hay nada de qué estar "en vivo": mostrar un
  // punto verde sería exactamente la clase de mentira que este indicador existe
  // para evitar.
  if (channels === 0) return null;

  const handleClick = () => {
    if (settled === "auth-lost") {
      window.location.reload();
      return;
    }
    requestResync();
    router.refresh();
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            aria-live="polite"
            aria-label={`Estado de actualización: ${look.label}`}
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium",
              "transition-colors hover:bg-accent/60",
              look.tone,
              className
            )}
          >
            <span className="relative flex size-1.5">
              {pulseKey > 0 && settled === "live" && (
                <span
                  key={pulseKey}
                  className={cn(
                    "absolute inline-flex size-full rounded-full opacity-70",
                    look.dot,
                    "animate-live-ping"
                  )}
                />
              )}
              <span className={cn("relative inline-flex size-1.5 rounded-full", look.dot)} />
            </span>
            <span className="hidden sm:inline">{look.label}</span>
            {look.actionable && (
              <RefreshCw
                size={11}
                className="opacity-60 group-hover:opacity-100 transition-opacity"
              />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {settled === "auth-lost" ? (
            <span>La sesión venció. Tocá para recargar.</span>
          ) : (
            <span>
              Última novedad: {relative(lastEventAt, now)}
              <br />
              <span className="opacity-70">Tocá para actualizar ahora</span>
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
