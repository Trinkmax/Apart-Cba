import { ListTodo, Plus, Sparkles } from "lucide-react";
import { listConciergeRequests, listAssignableMembers } from "@/lib/actions/concierge";
import { listUnitsEnriched } from "@/lib/actions/units";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConciergeBoard } from "@/components/concierge/concierge-board";
import { ConciergeFormDialog } from "@/components/concierge/concierge-form-dialog";

export default async function TareasPage() {
  const [requests, units, members] = await Promise.all([
    listConciergeRequests(),
    listUnitsEnriched(),
    listAssignableMembers(),
  ]);
  const unitsLite = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));

  const pendientes = (requests as { status: string }[]).filter(
    (r) => r.status === "pendiente"
  ).length;
  const isEmpty = requests.length === 0;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ListTodo className="size-5 text-primary" />
            Tareas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {requests.length} tareas · {pendientes} pendientes · arrastrá las cards entre columnas
          </p>
        </div>
        <ConciergeFormDialog units={unitsLite} members={members}>
          <Button size="lg" className="gap-2 shadow-md">
            <Plus size={18} /> Nueva tarea
          </Button>
        </ConciergeFormDialog>
      </div>

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

      <ConciergeBoard initialRequests={requests as never} units={unitsLite} members={members} />
    </div>
  );
}
