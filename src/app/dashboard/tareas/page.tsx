import { ListTodo, Plus, Sparkles } from "lucide-react";
import { listConciergeRequests, listAssignableMembers } from "@/lib/actions/concierge";
import { listUnitsEnriched } from "@/lib/actions/units";
import { getCurrentOrg } from "@/lib/actions/org";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConciergeBoard } from "@/components/concierge/concierge-board";
import { ConciergeFormDialog } from "@/components/concierge/concierge-form-dialog";
import { HistoryToggle } from "@/components/shared/history-toggle";
import {
  WeeklyHistoryTable,
  type HistoryRow,
} from "@/components/shared/weekly-history-table";

const CONCIERGE_STATUS_META: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "#94a3b8" },
  en_progreso: { label: "En progreso", color: "#3b82f6" },
  completada: { label: "Completada", color: "#10b981" },
  rechazada: { label: "Rechazada", color: "#ef4444" },
  cancelada: { label: "Cancelada", color: "#64748b" },
};

type ConciergeRow = {
  id: string;
  status: string;
  description: string;
  scheduled_for: string | null;
  archived_at: string | null;
  unit?: { code?: string | null; name?: string | null } | null;
};

export default async function TareasPage({
  searchParams,
}: {
  searchParams: Promise<{ historial?: string }>;
}) {
  const { historial } = await searchParams;
  const showArchived = historial === "1";

  const [{ organization }, requests, units, members] = await Promise.all([
    getCurrentOrg(),
    listConciergeRequests({ showArchived }),
    listUnitsEnriched(),
    listAssignableMembers(),
  ]);
  const unitsLite = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));

  const pendientes = (requests as { status: string }[]).filter(
    (r) => r.status === "pendiente"
  ).length;
  const isEmpty = requests.length === 0;

  const historyRows: HistoryRow[] = showArchived
    ? (requests as unknown as ConciergeRow[]).map((r) => {
        const meta = CONCIERGE_STATUS_META[r.status];
        const unitLabel = r.unit
          ? `${r.unit.code ?? ""}${r.unit.name ? ` · ${r.unit.name}` : ""}`.trim()
          : null;
        return {
          id: r.id,
          title: r.description,
          subtitle: unitLabel,
          statusLabel: meta?.label ?? r.status,
          statusColor: meta?.color ?? "#64748b",
          archivedAt: r.archived_at!,
          primaryDate: r.scheduled_for,
        };
      })
    : [];

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ListTodo className="size-5 text-primary" />
            Tareas {showArchived ? <span className="text-muted-foreground font-normal">· Historial</span> : null}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {showArchived ? (
              <>
                {requests.length} tareas archivadas
                <span className="hidden sm:inline"> · finalizadas en semanas anteriores</span>
              </>
            ) : (
              <>
                {requests.length} tareas · {pendientes} pendientes
                <span className="hidden sm:inline"> · arrastrá las cards entre columnas</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HistoryToggle basePath="/dashboard/tareas" active={showArchived} />
          {!showArchived && (
            <ConciergeFormDialog units={unitsLite} members={members}>
              <Button className="gap-2 shadow-md sm:h-10 sm:text-base sm:px-6">
                <Plus size={18} /> Nueva tarea
              </Button>
            </ConciergeFormDialog>
          )}
        </div>
      </div>

      {showArchived ? (
        <WeeklyHistoryTable
          rows={historyRows}
          emptyHint="Todavía no hay tareas archivadas."
        />
      ) : (
        <>
          {/* Empty-state hero: CTA imposible de no ver cuando todavía no hay tareas */}
          {isEmpty && (
            <Card className="border-dashed bg-gradient-to-br from-primary/5 via-background to-background p-8 text-center">
              <div className="mx-auto max-w-md space-y-4">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="size-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Todavía no cargaste ninguna tarea</h2>
                  <p className="text-sm text-muted-foreground">
                    Las tareas son pedidos puntuales para conserjería, mantenimiento o limpieza.
                    Asignalas a un miembro del equipo, definí prioridad y arrastralas entre columnas
                    para llevar el seguimiento.
                  </p>
                </div>
                <ConciergeFormDialog units={unitsLite} members={members}>
                  <Button size="lg" className="gap-2">
                    <Plus size={18} /> Crear primera tarea
                  </Button>
                </ConciergeFormDialog>
              </div>
            </Card>
          )}

          <ConciergeBoard
            organizationId={organization.id}
            initialRequests={requests as never}
            units={unitsLite}
            members={members}
          />
        </>
      )}
    </div>
  );
}
