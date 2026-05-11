import { Plus, Sparkles } from "lucide-react";
import { listCleaningTasks } from "@/lib/actions/cleaning";
import { listUnitsEnriched } from "@/lib/actions/units";
import { getCurrentOrg } from "@/lib/actions/org";
import { Button } from "@/components/ui/button";
import { CleaningBoard } from "@/components/cleaning/cleaning-board";
import { CleaningFormDialog } from "@/components/cleaning/cleaning-form-dialog";
import { HistoryToggle } from "@/components/shared/history-toggle";
import {
  WeeklyHistoryTable,
  type HistoryRow,
} from "@/components/shared/weekly-history-table";
import { CLEANING_STATUS_META } from "@/lib/constants";
import type { CleaningTask, CleaningStatus, Unit } from "@/lib/types/database";

type CT = CleaningTask & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function LimpiezaPage({
  searchParams,
}: {
  searchParams: Promise<{ historial?: string }>;
}) {
  const { historial } = await searchParams;
  const showArchived = historial === "1";

  const [{ organization }, tasks, units] = await Promise.all([
    getCurrentOrg(),
    listCleaningTasks({ showArchived }) as Promise<CT[]>,
    listUnitsEnriched(),
  ]);

  const pendientes = tasks.filter((t) => t.status === "pendiente").length;
  const unitsLite = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));

  const historyRows: HistoryRow[] = showArchived
    ? tasks.map((t) => {
        const meta = CLEANING_STATUS_META[t.status as CleaningStatus];
        return {
          id: t.id,
          title: `${t.unit.code || "—"} · ${t.unit.name || ""}`.trim(),
          subtitle: t.notes ?? null,
          statusLabel: meta?.label ?? t.status,
          statusColor: meta?.color ?? "#64748b",
          archivedAt: t.archived_at!,
          primaryDate: t.scheduled_for,
        };
      })
    : [];

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="size-5 text-cyan-500" />
            Limpieza {showArchived ? <span className="text-muted-foreground font-normal">· Historial</span> : null}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {showArchived ? (
              <>
                {tasks.length} tareas archivadas
                <span className="hidden sm:inline"> · finalizadas en semanas anteriores</span>
              </>
            ) : (
              <>
                {tasks.length} tareas · {pendientes} pendientes
                <span className="hidden sm:inline">
                  {" "}
                  · arrastrá las cards entre columnas para cambiar el estado
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HistoryToggle basePath="/dashboard/limpieza" active={showArchived} />
          {!showArchived && (
            <CleaningFormDialog units={unitsLite}>
              <Button className="gap-2">
                <Plus size={16} /> Nueva tarea
              </Button>
            </CleaningFormDialog>
          )}
        </div>
      </div>

      {showArchived ? (
        <WeeklyHistoryTable
          rows={historyRows}
          emptyHint="Todavía no hay tareas de limpieza archivadas."
        />
      ) : (
        <CleaningBoard organizationId={organization.id} initialTasks={tasks} units={unitsLite} />
      )}
    </div>
  );
}
