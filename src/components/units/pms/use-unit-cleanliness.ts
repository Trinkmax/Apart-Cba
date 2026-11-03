"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listUnitCleanliness, setUnitCleanliness } from "@/lib/actions/cleaning";
import { useLiveTable } from "@/lib/realtime/use-live";
import type { UnitCleanliness } from "@/lib/cleaning/cleanliness";

export type CleanlinessMap = Record<string, UnitCleanliness>;
export type CleanlinessTarget = "limpio" | "sucio";

/** Una ráfaga (un sync de iCal con 20 reservas) termina en una sola relectura. */
const RELOAD_DELAY_MS = 800;
const DAY_CHECK_MS = 60_000;

const localDay = () => new Date().toDateString();

/**
 * Qué unidades están sucias, en vivo.
 *
 * El estado depende de reservas, tareas y unidades, y de qué día es: los eventos
 * se usan de aviso y se relee del servidor, que es el único que ve todo junto.
 * Si la relectura falla se conserva lo que había: "no pude leer" no es "está todo
 * limpio".
 */
export function useUnitCleanliness({
  initial,
  enabled,
}: {
  /** `null`: el servidor no pudo leerlo. */
  initial: CleanlinessMap | null;
  enabled: boolean;
}) {
  const [byUnit, setByUnit] = useState<CleanlinessMap>(initial ?? {});
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    if (initial) setByUnit(initial);
  }

  const byUnitRef = useRef(byUnit);
  useEffect(() => {
    byUnitRef.current = byUnit;
  }, [byUnit]);

  const readSeq = useRef(0);
  const writesInFlight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const seq = ++readSeq.current;
    const next = await listUnitCleanliness().catch(() => null);
    // Una respuesta vieja, o una lectura que salió antes de que terminara un clic,
    // pisaría lo que la persona acaba de marcar.
    if (!next || seq !== readSeq.current || writesInFlight.current > 0) return;
    setByUnit(next);
  }, []);

  const scheduleReload = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void reload();
    }, RELOAD_DELAY_MS);
  }, [reload]);

  useLiveTable({ table: "cleaning_tasks", enabled, onChange: scheduleReload, onResync: scheduleReload });
  useLiveTable({ table: "bookings", enabled, onChange: scheduleReload });
  useLiveTable({ table: "units", enabled, onChange: scheduleReload });

  useEffect(() => {
    if (!enabled) return;
    if (initial === null) scheduleReload();
    // Un calendario abierto de un día para el otro: "mañana" pasa a ser "hoy".
    let day = localDay();
    const interval = setInterval(() => {
      if (localDay() === day) return;
      day = localDay();
      scheduleReload();
    }, DAY_CHECK_MS);
    return () => {
      clearInterval(interval);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [enabled, initial, scheduleReload]);

  const apply = useCallback(
    async (unit: { id: string; code: string }, target: CleanlinessTarget): Promise<boolean> => {
      const previous = byUnitRef.current[unit.id] ?? null;
      const write = (state: UnitCleanliness | null) =>
        setByUnit((current) => {
          const next = { ...current };
          if (state) next[unit.id] = state;
          else delete next[unit.id];
          return next;
        });

      write(target === "sucio" ? { due: "now", overdueSince: null } : null);
      writesInFlight.current += 1;
      const result = await setUnitCleanliness(unit.id, target).catch(() => ({
        ok: false as const,
        error: "No se pudo guardar. Revisá la conexión y probá de nuevo.",
      }));
      writesInFlight.current -= 1;
      // Una lectura que salió durante el clic vio el cambio a medias: se descarta.
      // Los eventos de lo que se acaba de escribir disparan otra, ya completa.
      readSeq.current += 1;

      if (!result.ok) {
        write(previous);
        toast.error(`No se pudo marcar ${unit.code}`, { description: result.error });
        return false;
      }
      write(result.cleanliness);
      return true;
    },
    [],
  );

  const mark = useCallback(
    async (unit: { id: string; code: string }, target: CleanlinessTarget) => {
      if (!(await apply(unit, target))) return;
      const opposite: CleanlinessTarget = target === "limpio" ? "sucio" : "limpio";
      toast.success(`${unit.code} marcado ${target}`, {
        description: target === "sucio" ? "Ya figura en Limpieza." : undefined,
        action: {
          label: "Deshacer",
          onClick: () => {
            void apply(unit, opposite).then((ok) => {
              if (ok) toast.success(`${unit.code} marcado ${opposite}`);
            });
          },
        },
      });
    },
    [apply],
  );

  return { byUnit, mark };
}
