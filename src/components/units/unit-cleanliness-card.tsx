"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setUnitCleanliness } from "@/lib/actions/cleaning";
import {
  CLEANLINESS_LABEL,
  cleanlinessHint,
  type UnitCleanliness,
} from "@/lib/cleaning/cleanliness";
import { CleanlinessSwitch } from "@/components/units/pms/unit-cleanliness-controls";
import type { CleanlinessTarget } from "@/components/units/pms/use-unit-cleanliness";

/** Sucio / limpio en la ficha de la unidad. El mismo botón que el calendario. */
export function UnitCleanlinessCard({
  unitId,
  initial,
}: {
  unitId: string;
  initial: UnitCleanliness | null;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setState(initial);
  }
  const [pending, startTransition] = useTransition();

  function mark(target: CleanlinessTarget) {
    startTransition(async () => {
      const result = await setUnitCleanliness(unitId, target).catch(() => ({
        ok: false as const,
        error: "No se pudo guardar. Revisá la conexión y probá de nuevo.",
      }));
      if (!result.ok) {
        toast.error("No se pudo marcar", { description: result.error });
        return;
      }
      setState(result.cleanliness);
      toast.success(`Marcado ${target}`);
      // El estado de la unidad de arriba también pudo cambiar.
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <CleanlinessSwitch state={state} onMark={mark} disabled={pending} />
      {state && (
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-cyan-800 dark:text-cyan-300">
            {CLEANLINESS_LABEL[state.due]}.
          </span>{" "}
          {cleanlinessHint(state)}
        </span>
      )}
    </div>
  );
}
