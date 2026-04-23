import { Sparkles } from "lucide-react";
import { listCleaningTasks } from "@/lib/actions/cleaning";
import { CleaningBoard } from "@/components/cleaning/cleaning-board";
import type { CleaningTask, Unit } from "@/lib/types/database";

type CT = CleaningTask & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function LimpiezaPage() {
  const tasks = (await listCleaningTasks()) as CT[];

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="size-5 text-cyan-500" />
          Limpieza
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {tasks.length} tareas · {tasks.filter((t) => t.status === "pendiente").length} pendientes
        </p>
      </div>

      <CleaningBoard tasks={tasks} />
    </div>
  );
}
