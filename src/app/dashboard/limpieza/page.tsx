import { Plus, Sparkles } from "lucide-react";
import { listCleaningTasks } from "@/lib/actions/cleaning";
import { listUnitsEnriched } from "@/lib/actions/units";
import { Button } from "@/components/ui/button";
import { CleaningBoard } from "@/components/cleaning/cleaning-board";
import { CleaningFormDialog } from "@/components/cleaning/cleaning-form-dialog";
import type { CleaningTask, Unit } from "@/lib/types/database";

type CT = CleaningTask & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function LimpiezaPage() {
  const [tasks, units] = await Promise.all([
    listCleaningTasks() as Promise<CT[]>,
    listUnitsEnriched(),
  ]);

  const pendientes = tasks.filter((t) => t.status === "pendiente").length;
  const unitsLite = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="size-5 text-cyan-500" />
            Limpieza
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {tasks.length} tareas · {pendientes} pendientes
            <span className="hidden sm:inline"> · arrastrá las cards entre columnas para cambiar el estado</span>
          </p>
        </div>
        <CleaningFormDialog units={unitsLite}>
          <Button className="gap-2">
            <Plus size={16} /> Nueva tarea
          </Button>
        </CleaningFormDialog>
      </div>

      <CleaningBoard initialTasks={tasks} units={unitsLite} />
    </div>
  );
}
